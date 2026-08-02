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
} from './unread.constants'

@Injectable()
export class UnreadCron {
  private readonly logger = new Logger(UnreadCron.name)

  constructor(
    private readonly redisService: RedisService,
    private readonly conversationRepo: ConversationRepository,
    private readonly memberRepo: ConversationMemberRepository,
  ) {}

  @Cron(CronExpression.EVERY_5_SECONDS)
  async handleCron() {
    // SPOP nguyên tử: nhiều bản sao service chạy song song sẽ không xử lý trùng
    // cùng một conversation (điều mà SMEMBERS + DEL sau đó không đảm bảo được).
    const conversationIds = await this.redisService.spop(
      DIRTY_CONVERSATIONS_KEY,
      DIRTY_BATCH_SIZE,
    )
    if (conversationIds.length === 0) return

    for (const conversationId of conversationIds) {
      if (!conversationId) continue

      const key = `unread_count:${conversationId}`
      const lastMsgKey = `last_message:${conversationId}`

      try {
        const unreadData = await this.redisService.hgetall(key)

        for (const [senderId, countStr] of Object.entries(unreadData)) {
          const unreadDelta = Number.parseInt(countStr, 10)
          if (!Number.isFinite(unreadDelta) || unreadDelta <= 0) continue

          await this.memberRepo.updateUnreadCount(
            conversationId,
            senderId,
            unreadDelta,
          )
        }

        const lastMsgString = await this.redisService.get(lastMsgKey)
        if (lastMsgString) {
          const lastMsg = JSON.parse(lastMsgString)

          await this.conversationRepo.updateUpdatedAt(conversationId, {
            lastMessageId: lastMsg.lastMessageId || undefined,
            lastMessageAt: lastMsg.lastMessageAt
              ? new Date(lastMsg.lastMessageAt)
              : undefined,
            lastMessageText: lastMsg.lastMessageText || '',
            lastMessageSenderId: lastMsg.senderId,
            lastMessageSenderName: lastMsg.lastMessageSenderName,
            lastMessageSenderAvatar: lastMsg.lastMessageSenderAvatar,
          })

          if (lastMsg.lastMessageAt) {
            await this.memberRepo.updateLastMessageAt(
              conversationId,
              new Date(lastMsg.lastMessageAt),
            )
          }
        }

        this.logger.debug(
          `[Batch Update] Synced conversation ${conversationId}`,
        )

        // CHỈ xoá khi đã đồng bộ thành công. Trước đây hai lệnh này nằm trong
        // `finally`, nên Mongo lỗi một nhịp là số tin chưa đọc bốc hơi luôn.
        await this.redisService.del(key)
        await this.redisService.del(lastMsgKey)
      } catch (error) {
        this.logger.error(
          `[Batch Update] Failed to sync conversation ${conversationId}`,
          error instanceof Error ? error.stack : String(error),
        )
        // Trả lại hàng đợi để lượt sau thử lại; dữ liệu Redis giữ nguyên.
        await this.redisService.sadd(DIRTY_CONVERSATIONS_KEY, conversationId)
      }
    }
  }
}
