import Redis from 'ioredis'
import { RedisLeaseStore } from './lease-store'

// Chạy trên Redis thật vì đúng/sai nằm ở các script Lua. Ví dụ:
//   LEASE_STORE_REDIS_URL=redis://localhost:6380/15 npx jest lease-store
const url = process.env.LEASE_STORE_REDIS_URL
// Mỗi file một DB riêng: jest chạy các file song song, flushdb không được xoá dữ liệu của nhau.
const describeRedis = url ? describe : describe.skip

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describeRedis('RedisLeaseStore', () => {
  let redis: Redis
  let sub: Redis
  let store: RedisLeaseStore

  beforeEach(async () => {
    redis = new Redis(url!, { db: 15 })
    sub = new Redis(url!, { db: 15 })
    await redis.flushdb()
    store = new RedisLeaseStore(redis, sub)
  })

  afterEach(async () => {
    await Promise.all([redis.quit(), sub.quit()])
  })

  it('heartbeat lists live members and drops members silent for longer than the ttl', async () => {
    await store.heartbeat('B', 300)
    expect(await store.heartbeat('A', 300)).toEqual(['A', 'B'])

    await sleep(350)

    expect(await store.heartbeat('A', 300)).toEqual(['A'])
  })

  it('leave removes the member at once', async () => {
    await store.heartbeat('A', 5000)
    await store.heartbeat('B', 5000)
    await store.leave('B')
    expect(await store.heartbeat('A', 5000)).toEqual(['A'])
  })

  it('acquire succeeds only when the lease is free', async () => {
    expect(await store.acquire(3, 'A', 5000)).toBe(true)
    expect(await store.acquire(3, 'B', 5000)).toBe(false)
    const owners = await store.owners()
    expect(owners).toHaveLength(16)
    expect(owners[3]).toBe('A')
    expect(owners[4]).toBeNull()
  })

  it('renew reports lost once someone else owns the lease', async () => {
    await store.acquire(3, 'A', 5000)
    expect(await store.renew(3, 'A', 5000)).toBe('renewed')

    await redis.set('chat:lease:p3', 'B')

    expect(await store.renew(3, 'A', 5000)).toBe('lost')
  })

  it("release never deletes another member's lease", async () => {
    await store.acquire(3, 'B', 5000)
    await store.release(3, 'A')
    expect((await store.owners())[3]).toBe('B')
    await store.release(3, 'B')
    expect((await store.owners())[3]).toBeNull()
  })

  it('a lease expires on its own after the ttl', async () => {
    await store.acquire(3, 'A', 200)
    await sleep(250)
    expect(await store.acquire(3, 'B', 5000)).toBe(true)
  })

  it('notify reaches onNotify subscribers', async () => {
    const heard = jest.fn()
    await store.onNotify(heard)
    await store.notify()
    await sleep(100)
    expect(heard).toHaveBeenCalledTimes(1)
  })
})
