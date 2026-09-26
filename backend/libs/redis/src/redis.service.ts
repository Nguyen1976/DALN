import { Inject, Injectable } from '@nestjs/common'
import type Redis from 'ioredis'

/** Set chỉ mục các user đang online — phải khớp với UserStatusStore. */
const ONLINE_USERS_KEY = 'online:users'

@Injectable()
export class RedisService {
  constructor(@Inject('REDIS_CLIENT') private readonly redisClient: Redis) {}

  private getKey(userId: string) {
    return `user:${userId}:sockets`
  }

  async isOnline(userId: string): Promise<boolean> {
    const userKey = this.getKey(userId)
    const sockets = await this.redisClient.smembers(userKey)

    if (!sockets.length) return false

    // Gộp N lệnh EXISTS vào 1 pipeline: 1 round-trip thay vì N.
    const res = await this.pipeline(
      sockets.map((id) => ['exists', `socket:${id}`]),
    )

    const dead = sockets.filter((_, i) => !res[i]?.[1])
    if (dead.length) await this.redisClient.srem(userKey, ...dead)

    if (dead.length === sockets.length) {
      await this.redisClient
        .multi()
        .del(userKey)
        .srem(ONLINE_USERS_KEY, userId)
        .exec()
      return false
    }

    return true
  }

  /**
   * Bản theo lô của isOnline: 2 round-trip cho N user, bất kể N lớn đến đâu.
   * Dùng cho các luồng quét nhiều user (digest sweep) thay vì gọi isOnline()
   * trong vòng lặp — vốn tốn 1 + K round-trip cho MỖI user.
   */
  async isOnlineBatch(userIds: string[]): Promise<Map<string, boolean>> {
    const result = new Map<string, boolean>(userIds.map((id) => [id, false]))
    if (!userIds.length) return result

    const sets = await this.pipeline(
      userIds.map((id) => ['smembers', this.getKey(id)]),
    )

    const probes: { userId: string; socketId: string }[] = []
    userIds.forEach((userId, i) => {
      for (const socketId of (sets[i]?.[1] as string[] | undefined) ?? []) {
        probes.push({ userId, socketId })
      }
    })
    if (!probes.length) return result

    const alive = await this.pipeline(
      probes.map((p) => ['exists', `socket:${p.socketId}`]),
    )

    probes.forEach((p, i) => {
      if (alive[i]?.[1]) result.set(p.userId, true)
    })

    return result
  }

  async sadd(key: string, ...members: string[]): Promise<number> {
    if (!members.length) return 0
    return await this.redisClient.sadd(key, ...members)
  }

  async srem(key: string, ...members: string[]): Promise<number> {
    if (!members.length) return 0
    return await this.redisClient.srem(key, ...members)
  }

  async smembers(key: string): Promise<string[]> {
    return await this.redisClient.smembers(key)
  }

  /**
   * Lấy tối đa `count` phần tử ra khỏi set, nguyên tử.
   * Dùng làm hàng đợi việc: nhiều bản sao service cùng pop sẽ không xử lý trùng.
   */
  async spop(key: string, count: number): Promise<string[]> {
    const res = await this.redisClient.spop(key, count)
    if (!res) return []
    return Array.isArray(res) ? res : [res]
  }

  async del(key: string): Promise<void> {
    await this.redisClient.del(key)
  }

  /** Xoá nhiều key trong một lệnh thay vì N lần round-trip. */
  async delMany(keys: string[]): Promise<void> {
    if (!keys.length) return
    await this.redisClient.del(...keys)
  }

  async set(key: string, value: string): Promise<void> {
    await this.redisClient.set(key, value)
  }

  /** SET kèm TTL (giây). */
  async setEx(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.redisClient.set(key, value, 'EX', ttlSeconds)
  }

  /**
   * Gom nhiều lệnh vào một round-trip. Trả về mảng [error, result] theo thứ tự
   * lệnh, giống ioredis.
   */
  async pipeline(
    commands: (string | number)[][],
  ): Promise<[Error | null, unknown][]> {
    if (!commands.length) return []
    return (await this.redisClient.pipeline(commands).exec()) ?? []
  }

  /**
   * Chạy một Lua script (EVAL). Cả script chạy nguyên tử trên Redis: không lệnh
   * nào của client khác chen vào giữa. Mọi key script đụng tới phải truyền qua
   * `keys`, không tự ghép tên key bên trong script.
   */
  async eval(
    script: string,
    keys: string[],
    args: (string | number)[] = [],
  ): Promise<unknown> {
    return await this.redisClient.eval(script, keys.length, ...keys, ...args)
  }

  /**
   * Giành quyền xử lý một lần cho `key` bằng SET NX EX nguyên tử.
   *
   * Trả `true` khi caller là người đầu tiên đặt được key (chưa từng tồn tại), và
   * `false` khi key đã có — dùng làm chốt idempotency: hai lần gọi trùng (webhook
   * gửi lại) chỉ một lần thắng. Key tự hết hạn sau `ttlSeconds` giây.
   */
  async claimOnce(key: string, ttlSeconds: number): Promise<boolean> {
    const won = await this.redisClient.set(key, '1', 'EX', ttlSeconds, 'NX')
    return Boolean(won)
  }

  async get(key: string): Promise<string | null> {
    return await this.redisClient.get(key)
  }

  /** Key có tồn tại không — dùng cho việc kiểm phiên còn sống ở AuthGuard. */
  async exists(key: string): Promise<boolean> {
    return (await this.redisClient.exists(key)) === 1
  }
}
