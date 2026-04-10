// unread.cron.ts
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
    // 1. Quét tìm tất cả các group đang có biến động Unread
    // Lưu ý: Đổi tên prefix thành unread_count để chuẩn hóa
    const keys = await this.redisService.keys('unread_count:*')
    
    if (keys.length === 0) return

    for (const key of keys) {
      const conversationId = key.split(':')[1]
      if (!conversationId) continue

      // ==========================================
      // PHẦN 1: XỬ LÝ UNREAD COUNT (CỘNG DỒN)
      // ==========================================
      const unreadData = await this.redisService.hgetall(key)
      
      // Ở đây, key của object unreadData chính là senderId, value là số đếm
      for (const [senderId, countStr] of Object.entries(unreadData)) {
        const unreadDelta = Number.parseInt(countStr, 10)
        
        if (Number.isFinite(unreadDelta) && unreadDelta > 0) {
          // Lệnh này giờ đây đã cộng gom toàn bộ tin nhắn của 1 người gửi!
          await this.memberRepo.updateUnreadCount(
            conversationId,
            senderId,
            unreadDelta,
          )
        }
      }

      // ==========================================
      // PHẦN 2: XỬ LÝ LAST MESSAGE (GHI ĐÈ)
      // ==========================================
      const lastMsgKey = `last_message:${conversationId}`
      const lastMsgString = await this.redisService.get(lastMsgKey)

      if (lastMsgString) {
        const lastMsg = JSON.parse(lastMsgString)

        // Cập nhật DB cho Conversation (Chỉ chạy 1 lần duy nhất cho mỗi group)
        await this.conversationRepo.updateUpdatedAt(conversationId, {
          lastMessageAt: lastMsg.lastMessageAt ? new Date(lastMsg.lastMessageAt) : undefined,
          lastMessageText: lastMsg.lastMessageText || '',
          lastMessageSenderId: lastMsg.senderId,
          lastMessageSenderName: lastMsg.lastMessageSenderName,
          lastMessageSenderAvatar: lastMsg.lastMessageSenderAvatar,
        })

        // Cập nhật DB cho Member (Chỉ chạy 1 lần duy nhất cho mỗi group)
        if (lastMsg.lastMessageAt) {
          await this.memberRepo.updateLastMessageAt(
            conversationId,
            new Date(lastMsg.lastMessageAt),
          )
        }
      }

      // ==========================================
      // PHẦN 3: DỌN DẸP REDIS
      // ==========================================
      await this.redisService.del(key) // Xóa key unread_count
      await this.redisService.del(lastMsgKey) // Xóa key last_message
      
      this.logger.debug(`[Batch Update] Hoàn tất đồng bộ dữ liệu cho Group: ${conversationId}`)
    }
  }
}