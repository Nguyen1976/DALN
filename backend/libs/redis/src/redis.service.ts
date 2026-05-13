import { Inject, Injectable } from '@nestjs/common'
// import Redis, { Redis as RedisClient, RedisOptions } from 'ioredis'
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

    let alive = 0

    for (const socketId of sockets) {
      const exists = await this.redisClient.exists(`socket:${socketId}`)
      if (exists) alive++
      else await this.redisClient.srem(userKey, socketId) // cleanup zombie
    }

    if (alive === 0) {
      await this.redisClient.del(userKey)
      return false
    }

    return true
  }

  async hincrby(redisKey: string, field: string, increment: number) {
    await this.redisClient.hincrby(redisKey, field, increment)
  }

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
