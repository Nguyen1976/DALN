import { createHash } from 'node:crypto'
import type { RedisService } from '@app/redis/redis.service'
import {
  parseRefreshCookie,
  SessionStore,
  sessionIndexKey,
  sessionKey,
} from './session.store'
import {
  REFRESH_TOKEN_TTL_SECONDS,
  SESSION_INDEX_TTL_SECONDS,
} from './session.constants'
import {
  SESSION_STORE_TIMEOUT_MS,
  SessionStoreUnavailableError,
} from './session.store'

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex')

type RedisMock = {
  [K in keyof RedisService]?: jest.Mock
}

function makeRedis(overrides: RedisMock = {}) {
  const redis: RedisMock = {
    pipeline: jest.fn().mockResolvedValue([]),
    eval: jest.fn(),
    exists: jest.fn(),
    smembers: jest.fn().mockResolvedValue([]),
    delMany: jest.fn().mockResolvedValue(undefined),
    del: jest.fn().mockResolvedValue(undefined),
    srem: jest.fn().mockResolvedValue(0),
    ...overrides,
  }
  return {
    redis,
    store: new SessionStore(redis as unknown as RedisService),
  }
}

/** Lệnh pipeline của lần gọi thứ `call` — đọc `mock.calls` một lần, có kiểu. */
function pipelineArgs(mock: jest.Mock, call = 0): (string | number)[][] {
  const calls = mock.mock.calls as unknown as [(string | number)[][]][]
  return calls[call][0]
}

/** Mảng ARGV truyền vào Lua script của lần gọi eval đầu tiên. */
function evalArgs(mock: jest.Mock): string[] {
  const calls = mock.mock.calls as unknown as [string, string[], string[]][]
  return calls[0][2]
}

/** Gom một mảng lệnh pipeline phẳng thành object để assert cho dễ đọc. */
function commandAsHash(command: (string | number)[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (let i = 2; i < command.length - 1; i += 2) {
    out[String(command[i])] = String(command[i + 1])
  }
  return out
}

describe('parseRefreshCookie', () => {
  it('tách đúng sid và verifier', () => {
    expect(parseRefreshCookie('abc.xyz')).toEqual({
      sid: 'abc',
      verifier: 'xyz',
    })
  })

  it.each([
    ['không có dấu chấm', 'abcxyz'],
    ['thiếu verifier', 'abc.'],
    ['thiếu sid', '.xyz'],
    ['chỉ có dấu chấm', '.'],
    ['hai dấu chấm — không phải định dạng của ta', 'abc.xyz.more'],
    ['chuỗi rỗng', ''],
  ])('trả null khi %s', (_label, value) => {
    expect(parseRefreshCookie(value)).toBeNull()
  })

  it('trả null khi không có cookie', () => {
    expect(parseRefreshCookie(undefined)).toBeNull()
    expect(parseRefreshCookie(null)).toBeNull()
  })
})

describe('SessionStore.create', () => {
  it('chỉ lưu HASH của verifier, không bao giờ lưu bản thô', async () => {
    const { redis, store } = makeRedis()

    const { sid, refreshToken } = await store.create('u1')
    const verifier = refreshToken.slice(sid.length + 1)

    const commands = pipelineArgs(redis.pipeline!)
    const hset = commandAsHash(commands[0])

    expect(hset.rtHash).toBe(sha256(verifier))
    // Bản thô không được xuất hiện ở bất kỳ đâu trong lệnh gửi sang Redis.
    expect(JSON.stringify(commands)).not.toContain(verifier)
  })

  it('cookie có dạng <sid>.<verifier> và sid đủ ngẫu nhiên', async () => {
    const { store } = makeRedis()

    const a = await store.create('u1')
    const b = await store.create('u1')

    expect(a.refreshToken.startsWith(`${a.sid}.`)).toBe(true)
    expect(a.sid).not.toEqual(b.sid)
    expect(a.sid).not.toContain('.')
    expect(a.sid.length).toBeGreaterThanOrEqual(20)
  })

  it('đặt TTL idle cho phiên và TTL dài hơn cho chỉ mục', async () => {
    const { redis, store } = makeRedis()

    const { sid } = await store.create('u1')
    const commands = pipelineArgs(redis.pipeline!)

    expect(commands).toEqual(
      expect.arrayContaining([
        ['expire', sessionKey(sid), REFRESH_TOKEN_TTL_SECONDS],
        ['sadd', sessionIndexKey('u1'), sid],
        ['expire', sessionIndexKey('u1'), SESSION_INDEX_TTL_SECONDS],
      ]),
    )
  })

  it('ghi metadata thiết bị để sau này liệt kê được phiên', async () => {
    const { redis, store } = makeRedis()

    await store.create('u1', { userAgent: 'Chrome/1', ip: '10.0.0.9' })
    const commands = pipelineArgs(redis.pipeline!)
    const hset = commandAsHash(commands[0])

    expect(hset).toMatchObject({ uid: 'u1', ua: 'Chrome/1', ip: '10.0.0.9' })
    expect(Number(hset.absExp)).toBeGreaterThan(Date.now())
  })

  it('lastIp bắt đầu bằng đúng IP lúc đăng nhập', async () => {
    const { redis, store } = makeRedis()

    await store.create('u1', { userAgent: 'Chrome/1', ip: '10.0.0.9' })
    const hset = commandAsHash(pipelineArgs(redis.pipeline!)[0])

    expect(hset.lastIp).toBe('10.0.0.9')
  })
})

describe('SessionStore.consume', () => {
  it('cookie méo -> invalid và KHÔNG gọi Redis', async () => {
    const { redis, store } = makeRedis()

    await expect(store.consume('khong-co-dau-cham')).resolves.toEqual({
      status: 'invalid',
    })
    expect(redis.eval).not.toHaveBeenCalled()
  })

  it('không có cookie -> invalid', async () => {
    const { store } = makeRedis()
    await expect(store.consume(undefined)).resolves.toEqual({
      status: 'invalid',
    })
  })

  it('rotated -> cookie mới giữ nguyên sid nhưng đổi verifier', async () => {
    const { redis, store } = makeRedis({
      eval: jest.fn().mockResolvedValue('rotated|u1'),
    })

    const outcome = await store.consume('sid1.old-verifier')

    expect(outcome).toMatchObject({
      status: 'rotated',
      userId: 'u1',
      sid: 'sid1',
    })
    if (outcome.status !== 'rotated') throw new Error('unreachable')
    expect(outcome.refreshToken.startsWith('sid1.')).toBe(true)
    expect(outcome.refreshToken).not.toBe('sid1.old-verifier')

    // Hash gửi vào script phải là hash của verifier đang trình, và hash mới
    // phải là hash của verifier trong cookie trả về.
    const args = evalArgs(redis.eval!)
    const nextVerifier = outcome.refreshToken.slice('sid1.'.length)
    expect(args[0]).toBe(sha256('old-verifier'))
    expect(args[1]).toBe(sha256(nextVerifier))
  })

  it('grace -> không cấp cookie mới (bản mới đã ở trình duyệt rồi)', async () => {
    const { store } = makeRedis({
      eval: jest.fn().mockResolvedValue('grace|u1'),
    })

    await expect(store.consume('sid1.v')).resolves.toEqual({
      status: 'grace',
      userId: 'u1',
      sid: 'sid1',
    })
  })

  it('replayed -> mang theo userId để caller giết cả phiên', async () => {
    const { store } = makeRedis({
      eval: jest.fn().mockResolvedValue('replayed|u1'),
    })

    await expect(store.consume('sid1.v')).resolves.toEqual({
      status: 'replayed',
      userId: 'u1',
      sid: 'sid1',
    })
  })

  it('script trả invalid -> invalid', async () => {
    const { store } = makeRedis({
      eval: jest.fn().mockResolvedValue('invalid'),
    })

    await expect(store.consume('sid1.v')).resolves.toEqual({
      status: 'invalid',
    })
  })

  it('script trả thứ không hiểu được -> invalid, không đoán bừa', async () => {
    const { store } = makeRedis({
      eval: jest.fn().mockResolvedValue('rotated'),
    })

    await expect(store.consume('sid1.v')).resolves.toEqual({
      status: 'invalid',
    })
  })

  it('Redis lỗi -> SessionStoreUnavailableError, không âm thầm coi là invalid', async () => {
    const { store } = makeRedis({
      eval: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    })

    // Coi lỗi hạ tầng là "token sai" sẽ đăng xuất người dùng vì Redis nấc.
    await expect(store.consume('sid1.v')).rejects.toThrow(
      SessionStoreUnavailableError,
    )
  })

  it('truyền IP của request refresh vào script làm ARGV[6]', async () => {
    const { redis, store } = makeRedis({
      eval: jest.fn().mockResolvedValue('rotated|u1'),
    })

    await store.consume('sid1.old-verifier', { ip: '81.2.69.142' })

    expect(evalArgs(redis.eval!)[5]).toBe('81.2.69.142')
  })

  it('không biết IP -> ARGV[6] rỗng để script KHÔNG đè IP cũ', async () => {
    const { redis, store } = makeRedis({
      eval: jest.fn().mockResolvedValue('rotated|u1'),
    })

    await store.consume('sid1.old-verifier')

    expect(evalArgs(redis.eval!)[5]).toBe('')
  })
})

describe('SessionStore.isAlive', () => {
  it('phản chiếu EXISTS của key phiên', async () => {
    const { redis, store } = makeRedis({
      exists: jest.fn().mockResolvedValue(true),
    })

    await expect(store.isAlive('sid1')).resolves.toBe(true)
    expect(redis.exists).toHaveBeenCalledWith(sessionKey('sid1'))
  })

  it('Redis lỗi -> SessionStoreUnavailableError để guard trả 503 chứ không 401', async () => {
    const { store } = makeRedis({
      exists: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    })

    const error = await store.isAlive('sid1').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(SessionStoreUnavailableError)
    // Lỗi gốc phải giữ được để log ra còn điều tra tiếp.
    expect((error as SessionStoreUnavailableError).cause).toEqual(
      new Error('ECONNREFUSED'),
    )
  })
})

describe('SessionStore.revoke', () => {
  it('revokeSession: SREM là bước kiểm quyền, chỉ DEL khi sid thuộc user', async () => {
    const { redis, store } = makeRedis({
      srem: jest.fn().mockResolvedValue(1),
    })

    await expect(store.revokeSession('u1', 'sid1')).resolves.toBe(true)
    expect(redis.srem).toHaveBeenCalledWith(sessionIndexKey('u1'), 'sid1')
    expect(redis.del).toHaveBeenCalledWith(sessionKey('sid1'))
  })

  // Nếu DEL chạy trước rồi mới kiểm, trang "Thiết bị đang đăng nhập" nhận sid
  // từ client sẽ xoá được phiên của NGƯỜI KHÁC chỉ bằng cách đổi một tham số.
  it('revokeSession: sid không thuộc user -> false và KHÔNG xoá gì', async () => {
    const { redis, store } = makeRedis({
      srem: jest.fn().mockResolvedValue(0),
    })

    await expect(store.revokeSession('u1', 'cua-nguoi-khac')).resolves.toBe(
      false,
    )
    expect(redis.del).not.toHaveBeenCalled()
  })

  it('revokeAllForUser xoá mọi phiên, xoá chỉ mục, trả về sid đã giết', async () => {
    const { redis, store } = makeRedis({
      smembers: jest.fn().mockResolvedValue(['s1', 's2']),
    })

    await expect(store.revokeAllForUser('u1')).resolves.toEqual(['s1', 's2'])
    expect(redis.delMany).toHaveBeenCalledWith([
      sessionKey('s1'),
      sessionKey('s2'),
    ])
    expect(redis.del).toHaveBeenCalledWith(sessionIndexKey('u1'))
  })

  it('revokeAllForUser với user chưa có phiên nào -> không gọi delMany', async () => {
    const { redis, store } = makeRedis({
      smembers: jest.fn().mockResolvedValue([]),
    })

    await expect(store.revokeAllForUser('u1')).resolves.toEqual([])
    expect(redis.delMany).not.toHaveBeenCalled()
  })
})

describe('SessionStore.listSessions', () => {
  it('trả phiên còn sống và tự dọn sid đã chết khỏi chỉ mục', async () => {
    const { redis, store } = makeRedis({
      smembers: jest.fn().mockResolvedValue(['alive', 'dead']),
      pipeline: jest.fn().mockResolvedValue([
        [
          null,
          [
            'uid',
            'u1',
            'createdAt',
            '1000',
            'lastSeenAt',
            '2000',
            'ua',
            'Chrome',
            'ip',
            '10.0.0.1',
          ],
        ],
        // Phiên đã hết TTL: HGETALL trả mảng rỗng.
        [null, []],
      ]),
    })

    const sessions = await store.listSessions('u1')

    expect(sessions).toEqual([
      {
        sid: 'alive',
        createdAt: 1000,
        lastSeenAt: 2000,
        userAgent: 'Chrome',
        ip: '10.0.0.1',
        // Hash này chưa có lastIp (phiên tạo trước tính năng): nơi gần nhất
        // mà ta biết chính là nơi đăng nhập.
        lastIp: '10.0.0.1',
      },
    ])
    expect(redis.srem).toHaveBeenCalledWith(sessionIndexKey('u1'), 'dead')
  })

  it('chỉ mục rỗng -> không gọi pipeline', async () => {
    const { redis, store } = makeRedis({
      smembers: jest.fn().mockResolvedValue([]),
    })

    await expect(store.listSessions('u1')).resolves.toEqual([])
    expect(redis.pipeline).not.toHaveBeenCalled()
  })

  it('trả lastIp riêng khi phiên đã refresh từ nơi khác', async () => {
    const { store } = makeRedis({
      smembers: jest.fn().mockResolvedValue(['s1']),
      pipeline: jest.fn().mockResolvedValue([
        [
          null,
          [
            'uid',
            'u1',
            'createdAt',
            '1000',
            'lastSeenAt',
            '2000',
            'ua',
            'Chrome',
            'ip',
            '81.2.69.142',
            'lastIp',
            '89.160.20.112',
          ],
        ],
      ]),
    })

    const [session] = await store.listSessions('u1')

    expect(session).toMatchObject({
      ip: '81.2.69.142',
      lastIp: '89.160.20.112',
    })
  })
})

/**
 * Lệnh Redis TREO là ca đã thật sự xảy ra khi QC: client dùng
 * `maxRetriesPerRequest: null` nên lúc Redis chết lệnh không lỗi mà xếp hàng
 * vô hạn, và request treo tới khi trình duyệt tự bỏ. Nhánh fail-closed 503 chỉ
 * chạy được nếu lệnh chịu thất bại — nên biên thời gian này chính là thứ làm
 * cho quyết định "503 chứ không 401" có hiệu lực thật.
 */
describe('SessionStore — lệnh treo', () => {
  const never = () => new Promise<never>(() => {})

  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('isAlive treo -> SessionStoreUnavailableError sau đúng trần thời gian', async () => {
    const { store } = makeRedis({ exists: jest.fn().mockImplementation(never) })

    const pending = store.isAlive('sid1')
    const assertion = expect(pending).rejects.toThrow(
      SessionStoreUnavailableError,
    )
    jest.advanceTimersByTime(SESSION_STORE_TIMEOUT_MS)
    await assertion
  })

  it('consume treo -> SessionStoreUnavailableError, không trả invalid', async () => {
    const { store } = makeRedis({ eval: jest.fn().mockImplementation(never) })

    const pending = store.consume('sid1.v')
    // Trả `invalid` ở đây sẽ là lời nói dối tệ nhất có thể: nó nghĩa là
    // "token của bạn sai", và frontend sẽ đăng xuất người dùng.
    const assertion = expect(pending).rejects.toThrow(
      SessionStoreUnavailableError,
    )
    jest.advanceTimersByTime(SESSION_STORE_TIMEOUT_MS)
    await assertion
  })

  it('lệnh trả kịp thì KHÔNG bị timeout chặn', async () => {
    const { store } = makeRedis({
      exists: jest.fn().mockResolvedValue(true),
    })

    await expect(store.isAlive('sid1')).resolves.toBe(true)
  })
})

describe('SessionStore.revokeAllExcept', () => {
  it('giết mọi phiên khác và để nguyên phiên đang thao tác', async () => {
    const { redis, store } = makeRedis({
      smembers: jest
        .fn()
        .mockResolvedValue(['dien-thoai', 'may-nay', 'tablet']),
    })

    await expect(store.revokeAllExcept('u1', 'may-nay')).resolves.toEqual([
      'dien-thoai',
      'tablet',
    ])

    expect(redis.delMany).toHaveBeenCalledWith([
      sessionKey('dien-thoai'),
      sessionKey('tablet'),
    ])
    // Chỉ mục phải giữ lại phiên hiện tại, nên KHÔNG được xoá cả key như
    // revokeAllForUser: chỉ gỡ đúng những sid vừa giết.
    expect(redis.srem).toHaveBeenCalledWith(
      sessionIndexKey('u1'),
      'dien-thoai',
      'tablet',
    )
    expect(redis.del).not.toHaveBeenCalled()
  })

  it('chỉ có mỗi phiên hiện tại -> không đụng gì tới Redis', async () => {
    const { redis, store } = makeRedis({
      smembers: jest.fn().mockResolvedValue(['may-nay']),
    })

    await expect(store.revokeAllExcept('u1', 'may-nay')).resolves.toEqual([])
    expect(redis.delMany).not.toHaveBeenCalled()
    expect(redis.srem).not.toHaveBeenCalled()
  })
})
