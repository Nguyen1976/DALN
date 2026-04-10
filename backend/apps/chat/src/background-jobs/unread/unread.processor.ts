// unread.processor.ts
import { RedisService } from '@app/redis'
import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Job } from 'bullmq'

@Processor('unreadQueue') // Phải khớp tên với Queue đã khai báo ở ChatModule
export class UnreadProcessor extends WorkerHost {
  constructor(private readonly redisService: RedisService) {
    super()
  }

  async process(job: Job<any, any, string>): Promise<any> {
    // Tách riêng conversationId và senderId ra khỏi phần data còn lại
    const { conversationId, senderId, ...lastMessageData } = job.data

    // --- NHIỆM VỤ 1: CỘNG DỒN UNREAD COUNT ---
    // Key: unread_count:group_123
    // Field: MÃ NGƯỜI GỬI (Ví dụ: user_A). Vì Field cố định, nó sẽ cộng dồn được!
    // Value: Số tin nhắn
    const unreadKey = `unread_count:${conversationId}`
    await this.redisService.hincrby(unreadKey, senderId, 1)

    // --- NHIỆM VỤ 2: GHI ĐÈ THÔNG TIN LAST MESSAGE ---
    // Key: last_message:group_123
    // Value: Toàn bộ JSON data của tin nhắn này
    const lastMessageKey = `last_message:${conversationId}`

    // Gộp senderId vào lại payload để Cronjob sau này biết ai gửi tin cuối cùng
    const payloadToSave = JSON.stringify({
      senderId,
      ...lastMessageData,
    })

    // Dùng lệnh SET. Lệnh này dã man ở chỗ: Cứ có tin nhắn mới là nó "đá văng" tin nhắn cũ,
    // đè luôn cục JSON mới vào. Nhờ vậy lúc Cronjob quét qua, nó chắc chắn chỉ lấy được tin mới nhất.
    await this.redisService.set(lastMessageKey, payloadToSave)
  }
}
