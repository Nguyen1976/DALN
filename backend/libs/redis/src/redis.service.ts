import { Inject, Injectable } from '@nestjs/common'
// import Redis, { Redis as RedisClient, RedisOptions } from 'ioredis'

/** Set chỉ mục các user đang online — phải khớp với UserStatusStore. */
const ONLINE_USERS_KEY = 'online:users'

@Injectable()
export class RedisService {
  //   static create(options?: RedisOptions): RedisClient {
  //     const client: RedisClient = new Redis(options as RedisOptions)
  //     return client
  //   }
  constructor(@Inject('REDIS_CLIENT') private readonly redisClient) {}

  private getKey(userId: string) {
    return `user:${userId}:sockets`
  }

  async isOnline(userId: string): Promise<boolean> {
    const userKey = this.getKey(userId)
    const sockets: string[] = await this.redisClient.smembers(userKey)

    if (!sockets.length) return false

    // Gộp N lệnh EXISTS vào 1 pipeline: 1 round-trip thay vì N.
    const res: [Error | null, unknown][] = await this.redisClient
      .pipeline(sockets.map((id) => ['exists', `socket:${id}`]))
      .exec()

    const dead = sockets.filter((_, i) => !res?.[i]?.[1])
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

    const sets: [Error | null, string[]][] = await this.redisClient
      .pipeline(userIds.map((id) => ['smembers', this.getKey(id)]))
      .exec()

    const probes: { userId: string; socketId: string }[] = []
    userIds.forEach((userId, i) => {
      for (const socketId of sets?.[i]?.[1] ?? []) {
        probes.push({ userId, socketId })
      }
    })
    if (!probes.length) return result

    const alive: [Error | null, unknown][] = await this.redisClient
      .pipeline(probes.map((p) => ['exists', `socket:${p.socketId}`]))
      .exec()

    probes.forEach((p, i) => {
      if (alive?.[i]?.[1]) result.set(p.userId, true)
    })

    return result
  }

  async hincrby(redisKey: string, field: string, increment: number) {
    await this.redisClient.hincrby(redisKey, field, increment)
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

  /**
   * @deprecated KEYS duyệt toàn bộ keyspace và CHẶN Redis (đơn luồng) —
   * đo được 45,7ms ở 1 triệu key. Dùng Set chỉ mục + {@link spop} thay thế.
   */
  async keys(pattern: string): Promise<string[]> {
    return await this.redisClient.keys(pattern)
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    return await this.redisClient.hgetall(key)
  }

  async del(key: string): Promise<void> {
    await this.redisClient.del(key)
  }

  async set(key: string, value: string): Promise<void> {
    await this.redisClient.set(key, value)
  }

  private getRegistrationOtpKey(email: string): string {
    return `otp:reg:${email.trim().toLowerCase()}`
  }

  async saveOTP(email: string, otp: string, ttl = 300): Promise<void> {
    const key = this.getRegistrationOtpKey(email)
    await this.redisClient.set(key, otp, 'EX', ttl)
  }

  async getOTP(email: string): Promise<string | null> {
    const key = this.getRegistrationOtpKey(email)
    return await this.redisClient.get(key)
  }

  async deleteOTP(email: string): Promise<void> {
    const key = this.getRegistrationOtpKey(email)
    await this.redisClient.del(key)
  }

  async get(key: string): Promise<string | null> {
    return await this.redisClient.get(key)
  }

  // Feature Hydration Cache methods
  private getFeaturesKey(userId: string): string {
    return `user:${userId}:features`
  }

  async getUserFeatures(userId: string): Promise<Record<string, any> | null> {
    try {
      const key = this.getFeaturesKey(userId)
      const data = await this.redisClient.hgetall(key)
      if (!data || Object.keys(data).length === 0) return null
      return data
    } catch (err) {
      console.error(`[RedisService] Error getting features for ${userId}:`, err)
      return null
    }
  }

  async getUserFeaturesBatch(
    userIds: string[],
  ): Promise<Record<string, Record<string, any>>> {
    try {
      const keys = userIds.map((id) => this.getFeaturesKey(id))
      const results = await this.redisClient.mget(...keys)

      const featuresByUserId: Record<string, Record<string, any>> = {}
      for (let i = 0; i < userIds.length; i++) {
        const data = results[i]
        if (data) {
          try {
            featuresByUserId[userIds[i]] = JSON.parse(data)
          } catch {
            featuresByUserId[userIds[i]] = data
          }
        }
      }
      return featuresByUserId
    } catch (err) {
      console.error(`[RedisService] Error getting features batch:`, err)
      return {}
    }
  }

  async setUserFeatures(
    userId: string,
    features: { bio?: string; location?: any; interests?: string[] },
    ttl = 86400,
  ): Promise<void> {
    try {
      const key = this.getFeaturesKey(userId)
      const serialized = JSON.stringify(features)
      await this.redisClient.set(key, serialized, 'EX', ttl)
    } catch (err) {
      console.error(`[RedisService] Error setting features for ${userId}:`, err)
    }
  }

  async deleteUserFeatures(userId: string): Promise<void> {
    try {
      const key = this.getFeaturesKey(userId)
      await this.redisClient.del(key)
    } catch (err) {
      console.error(
        `[RedisService] Error deleting features for ${userId}:`,
        err,
      )
    }
  }

  async setUserFeaturesBatch(
    profiles: Array<{
      id: string
      bio?: string | null
      location?: any
      interests?: string[]
    }>,
    ttl = 86400,
  ): Promise<void> {
    try {
      const pipeline = this.redisClient.pipeline()
      for (const p of profiles) {
        const key = this.getFeaturesKey(p.id)
        const serialized = JSON.stringify({
          bio: p.bio ?? null,
          location: p.location ?? null,
          interests: p.interests ?? [],
        })
        pipeline.set(key, serialized, 'EX', ttl)
      }
      await pipeline.exec()
    } catch (err) {
      console.error(`[RedisService] Error setting features batch:`, err)
    }
  }
}
