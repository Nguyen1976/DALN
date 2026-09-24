import { execFileSync } from 'node:child_process'
import Redis from 'ioredis'
import { RedisService } from './redis.service'

/**
 * OTP và bộ đếm khoá tài khoản, chạy trên REDIS THẬT.
 *
 * Cả hai đều dựa vào Lua (INCR + EXPIRE nguyên tử) và vào việc so khớp theo
 * thời gian hằng định. Mock Redis ở đây nghĩa là tự viết lại semantics rồi test
 * chính bản viết lại đó. Suite TỰ SKIP khi không có Redis (CI chưa dựng service)
 * để không thành màu xanh giả.
 */

const HOST = process.env.TEST_REDIS_HOST ?? '127.0.0.1'
const PORT = Number(process.env.TEST_REDIS_PORT ?? 6380)
const TEST_DB = 14

function redisReachable(): boolean {
  try {
    execFileSync(
      process.execPath,
      [
        '-e',
        `const n=require('net');const s=n.createConnection({host:'${HOST}',port:${PORT}});` +
          `s.on('connect',()=>{s.destroy();process.exit(0)});` +
          `s.on('error',()=>process.exit(1));setTimeout(()=>process.exit(1),1500)`,
      ],
      { stdio: 'ignore' },
    )
    return true
  } catch {
    return false
  }
}

const describeRedis = redisReachable() ? describe : describe.skip

describeRedis('RedisService — OTP đăng ký', () => {
  let client: Redis
  let redis: RedisService

  beforeAll(() => {
    client = new Redis({ host: HOST, port: PORT, db: TEST_DB })
    redis = new RedisService(client)
  })

  afterAll(async () => {
    await client.flushdb()
    await client.quit()
  })

  beforeEach(async () => {
    await client.flushdb()
  })

  const email = 'Nguoi@Example.TEST'

  it('lưu BẢN BĂM, không lưu mã thô', async () => {
    await redis.saveOTP(email, '123456')

    const stored = await client.get('otp:reg:nguoi@example.test')
    expect(stored).not.toBe('123456')
    expect(stored).toMatch(/^[0-9a-f]{64}$/)
  })

  it('email không phân biệt hoa thường và khoảng trắng', async () => {
    await redis.saveOTP('  Nguoi@Example.TEST ', '123456')
    await expect(redis.verifyOTP('nguoi@example.test', '123456')).resolves.toBe(
      true,
    )
  })

  it('mã đúng -> true, mã sai -> false', async () => {
    await redis.saveOTP(email, '123456')

    await expect(redis.verifyOTP(email, '123456')).resolves.toBe(true)
    await expect(redis.verifyOTP(email, '654321')).resolves.toBe(false)
  })

  it('không có mã nào -> false, không ném lỗi', async () => {
    await expect(redis.verifyOTP(email, '123456')).resolves.toBe(false)
  })

  it('TTL 5 phút', async () => {
    await redis.saveOTP(email, '123456')
    const ttl = await client.ttl('otp:reg:nguoi@example.test')
    expect(ttl).toBeGreaterThan(240)
    expect(ttl).toBeLessThanOrEqual(300)
  })

  it('deleteOTP xoá cả mã và bộ đếm lần thử', async () => {
    await redis.saveOTP(email, '123456')
    await redis.claimOtpAttempt(email)
    await redis.deleteOTP(email)

    expect(await client.exists('otp:reg:nguoi@example.test')).toBe(0)
    expect(await client.exists('otp:attempts:nguoi@example.test')).toBe(0)
  })

  // Không có bước này thì cả không gian 10^6 mở trong 5 phút, và mỗi lần đoán
  // sai không mất gì cả: mã vẫn nằm đó cho lần đoán tiếp theo.
  it('quá 5 lần thử -> mã bị TIÊU HUỶ', async () => {
    await redis.saveOTP(email, '123456')

    const burned: boolean[] = []
    for (let i = 0; i < 5; i += 1) {
      burned.push(await redis.claimOtpAttempt(email))
    }

    expect(burned).toEqual([false, false, false, false, true])
    // Mã đúng cũng không dùng được nữa — đó là điểm của việc huỷ.
    await expect(redis.verifyOTP(email, '123456')).resolves.toBe(false)
  })

  it('gửi mã mới -> bộ đếm lần thử về 0', async () => {
    await redis.saveOTP(email, '111111')
    await redis.claimOtpAttempt(email)
    await redis.claimOtpAttempt(email)

    await redis.saveOTP(email, '222222')

    expect(await client.exists('otp:attempts:nguoi@example.test')).toBe(0)
    await expect(redis.verifyOTP(email, '222222')).resolves.toBe(true)
  })
})

describeRedis('RedisService — khoá tài khoản sau nhiều lần sai', () => {
  let client: Redis
  let redis: RedisService

  beforeAll(() => {
    client = new Redis({ host: HOST, port: PORT, db: TEST_DB })
    redis = new RedisService(client)
  })

  afterAll(async () => {
    await client.flushdb()
    await client.quit()
  })

  beforeEach(async () => {
    await client.flushdb()
  })

  const email = 'ai@example.test'

  it('đếm tăng dần và đặt TTL ngay từ lần đầu', async () => {
    await expect(redis.countLoginFailure(email, 900)).resolves.toBe(1)
    await expect(redis.countLoginFailure(email, 900)).resolves.toBe(2)

    // TTL phải được đặt ở lần INCR đầu tiên: quên bước này để lại một bộ đếm
    // không bao giờ hết hạn, tức khoá tài khoản vĩnh viễn.
    const ttl = await client.ttl('login:fail:ai@example.test')
    expect(ttl).toBeGreaterThan(0)
    expect(ttl).toBeLessThanOrEqual(900)
  })

  it('loginFailureCount đọc mà KHÔNG làm tăng bộ đếm', async () => {
    await redis.countLoginFailure(email)

    await expect(redis.loginFailureCount(email)).resolves.toBe(1)
    await expect(redis.loginFailureCount(email)).resolves.toBe(1)
  })

  it('chưa từng sai -> 0', async () => {
    await expect(redis.loginFailureCount(email)).resolves.toBe(0)
  })

  it('đăng nhập đúng -> xoá bộ đếm, người dùng thật không tích luỹ', async () => {
    await redis.countLoginFailure(email)
    await redis.countLoginFailure(email)

    await redis.clearLoginFailures(email)

    await expect(redis.loginFailureCount(email)).resolves.toBe(0)
  })

  it('đếm theo TÀI KHOẢN: hai email không dùng chung bộ đếm', async () => {
    await redis.countLoginFailure('a@example.test')
    await redis.countLoginFailure('a@example.test')

    await expect(redis.loginFailureCount('b@example.test')).resolves.toBe(0)
  })
})
