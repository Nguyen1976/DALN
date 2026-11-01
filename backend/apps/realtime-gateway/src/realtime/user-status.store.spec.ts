import Redis from 'ioredis'
import { UserStatusStore } from './user-status.store'

// Chạy trên Redis thật vì quyết định online/offline nằm trong script Lua.
//   LEASE_STORE_REDIS_URL=redis://localhost:6380/15 npx jest user-status
const url = process.env.LEASE_STORE_REDIS_URL
// Mỗi file một DB riêng: jest chạy các file song song, flushdb không được xoá dữ liệu của nhau.
const describeRedis = url ? describe : describe.skip

describeRedis('UserStatusStore', () => {
  let redis: Redis
  let store: UserStatusStore

  beforeEach(async () => {
    redis = new Redis(url!, { db: 14 })
    await redis.flushdb()
    store = new UserStatusStore(redis)
  })

  afterEach(() => redis.quit())

  it('reports online exactly once for two concurrent connections', async () => {
    const results = await Promise.all([
      store.addConnection('u1', 's1'),
      store.addConnection('u1', 's2'),
    ])

    expect(results.filter((r) => r.cameOnline)).toHaveLength(1)
    expect(await store.isOnline('u1')).toBe(true)
  })

  it('reports offline only when the last live socket leaves', async () => {
    await store.addConnection('u1', 's1')
    await store.addConnection('u1', 's2')

    expect(await store.removeConnection('u1', 's1')).toEqual({
      wentOffline: false,
    })
    expect(await store.removeConnection('u1', 's2')).toEqual({
      wentOffline: true,
    })
    expect(await redis.sismember('online:users', 'u1')).toBe(0)
  })

  it('does not report offline twice for the same socket', async () => {
    await store.addConnection('u1', 's1')
    await store.removeConnection('u1', 's1')

    expect(await store.removeConnection('u1', 's1')).toEqual({
      wentOffline: false,
    })
  })

  it('ignores expired sockets when deciding', async () => {
    await store.addConnection('u1', 'stale')
    await redis.del('socket:stale') // TTL đã hết, set vẫn còn tên socket

    expect(await store.addConnection('u1', 's2')).toEqual({
      cameOnline: true,
    })
    expect(await redis.sismember('user:u1:sockets', 'stale')).toBe(0)
  })
})
