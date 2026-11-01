import {
  BeforeApplicationShutdown,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common'
import { ObjectId } from 'mongodb'
import { findStoredBySenderClientIds } from '../repositories/message-raw.queries'
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
  /**
   * Bản đã có sẵn trong DB (tin gửi lại chạm unique index). Lần xử lý đầu đã
   * cộng unread/nhắc tên, nên bên gọi không cộng lần nữa.
   */
  replayed?: true
}

type Pending = {
  doc: BatchedMessage
  resolve: (message: BatchedMessage) => void
  reject: (error: unknown) => void
}

/** Trần số tin mỗi lần insert. */
const MAX_BATCH = Number(process.env.MESSAGE_BATCH_SIZE ?? 100)

const DUPLICATE_KEY = 11000
/**
 * Lô lỗi được ghi lại với ĐÚNG các document cũ (cùng _id, cùng createdAt). Làn
 * của hội thoại đã nhả ngay khi tin vào lô, nên thử lại ở handler sẽ sinh tin
 * mới đứng sau các tin đến sau; ghi lại bản cũ thì thứ tự vẫn giữ nguyên.
 */
const WRITE_RETRY_DELAYS_MS = [50, 200, 800]
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

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
    ...(doc.clientMessageId ? { clientMessageId: doc.clientMessageId } : {}),
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
  /** Lần ghi đang chạy. Tối đa một: tin đến trong lúc ghi gom vào lần sau. */
  private writing: Promise<void> | null = null
  private scheduled = false
  private lastCreatedAt = 0
  private stopped = false

  private totalMessages = 0
  private totalBatches = 0

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  enqueue(input: BatchMessageInput): Promise<BatchedMessage> {
    // Thứ tự trong hội thoại là (createdAt, _id), nên createdAt không được lùi.
    // Đồng hồ hệ thống thì có thể lùi: đo được máy ảo Docker lùi ~2 ms lúc đang
    // swap, đảo thứ tự 21 cặp tin. Lùi thì giữ mốc cũ; bộ đếm của _id vẫn tăng
    // nên phân xử đúng thứ tự giữa các tin cùng mốc.
    this.lastCreatedAt = Math.max(Date.now(), this.lastCreatedAt)
    const now = new Date(this.lastCreatedAt)
    const doc: BatchedMessage = {
      id: new ObjectId(Math.floor(this.lastCreatedAt / 1000)).toHexString(),
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
      this.schedule()
    })
  }

  /**
   * Group commit: rảnh thì ghi ngay ở tick sau (gom các tin đến cùng tick), đang
   * ghi thì chờ lần ghi đó xong. Không có hẹn giờ cố định: một hẹn giờ 20 ms
   * cộng prefetch 20 mỗi partition từng chặn một hội thoại ở ~750 tin/s, vì lô
   * không bao giờ đủ lớn để ghi sớm. Tải cao thì lô tự lớn lên trong lúc chờ.
   */
  private schedule() {
    if (this.writing || this.scheduled) return
    this.scheduled = true
    setImmediate(() => {
      this.scheduled = false
      void this.flush()
    })
  }

  private flush(): Promise<void> {
    if (this.writing) return this.writing
    if (!this.buffer.length) return Promise.resolve()

    // Lấy lô ra khỏi buffer TRƯỚC mọi `await`. Đoạn này chạy đồng bộ nên nhờ
    // Node đơn luồng, không callback nào chen vào giữa được — không cần khoá.
    // Nếu đảo thứ tự (await trước, lấy sau) thì tin nhắn đến trong lúc ghi sẽ bị
    // ghi hai lần hoặc mất.
    const batch = this.buffer.splice(0, MAX_BATCH)
    this.writing = this.writeWithRetry(batch).finally(() => {
      this.writing = null
      if (this.buffer.length) void this.flush()
    })
    return this.writing
  }

  private async writeWithRetry(batch: Pending[]): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try {
        const saved = await this.write(batch)
        batch.forEach((item, i) => item.resolve(saved[i]))
        break
      } catch (error) {
        const delay = WRITE_RETRY_DELAYS_MS[attempt]
        this.logger.error(
          `ghi lô ${batch.length} tin thất bại (lần ${attempt + 1}): ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
        if (delay === undefined) {
          for (const item of batch) item.reject(error)
          return
        }
        await sleep(delay)
      }
    }

    this.totalMessages += batch.length
    this.totalBatches += 1
    if (this.totalBatches % 200 === 0) {
      this.logger.debug(
        `đã ghi ${this.totalMessages} tin qua ${this.totalBatches} lô ` +
          `(trung bình ${(this.totalMessages / this.totalBatches).toFixed(1)} tin/lô)`,
      )
    }
  }

  /** Một lần insert cả lô; dòng trùng khoá trả về bản đã lưu. */
  private async write(batch: Pending[]): Promise<BatchedMessage[]> {
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
    return batch.map((item, i) =>
      duplicates.has(i) ? (stored(item.doc) ?? item.doc) : item.doc,
    )
  }

  /**
   * Bản đã lưu của những tin bị trùng, tra theo (senderId, clientMessageId).
   * Đi qua lệnh find thô: qua Prisma nó quét cả collection (xem message-raw.queries).
   */
  private async loadStored(docs: BatchedMessage[]) {
    if (!docs.length) return () => undefined
    const rows = await findStoredBySenderClientIds(
      this.prisma,
      docs.map((doc) => ({
        senderId: doc.senderId,
        clientMessageId: doc.clientMessageId as string,
      })),
    )
    const byKey = new Map(
      rows.map((row) => [`${row.senderId}|${row.clientMessageId}`, row]),
    )
    return (doc: BatchedMessage): BatchedMessage | undefined => {
      const row = byKey.get(`${doc.senderId}|${doc.clientMessageId}`)
      // Cùng _id: chính lần ghi hỏng trước của lô này đã kịp đưa vào — chưa ai
      // cộng unread/nhắc tên cho nó, nên không phải tin gửi lại.
      if (row && String(row.id) === doc.id) return doc
      return row
        ? {
            ...doc,
            id: String(row.id),
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            replayed: true,
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
    while (this.writing || this.buffer.length) await this.flush()
  }

  /** Cho test/quan sát. */
  get pendingCount(): number {
    return this.buffer.length
  }
}
