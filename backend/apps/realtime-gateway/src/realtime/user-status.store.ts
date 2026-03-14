export class UserStatusStore {
  // Map userId -> Set socketIds
  private readonly socketTtlSeconds = 90
  private readonly userSetTtlSeconds = 300

  constructor(private redisClient: any) {}
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
      await this.redisClient.del(userKey)
    }
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

  async getUserSockets(userId: string): Promise<string[]> {
    const userKey = this.getKey(userId)
    const sockets: string[] = await this.redisClient.smembers(userKey)

    const aliveSockets: string[] = []

    for (const socketId of sockets) {
      const exists = await this.redisClient.exists(`socket:${socketId}`)
      if (exists) {
        aliveSockets.push(socketId)
      } else {
        await this.redisClient.srem(userKey, socketId)
      }
    }

    return aliveSockets
  }

  async getOnlineUsers(): Promise<string[]> {
    const keys = await this.redisClient.keys('user:*:sockets')
    return keys.map((k) => k.split(':')[1])
  }
}
