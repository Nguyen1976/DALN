import Redis from 'ioredis'
import { GroupCallTimers } from './group-call-timers'

// Chạy trên Redis thật: điều cần chứng minh là hai gateway không cùng chạy một
// hạn chót, và hạn chót sống sót khi gateway đặt nó đã tắt.
//   LEASE_STORE_REDIS_URL=redis://localhost:6380/15 npx jest group-call-timers
const url = process.env.LEASE_STORE_REDIS_URL
// Mỗi file một DB riêng: jest chạy các file song song, flushdb không được xoá dữ liệu của nhau.
const describeRedis = url ? describe : describe.skip

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describeRedis('GroupCallTimers', () => {
  let redis: Redis
  const timers: GroupCallTimers[] = []

  const make = (onDue: jest.Mock) => {
    const t = new GroupCallTimers(redis, onDue, 20)
    timers.push(t)
    return t
  }

  beforeEach(async () => {
    redis = new Redis(url!, { db: 13 })
    await redis.flushdb()
  })

  afterEach(async () => {
    timers.splice(0).forEach((t) => t.stop())
    await redis.quit()
  })

  it('fires a due timer once even with two sweepers', async () => {
    const onDue = jest.fn().mockResolvedValue(undefined)
    const a = make(onDue)
    const b = make(onDue)
    a.start()
    b.start()

    await a.schedule('pending', 'call-1', 50)
    await sleep(200)

    expect(onDue).toHaveBeenCalledTimes(1)
    expect(onDue).toHaveBeenCalledWith('pending', 'call-1')
  })

  it('a cancelled timer never fires', async () => {
    const onDue = jest.fn().mockResolvedValue(undefined)
    const a = make(onDue)
    a.start()

    await a.schedule('empty', 'call-1', 50)
    await a.cancel('empty', 'call-1')
    await sleep(150)

    expect(onDue).not.toHaveBeenCalled()
  })

  it('a timer survives the instance that scheduled it', async () => {
    const first = jest.fn().mockResolvedValue(undefined)
    const second = jest.fn().mockResolvedValue(undefined)
    const a = make(first)
    await a.schedule('pending', 'call-1', 50)
    a.stop()

    make(second).start()
    await sleep(200)

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith('pending', 'call-1')
  })

  it('rescheduling replaces the previous deadline', async () => {
    const onDue = jest.fn().mockResolvedValue(undefined)
    const a = make(onDue)
    a.start()

    await a.schedule('empty', 'call-1', 50)
    await a.schedule('empty', 'call-1', 300)
    await sleep(150)
    expect(onDue).not.toHaveBeenCalled()

    await sleep(300)
    expect(onDue).toHaveBeenCalledTimes(1)
  })
})
