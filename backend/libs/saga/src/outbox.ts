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

  // Kéo relay về nhịp nhanh: nếu nó đang ở trạng thái backoff (hệ thống vừa
  // rảnh một lúc), lượt quét kế tiếp sẽ diễn ra sau intervalMs thay vì phải
  // chờ hết chu kỳ giãn. Không quét ngay lập tức là có chủ đích — transaction
  // chứa lời gọi này còn chưa commit.
  kickOutboxRelays()
}

/**
 * Các relay đang chạy trong tiến trình. Dùng sổ đăng ký thay vì tiêm phụ thuộc
 * vào cả 9 điểm gọi enqueueOutbox nằm rải rác ở 5 service.
 */
const activeRelays = new Set<OutboxRelay>()

export function kickOutboxRelays(): void {
  for (const relay of activeRelays) relay.kick()
}

export interface OutboxRelayOptions {
  /** Chu kỳ quét bảng outbox (ms). Mặc định 1500ms. */
  intervalMs?: number
  /** Số event xử lý mỗi vòng. Mặc định 50. */
  batchSize?: number
  /** Số lần thử tối đa trước khi đánh dấu DEAD. Mặc định 10. */
  maxAttempts?: number
  /** Chu kỳ tối đa khi hàng đợi rỗng (backoff). Mặc định 15000ms. */
  maxIdleMs?: number
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
  private readonly maxIdleMs: number
  private timer: NodeJS.Timeout | null = null
  private running = false
  private stopped = false
  /** Chu kỳ hiện tại: bằng intervalMs khi có việc, nhân đôi dần khi rỗng. */
  private currentDelayMs: number

  constructor(
    private readonly prisma: OutboxCapablePrisma,
    private readonly amqp: AmqpConnection,
    options: OutboxRelayOptions = {},
  ) {
    this.intervalMs = options.intervalMs ?? 1500
    this.maxIdleMs = options.maxIdleMs ?? 15_000
    this.batchSize = options.batchSize ?? 50
    this.maxAttempts = options.maxAttempts ?? 10
    this.currentDelayMs = this.intervalMs
    this.logger = new Logger(options.name ?? 'OutboxRelay')
  }

  onModuleInit(): void {
    this.logger.log(
      `Outbox relay started (interval=${this.intervalMs}ms, maxIdle=${this.maxIdleMs}ms)`,
    )
    activeRelays.add(this)
    this.schedule()
  }

  onModuleDestroy(): void {
    this.stopped = true
    activeRelays.delete(this)
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  /**
   * setTimeout đệ quy thay cho setInterval: cho phép đổi chu kỳ động, và tự
   * nó loại bỏ khả năng hai lượt chồng lấn khi một lượt chạy lâu hơn chu kỳ.
   */
  private schedule(): void {
    if (this.stopped) return
    this.timer = setTimeout(() => {
      void this.tick().finally(() => this.schedule())
    }, this.currentDelayMs)
  }

  /**
   * Đánh thức relay ngay lập tức. Gọi sau khi ghi outbox để backoff lúc rảnh
   * không phải đánh đổi bằng độ trễ khi có việc thật.
   */
  kick(): void {
    if (this.stopped) return
    this.currentDelayMs = this.intervalMs
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
      this.schedule()
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

      if (events.length === 0) {
        // Rảnh: giãn dần chu kỳ (1,5s -> 3 -> 6 -> 12 -> 15) để không phải
        // truy vấn Mongo 40 lần/phút/service khi hệ thống không có việc gì.
        this.currentDelayMs = Math.min(
          this.currentDelayMs * 2,
          this.maxIdleMs,
        )
        return
      }

      // Có việc: quay lại nhịp nhanh ngay
      this.currentDelayMs = this.intervalMs
      this.logger.debug(`Publishing ${events.length} outbox event(s)`)
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
