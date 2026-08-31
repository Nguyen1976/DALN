import { RedisService } from '@app/redis'
import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import {
  ConversationMemberRepository,
  ConversationRepository,
} from '../../repositories'
import {
  DIRTY_BATCH_SIZE,
  DIRTY_CONVERSATIONS_KEY,
  FLUSH_CONCURRENCY,
} from './unread.constants'

function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size))
  }
  return out
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

  /** Gom dữ liệu Redis của một conversation xuống Mongo. Ném lỗi nếu thất bại. */
  private async flushConversation(conversationId: string): Promise<void> {
    const key = `unread_count:${conversationId}`
    const lastMsgKey = `last_message:${conversationId}`

    const [unreadData, lastMsgString] = await Promise.all([
      this.redisService.hgetall(key),
      this.redisService.get(lastMsgKey),
    ])

    const writes: Promise<unknown>[] = []

    for (const [senderId, countStr] of Object.entries(unreadData)) {
      const unreadDelta = Number.parseInt(countStr, 10)
      if (!Number.isFinite(unreadDelta) || unreadDelta <= 0) continue

      writes.push(
        this.memberRepo.updateUnreadCount(conversationId, senderId, unreadDelta),
      )
    }

    if (lastMsgString) {
      const lastMsg = JSON.parse(lastMsgString)

      writes.push(
        this.conversationRepo.updateUpdatedAt(conversationId, {
          lastMessageId: lastMsg.lastMessageId || undefined,
          lastMessageAt: lastMsg.lastMessageAt
            ? new Date(lastMsg.lastMessageAt)
            : undefined,
          lastMessageText: lastMsg.lastMessageText || '',
          lastMessageSenderId: lastMsg.senderId,
          lastMessageSenderName: lastMsg.lastMessageSenderName,
          lastMessageSenderAvatar: lastMsg.lastMessageSenderAvatar,
        }),
      )

      if (lastMsg.lastMessageAt) {
        writes.push(
          this.memberRepo.updateLastMessageAt(
            conversationId,
            new Date(lastMsg.lastMessageAt),
          ),
        )
      }
    }

    // Các write này thao tác trên collection khác nhau và không phụ thuộc nhau.
    await Promise.all(writes)

    // CHỈ xoá khi đã đồng bộ xong. Trước đây hai lệnh này nằm trong `finally`
    // nên Mongo lỗi một nhịp là số tin chưa đọc bốc hơi luôn.
    await this.redisService.delMany([key, lastMsgKey])
  }
}
