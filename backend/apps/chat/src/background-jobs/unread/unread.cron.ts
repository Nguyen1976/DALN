import { RedisService } from '@app/redis'
import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import {
  ConversationMemberRepository,
  ConversationRepository,
} from '../../repositories'
import {
  CLAIM_SCRIPT,
  DIRTY_BATCH_SIZE,
  DIRTY_CONVERSATIONS_KEY,
  FLUSH_CONCURRENCY,
  RESTORE_SCRIPT,
  lastMessageKey,
  unreadCountKey,
  unreadLastKey,
} from './unread.constants'

function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size))
  }
  return out
}

/** HGETALL trong Lua trả mảng phẳng [k1, v1, k2, v2, ...] -> object. */
function pairsToRecord(flat: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!Array.isArray(flat)) return out
  for (let i = 0; i + 1 < flat.length; i += 2) {
    out[String(flat[i])] = String(flat[i + 1])
  }
  return out
}

type LastMessageSnapshot = {
  seq?: number
  senderId?: string
  lastMessageId?: string
  lastMessageAt?: string
  lastMessageText?: string
  lastMessageSenderName?: string
  lastMessageSenderAvatar?: string | null
}

/** Seq lớn nhất của tin một người gửi trong lượt này: mốc đọc của chính họ. */
type SenderMark = { senderId: string; seq: number }

@Injectable()
export class UnreadCron {
  private readonly logger = new Logger(UnreadCron.name)
  /** Chặn hai lượt cron chồng lên nhau khi một lượt chạy quá 5 giây. */
  private running = false

  constructor(
    private readonly redisService: RedisService,
    private readonly conversationRepo: ConversationRepository,
    private readonly memberRepo: ConversationMemberRepository,
  ) {}

  @Cron(CronExpression.EVERY_5_SECONDS)
  async handleCron() {
    if (this.running) {
      // Lượt trước còn chạy (tải cao) -> bỏ lượt này, việc vẫn nằm trong set.
      return
    }
    this.running = true
    const startedAt = Date.now()

    try {
      // SPOP nguyên tử: nhiều bản sao service chạy song song sẽ không xử lý
      // trùng cùng một conversation (điều mà SMEMBERS + DEL không đảm bảo).
      const conversationIds = await this.redisService.spop(
        DIRTY_CONVERSATIONS_KEY,
        DIRTY_BATCH_SIZE,
      )
      if (conversationIds.length === 0) return

      let failed = 0

      // Chia lô chạy song song thay vì `for await` tuần tự. Ở peak, 500
      // conversation x ~4 round-trip nối tiếp không thể xong trong cửa sổ 5
      // giây; giới hạn đồng thời giữ Mongo không bị dội quá tải.
      for (const chunk of chunkArray(conversationIds, FLUSH_CONCURRENCY)) {
        const results = await Promise.allSettled(
          chunk.map((id) => this.flushConversation(id)),
        )
        const retry = chunk.filter((_id, i) => results[i].status === 'rejected')
        if (retry.length) {
          failed += retry.length
          await this.redisService.sadd(DIRTY_CONVERSATIONS_KEY, ...retry)
        }
      }

      const elapsed = Date.now() - startedAt
      if (failed > 0 || elapsed > 4000) {
        this.logger.warn(
          `[Batch Update] ${conversationIds.length} conversation trong ${elapsed}ms, ${failed} trả lại hàng đợi`,
        )
      } else {
        this.logger.debug(
          `[Batch Update] ${conversationIds.length} conversation trong ${elapsed}ms`,
        )
      }
    } finally {
      this.running = false
    }
  }

  /**
   * Gom dữ liệu Redis của một conversation xuống Mongo. Ném lỗi nếu thất bại,
   * SAU khi đã trả phần chưa ghi được về Redis, để handleCron đưa lại hàng đợi.
   *
   * Không còn số đếm: unreadCount = latestSeq − lastReadSeq. Mỗi hội thoại chỉ
   * còn ba lệnh thô, đều "chỉ tiến lên" ($max / so seq) nên chạy lại vô hại và
   * không cần transaction — bản cũ dùng Prisma updateMany (mỗi lệnh một
   * transaction) và hai lệnh song song trên cùng document abort lẫn nhau.
   */
  private async flushConversation(conversationId: string): Promise<void> {
    const keys = [
      unreadCountKey(conversationId),
      lastMessageKey(conversationId),
      unreadLastKey(conversationId),
    ]

    // Claim TRƯỚC khi đọc: lấy-và-xoá các key trong một script nguyên tử. Tin
    // đến sau lúc claim rơi vào key mới tinh và được lượt sau xử lý.
    const claimed = await this.redisService.eval(CLAIM_SCRIPT, keys)
    const [rawLast, rawNewest] = Array.isArray(claimed)
      ? (claimed as unknown[])
      : []
    const lastMsgString = typeof rawLast === 'string' ? rawLast : null
    const lastMsg = this.parseLastMessage(conversationId, lastMsgString)

    const senders: SenderMark[] = []
    for (const [senderId, raw] of Object.entries(pairsToRecord(rawNewest))) {
      const seq = Number(raw)
      // ObjectId của bản cũ (trước seq): không dùng được làm mốc đọc, bỏ qua.
      if (Number.isInteger(seq) && seq > 0) senders.push({ senderId, seq })
      else
        this.logger.warn(
          `[Batch Update] unread_last cũ, bỏ qua (${conversationId})`,
        )
    }

    const [lastResult, sendersResult] = await Promise.allSettled([
      lastMsg
        ? this.writeLastMessage(conversationId, lastMsg)
        : Promise.resolve(),
      senders.length
        ? this.memberRepo.advanceReadOfSenders(conversationId, senders)
        : Promise.resolve(),
    ])
    const lastFailed = lastResult.status === 'rejected'
    const sendersFailed = sendersResult.status === 'rejected'
    if (!lastFailed && !sendersFailed) return

    await this.restoreClaim(
      conversationId,
      keys,
      sendersFailed ? senders : [],
      lastFailed && lastMsg
        ? { raw: lastMsgString ?? '', seq: lastMsg.seq ?? 0 }
        : null,
    )

    const firstError = [lastResult, sendersResult].find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    )
    throw firstError?.reason
  }

  private async writeLastMessage(
    conversationId: string,
    lastMsg: LastMessageSnapshot,
  ): Promise<void> {
    // Bản Redis từ trước seq không có `seq`: coi là 0 — chỉ ghi khi
    // conversation chưa có tin cuối nào, không bao giờ đè bản mới hơn.
    const seq = typeof lastMsg.seq === 'number' ? lastMsg.seq : 0
    await Promise.all([
      this.conversationRepo.saveLastMessage(conversationId, {
        seq,
        lastMessageId: lastMsg.lastMessageId || undefined,
        lastMessageAt: lastMsg.lastMessageAt
          ? new Date(lastMsg.lastMessageAt)
          : undefined,
        lastMessageText: lastMsg.lastMessageText || '',
        lastMessageSenderId: lastMsg.senderId,
        lastMessageSenderName: lastMsg.lastMessageSenderName,
        lastMessageSenderAvatar: lastMsg.lastMessageSenderAvatar,
      }),
      lastMsg.lastMessageAt
        ? this.memberRepo.advanceMembers(conversationId, {
            lastMessageAt: new Date(lastMsg.lastMessageAt),
            seq,
          })
        : undefined,
    ])
  }

  private parseLastMessage(
    conversationId: string,
    raw: string | null,
  ): LastMessageSnapshot | null {
    if (!raw) return null
    try {
      const parsed: unknown = JSON.parse(raw)
      return parsed && typeof parsed === 'object'
        ? (parsed as LastMessageSnapshot)
        : null
    } catch {
      // JSON hỏng: trả về Redis thì lượt nào cũng hỏng lại, nên bỏ qua.
      this.logger.warn(
        `[Batch Update] last_message hỏng, bỏ qua (${conversationId})`,
      )
      return null
    }
  }

  /**
   * Trả phần đã claim nhưng ghi Mongo lỗi về Redis để lượt sau thử lại: seq
   * mới nhất của người gửi chỉ nâng không hạ, last_message chỉ đặt lại khi
   * chưa có bản mới hơn. Lỗi ở bước này chỉ ghi log — lỗi gốc vẫn được ném
   * tiếp để conversation quay lại hàng đợi.
   */
  private async restoreClaim(
    conversationId: string,
    keys: string[],
    failedSenders: SenderMark[],
    last: { raw: string; seq: number } | null,
  ): Promise<void> {
    const payload = {
      newest: Object.fromEntries(
        failedSenders.map((mark) => [mark.senderId, mark.seq]),
      ),
      last: last?.raw ?? '',
      lastSeq: last?.seq ?? 0,
    }

    try {
      await this.redisService.eval(RESTORE_SCRIPT, keys, [
        JSON.stringify(payload),
      ])
    } catch (error) {
      this.logger.error(
        `[Batch Update] không trả được dữ liệu về Redis (${conversationId}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }
}
