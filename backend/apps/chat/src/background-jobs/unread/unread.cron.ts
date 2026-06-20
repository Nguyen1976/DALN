import { RedisService } from '@app/redis'
import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import {
  ConversationMemberRepository,
  ConversationRepository,
} from '../../repositories'

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
    const keys = await this.redisService.keys('unread_count:*')
    if (keys.length === 0) return

    for (const key of keys) {
      const conversationId = key.split(':')[1]
      if (!conversationId) continue

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
      } catch (error) {
        this.logger.error(
          `[Batch Update] Failed to sync conversation ${conversationId}`,
          error instanceof Error ? error.stack : String(error),
        )
      } finally {
        await this.redisService.del(key)
        await this.redisService.del(lastMsgKey)
      }
    }
  }
}
