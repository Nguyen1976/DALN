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
}
