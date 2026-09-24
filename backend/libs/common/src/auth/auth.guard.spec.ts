import { ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { JwtService } from '@nestjs/jwt'
import { AuthGuard } from './auth.guard'
import { ACCESS_TOKEN_TYPE } from './resolve-tokens'
import type { SessionStore } from './session.store'

const jwt = new JwtService({ secret: 'test-secret' })

const signAccess = (extra: Record<string, unknown> = {}) =>
  jwt.sign(
    {
      userId: 'u1',
      email: 'u1@example.test',
      username: 'u1',
      sid: 's1',
      typ: ACCESS_TOKEN_TYPE,
      ...extra,
    },
    { expiresIn: '15m' },
  )

interface CtxOptions {
  type?: 'http' | 'ws'
  url?: string
  cookies?: Record<string, string>
  cookieHeader?: string
  headers?: Record<string, string>
  internalOnly?: boolean
  withoutLogin?: boolean
}

function buildContext(opts: CtxOptions = {}) {
  const request: Record<string, unknown> = {
    url: opts.url ?? '/user/me',
    cookies: opts.cookies,
    headers: { ...(opts.headers ?? {}), cookie: opts.cookieHeader },
  }

  const context = {
    getType: () => opts.type ?? 'http',
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext

  const reflector = {
    getAllAndOverride: (key: string) =>
      key === 'internal-only' ? opts.internalOnly : opts.withoutLogin,
  } as unknown as Reflector

  return { context, reflector, request }
}

function makeGuard(
  opts: CtxOptions = {},
  session: Partial<jest.Mocked<SessionStore>> = {},
) {
  const { context, reflector, request } = buildContext(opts)
  const isAlive = (session.isAlive ??
    jest.fn().mockResolvedValue(true)) as jest.Mock
  const sessions = { isAlive } as unknown as SessionStore
  return {
    guard: new AuthGuard(jwt, reflector, sessions),
    context,
    request,
    isAlive,
  }
}

/** Đọc `code` trong body của HttpException mà guard ném ra. */
async function codeOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run()
  } catch (error) {
    const response = (error as { getResponse?: () => unknown }).getResponse?.()
    return (response as { code?: string })?.code ?? 'NO_CODE'
  }
  throw new Error('không ném lỗi như kỳ vọng')
}

async function statusOf(run: () => Promise<unknown>): Promise<number> {
  try {
    await run()
  } catch (error) {
    return (error as { getStatus: () => number }).getStatus()
  }
  throw new Error('không ném lỗi như kỳ vọng')
}

describe('AuthGuard — đường cho qua', () => {
  it('context không phải HTTP (WebSocket) -> cho qua, gateway tự lo', async () => {
    const { guard, context, isAlive } = makeGuard({ type: 'ws' })

    await expect(guard.canActivate(context)).resolves.toBe(true)
    expect(isAlive).not.toHaveBeenCalled()
  })

  it('/metrics -> cho qua', async () => {
    const { guard, context } = makeGuard({ url: '/metrics' })
    await expect(guard.canActivate(context)).resolves.toBe(true)
  })

  it('@WithoutLogin() -> cho qua và KHÔNG chạm Redis', async () => {
    const { guard, context, isAlive } = makeGuard({ withoutLogin: true })

    await expect(guard.canActivate(context)).resolves.toBe(true)
    // Đăng nhập phải dùng được ngay cả khi tầng phiên đang lỗi.
    expect(isAlive).not.toHaveBeenCalled()
  })

  it('access hợp lệ + phiên còn sống -> cho qua và gắn user vào request', async () => {
    const { guard, context, request, isAlive } = makeGuard({
      cookies: { accessToken: signAccess() },
    })

    await expect(guard.canActivate(context)).resolves.toBe(true)
    expect(isAlive).toHaveBeenCalledWith('s1')
    expect(request.user).toEqual({
      userId: 'u1',
      email: 'u1@example.test',
      username: 'u1',
      sid: 's1',
    })
  })

  it('đọc được token từ header cookie thô khi không có cookie-parser', async () => {
    const { guard, context } = makeGuard({
      cookieHeader: `accessToken=${signAccess()}`,
    })

    await expect(guard.canActivate(context)).resolves.toBe(true)
  })
})

describe('AuthGuard — đường từ chối', () => {
  it('không có cookie -> 401 ACCESS_TOKEN_MISSING', async () => {
    const { guard, context } = makeGuard()
    await expect(codeOf(() => guard.canActivate(context))).resolves.toBe(
      'ACCESS_TOKEN_MISSING',
    )
  })

  it('access hết hạn -> 401 ACCESS_TOKEN_EXPIRED (FE sẽ gọi refresh)', async () => {
    const expired = jwt.sign({
      userId: 'u1',
      sid: 's1',
      typ: ACCESS_TOKEN_TYPE,
      exp: Math.floor(Date.now() / 1000) - 60,
    })
    const { guard, context } = makeGuard({ cookies: { accessToken: expired } })

    await expect(codeOf(() => guard.canActivate(context))).resolves.toBe(
      'ACCESS_TOKEN_EXPIRED',
    )
  })

  it('sai chữ ký -> 401 TOKEN_INVALID', async () => {
    const forged = new JwtService({ secret: 'khac' }).sign(
      { userId: 'u1', sid: 's1', typ: ACCESS_TOKEN_TYPE },
      { expiresIn: '15m' },
    )
    const { guard, context } = makeGuard({ cookies: { accessToken: forged } })

    await expect(codeOf(() => guard.canActivate(context))).resolves.toBe(
      'TOKEN_INVALID',
    )
  })

  it('token cũ không có sid -> 401 TOKEN_INVALID', async () => {
    const legacy = jwt.sign(
      { userId: 'u1', email: 'e', username: 'u', typ: ACCESS_TOKEN_TYPE },
      { expiresIn: '15m' },
    )
    const { guard, context, isAlive } = makeGuard({
      cookies: { accessToken: legacy },
    })

    await expect(codeOf(() => guard.canActivate(context))).resolves.toBe(
      'TOKEN_INVALID',
    )
    expect(isAlive).not.toHaveBeenCalled()
  })

  it('đưa token không phải access vào chỗ access -> 401 TOKEN_INVALID', async () => {
    const { guard, context } = makeGuard({
      cookies: { accessToken: signAccess({ typ: 'rt' }) },
    })

    await expect(codeOf(() => guard.canActivate(context))).resolves.toBe(
      'TOKEN_INVALID',
    )
  })

  it('phiên đã bị thu hồi -> 401 SESSION_REVOKED dù token còn hạn', async () => {
    const { guard, context } = makeGuard(
      { cookies: { accessToken: signAccess() } },
      { isAlive: jest.fn().mockResolvedValue(false) as never },
    )

    await expect(codeOf(() => guard.canActivate(context))).resolves.toBe(
      'SESSION_REVOKED',
    )
    await expect(statusOf(() => guard.canActivate(context))).resolves.toBe(401)
  })
})

describe('AuthGuard — Redis lỗi', () => {
  // Quyết định thiết kế: 503 chứ không 401. Interceptor của FE coi mọi 401 là
  // phiên chấm dứt, nên trả 401 ở đây sẽ đăng xuất toàn bộ người dùng chỉ vì
  // Redis nấc một nhịp.
  it('không kiểm tra được phiên -> 503 SESSION_CHECK_UNAVAILABLE', async () => {
    const guardFor = () =>
      makeGuard(
        { cookies: { accessToken: signAccess() } },
        {
          isAlive: jest
            .fn()
            .mockRejectedValue(new Error('ECONNREFUSED')) as never,
        },
      )

    const a = guardFor()
    await expect(codeOf(() => a.guard.canActivate(a.context))).resolves.toBe(
      'SESSION_CHECK_UNAVAILABLE',
    )

    const b = guardFor()
    await expect(statusOf(() => b.guard.canActivate(b.context))).resolves.toBe(
      503,
    )
  })
})

describe('AuthGuard — @InternalOnly()', () => {
  const OLD = process.env.INTERNAL_API_TOKEN

  afterEach(() => {
    process.env.INTERNAL_API_TOKEN = OLD
  })

  it('token nội bộ đúng -> cho qua, không cần cookie', async () => {
    process.env.INTERNAL_API_TOKEN = 'secret-noi-bo'
    const { guard, context } = makeGuard({
      internalOnly: true,
      headers: { 'x-internal-token': 'secret-noi-bo' },
    })

    await expect(guard.canActivate(context)).resolves.toBe(true)
  })

  it('thiếu cấu hình -> 403, fail-closed', async () => {
    delete process.env.INTERNAL_API_TOKEN
    const { guard, context } = makeGuard({ internalOnly: true })

    await expect(codeOf(() => guard.canActivate(context))).resolves.toBe(
      'INTERNAL_API_NOT_CONFIGURED',
    )
  })

  it('token nội bộ sai -> 403', async () => {
    process.env.INTERNAL_API_TOKEN = 'secret-noi-bo'
    const { guard, context } = makeGuard({
      internalOnly: true,
      headers: { 'x-internal-token': 'sai' },
    })

    await expect(codeOf(() => guard.canActivate(context))).resolves.toBe(
      'INTERNAL_TOKEN_INVALID',
    )
  })

  // @InternalOnly() phải thắng @WithoutLogin() kể cả khi decorator nằm ở class cha.
  it('@InternalOnly() thắng @WithoutLogin()', async () => {
    process.env.INTERNAL_API_TOKEN = 'secret-noi-bo'
    const { guard, context } = makeGuard({
      internalOnly: true,
      withoutLogin: true,
    })

    await expect(codeOf(() => guard.canActivate(context))).resolves.toBe(
      'INTERNAL_TOKEN_INVALID',
    )
  })
})
