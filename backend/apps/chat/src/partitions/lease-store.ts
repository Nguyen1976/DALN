import type Redis from 'ioredis'
import { PARTITION_COUNT } from 'libs/constant/rmq/partition'

/**
 * Nơi các instance chat cùng nhìn vào để chia partition: ai còn sống
 * (heartbeat) và ai đang giữ partition nào (lease). Bảng phân công KHÔNG lưu ở
 * đây — mỗi instance tự tính từ hai thứ này (stickyAssign).
 */
export interface LeaseStore {
  /** Ghi mình còn sống, dọn ai im lặng quá ttl; trả danh sách còn sống đã sort. */
  heartbeat(memberId: string, ttlMs: number): Promise<string[]>
  leave(memberId: string): Promise<void>
  /** Chủ của từng partition; null = chưa ai giữ. Độ dài PARTITION_COUNT. */
  owners(): Promise<(string | null)[]>
  /** Chỉ thành công khi lease đang trống. */
  acquire(p: number, memberId: string, ttlMs: number): Promise<boolean>
  /** `lost` = lease đã mang tên người khác (hoặc đã hết hạn). */
  renew(p: number, memberId: string, ttlMs: number): Promise<'renewed' | 'lost'>
  /** Chỉ xoá khi lease còn mang tên mình. */
  release(p: number, memberId: string): Promise<void>
  /** Báo mọi instance "tính lại ngay". */
  notify(): Promise<void>
  onNotify(cb: () => void): Promise<void>
}

const MEMBERS_KEY = 'chat:members'
const REBALANCE_CHANNEL = 'chat:rebalance'
const leaseKey = (p: number) => `chat:lease:p${p}`

// Giờ lấy từ Redis (TIME) để mọi instance chung một đồng hồ.
const HEARTBEAT = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
redis.call('ZADD', KEYS[1], now, ARGV[1])
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, now - tonumber(ARGV[2]))
return redis.call('ZRANGE', KEYS[1], 0, -1)
`

const RENEW_IF_OWNER = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return 0
`

const DELETE_IF_OWNER = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`

export class RedisLeaseStore implements LeaseStore {
  /** `subscriber` phải là kết nối riêng: kết nối đang SUBSCRIBE không chạy lệnh khác được. */
  constructor(
    private readonly redis: Redis,
    private readonly subscriber: Redis,
  ) {}

  async heartbeat(memberId: string, ttlMs: number): Promise<string[]> {
    const members = (await this.redis.eval(
      HEARTBEAT,
      1,
      MEMBERS_KEY,
      memberId,
      ttlMs,
    )) as string[]
    return [...members].sort()
  }

  async leave(memberId: string): Promise<void> {
    await this.redis.zrem(MEMBERS_KEY, memberId)
  }

  owners(): Promise<(string | null)[]> {
    return this.redis.mget(
      Array.from({ length: PARTITION_COUNT }, (_, p) => leaseKey(p)),
    )
  }

  async acquire(p: number, memberId: string, ttlMs: number): Promise<boolean> {
    return (
      (await this.redis.set(leaseKey(p), memberId, 'PX', ttlMs, 'NX')) === 'OK'
    )
  }

  async renew(
    p: number,
    memberId: string,
    ttlMs: number,
  ): Promise<'renewed' | 'lost'> {
    const ok = await this.redis.eval(
      RENEW_IF_OWNER,
      1,
      leaseKey(p),
      memberId,
      ttlMs,
    )
    return ok === 1 ? 'renewed' : 'lost'
  }

  async release(p: number, memberId: string): Promise<void> {
    await this.redis.eval(DELETE_IF_OWNER, 1, leaseKey(p), memberId)
  }

  async notify(): Promise<void> {
    await this.redis.publish(REBALANCE_CHANNEL, '1')
  }

  async onNotify(cb: () => void): Promise<void> {
    this.subscriber.on('message', (channel: string) => {
      if (channel === REBALANCE_CHANNEL) cb()
    })
    await this.subscriber.subscribe(REBALANCE_CHANNEL)
  }
}
