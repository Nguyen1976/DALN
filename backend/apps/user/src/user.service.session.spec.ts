import { JwtService } from '@nestjs/jwt'
import { resolveAccessToken } from '@app/common/auth/resolve-tokens'
import { UserService } from './user.service'

/**
 * Vòng đời phiên ở tầng service: đăng nhập, làm mới có rotation, đăng xuất, và
 * phản ứng khi refresh token bị dùng lại.
 *
 * Access token được ký bằng JwtService THẬT rồi đưa lại qua `resolveAccessToken`
 * — đúng hàm mà AuthGuard dùng. Nhờ vậy test chứng minh được "login phát ra thứ
 * mà guard chấp nhận", chứ không chỉ chứng minh sign() được gọi.
 */

const jwt = new JwtService({ secret: 'test-secret' })

const activeUser = {
  id: 'u1',
  email: 'u1@example.test',
  username: 'u1',
  fullName: 'User Mot',
  password: 'hashed',
  isActive: true,
  avatar: null,
  bio: null,
  interests: [],
  hasCompletedInterestOnboarding: true,
  lastSeen: null,
}

function setup(
  overrides: {
    findByEmail?: jest.Mock
    findSessionFieldsById?: jest.Mock
    consume?: jest.Mock
  } = {},
) {
  const userRepo = {
    findByEmail: jest.fn().mockResolvedValue(activeUser),
    findSessionFieldsById: jest.fn().mockResolvedValue(activeUser),
    ...(overrides.findByEmail ? { findByEmail: overrides.findByEmail } : {}),
    ...(overrides.findSessionFieldsById
      ? { findSessionFieldsById: overrides.findSessionFieldsById }
      : {}),
  }
  const utilService = { comparePassword: jest.fn().mockResolvedValue(true) }
  const sessions = {
    listSessions: jest.fn().mockResolvedValue([]),
    create: jest
      .fn()
      .mockResolvedValue({ sid: 's1', refreshToken: 's1.verifier' }),
    consume: overrides.consume ?? jest.fn(),
    revokeSession: jest.fn().mockResolvedValue(undefined),
    revokeAllForUser: jest.fn().mockResolvedValue(['s1', 's2']),
  }
  const eventsPublisher = { publishSessionRevoked: jest.fn() }
  const redisService = {
    loginFailureCount: jest.fn().mockResolvedValue(0),
    countLoginFailure: jest.fn().mockResolvedValue(1),
    clearLoginFailures: jest.fn().mockResolvedValue(undefined),
  }
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  const geoIp = { lookup: jest.fn().mockReturnValue(null) }

  const service = new UserService(
    userRepo as never,
    {} as never, // friendRequestRepo
    {} as never, // friendShipRepo
    jwt as never,
    utilService as never,
    eventsPublisher as never,
    {} as never, // s3StorageService
    redisService as never,
    logger as never,
    {} as never, // prisma
    sessions as never,
    geoIp as never,
    redisService as never, // authStore: cùng stub, đã có đủ các phương thức đã dời
  )

  return {
    service,
    userRepo,
    sessions,
    eventsPublisher,
    logger,
    utilService,
    redisService,
    geoIp,
  }
}

describe('UserService.login', () => {
  it('tạo phiên và phát ra access token mà AuthGuard chấp nhận', async () => {
    const { service, sessions } = setup()

    const result = await service.login({
      email: 'u1@example.test',
      password: 'dung',
    })

    expect(sessions.create).toHaveBeenCalledWith('u1', {})
    expect(result.refreshToken).toBe('s1.verifier')
    expect(resolveAccessToken(jwt, result.accessToken)).toEqual({
      ok: true,
      payload: {
        userId: 'u1',
        email: 'u1@example.test',
        username: 'u1',
        sid: 's1',
      },
    })
  })

  it('ghi thiết bị và IP vào phiên', async () => {
    const { service, sessions } = setup()

    await service.login(
      { email: 'u1@example.test', password: 'dung' },
      { userAgent: 'Chrome/1', ip: '10.0.0.1' },
    )

    expect(sessions.create).toHaveBeenCalledWith('u1', {
      userAgent: 'Chrome/1',
      ip: '10.0.0.1',
    })
  })

  it('sai mật khẩu -> không tạo phiên nào', async () => {
    const { service, sessions, utilService } = setup()
    utilService.comparePassword.mockResolvedValue(false)

    await expect(
      service.login({ email: 'u1@example.test', password: 'sai' }),
    ).rejects.toBeDefined()
    expect(sessions.create).not.toHaveBeenCalled()
  })
})

describe('UserService.refreshSession', () => {
  it('rotated -> access mới cùng sid + refresh cookie mới', async () => {
    const { service } = setup({
      consume: jest.fn().mockResolvedValue({
        status: 'rotated',
        userId: 'u1',
        sid: 's1',
        refreshToken: 's1.moi',
      }),
    })

    const result = await service.refreshSession('s1.cu')

    expect(result.status).toBe('rotated')
    if (result.status !== 'rotated') throw new Error('unreachable')
    expect(result.refreshToken).toBe('s1.moi')
    expect(resolveAccessToken(jwt, result.accessToken)).toMatchObject({
      ok: true,
      payload: { sid: 's1', userId: 'u1' },
    })
  })

  // Trả cookie refresh ở nhánh này sẽ ghi đè bản mới mà request thắng cuộc
  // rotate vừa đặt vào trình duyệt — tự huỷ phiên của chính mình.
  it('grace -> CHỈ access mới, không kèm cookie refresh', async () => {
    const { service } = setup({
      consume: jest
        .fn()
        .mockResolvedValue({ status: 'grace', userId: 'u1', sid: 's1' }),
    })

    const result = await service.refreshSession('s1.cu')

    expect(result.status).toBe('grace')
    expect(result).not.toHaveProperty('refreshToken')
  })

  it('cookie sai/không có phiên -> terminated, không thu hồi gì', async () => {
    const { service, sessions, eventsPublisher } = setup({
      consume: jest.fn().mockResolvedValue({ status: 'invalid' }),
    })

    await expect(service.refreshSession('rac')).resolves.toEqual({
      status: 'terminated',
    })
    expect(sessions.revokeAllForUser).not.toHaveBeenCalled()
    expect(eventsPublisher.publishSessionRevoked).not.toHaveBeenCalled()
  })

  it('token bị dùng lại -> giết MỌI phiên của user và báo đi ngắt socket', async () => {
    const { service, sessions, eventsPublisher, logger } = setup({
      consume: jest
        .fn()
        .mockResolvedValue({ status: 'replayed', userId: 'u1', sid: 's1' }),
    })

    await expect(service.refreshSession('s1.da-tieu')).resolves.toEqual({
      status: 'terminated',
    })

    expect(sessions.revokeAllForUser).toHaveBeenCalledWith('u1')
    expect(eventsPublisher.publishSessionRevoked).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        sids: ['s1', 's2'],
        reason: 'token-reuse',
        // Người nhận đi kèm sẵn: đường cảnh báo bảo mật không nên phụ thuộc
        // vào một lời gọi nội bộ có thể đang lỗi.
        recipient: { email: 'u1@example.test', username: 'u1' },
        revokedAt: expect.any(String) as unknown,
      }),
    )
    // Phải để lại dấu vết: đây là dấu hiệu token bị đánh cắp.
    expect(logger.warn).toHaveBeenCalled()
  })

  it('tài khoản không còn -> thu hồi đúng phiên đó và terminated', async () => {
    const { service, sessions } = setup({
      findSessionFieldsById: jest.fn().mockResolvedValue(null),
      consume: jest.fn().mockResolvedValue({
        status: 'rotated',
        userId: 'u1',
        sid: 's1',
        refreshToken: 's1.moi',
      }),
    })

    await expect(service.refreshSession('s1.cu')).resolves.toEqual({
      status: 'terminated',
    })
    expect(sessions.revokeSession).toHaveBeenCalledWith('u1', 's1')
  })

  it('truyền IP của request xuống tầng phiên để ghi lastIp', async () => {
    const consume = jest.fn().mockResolvedValue({ status: 'invalid' })
    const { service } = setup({ consume })

    await service.refreshSession('s1.cu', { ip: '89.160.20.112' })

    expect(consume).toHaveBeenCalledWith('s1.cu', { ip: '89.160.20.112' })
  })
})

describe('UserService.logout', () => {
  it('thu hồi đúng phiên hiện tại và báo ngắt đúng socket đó', async () => {
    const { service, sessions, eventsPublisher } = setup({
      consume: jest
        .fn()
        .mockResolvedValue({ status: 'rotated', userId: 'u1', sid: 's1' }),
    })

    await service.logout('s1.verifier')

    expect(sessions.revokeSession).toHaveBeenCalledWith('u1', 's1')
    expect(eventsPublisher.publishSessionRevoked).toHaveBeenCalledWith({
      userId: 'u1',
      sids: ['s1'],
      reason: 'logout',
    })
    // Không được đá các thiết bị khác của cùng người.
    expect(sessions.revokeAllForUser).not.toHaveBeenCalled()
  })

  // Người bấm đăng xuất phải được thoát ra, kể cả khi cookie đã hỏng.
  it('cookie hỏng -> im lặng bỏ qua, không ném lỗi', async () => {
    const { service, sessions, eventsPublisher } = setup({
      consume: jest.fn().mockResolvedValue({ status: 'invalid' }),
    })

    await expect(service.logout('rac')).resolves.toBeUndefined()
    expect(sessions.revokeSession).not.toHaveBeenCalled()
    expect(eventsPublisher.publishSessionRevoked).not.toHaveBeenCalled()
  })

  it('token đã tiêu -> vẫn thu hồi phiên đó', async () => {
    const { service, sessions } = setup({
      consume: jest
        .fn()
        .mockResolvedValue({ status: 'replayed', userId: 'u1', sid: 's1' }),
    })

    await service.logout('s1.cu')

    expect(sessions.revokeSession).toHaveBeenCalledWith('u1', 's1')
  })
})

describe('UserService.logoutAll', () => {
  it('giết mọi phiên và báo ngắt mọi socket', async () => {
    const { service, sessions, eventsPublisher } = setup()

    await service.logoutAll('u1')

    expect(sessions.revokeAllForUser).toHaveBeenCalledWith('u1')
    expect(eventsPublisher.publishSessionRevoked).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        sids: ['s1', 's2'],
        reason: 'logout-all',
      }),
    )
    // Đăng xuất mọi nơi là việc người dùng tự làm -> KHÔNG kèm người nhận,
    // nên notification sẽ không gửi mail cảnh báo cho nó.
    const [payload] = eventsPublisher.publishSessionRevoked.mock.calls[0] as [
      { recipient?: unknown },
    ]
    expect(payload.recipient).toBeUndefined()
  })

  it('không có phiên nào -> không phát event rỗng', async () => {
    const { service, sessions, eventsPublisher } = setup()
    sessions.revokeAllForUser.mockResolvedValue([])

    await service.logoutAll('u1')

    expect(eventsPublisher.publishSessionRevoked).not.toHaveBeenCalled()
  })
})

describe('UserService.login — khoá tài khoản và cân bằng thời gian', () => {
  it('sai mật khẩu -> cộng bộ đếm khoá', async () => {
    const { service, utilService, redisService } = setup()
    utilService.comparePassword.mockResolvedValue(false)

    await expect(
      service.login({ email: 'u1@example.test', password: 'sai' }),
    ).rejects.toBeDefined()

    expect(redisService.countLoginFailure).toHaveBeenCalledWith(
      'u1@example.test',
      15 * 60,
    )
  })

  // Nói "tài khoản đang bị khoá" là xác nhận địa chỉ này có tồn tại, và biến
  // trang đăng nhập thành máy dò tài khoản. OWASP yêu cầu mọi nhánh nói giống nhau.
  it('đang bị khoá -> cùng lỗi như mật khẩu sai, và KHÔNG chạm DB', async () => {
    const { service, userRepo, redisService, sessions } = setup()
    redisService.loginFailureCount.mockResolvedValue(10)

    await expect(
      service.login({ email: 'u1@example.test', password: 'dung' }),
    ).rejects.toMatchObject({ status: 401 })

    expect(userRepo.findByEmail).not.toHaveBeenCalled()
    expect(sessions.create).not.toHaveBeenCalled()
  })

  it('dưới ngưỡng -> vẫn đăng nhập được', async () => {
    const { service, redisService } = setup()
    redisService.loginFailureCount.mockResolvedValue(9)

    await expect(
      service.login({ email: 'u1@example.test', password: 'dung' }),
    ).resolves.toMatchObject({ refreshToken: 's1.verifier' })
  })

  it('đăng nhập đúng -> xoá bộ đếm', async () => {
    const { service, redisService } = setup()

    await service.login({ email: 'u1@example.test', password: 'dung' })

    expect(redisService.clearLoginFailures).toHaveBeenCalledWith(
      'u1@example.test',
    )
  })

  // Bỏ bcrypt ở nhánh "không có user" làm email chưa đăng ký trả lời nhanh hơn
  // email đã đăng ký một cách đo được — đúng câu trả lời mà thông điệp giống
  // nhau đang cố che.
  it('email không tồn tại -> VẪN chạy bcrypt để thời gian không tố giác', async () => {
    const { service, userRepo, utilService } = setup()
    userRepo.findByEmail.mockResolvedValue(null)

    await expect(
      service.login({ email: 'khongco@example.test', password: 'x' }),
    ).rejects.toBeDefined()

    expect(utilService.comparePassword).toHaveBeenCalledTimes(1)
    const [, hash] = utilService.comparePassword.mock.calls[0] as [
      string,
      string,
    ]
    expect(hash).toMatch(/^\$2[aby]\$/)
  })

  it('Redis lỗi khi đọc bộ đếm -> cho qua (fail-open), không chặn đăng nhập', async () => {
    const { service, redisService } = setup()
    redisService.loginFailureCount.mockRejectedValue(new Error('ECONNREFUSED'))

    await expect(
      service.login({ email: 'u1@example.test', password: 'dung' }),
    ).resolves.toMatchObject({ refreshToken: 's1.verifier' })
  })
})

describe('UserService — danh sách thiết bị', () => {
  const rows = [
    {
      sid: 'cu',
      createdAt: 1,
      lastSeenAt: 100,
      userAgent: 'Firefox',
      ip: '1.1.1.1',
    },
    {
      sid: 'hien-tai',
      createdAt: 2,
      lastSeenAt: 500,
      userAgent: 'Chrome',
      ip: '2.2.2.2',
    },
  ]

  it('đánh dấu thiết bị đang xem và xếp mới nhất lên trước', async () => {
    const { service, sessions } = setup()
    sessions.listSessions.mockResolvedValue(rows)

    const list = await service.listOwnSessions('u1', 'hien-tai')

    expect(list.map((s) => s.sid)).toEqual(['hien-tai', 'cu'])
    expect(list[0].current).toBe(true)
    expect(list[1].current).toBe(false)
  })

  it('không có phiên nào -> danh sách rỗng', async () => {
    const { service } = setup()
    await expect(service.listOwnSessions('u1', 'x')).resolves.toEqual([])
  })

  it('thu hồi một thiết bị -> publish để ngắt đúng socket đó', async () => {
    const { service, sessions, eventsPublisher } = setup()
    sessions.revokeSession.mockResolvedValue(true)

    await expect(service.revokeOwnSession('u1', 'sid-khac')).resolves.toBe(true)
    expect(eventsPublisher.publishSessionRevoked).toHaveBeenCalledWith({
      userId: 'u1',
      sids: ['sid-khac'],
      reason: 'logout',
    })
  })

  // Không được publish khi chẳng thu hồi được gì: gateway sẽ ngắt socket của
  // một phiên mà người gọi không có quyền chạm tới.
  it('sid không thuộc mình -> false và KHÔNG publish', async () => {
    const { service, eventsPublisher, sessions } = setup()
    sessions.revokeSession.mockResolvedValue(false)

    await expect(
      service.revokeOwnSession('u1', 'cua-nguoi-khac'),
    ).resolves.toBe(false)
    expect(eventsPublisher.publishSessionRevoked).not.toHaveBeenCalled()
  })

  const london = {
    city: 'London',
    country: 'United Kingdom',
    latitude: 51.5142,
    longitude: -0.0931,
    accuracyRadiusKm: 10,
  }
  const linkoping = {
    city: 'Linköping',
    country: 'Sweden',
    latitude: 58.4167,
    longitude: 15.6167,
    accuracyRadiusKm: 76,
  }

  it('gắn vị trí cho IP lúc đăng nhập và cho IP gần nhất, mỗi cái một vị trí', async () => {
    const { service, sessions, geoIp } = setup()
    sessions.listSessions.mockResolvedValue([
      {
        sid: 'a',
        createdAt: 1,
        lastSeenAt: 2,
        userAgent: 'Chrome',
        ip: '81.2.69.142',
        lastIp: '89.160.20.112',
      },
    ])
    geoIp.lookup.mockImplementation((ip: string | null) =>
      ip === '81.2.69.142' ? london : ip === '89.160.20.112' ? linkoping : null,
    )

    const [item] = await service.listOwnSessions('u1', 'a')

    expect(item).toEqual({
      sid: 'a',
      createdAt: 1,
      lastSeenAt: 2,
      userAgent: 'Chrome',
      ip: '81.2.69.142',
      lastIp: '89.160.20.112',
      location: london,
      lastLocation: linkoping,
      current: true,
    })
  })

  it('không tra được vị trí -> location null, các field khác vẫn đủ', async () => {
    const { service, sessions } = setup()
    sessions.listSessions.mockResolvedValue([
      {
        sid: 'a',
        createdAt: 1,
        lastSeenAt: 2,
        userAgent: null,
        ip: '172.22.0.1',
        lastIp: '172.22.0.1',
      },
    ])

    const [item] = await service.listOwnSessions('u1', 'khac')

    expect(item).toMatchObject({
      sid: 'a',
      ip: '172.22.0.1',
      lastIp: '172.22.0.1',
      location: null,
      lastLocation: null,
      current: false,
    })
  })
})
