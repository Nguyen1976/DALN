import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common'
import { ObjectId } from 'mongodb'
import { PrismaService } from 'apps/chat/prisma/prisma.service'

export type BatchMessageInput = {
  conversationId: string
  senderId: string
  type: 'TEXT' | 'IMAGE' | 'VIDEO' | 'FILE' | 'POLL'
  content?: string | null
  replyToMessageId?: string | null
}

/** Hình dạng trả về khớp với `messageRepo.create()` để bên gọi không phải đổi. */
export type BatchedMessage = {
  id: string
  conversationId: string
  senderId: string
  type: string
  content: string | null
  replyToMessageId: string | null
  pollId: null
  isRevoked: boolean
  isDeleted: boolean
  createdAt: Date
  updatedAt: Date
  medias: unknown[]
  poll: null
}

type Pending = {
  doc: BatchedMessage
  resolve: (message: BatchedMessage) => void
  reject: (error: unknown) => void
}

/** Tương đương `batch.size` của Kafka producer. */
const MAX_BATCH = Number(process.env.MESSAGE_BATCH_SIZE ?? 100)
/** Tương đương `linger.ms` của Kafka producer — trần độ trễ thêm vào. */
const MAX_DELAY_MS = Number(process.env.MESSAGE_BATCH_DELAY_MS ?? 20)

/**
 * Gom nhiều lệnh ghi tin nhắn thành một `createMany`.
 *
 * Vì sao cần: đo trên chính hệ thống này, `prisma.message.create()` ở mức đồng
 * thời 10 (đúng bằng prefetch của RabbitMQ) tốn 4,104 ms CPU mỗi tin, trong khi
 * `createMany(100)` chỉ tốn 0,0296 ms — rẻ hơn 139 lần. Chi phí không nằm ở
 * MongoDB (mỗi thao tác đo được 0,000ms) mà ở tầng dịch giữa JS và query engine
 * của Prisma: 87% CPU của service chat là các luồng `tokio-runtime-w`.
 *
 * Cách hoạt động: `enqueue()` trả về một Promise nhưng KHÔNG resolve ngay — nó
 * cất `resolve` vào buffer. Caller treo ở `await` cho tới khi cả lô được ghi
 * xong. `_id` sinh ở phía JS nên biết trước toàn bộ nội dung ack, không cần
 * chờ database trả về id.
 *
 * An toàn khi crash: golevelup chỉ `channel.ack()` SAU khi handler resolve, mà
 * handler đang chờ Promise này. Tiến trình chết lúc buffer còn hàng thì
 * RabbitMQ chưa ack và sẽ giao lại — không mất tin.
 */
@Injectable()
export class MessageBatchWriter implements OnModuleDestroy {
  private readonly logger = new Logger(MessageBatchWriter.name)
  private buffer: Pending[] = []
  private timer: NodeJS.Timeout | null = null
  private stopped = false

  private totalMessages = 0
  private totalBatches = 0

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  enqueue(input: BatchMessageInput): Promise<BatchedMessage> {
    const now = new Date()
    const doc: BatchedMessage = {
      id: new ObjectId().toHexString(),
      conversationId: input.conversationId,
      senderId: input.senderId,
      type: input.type,
      content: input.content || null,
      replyToMessageId: input.replyToMessageId || null,
      pollId: null,
      isRevoked: false,
      isDeleted: false,
      createdAt: now,
      updatedAt: now,
      medias: [],
      poll: null,
    }

    return new Promise<BatchedMessage>((resolve, reject) => {
      this.buffer.push({ doc, resolve, reject })

      if (this.buffer.length >= MAX_BATCH) {
        void this.flush()
      } else if (!this.timer) {
        this.timer = setTimeout(() => void this.flush(), MAX_DELAY_MS)
      }
    })
  }

  private async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (!this.buffer.length) return

    // Đổi buffer TRƯỚC mọi `await`. Hai dòng này chạy đồng bộ nên nhờ Node đơn
    // luồng, không callback nào chen vào giữa được — không cần khoá. Nếu đảo
    // thứ tự (await trước, gán sau) thì tin nhắn đến trong lúc ghi sẽ bị ghi
    // hai lần hoặc mất.
    const batch = this.buffer
    this.buffer = []

    try {
      await this.prisma.message.createMany({
        data: batch.map((item) => ({
          id: item.doc.id,
          conversationId: item.doc.conversationId,
          senderId: item.doc.senderId,
          type: item.doc.type as never,
          content: item.doc.content,
          replyToMessageId: item.doc.replyToMessageId,
          isRevoked: false,
          isDeleted: false,
          createdAt: item.doc.createdAt,
          updatedAt: item.doc.updatedAt,
        })),
      })

      for (const item of batch) item.resolve(item.doc)

      this.totalMessages += batch.length
      this.totalBatches += 1
      if (this.totalBatches % 200 === 0) {
        this.logger.debug(
          `đã ghi ${this.totalMessages} tin qua ${this.totalBatches} lô ` +
            `(trung bình ${(this.totalMessages / this.totalBatches).toFixed(1)} tin/lô)`,
        )
      }
    } catch (error) {
      this.logger.error(
        `ghi lô ${batch.length} tin thất bại: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
      // Từ chối cả lô -> handler ném lỗi -> RabbitMQ giao lại. Vì `_id` sinh ở
      // phía client, lần ghi lại dùng đúng id cũ nên nếu một phần đã vào được
      // DB thì lần sau chạm duplicate key thay vì nhân bản tin nhắn.
      for (const item of batch) item.reject(error)
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true
    await this.flush()
  }

  /** Cho test/quan sát. */
  get pendingCount(): number {
    return this.buffer.length
  }
}
