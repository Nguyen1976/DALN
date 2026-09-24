import { ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { RedisService } from '@app/redis/redis.service'
import { RateLimitGuard, type RateLimitRule } from './rate-limit'

const rule = (over: Partial<RateLimitRule> = {}): RateLimitRule => ({
  bucket: 'login',
  limit: 5,
  windowSeconds: 300,
  by: ['ip'],
  ...over,
})

function makeGuard(opts: {
  rule?: RateLimitRule
  ip?: string
  body?: unknown
  type?: 'http' | 'ws'
  /** Giá trị Lua trả về theo thứ tự từng key được kiểm. */
  retryAfter?: (number | Error)[]
}) {
  const evalMock = jest.fn()
  for (const value of opts.retryAfter ?? [0]) {
    if (value instanceof Error) evalMock.mockRejectedValueOnce(value)
    else evalMock.mockResolvedValueOnce(value)
  }
  evalMock.mockResolvedValue(0)

  const context = {
    getType: () => opts.type ?? 'http',
    switchToHttp: () => ({
      getRequest: () => ({ ip: opts.ip, body: opts.body }),
    }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext

  const reflector = {
    getAllAndOverride: () => opts.rule,
  } as unknown as Reflector

  const guard = new RateLimitGuard(reflector, {
    eval: evalMock,
  } as unknown as RedisService)

  return { guard, context, evalMock }
}

/** Key Redis của lần gọi eval thứ `n`. */
const keyOf = (evalMock: jest.Mock, n = 0): string => {
  const calls = evalMock.mock.calls as unknown as [
    string,
    string[],
    unknown[],
  ][]
  return calls[n][1][0]
}

async function statusOf(run: () => Promise<unknown>): Promise<number> {
  try {
    await run()
  } catch (error) {
    return (error as { getStatus: () => number }).getStatus()
  }
  throw new Error('không ném lỗi như kỳ vọng')
}

async function bodyOf(run: () => Promise<unknown>) {
  try {
    await run()
  } catch (error) {
    return (error as { getResponse: () => unknown }).getResponse() as {
      code?: string
      retryAfterSeconds?: number
    }
  }
  throw new Error('không ném lỗi như kỳ vọng')
}

describe('RateLimitGuard — khi nào bỏ qua', () => {
  it('endpoint không gắn @RateLimit -> cho qua, không chạm Redis', async () => {
    const { guard, context, evalMock } = makeGuard({})

    await expect(guard.canActivate(context)).resolves.toBe(true)
    expect(evalMock).not.toHaveBeenCalled()
  })

  it('context không phải HTTP -> cho qua', async () => {
    const { guard, context, evalMock } = makeGuard({
      type: 'ws',
      rule: rule(),
      ip: '1.2.3.4',
    })

    await expect(guard.canActivate(context)).resolves.toBe(true)
    expect(evalMock).not.toHaveBeenCalled()
  })

  it('thiếu IP -> bỏ qua chiều đó thay vì đếm vào một key rỗng', async () => {
    const { guard, context, evalMock } = makeGuard({ rule: rule(), ip: '' })

    await expect(guard.canActivate(context)).resolves.toBe(true)
    expect(evalMock).not.toHaveBeenCalled()
  })

  it('đếm theo email nhưng body không có email -> bỏ qua chiều đó', async () => {
    const { guard, context, evalMock } = makeGuard({
      rule: rule({ by: ['email'] }),
      body: {},
    })

    await expect(guard.canActivate(context)).resolves.toBe(true)
    expect(evalMock).not.toHaveBeenCalled()
  })
})

describe('RateLimitGuard — đếm và chặn', () => {
  it('còn lượt -> cho qua', async () => {
    const { guard, context } = makeGuard({
      rule: rule(),
      ip: '1.2.3.4',
      retryAfter: [0],
    })

    await expect(guard.canActivate(context)).resolves.toBe(true)
  })

  it('hết lượt -> 429 kèm retryAfterSeconds cho client biết chờ bao lâu', async () => {
    const guardFor = () =>
      makeGuard({ rule: rule(), ip: '1.2.3.4', retryAfter: [42] })

    const a = guardFor()
    await expect(statusOf(() => a.guard.canActivate(a.context))).resolves.toBe(
      429,
    )

    const b = guardFor()
    await expect(bodyOf(() => b.guard.canActivate(b.context))).resolves.toEqual(
      {
        message: 'TOO_MANY_REQUESTS',
        code: 'RATE_LIMITED',
        retryAfterSeconds: 42,
      },
    )
  })

  it('key gồm tên xô và IP', async () => {
    const { guard, context, evalMock } = makeGuard({
      rule: rule(),
      ip: '1.2.3.4',
    })

    await guard.canActivate(context)
    expect(keyOf(evalMock)).toBe('rl:login:ip:1.2.3.4')
  })

  it('email được chuẩn hoá về chữ thường -> không lách bằng cách viết hoa', async () => {
    const { guard, context, evalMock } = makeGuard({
      rule: rule({ by: ['email'] }),
      body: { email: '  Nguoi@Example.TEST ' },
    })

    await guard.canActivate(context)
    expect(keyOf(evalMock)).toBe('rl:login:email:nguoi@example.test')
  })

  // Hai chiều chặn hai kiểu tấn công khác nhau: một máy dội nhiều tài khoản,
  // và nhiều máy dội một tài khoản.
  it('by [ip, email] -> kiểm cả hai key', async () => {
    const { guard, context, evalMock } = makeGuard({
      rule: rule({ by: ['ip', 'email'] }),
      ip: '1.2.3.4',
      body: { email: 'a@b.test' },
      retryAfter: [0, 0],
    })

    await guard.canActivate(context)
    expect(evalMock).toHaveBeenCalledTimes(2)
    expect(keyOf(evalMock, 0)).toBe('rl:login:ip:1.2.3.4')
    expect(keyOf(evalMock, 1)).toBe('rl:login:email:a@b.test')
  })

  it('chiều nào vượt hạn trước thì chặn ngay, không kiểm tiếp', async () => {
    const { guard, context, evalMock } = makeGuard({
      rule: rule({ by: ['ip', 'email'] }),
      ip: '1.2.3.4',
      body: { email: 'a@b.test' },
      retryAfter: [30, 0],
    })

    await expect(statusOf(() => guard.canActivate(context))).resolves.toBe(429)
    expect(evalMock).toHaveBeenCalledTimes(1)
  })

  it('email không phải chuỗi -> bỏ qua, không crash', async () => {
    const { guard, context, evalMock } = makeGuard({
      rule: rule({ by: ['email'] }),
      body: { email: { nested: 'object' } },
    })

    await expect(guard.canActivate(context)).resolves.toBe(true)
    expect(evalMock).not.toHaveBeenCalled()
  })
})

describe('RateLimitGuard — Redis lỗi', () => {
  // Fail-OPEN có chủ ý: fail-closed sẽ biến sự cố của tầng hạn mức thành sập
  // hẳn đường đăng nhập, mà đăng nhập đã cần Redis để tạo phiên rồi.
  it('cho qua và không ném lỗi', async () => {
    const { guard, context } = makeGuard({
      rule: rule(),
      ip: '1.2.3.4',
      retryAfter: [new Error('ECONNREFUSED')],
    })

    await expect(guard.canActivate(context)).resolves.toBe(true)
  })
})
