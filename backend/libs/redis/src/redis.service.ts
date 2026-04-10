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

  async get(key: string): Promise<string | null> {
    return await this.redisClient.get(key)
  }
}
