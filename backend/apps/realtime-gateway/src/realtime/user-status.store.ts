import type Redis from 'ioredis'

/** Set chỉ mục các user đang online — thay cho việc quét KEYS 'user:*:sockets'. */
const ONLINE_USERS_KEY = 'online:users'

// Socket còn sống = còn key `socket:{id}` (TTL 90s, gia hạn theo pong). Socket
// đã hết hạn vẫn nằm trong set thì dọn luôn trước khi đếm.
const ADD_CONNECTION = `
local alive = 0
for _, id in ipairs(redis.call('SMEMBERS', KEYS[1])) do
  if id ~= ARGV[1] then
    if redis.call('EXISTS', 'socket:' .. id) == 1 then
      alive = alive + 1
    else
      redis.call('SREM', KEYS[1], id)
    end
  end
end
redis.call('SADD', KEYS[1], ARGV[1])
redis.call('SET', 'socket:' .. ARGV[1], ARGV[2], 'EX', ARGV[3])
redis.call('EXPIRE', KEYS[1], ARGV[4])
redis.call('SADD', KEYS[2], ARGV[2])
if alive == 0 then return 1 end
return 0
`

const REMOVE_CONNECTION = `
local removed = redis.call('SREM', KEYS[1], ARGV[1])
redis.call('DEL', 'socket:' .. ARGV[1])
local alive = 0
for _, id in ipairs(redis.call('SMEMBERS', KEYS[1])) do
  if redis.call('EXISTS', 'socket:' .. id) == 1 then
    alive = alive + 1
  else
    redis.call('SREM', KEYS[1], id)
  end
end
if alive > 0 then return 0 end
redis.call('DEL', KEYS[1])
redis.call('SREM', KEYS[2], ARGV[2])
if removed == 1 then return 1 end
return 0
`

export class UserStatusStore {
  // Map userId -> Set socketIds
  private readonly socketTtlSeconds = 90
  private readonly userSetTtlSeconds = 300

  constructor(private redisClient: Redis) {}
  private getKey(userId: string) {
    return `user:${userId}:sockets`
  }

  /**
   * Thêm socket và cho biết user vừa chuyển từ offline sang online hay chưa —
   * trong MỘT script Lua. Đọc isOnline rồi mới ghi (check-then-act) thì hai
   * tab vào hai gateway cùng lúc đều thấy "chưa online" và phát online hai lần.
   */
  async addConnection(
    userId: string,
    socketId: string,
  ): Promise<{ cameOnline: boolean }> {
    const cameOnline = await this.redisClient.eval(
      ADD_CONNECTION,
      2,
      this.getKey(userId),
      ONLINE_USERS_KEY,
      socketId,
      userId,
      this.socketTtlSeconds,
      this.userSetTtlSeconds,
    )
    return { cameOnline: cameOnline === 1 }
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

  /** Gỡ socket; `wentOffline` chỉ đúng khi đây là socket còn sống cuối cùng. */
  async removeConnection(
    userId: string,
    socketId: string,
  ): Promise<{ wentOffline: boolean }> {
    const wentOffline = await this.redisClient.eval(
      REMOVE_CONNECTION,
      2,
      this.getKey(userId),
      ONLINE_USERS_KEY,
      socketId,
      userId,
    )
    return { wentOffline: wentOffline === 1 }
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
