import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import Redis from 'ioredis'
import { RedisService } from '@app/redis/redis.service'
import { SessionStore, sessionIndexKey, sessionKey } from './session.store'
import {
  REFRESH_TOKEN_TTL_SECONDS,
  ROTATION_GRACE_MS,
} from './session.constants'

/**
 * Ma trận rotate/ân hạn/replay chạy trên REDIS THẬT.
 *
 * Phần khó nhất của cơ chế này nằm trong một script Lua, và cái nó bảo vệ là
 * một race: hai request song song cùng mang token cũ. Mock Redis ở đây nghĩa là
 * tự viết lại semantics của script rồi test chính bản viết lại đó — xanh mà
 * không chứng minh gì. Nên suite này cần một Redis thật, và TỰ SKIP khi không
 * có (CI chưa dựng service Redis) để không biến thành màu xanh giả.
 *
 * Chạy local: `docker compose up -d redis` rồi
 *   TEST_REDIS_PORT=6380 npx jest session.store.redis
 */

const HOST = process.env.TEST_REDIS_HOST ?? '127.0.0.1'
const PORT = Number(process.env.TEST_REDIS_PORT ?? 6380)
const TEST_DB = 15

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

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex')
const verifierOf = (cookie: string) => cookie.slice(cookie.indexOf('.') + 1)

const describeRedis = redisReachable() ? describe : describe.skip

describeRedis('SessionStore trên Redis thật', () => {
  let client: Redis
  let store: SessionStore

  beforeAll(() => {
    client = new Redis({ host: HOST, port: PORT, db: TEST_DB })
    store = new SessionStore(new RedisService(client))
  })

  afterAll(async () => {
    await client.flushdb()
    await client.quit()
  })

  beforeEach(async () => {
    await client.flushdb()
  })

  it('create: phiên sống, chỉ lưu hash, TTL idle 7 ngày', async () => {
    const { sid, refreshToken } = await store.create('u1', { ip: '10.0.0.1' })

    await expect(store.isAlive(sid)).resolves.toBe(true)
    expect(await client.hget(sessionKey(sid), 'rtHash')).toBe(
      sha256(verifierOf(refreshToken)),
    )
    expect(await client.hget(sessionKey(sid), 'uid')).toBe('u1')

    const ttl = await client.ttl(sessionKey(sid))
    expect(ttl).toBeGreaterThan(REFRESH_TOKEN_TTL_SECONDS - 60)
    expect(ttl).toBeLessThanOrEqual(REFRESH_TOKEN_TTL_SECONDS)
    expect(await client.smembers(sessionIndexKey('u1'))).toEqual([sid])
  })

  it('token đúng -> rotate, và bản cũ chuyển sang prevHash', async () => {
    const { sid, refreshToken } = await store.create('u1')
    const oldHash = sha256(verifierOf(refreshToken))

    const outcome = await store.consume(refreshToken)

    expect(outcome.status).toBe('rotated')
    if (outcome.status !== 'rotated') throw new Error('unreachable')
    expect(outcome.userId).toBe('u1')
    expect(outcome.sid).toBe(sid)
    expect(await client.hget(sessionKey(sid), 'prevHash')).toBe(oldHash)
    expect(await client.hget(sessionKey(sid), 'rtHash')).toBe(
      sha256(verifierOf(outcome.refreshToken)),
    )
  })

  it('token mới dùng được ngay sau rotate', async () => {
    const { refreshToken } = await store.create('u1')
    const first = await store.consume(refreshToken)
    if (first.status !== 'rotated') throw new Error('unreachable')

    await expect(store.consume(first.refreshToken)).resolves.toMatchObject({
      status: 'rotated',
    })
  })

  it('token vừa bị thay, còn trong ân hạn -> grace và KHÔNG rotate lần nữa', async () => {
    const { sid, refreshToken } = await store.create('u1')
    const rotated = await store.consume(refreshToken)
    if (rotated.status !== 'rotated') throw new Error('unreachable')

    const hashBefore = await client.hget(sessionKey(sid), 'rtHash')
    const outcome = await store.consume(refreshToken)

    expect(outcome).toMatchObject({ status: 'grace', userId: 'u1', sid })
    // Rotate lần nữa ở nhánh ân hạn sẽ làm chính cookie vừa cấp thành vô hiệu.
    expect(await client.hget(sessionKey(sid), 'rtHash')).toBe(hashBefore)
  })

  it('token đã tiêu và hết ân hạn -> replayed', async () => {
    const { sid, refreshToken } = await store.create('u1')
    await store.consume(refreshToken)

    await client.hset(sessionKey(sid), 'prevUntil', String(Date.now() - 1))

    await expect(store.consume(refreshToken)).resolves.toMatchObject({
      status: 'replayed',
      userId: 'u1',
      sid,
    })
  })

  it('verifier bịa -> replayed, không cần biết token thật là gì', async () => {
    const { sid } = await store.create('u1')
    const forged = `${sid}.${randomBytes(32).toString('base64url')}`

    await expect(store.consume(forged)).resolves.toMatchObject({
      status: 'replayed',
      userId: 'u1',
    })
  })

  it('sid không tồn tại -> invalid', async () => {
    await expect(
      store.consume(`khong-ton-tai.${randomBytes(32).toString('base64url')}`),
    ).resolves.toEqual({ status: 'invalid' })
  })

  it('quá trần tuyệt đối -> invalid và key bị xoá, dù token vẫn đúng', async () => {
    const { sid, refreshToken } = await store.create('u1')
    await client.hset(sessionKey(sid), 'absExp', String(Date.now() - 1))

    await expect(store.consume(refreshToken)).resolves.toEqual({
      status: 'invalid',
    })
    await expect(store.isAlive(sid)).resolves.toBe(false)
  })

  it('rotate đẩy lại TTL idle', async () => {
    const { sid, refreshToken } = await store.create('u1')
    await client.expire(sessionKey(sid), 100)

    await store.consume(refreshToken)

    expect(await client.ttl(sessionKey(sid))).toBeGreaterThan(
      REFRESH_TOKEN_TTL_SECONDS - 60,
    )
  })

  it('ân hạn KHÔNG đẩy TTL idle (chỉ rotate mới được gia hạn phiên)', async () => {
    const { sid, refreshToken } = await store.create('u1')
    await store.consume(refreshToken)
    await client.expire(sessionKey(sid), 100)

    await store.consume(refreshToken) // grace

    expect(await client.ttl(sessionKey(sid))).toBeLessThanOrEqual(100)
  })

  it('5 request song song cùng token -> đúng 1 rotate, 4 grace, 0 bị giết', async () => {
    const { refreshToken } = await store.create('u1')

    const outcomes = await Promise.all(
      Array.from({ length: 5 }, () => store.consume(refreshToken)),
    )
    const count = (status: string) =>
      outcomes.filter((o) => o.status === status).length

    expect(count('rotated')).toBe(1)
    expect(count('grace')).toBe(4)
    expect(count('replayed')).toBe(0)
  })

  it('ân hạn đúng bằng ROTATION_GRACE_MS, không phải vô hạn', async () => {
    const { sid, refreshToken } = await store.create('u1')
    const before = Date.now()
    await store.consume(refreshToken)

    const prevUntil = Number(await client.hget(sessionKey(sid), 'prevUntil'))
    expect(prevUntil).toBeGreaterThanOrEqual(before + ROTATION_GRACE_MS - 1000)
    expect(prevUntil).toBeLessThanOrEqual(Date.now() + ROTATION_GRACE_MS)
  })

  it('revokeSession chỉ giết thiết bị đó, thiết bị khác của cùng user vẫn sống', async () => {
    const chrome = await store.create('u1')
    const phone = await store.create('u1')

    await store.revokeSession('u1', chrome.sid)

    await expect(store.isAlive(chrome.sid)).resolves.toBe(false)
    await expect(store.isAlive(phone.sid)).resolves.toBe(true)
    expect(await client.smembers(sessionIndexKey('u1'))).toEqual([phone.sid])
    await expect(store.consume(chrome.refreshToken)).resolves.toEqual({
      status: 'invalid',
    })
  })

  it('không thu hồi được phiên của user khác dù biết đúng sid', async () => {
    const victim = await store.create('victim')

    await expect(store.revokeSession('ke-tan-cong', victim.sid)).resolves.toBe(
      false,
    )

    // Phiên của nạn nhân phải còn nguyên, kể cả khi sid bị đoán đúng.
    await expect(store.isAlive(victim.sid)).resolves.toBe(true)
    await expect(store.consume(victim.refreshToken)).resolves.toMatchObject({
      status: 'rotated',
    })
  })

  it('revokeAllForUser giết sạch và không đụng tới user khác', async () => {
    const a1 = await store.create('u1')
    const a2 = await store.create('u1')
    const other = await store.create('u2')

    await expect(store.revokeAllForUser('u1')).resolves.toEqual(
      expect.arrayContaining([a1.sid, a2.sid]),
    )

    await expect(store.isAlive(a1.sid)).resolves.toBe(false)
    await expect(store.isAlive(a2.sid)).resolves.toBe(false)
    await expect(store.isAlive(other.sid)).resolves.toBe(true)
    expect(await client.exists(sessionIndexKey('u1'))).toBe(0)
  })

  it('listSessions trả phiên còn sống và tự dọn sid đã chết già', async () => {
    const alive = await store.create('u1', {
      userAgent: 'Chrome',
      ip: '1.1.1.1',
    })
    const dead = await store.create('u1')
    await client.del(sessionKey(dead.sid)) // hết TTL, chỉ mục vẫn còn

    const sessions = await store.listSessions('u1')

    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toMatchObject({
      sid: alive.sid,
      userAgent: 'Chrome',
      ip: '1.1.1.1',
    })
    expect(await client.smembers(sessionIndexKey('u1'))).toEqual([alive.sid])
  })
})
