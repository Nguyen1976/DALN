import type Redis from 'ioredis'

/** Set chỉ mục các user đang online — thay cho việc quét KEYS 'user:*:sockets'. */
const ONLINE_USERS_KEY = 'online:users'

export class UserStatusStore {
  // Map userId -> Set socketIds
  private readonly socketTtlSeconds = 90
  private readonly userSetTtlSeconds = 300

  constructor(private redisClient: Redis) {}
  private getKey(userId: string) {
    return `user:${userId}:sockets`
  }

  async addConnection(userId: string, socketId: string) {
    const userKey = this.getKey(userId)
    const socketKey = `socket:${socketId}`

    await this.redisClient
      .multi()
      .sadd(userKey, socketId)
      .set(socketKey, userId, 'EX', this.socketTtlSeconds)
      .expire(userKey, this.userSetTtlSeconds)
      .sadd(ONLINE_USERS_KEY, userId)
      .exec()
  }

  async touchConnection(userId: string, socketId: string) {
    const userKey = this.getKey(userId)
    const socketKey = `socket:${socketId}`

    await this.redisClient
      .multi()
      .sadd(userKey, socketId)
      .expire(socketKey, this.socketTtlSeconds)
      .expire(userKey, this.userSetTtlSeconds)
      .exec()
  }

  async removeConnection(userId: string, socketId: string) {
    const userKey = this.getKey(userId)

    await this.redisClient
      .multi()
      .srem(userKey, socketId)
      .del(`socket:${socketId}`)
      .exec()

    const count = await this.redisClient.scard(userKey)
    if (count === 0) {
      await this.redisClient
        .multi()
        .del(userKey)
        .srem(ONLINE_USERS_KEY, userId)
        .exec()
    }
  }

  /**
   * Lọc ra các socket còn sống của user, dọn luôn socket "zombie".
   * Gộp N lệnh EXISTS vào một pipeline: 1 round-trip thay vì N.
   */
  private async filterAliveSockets(
    userKey: string,
    sockets: string[],
  ): Promise<string[]> {
    if (!sockets.length) return []

    const res =
      (await this.redisClient
        .pipeline(sockets.map((id) => ['exists', `socket:${id}`]))
        .exec()) ?? []

    const alive: string[] = []
    const dead: string[] = []
    sockets.forEach((id, i) => (res[i]?.[1] ? alive : dead).push(id))

    // srem nhận nhiều phần tử -> 1 lệnh thay vì 1 lệnh mỗi zombie
    if (dead.length) await this.redisClient.srem(userKey, ...dead)

    return alive
  }

  async isOnline(userId: string): Promise<boolean> {
    const userKey = this.getKey(userId)
    const sockets = await this.redisClient.smembers(userKey)
    if (!sockets.length) return false

    const alive = await this.filterAliveSockets(userKey, sockets)

    if (!alive.length) {
      // Toàn bộ socket đã chết -> dọn cả key lẫn chỉ mục online
      await this.redisClient
        .multi()
        .del(userKey)
        .srem(ONLINE_USERS_KEY, userId)
        .exec()
      return false
    }

    return true
  }
}
