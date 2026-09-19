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
  senderId?: string
  lastMessageId?: string
  lastMessageAt?: string
  lastMessageText?: string
  lastMessageSenderName?: string
  lastMessageSenderAvatar?: string | null
}

type CountJob = {
  senderId: string
  delta: number
  /** Id tin mới nhất của người gửi trong lượt này; thiếu = dữ liệu từ bản cũ. */
  newestMessageId?: string
}

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
   */
  private async flushConversation(conversationId: string): Promise<void> {
    const keys = [
      unreadCountKey(conversationId),
      lastMessageKey(conversationId),
      unreadLastKey(conversationId),
    ]

    // Claim TRƯỚC khi đọc: lấy-và-xoá cả ba key trong một script nguyên tử.
    // Trước đây cron đọc (HGETALL/GET) rồi mới DEL sau khi ghi Mongo xong — tin
    // đến trong khoảng đó bị DEL cuốn theo, số chưa đọc của nó mất hẳn. Giờ tin
    // đến sau lúc claim rơi vào key mới tinh và được lượt sau xử lý.
    const claimed = await this.redisService.eval(CLAIM_SCRIPT, keys)
    const [rawCounts, rawLast, rawNewest] = Array.isArray(claimed)
      ? (claimed as unknown[])
      : []
    const counts = pairsToRecord(rawCounts)
    const newest = pairsToRecord(rawNewest)
    const lastMsgString = typeof rawLast === 'string' ? rawLast : null

    const jobs: CountJob[] = []
    for (const [senderId, countStr] of Object.entries(counts)) {
      const delta = Number.parseInt(countStr, 10)
      if (!Number.isFinite(delta) || delta <= 0) continue
      jobs.push({ senderId, delta, newestMessageId: newest[senderId] })
    }

    const lastMsg = this.parseLastMessage(conversationId, lastMsgString)

    // Các write thao tác trên collection khác nhau và không phụ thuộc nhau.
    // allSettled thay vì all: phải biết CHÍNH XÁC phần nào lỗi để chỉ trả phần
    // đó về Redis — trả cả phần đã ghi xong thì lượt sau cộng trùng.
    const [lastResult, ...countResults] = await Promise.allSettled([
      lastMsg
        ? this.writeLastMessage(conversationId, lastMsg)
        : Promise.resolve(),
      ...jobs.map((job) =>
        this.memberRepo.updateUnreadCount(
          conversationId,
          job.senderId,
          job.delta,
          job.newestMessageId,
        ),
      ),
    ])

    const failedJobs = jobs.filter(
      (_job, i) => countResults[i].status === 'rejected',
    )
    const lastFailed = lastResult.status === 'rejected'
    if (!failedJobs.length && !lastFailed) return

    await this.restoreClaim(
      conversationId,
      keys,
      failedJobs,
      lastFailed
        ? { raw: lastMsgString ?? '', id: lastMsg?.lastMessageId ?? '' }
        : null,
    )

    const firstError = [lastResult, ...countResults].find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    )
    throw firstError?.reason
  }

  private async writeLastMessage(
    conversationId: string,
    lastMsg: LastMessageSnapshot,
  ): Promise<void> {
    await Promise.all([
      this.conversationRepo.saveLastMessage(conversationId, {
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
        ? this.memberRepo.updateLastMessageAt(
            conversationId,
            new Date(lastMsg.lastMessageAt),
          )
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
   * Trả phần đã claim nhưng ghi Mongo lỗi về Redis để lượt sau thử lại: số đếm
   * cộng lại, id mới nhất chỉ nâng không hạ, last_message chỉ đặt lại khi chưa
   * có bản mới hơn. Lỗi ở bước này chỉ ghi log — lỗi gốc vẫn được ném tiếp để
   * conversation quay lại hàng đợi.
   */
  private async restoreClaim(
    conversationId: string,
    keys: string[],
    failedJobs: CountJob[],
    last: { raw: string; id: string } | null,
  ): Promise<void> {
    const payload = {
      counts: Object.fromEntries(
        failedJobs.map((job) => [job.senderId, String(job.delta)]),
      ),
      newest: Object.fromEntries(
        failedJobs
          .filter((job) => job.newestMessageId)
          .map((job) => [job.senderId, job.newestMessageId]),
      ),
      last: last?.raw ?? '',
      lastId: last?.id ?? '',
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
