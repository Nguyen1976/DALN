/** Set chỉ mục các user đang online — thay cho việc quét KEYS 'user:*:sockets'. */
const ONLINE_USERS_KEY = 'online:users'

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

    const res: [Error | null, unknown][] = await this.redisClient
      .pipeline(sockets.map((id) => ['exists', `socket:${id}`]))
      .exec()

    const alive: string[] = []
    const dead: string[] = []
    sockets.forEach((id, i) => (res?.[i]?.[1] ? alive : dead).push(id))

    // srem nhận nhiều phần tử -> 1 lệnh thay vì 1 lệnh mỗi zombie
    if (dead.length) await this.redisClient.srem(userKey, ...dead)

    return alive
  }

  async isOnline(userId: string): Promise<boolean> {
    const userKey = this.getKey(userId)
    const sockets: string[] = await this.redisClient.smembers(userKey)
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

  /**
   * Bản theo lô của isOnline: 2 round-trip cho N user, bất kể N lớn đến đâu.
   * Dùng cho các luồng quét nhiều user cùng lúc (digest sweep, danh sách bạn bè)
   * thay vì gọi isOnline() trong vòng lặp.
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

  async getUserSockets(userId: string): Promise<string[]> {
    const userKey = this.getKey(userId)
    const sockets: string[] = await this.redisClient.smembers(userKey)
    return this.filterAliveSockets(userKey, sockets)
  }

  /**
   * Đọc từ Set chỉ mục `online:users` thay vì KEYS 'user:*:sockets'.
   * KEYS duyệt toàn bộ keyspace và chặn Redis (đo được 45,7ms ở 1 triệu key);
   * SMEMBERS trên set chỉ mục là O(số user online thật.)
   */
  async getOnlineUsers(): Promise<string[]> {
    return await this.redisClient.smembers(ONLINE_USERS_KEY)
  }
}
