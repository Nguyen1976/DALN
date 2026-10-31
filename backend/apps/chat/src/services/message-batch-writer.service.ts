import {
  BeforeApplicationShutdown,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common'
import { ObjectId } from 'mongodb'
import { PrismaService } from 'apps/chat/prisma/prisma.service'
import type { Prisma } from 'apps/chat/src/generated'

export type BatchMessageInput = {
  conversationId: string
  senderId: string
  type: 'TEXT' | 'IMAGE' | 'VIDEO' | 'FILE' | 'POLL'
  content?: string | null
  replyToMessageId?: string | null
  isSystem?: boolean
  mentionUserIds?: string[]
  /** Nhãn từng lượt nhắc để client tô sáng chính xác. */
  mentions?: unknown
  /** Khoá chống trùng do client sinh; tin hệ thống không có. */
  clientMessageId?: string
}

/** Hình dạng trả về khớp với `messageRepo.create()` để bên gọi không phải đổi. */
export type BatchedMessage = {
  id: string
  conversationId: string
  senderId: string
  type: BatchMessageInput['type']
  content: string | null
  replyToMessageId: string | null
  isSystem: boolean
  pollId: null
  isRevoked: boolean
  isDeleted: boolean
  createdAt: Date
  updatedAt: Date
  medias: never[]
  poll: null
  mentionUserIds: string[]
  mentions?: unknown
  clientMessageId?: string
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

const DUPLICATE_KEY = 11000

type InsertResult = {
  ok: number
  n: number
  writeErrors?: { index: number; code: number; errmsg?: string }[]
}

const oid = (hex: string) => ({ $oid: hex })
const date = (value: Date) => ({ $date: value.toISOString() })

/**
 * Document cho lệnh `insert` thô: ObjectId và Date viết theo Extended JSON vì
 * `$runCommandRaw` không đi qua lớp map kiểu của Prisma.
 */
function toDocument(doc: BatchedMessage): Prisma.InputJsonObject {
  return {
    _id: oid(doc.id),
    conversationId: oid(doc.conversationId),
    senderId: oid(doc.senderId),
    type: doc.type,
    content: doc.content,
    replyToMessageId: doc.replyToMessageId ? oid(doc.replyToMessageId) : null,
    isSystem: doc.isSystem,
    mentionUserIds: doc.mentionUserIds.map(oid),
    ...(doc.mentions !== undefined
      ? { mentions: doc.mentions as Prisma.InputJsonValue }
      : {}),
    // CHAT_QC_DISABLE_DEDUP: CHỈ DÀNH CHO QC đối chứng — bỏ khoá chống trùng để
    // chứng minh unique index là thứ chặn tin nhân bản khi giao lại.
    ...(doc.clientMessageId && process.env.CHAT_QC_DISABLE_DEDUP !== '1'
      ? { clientMessageId: doc.clientMessageId }
      : {}),
    isRevoked: false,
    isDeleted: false,
    createdAt: date(doc.createdAt),
    updatedAt: date(doc.updatedAt),
  }
}

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
 * An toàn khi crash: consumer chỉ ack SAU khi handler resolve, mà handler đang
 * chờ Promise này. Tiến trình chết lúc buffer còn hàng thì RabbitMQ chưa ack và
 * sẽ giao lại — không mất tin.
 *
 * Giao lại một tin ĐÃ ghi (chết sau insert, trước ack) không nhân bản nó: lô ghi
 * bằng `insert ordered:false`, dòng nào chạm unique index (senderId,
 * clientMessageId) thì đọc lại bản đã lưu và trả bản đó cho caller.
 */
@Injectable()
export class MessageBatchWriter implements BeforeApplicationShutdown {
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
      isSystem: Boolean(input.isSystem),
      pollId: null,
      isRevoked: false,
      isDeleted: false,
      createdAt: now,
      updatedAt: now,
      medias: [],
      poll: null,
      mentionUserIds: input.mentionUserIds || [],
      mentions: input.mentions ?? undefined,
      clientMessageId: input.clientMessageId,
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
      const result = (await this.prisma.$runCommandRaw({
        insert: 'message',
        ordered: false,
        documents: batch.map((item) => toDocument(item.doc)),
      })) as InsertResult

      const errors = result.writeErrors ?? []
      const other = errors.find((e) => e.code !== DUPLICATE_KEY)
      if (other) {
        throw new Error(
          `insert message lỗi ${other.code}: ${other.errmsg ?? 'không rõ'}`,
        )
      }

      const duplicates = new Set(errors.map((e) => e.index))
      const stored = await this.loadStored(
        batch.filter((_, i) => duplicates.has(i)).map((item) => item.doc),
      )
      batch.forEach((item, i) => {
        item.resolve(
          duplicates.has(i) ? (stored(item.doc) ?? item.doc) : item.doc,
        )
      })

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
      // Từ chối cả lô -> handler ném lỗi -> được thử lại. Dòng nào đã kịp vào
      // DB thì lần thử lại chạm unique index và lấy lại đúng bản đó.
      for (const item of batch) item.reject(error)
    }
  }

  /** Bản đã lưu của những tin bị trùng, tra theo (senderId, clientMessageId). */
  private async loadStored(docs: BatchedMessage[]) {
    if (!docs.length) return () => undefined
    const rows = await this.prisma.message.findMany({
      where: {
        OR: docs.map((doc) => ({
          senderId: doc.senderId,
          clientMessageId: doc.clientMessageId,
        })),
      },
    })
    const byKey = new Map(
      rows.map((row) => [`${row.senderId}|${row.clientMessageId}`, row]),
    )
    return (doc: BatchedMessage): BatchedMessage | undefined => {
      const row = byKey.get(`${doc.senderId}|${doc.clientMessageId}`)
      return row
        ? {
            ...doc,
            id: String(row.id),
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          }
        : undefined
    }
  }

  /**
   * Lần flush cuối chạy ở phase SAU onModuleDestroy: lúc đó coordinator đã nhả
   * hết partition, nên không còn tin mới nào chui vào buffer sau lần flush này.
   */
  async beforeApplicationShutdown(): Promise<void> {
    this.stopped = true
    await this.flush()
  }

  /** Cho test/quan sát. */
  get pendingCount(): number {
    return this.buffer.length
  }
}
