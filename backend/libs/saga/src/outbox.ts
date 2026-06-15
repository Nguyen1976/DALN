import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import type { AmqpConnection } from '@golevelup/nestjs-rabbitmq'
import type {
  OutboxCapablePrisma,
  OutboxEventInput,
  OutboxRecord,
  TxClient,
} from './types'

/**
 * Ghi một sự kiện vào bảng outbox TRONG cùng transaction với business write.
 * Đây là điểm mấu chốt của Transactional Outbox: việc lưu nghiệp vụ và "ý định
 * gửi event" là nguyên tử — hoặc cùng commit, hoặc cùng rollback. Nhờ vậy không
 * bao giờ xảy ra cảnh DB đã đổi nhưng event bị mất (hoặc ngược lại).
 */
export async function enqueueOutbox(
  tx: TxClient,
  input: OutboxEventInput,
): Promise<void> {
  await tx.outboxEvent.create({
    data: {
      messageId: input.messageId,
      exchange: input.exchange,
      routingKey: input.routingKey,
      payload: input.payload as object,
      status: 'NEW',
      attempt: 0,
      // Set mốc thời gian cụ thể (thay vì để null) để relay query bằng
      // nextAttemptAt <= now luôn khớp — tránh khác biệt null/missing field
      // của Prisma + MongoDB.
      nextAttemptAt: new Date(),
    },
  })
}

export interface OutboxRelayOptions {
  /** Chu kỳ quét bảng outbox (ms). Mặc định 1500ms. */
  intervalMs?: number
  /** Số event xử lý mỗi vòng. Mặc định 50. */
  batchSize?: number
  /** Số lần thử tối đa trước khi đánh dấu DEAD. Mặc định 10. */
  maxAttempts?: number
  /** Nhãn hiển thị trong log. */
  name?: string
}

/**
 * Worker chạy nền (poll) đọc các bản ghi outbox trạng thái NEW/FAILED tới hạn,
 * publish lên RabbitMQ rồi cập nhật trạng thái. Có exponential backoff và
 * chuyển DEAD khi vượt maxAttempts.
 *
 * At-least-once: relay có thể publish trùng (vd crash sau publish trước khi
 * kịp cập nhật). Consumer phía nhận dùng inbox idempotency nên hiệu ứng thực tế
 * là exactly-once.
 */
export class OutboxRelay implements OnModuleInit, OnModuleDestroy {
  private readonly logger: Logger
  private readonly intervalMs: number
  private readonly batchSize: number
  private readonly maxAttempts: number
  private timer: NodeJS.Timeout | null = null
  private running = false

  constructor(
    private readonly prisma: OutboxCapablePrisma,
    private readonly amqp: AmqpConnection,
    options: OutboxRelayOptions = {},
  ) {
    this.intervalMs = options.intervalMs ?? 1500
    this.batchSize = options.batchSize ?? 50
    this.maxAttempts = options.maxAttempts ?? 10
    this.logger = new Logger(options.name ?? 'OutboxRelay')
  }

  onModuleInit(): void {
    this.logger.log(`Outbox relay started (interval=${this.intervalMs}ms)`)
    this.timer = setInterval(() => {
      void this.tick()
    }, this.intervalMs)
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  async tick(): Promise<void> {
    if (this.running) return
    this.running = true

    try {
      const now = new Date()
      const events = (await this.prisma.outboxEvent.findMany({
        where: {
          status: { in: ['NEW', 'FAILED'] },
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
        },
        orderBy: { createdAt: 'asc' },
        take: this.batchSize,
      })) as unknown as OutboxRecord[]

      if (events.length > 0) {
        this.logger.debug(`Publishing ${events.length} outbox event(s)`)
      }
      for (const event of events) {
        await this.publishOne(event)
      }
    } catch (error) {
      this.logger.error(
        `Outbox relay tick failed: ${(error as Error)?.message}`,
      )
    } finally {
      this.running = false
    }
  }

  private async publishOne(event: OutboxRecord): Promise<void> {
    try {
      await this.amqp.publish(event.exchange, event.routingKey, event.payload)

      await this.prisma.outboxEvent.update({
        where: { id: event.id },
        data: {
          status: 'PUBLISHED',
          publishedAt: new Date(),
          error: null,
        },
      })
    } catch (error) {
      const attempt = event.attempt + 1
      const isDead = attempt >= this.maxAttempts
      // backoff luỹ thừa, trần 60s
      const delayMs = Math.min(60_000, 1000 * 2 ** Math.min(attempt, 6))

      await this.prisma.outboxEvent.update({
        where: { id: event.id },
        data: {
          status: isDead ? 'DEAD' : 'FAILED',
          attempt,
          nextAttemptAt: isDead ? null : new Date(Date.now() + delayMs),
          error: String((error as Error)?.message ?? error).slice(0, 500),
        },
      })

      this.logger.warn(
        `Publish outbox ${event.messageId} thất bại (attempt ${attempt}${
          isDead ? ', -> DEAD' : ''
        }): ${(error as Error)?.message}`,
      )
    }
  }
}
