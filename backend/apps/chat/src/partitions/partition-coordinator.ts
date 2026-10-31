import { Logger } from '@nestjs/common'
import { PARTITION_COUNT } from 'libs/constant/rmq/partition'
import type { LeaseStore } from './lease-store'
import { stickyAssign } from './sticky-assign'

export interface CoordinatorOptions {
  /** Nhịp tính lại, cũng là nhịp heartbeat và gia hạn lease. */
  tickMs: number
  memberTtlMs: number
  leaseTtlMs: number
  /** Chờ sau khi khởi động, trước khi ghi tên và giữ partition. */
  settleMs: number
  now: () => number
}

export interface OwnedConsumer {
  partition: number
  drain(): Promise<void>
  onLost(cb: () => void): void
}

/**
 * Chia 16 partition giữa các instance chat đang sống (spec §3).
 *
 * Mỗi instance tự tính cùng một bảng (stickyAssign trên dữ liệu đọc từ Redis),
 * rồi chỉ hành động trên phần của mình: nhả partition không còn được giao, giành
 * partition mới được giao. Lease (SET NX) quyết định ai ĐƯỢC giữ; người mới chỉ
 * giành được khi chủ cũ đã drain xong và xoá lease, nên không bao giờ có hai
 * bên cùng xử lý một partition. Bảng tạm lệch nhau (đọc Redis lệch vài ms) chỉ
 * làm chậm một nhịp, không làm sai.
 */
export class PartitionCoordinator {
  private readonly logger = new Logger('partitions')
  private readonly startedAt: number
  private readonly owned = new Map<number, OwnedConsumer>()
  private readonly releasing = new Set<number>()
  private lastMembers: string | null = null
  private lastOwned = ''
  private running?: Promise<void>
  private pending = false
  private stopped = false
  private timer?: NodeJS.Timeout

  constructor(
    private readonly store: LeaseStore,
    private readonly startConsumer: (p: number) => Promise<OwnedConsumer>,
    readonly memberId: string,
    private readonly options: CoordinatorOptions,
  ) {
    this.startedAt = options.now()
  }

  async start(): Promise<void> {
    await this.store.onNotify(() => void this.tick())
    this.timer = setInterval(() => void this.tick(), this.options.tickMs)
    void this.tick()
  }

  /**
   * Một vòng tính lại. Gọi trong lúc một vòng đang chạy thì KHÔNG bỏ qua: đánh
   * dấu và chạy thêm đúng một vòng ngay sau, để thông báo "tính lại" tới giữa
   * chừng vẫn được xử lý trên dữ liệu mới.
   */
  tick(): Promise<void> {
    if (this.running) {
      this.pending = true
      return this.running
    }
    this.running = (async () => {
      try {
        do {
          this.pending = false
          await this.once()
        } while (this.pending && !this.stopped)
      } finally {
        this.running = undefined
      }
    })()
    return this.running
  }

  ownedPartitions(): number[] {
    return [...this.owned.keys()].sort((a, b) => a - b)
  }

  async shutdown(): Promise<void> {
    this.stopped = true
    clearInterval(this.timer)
    await this.running?.catch(() => undefined)
    await this.store.leave(this.memberId).catch(() => undefined)
    await this.store.notify().catch(() => undefined)
    await Promise.all(this.ownedPartitions().map((p) => this.release(p)))
    this.logOwnership()
  }

  private async once() {
    if (this.stopped) return
    if (this.options.now() - this.startedAt < this.options.settleMs) return

    let members: string[]
    let owners: (string | null)[]
    try {
      members = await this.store.heartbeat(
        this.memberId,
        this.options.memberTtlMs,
      )
      const key = members.join(',')
      if (key !== this.lastMembers) {
        this.lastMembers = key
        await this.store.notify()
      }
      owners = await this.store.owners()
    } catch (error) {
      // Redis không trả lời: GIỮ NGUYÊN những gì đang giữ. Nhả hết ở đây là
      // cả hệ thống ngừng nhận tin; SAC vẫn chặn hai bên cùng xử lý.
      this.logger.warn(`không đọc được Redis, giữ nguyên: ${String(error)}`)
      return
    }

    const target = stickyAssign(members, owners)

    for (const p of this.ownedPartitions()) {
      if (this.releasing.has(p)) continue
      if (target[p] !== this.memberId) {
        void this.release(p)
        continue
      }
      const renewed = await this.store
        .renew(p, this.memberId, this.options.leaseTtlMs)
        .catch(() => 'unreachable' as const)
      if (renewed === 'lost') void this.release(p)
    }

    for (let p = 0; p < PARTITION_COUNT; p++) {
      if (this.stopped) return
      if (target[p] !== this.memberId || this.owned.has(p)) continue
      const acquired = await this.store
        .acquire(p, this.memberId, this.options.leaseTtlMs)
        .catch(() => false)
      if (!acquired) continue
      try {
        const consumer = await this.startConsumer(p)
        consumer.onLost(() => this.lose(p, consumer))
        this.owned.set(p, consumer)
      } catch (error) {
        this.logger.error(`không mở được consumer p${p}: ${String(error)}`)
        await this.store.release(p, this.memberId).catch(() => undefined)
      }
    }

    this.logOwnership()
  }

  /** HOLD → FINISH → CLOSE, rồi mới xoá lease và báo người đang chờ. */
  private async release(p: number) {
    const consumer = this.owned.get(p)
    if (!consumer || this.releasing.has(p)) return
    this.releasing.add(p)
    try {
      await consumer.drain()
    } finally {
      this.owned.delete(p)
      this.releasing.delete(p)
      await this.store.release(p, this.memberId).catch(() => undefined)
      await this.store.notify().catch(() => undefined)
    }
  }

  /** Channel chết ngoài ý muốn: bỏ partition, xoá lease; lượt sau giành lại. */
  private lose(p: number, consumer: OwnedConsumer) {
    if (this.owned.get(p) !== consumer || this.releasing.has(p)) return
    this.owned.delete(p)
    this.logger.warn(`mất channel p${p}, sẽ giành lại`)
    void this.store.release(p, this.memberId).catch(() => undefined)
  }

  private logOwnership() {
    const now = this.ownedPartitions().join(',')
    if (now === this.lastOwned) return
    const before = new Set(this.lastOwned ? this.lastOwned.split(',') : [])
    const after = new Set(now ? now.split(',') : [])
    const added = [...after].filter((p) => !before.has(p))
    const removed = [...before].filter((p) => !after.has(p))
    this.lastOwned = now
    this.logger.log(
      `member=${this.memberId} owned=${now || '-'} moved=+${added.join(',') || '-'},-${removed.join(',') || '-'}`,
    )
  }
}
