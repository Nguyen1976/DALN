import { Logger } from '@nestjs/common'
import type Redis from 'ioredis'

export type GroupDeadline = 'pending' | 'empty'

const KEY = 'call:group:deadlines'

/**
 * Hạn chót của phòng gọi nhóm (35s chưa ai vào, 15s phòng trống), lưu trong
 * Redis thay vì `setTimeout` trong RAM. Timer trong RAM chết theo gateway đã
 * đặt nó — gateway đó restart là phòng không bao giờ được dọn. Ở đây gateway
 * nào còn sống cũng quét được; `ZREM` trả 1 cho đúng một người nên mỗi hạn chót
 * chỉ chạy một lần dù nhiều gateway cùng quét.
 *
 * Giờ lấy từ đồng hồ máy: lệch vài ms giữa các gateway không đáng kể so với
 * 15-35 giây.
 */
export class GroupCallTimers {
  private readonly logger = new Logger(GroupCallTimers.name)
  private timer?: NodeJS.Timeout
  private sweeping = false

  constructor(
    private readonly redis: Redis,
    private readonly onDue: (
      kind: GroupDeadline,
      callId: string,
    ) => Promise<void>,
    private readonly pollMs = 1000,
  ) {}

  /** Idempotent. Gọi lúc khởi động để gateway này cũng quét hạn chót của gateway khác. */
  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.sweep(), this.pollMs)
    // Không giữ process sống chỉ vì vòng quét này.
    if (typeof this.timer.unref === 'function') this.timer.unref()
  }

  stop(): void {
    clearInterval(this.timer)
    this.timer = undefined
  }

  /** Đặt (hoặc đặt lại) hạn chót. */
  async schedule(
    kind: GroupDeadline,
    callId: string,
    delayMs: number,
  ): Promise<void> {
    await this.redis.zadd(KEY, Date.now() + delayMs, `${kind}:${callId}`)
    this.start()
  }

  async cancel(kind: GroupDeadline, callId: string): Promise<void> {
    await this.redis.zrem(KEY, `${kind}:${callId}`)
  }

  private async sweep() {
    if (this.sweeping) return
    this.sweeping = true
    try {
      const due = await this.redis.zrangebyscore(
        KEY,
        0,
        Date.now(),
        'LIMIT',
        0,
        50,
      )
      for (const member of due) {
        // Chỉ ai gỡ được member khỏi ZSET mới chạy nó.
        if ((await this.redis.zrem(KEY, member)) !== 1) continue
        const split = member.indexOf(':')
        const kind = member.slice(0, split) as GroupDeadline
        const callId = member.slice(split + 1)
        await this.onDue(kind, callId).catch((error: unknown) =>
          this.logger.error(`hạn chót ${member} lỗi`, error),
        )
      }
    } catch (error) {
      this.logger.warn(`quét hạn chót gọi nhóm lỗi: ${String(error)}`)
    } finally {
      this.sweeping = false
    }
  }
}
