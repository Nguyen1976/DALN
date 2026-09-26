import 'reflect-metadata'
import { createHash } from 'node:crypto'
import { UserService } from './user.service'
import type { UserPasswordResetPayload } from 'libs/constant/rmq/payload'

const activeUser = {
  id: '6aa55a491bea4834e8549a01',
  email: 'an@example.test',
  username: 'an',
  password: 'hash-cu',
  isActive: true,
}

function setup(user: typeof activeUser | null = activeUser) {
  const userRepo = {
    findByEmail: jest.fn().mockResolvedValue(user),
    findById: jest.fn().mockResolvedValue(user),
    updatePasswordById: jest.fn().mockResolvedValue(user),
  }
  const utilService = {
    hashPassword: jest.fn().mockResolvedValue('hash-moi'),
  }
  const eventsPublisher = {
    publishUserPasswordReset: jest.fn<void, [UserPasswordResetPayload]>(),
    publishUserPasswordChanged: jest.fn(),
    publishSessionRevoked: jest.fn(),
  }
  const redisService = {
    claimPasswordResetIpSlot: jest.fn().mockResolvedValue(true),
    claimPasswordResetHourlySlot: jest.fn().mockResolvedValue(true),
    claimPasswordResetSlot: jest.fn().mockResolvedValue(true),
    savePasswordResetToken: jest
      .fn<Promise<void>, [string, string, string, number?]>()
      .mockResolvedValue(undefined),
    peekPasswordResetToken: jest.fn().mockResolvedValue(null),
    consumePasswordResetToken: jest.fn().mockResolvedValue(null),
    clearPasswordResetIndex: jest.fn().mockResolvedValue(undefined),
  }
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  const sessions = {
    revokeAllForUser: jest.fn().mockResolvedValue(['s1', 's2']),
    revokeSession: jest.fn().mockResolvedValue(undefined),
  }

  const service = new UserService(
    userRepo as never,
    {} as never,
    {} as never,
    {} as never,
    utilService as never,
    eventsPublisher as never,
    {} as never,
    redisService as never,
    logger as never,
    {} as never,
    sessions as never,
    {} as never, // geoIp
    redisService as never, // authStore: cùng stub, đã có đủ các phương thức đã dời
  )
  return {
    service,
    userRepo,
    utilService,
    eventsPublisher,
    redisService,
    sessions,
  }
}

describe('UserService.forgotPassword', () => {
  it('đường hạnh phúc: lưu BẢN BĂM của token, phát sự kiện mang token THÔ', async () => {
    const { service, eventsPublisher, redisService } = setup()

    await service.forgotPassword({ email: 'an@example.test', ip: '1.2.3.4' })

    const published = eventsPublisher.publishUserPasswordReset.mock.calls[0][0]
    expect(published.email).toBe('an@example.test')
    expect(published.username).toBe('an')
    expect(published.expiresInMinutes).toBe(15)
    expect(typeof published.token).toBe('string')

    const [email, userId, tokenHash] =
      redisService.savePasswordResetToken.mock.calls[0]
    expect(email).toBe('an@example.test')
    expect(userId).toBe(activeUser.id)
    // Redis chỉ được thấy bản băm, không bao giờ thấy token thô.
    expect(tokenHash).toBe(
      createHash('sha256').update(published.token).digest('hex'),
    )
    expect(tokenHash).not.toBe(published.token)
  })

  it('token có đủ entropy và an toàn trong URL', async () => {
    const { service, eventsPublisher } = setup()

    await service.forgotPassword({ email: 'an@example.test', ip: '1.2.3.4' })
    await service.forgotPassword({ email: 'an@example.test', ip: '1.2.3.4' })

    const [a, b] = eventsPublisher.publishUserPasswordReset.mock.calls.map(
      (call) => call[0].token,
    )
    expect(a).not.toBe(b)
    expect(a).toHaveLength(43) // 32 byte base64url
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('email lạ: im lặng, không phát sự kiện, không ném lỗi', async () => {
    const { service, eventsPublisher } = setup(null)

    await expect(
      service.forgotPassword({ email: 'ai-do@example.test', ip: '1.2.3.4' }),
    ).resolves.toBeUndefined()

    expect(eventsPublisher.publishUserPasswordReset).not.toHaveBeenCalled()
  })

  it('tài khoản chưa kích hoạt: không gửi — đó là việc của luồng verify-otp', async () => {
    const { service, eventsPublisher } = setup({
      ...activeUser,
      isActive: false,
    })

    await service.forgotPassword({ email: 'an@example.test', ip: '1.2.3.4' })

    expect(eventsPublisher.publishUserPasswordReset).not.toHaveBeenCalled()
  })

  it('đang cooldown: im lặng, và KHÔNG tra cơ sở dữ liệu', async () => {
    const { service, userRepo, eventsPublisher, redisService } = setup()
    redisService.claimPasswordResetSlot.mockResolvedValueOnce(false)

    await service.forgotPassword({ email: 'an@example.test', ip: '1.2.3.4' })

    expect(eventsPublisher.publishUserPasswordReset).not.toHaveBeenCalled()
    // Claim trước khi tra: email có thật và không có thật phải đi qua cùng
    // số lượng thao tác, nếu không thời gian phản hồi tố cáo sự khác biệt.
    expect(userRepo.findByEmail).not.toHaveBeenCalled()
  })

  it('bị cooldown chặn thì KHÔNG tiêu một slot của trần theo giờ', async () => {
    const { service, redisService, eventsPublisher } = setup()
    redisService.claimPasswordResetSlot.mockResolvedValueOnce(false)

    await service.forgotPassword({ email: 'an@example.test', ip: '1.2.3.4' })

    // Đếm request thay vì đếm email sẽ khiến vài cú bấm liên tiếp khoá tài
    // khoản khỏi đường khôi phục cả tiếng, sau đúng một email gửi đi.
    expect(redisService.claimPasswordResetHourlySlot).not.toHaveBeenCalled()
    expect(eventsPublisher.publishUserPasswordReset).not.toHaveBeenCalled()
  })

  it('vượt hạn mức IP: im lặng, và không tiêu tốn cả slot cooldown', async () => {
    const { service, eventsPublisher, redisService } = setup()
    redisService.claimPasswordResetIpSlot.mockResolvedValueOnce(false)

    await service.forgotPassword({ email: 'an@example.test', ip: '1.2.3.4' })

    expect(eventsPublisher.publishUserPasswordReset).not.toHaveBeenCalled()
    expect(redisService.claimPasswordResetSlot).not.toHaveBeenCalled()
  })

  it('vượt trần theo giờ: im lặng, không phát sự kiện', async () => {
    const { service, userRepo, eventsPublisher, redisService } = setup()
    redisService.claimPasswordResetHourlySlot.mockResolvedValueOnce(false)

    await service.forgotPassword({ email: 'an@example.test', ip: '1.2.3.4' })

    expect(eventsPublisher.publishUserPasswordReset).not.toHaveBeenCalled()
    // Hourly được kiểm SAU cooldown (Fix 1) nên tới đây cooldown đã tiêu một
    // slot rồi — đó là hành vi đúng, khác với bản trước khi sửa thứ tự.
    expect(redisService.claimPasswordResetSlot).toHaveBeenCalledTimes(1)
    expect(userRepo.findByEmail).not.toHaveBeenCalled()
  })

  it('không xác định được IP thật thì bỏ qua hạn mức IP, không khoá người dùng', async () => {
    const { service, eventsPublisher, redisService } = setup()

    await service.forgotPassword({ email: 'an@example.test' })

    // Fail-open: đoán sai IP mà khoá cứng là tự chặn chính người dùng của mình.
    expect(redisService.claimPasswordResetIpSlot).not.toHaveBeenCalled()
    expect(eventsPublisher.publishUserPasswordReset).toHaveBeenCalledTimes(1)
  })

  it('hạ tầng lỗi cũng im lặng — không được biến sự cố thành tín hiệu dò tài khoản', async () => {
    const { service, redisService, eventsPublisher } = setup()
    redisService.savePasswordResetToken.mockRejectedValueOnce(
      new Error('redis down'),
    )

    await expect(
      service.forgotPassword({ email: 'an@example.test', ip: '1.2.3.4' }),
    ).resolves.toBeUndefined()

    expect(eventsPublisher.publishUserPasswordReset).not.toHaveBeenCalled()
  })

  it('tra cơ sở dữ liệu lỗi cũng im lặng như mọi nhánh khác', async () => {
    const { service, userRepo, eventsPublisher } = setup()
    userRepo.findByEmail.mockRejectedValueOnce(new Error('db down'))

    await expect(
      service.forgotPassword({ email: 'an@example.test', ip: '1.2.3.4' }),
    ).resolves.toBeUndefined()

    expect(eventsPublisher.publishUserPasswordReset).not.toHaveBeenCalled()
  })
})

describe('UserService.validatePasswordResetToken', () => {
  it('token sống: trả valid và email đã che', async () => {
    const { service, redisService } = setup()
    redisService.peekPasswordResetToken.mockResolvedValueOnce(activeUser.id)

    await expect(service.validatePasswordResetToken('tok')).resolves.toEqual({
      valid: true,
      maskedEmail: '**@example.test',
    })
  })

  it('chỉ đọc — không được tiêu thụ token', async () => {
    const { service, redisService } = setup()
    redisService.peekPasswordResetToken.mockResolvedValueOnce(activeUser.id)

    await service.validatePasswordResetToken('tok')

    expect(redisService.consumePasswordResetToken).not.toHaveBeenCalled()
  })

  it('token chết: trả valid false, không kèm gì khác', async () => {
    const { service, redisService } = setup()
    redisService.peekPasswordResetToken.mockResolvedValueOnce(null)

    await expect(service.validatePasswordResetToken('tok')).resolves.toEqual({
      valid: false,
    })
  })

  it('token trỏ tới user đã biến mất: coi như chết', async () => {
    const { service, userRepo, redisService } = setup()
    redisService.peekPasswordResetToken.mockResolvedValueOnce('u-mo-coi')
    userRepo.findById.mockResolvedValueOnce(null)

    await expect(service.validatePasswordResetToken('tok')).resolves.toEqual({
      valid: false,
    })
  })
})

describe('UserService.resetPassword', () => {
  it('đường hạnh phúc: băm mật khẩu mới, ghi, dọn chỉ mục, phát cảnh báo', async () => {
    const { service, userRepo, utilService, eventsPublisher, redisService } =
      setup()
    redisService.consumePasswordResetToken.mockResolvedValueOnce(activeUser.id)

    await service.resetPassword({ token: 'tok', password: 'MatKhauMoi1!' })

    expect(utilService.hashPassword).toHaveBeenCalledWith('MatKhauMoi1!')
    expect(userRepo.updatePasswordById).toHaveBeenCalledWith(
      activeUser.id,
      'hash-moi',
    )
    expect(redisService.clearPasswordResetIndex).toHaveBeenCalledWith(
      'an@example.test',
    )
    expect(eventsPublisher.publishUserPasswordChanged).toHaveBeenCalledTimes(1)
  })

  // Đây là lý do tồn tại của tính năng "quên mật khẩu": giành lại tài khoản.
  // Đổi mật khẩu mà phiên của kẻ đang chiếm vẫn sống thì không giành lại được gì.
  it('thu hồi MỌI phiên của tài khoản và báo đi ngắt socket', async () => {
    const { service, sessions, eventsPublisher, redisService } = setup()
    redisService.consumePasswordResetToken.mockResolvedValueOnce(activeUser.id)

    await service.resetPassword({ token: 'tok', password: 'MatKhauMoi1!' })

    expect(sessions.revokeAllForUser).toHaveBeenCalledWith(activeUser.id)
    expect(eventsPublisher.publishSessionRevoked).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: activeUser.id,
        sids: ['s1', 's2'],
        reason: 'password-changed',
      }),
    )
  })

  it('thu hồi phiên TRƯỚC khi gửi email cảnh báo', async () => {
    const { service, sessions, eventsPublisher, redisService } = setup()
    redisService.consumePasswordResetToken.mockResolvedValueOnce(activeUser.id)
    const order: string[] = []
    sessions.revokeAllForUser.mockImplementationOnce(() => {
      order.push('revoke')
      return Promise.resolve(['s1'])
    })
    eventsPublisher.publishUserPasswordChanged.mockImplementationOnce(() => {
      order.push('email')
    })

    await service.resetPassword({ token: 'tok', password: 'MatKhauMoi1!' })

    // Email nói "mật khẩu của bạn vừa bị đổi" nên khi nó tới thì phiên cũ phải
    // đã chết rồi, không phải sắp chết.
    expect(order).toEqual(['revoke', 'email'])
  })

  it('token sai -> không thu hồi phiên của ai', async () => {
    const { service, sessions, redisService } = setup()
    redisService.consumePasswordResetToken.mockResolvedValueOnce(null)

    await expect(
      service.resetPassword({ token: 'sai', password: 'MatKhauMoi1!' }),
    ).rejects.toBeDefined()
    expect(sessions.revokeAllForUser).not.toHaveBeenCalled()
  })

  it('tiêu thụ token TRƯỚC khi ghi mật khẩu', async () => {
    const { service, userRepo, redisService } = setup()
    const order: string[] = []
    redisService.consumePasswordResetToken.mockImplementationOnce(() => {
      order.push('consume')
      return Promise.resolve(activeUser.id)
    })
    userRepo.updatePasswordById.mockImplementationOnce(() => {
      order.push('write')
      return Promise.resolve(activeUser)
    })

    await service.resetPassword({ token: 'tok', password: 'MatKhauMoi1!' })

    // Ghi trước rồi mới tiêu thụ là mở lại đúng khe hở mà GETDEL vừa đóng.
    expect(order).toEqual(['consume', 'write'])
  })

  it('token chết: ném 400 và không đụng tới mật khẩu', async () => {
    const { service, userRepo, redisService } = setup()
    redisService.consumePasswordResetToken.mockResolvedValueOnce(null)

    await expect(
      service.resetPassword({ token: 'tok', password: 'MatKhauMoi1!' }),
    ).rejects.toThrow('Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn')

    expect(userRepo.updatePasswordById).not.toHaveBeenCalled()
  })

  it('dùng lại đúng token lần hai: lần đầu qua, lần sau ném lỗi', async () => {
    const { service, redisService } = setup()
    redisService.consumePasswordResetToken
      .mockResolvedValueOnce(activeUser.id)
      .mockResolvedValueOnce(null)

    await service.resetPassword({ token: 'tok', password: 'MatKhauMoi1!' })
    await expect(
      service.resetPassword({ token: 'tok', password: 'MatKhauMoi2!' }),
    ).rejects.toThrow('Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn')
  })

  it('token trỏ tới user đã biến mất: ném 400', async () => {
    const { service, userRepo, redisService } = setup()
    redisService.consumePasswordResetToken.mockResolvedValueOnce('u-mo-coi')
    userRepo.findById.mockResolvedValueOnce(null)

    await expect(
      service.resetPassword({ token: 'tok', password: 'MatKhauMoi1!' }),
    ).rejects.toThrow('Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn')
  })
})
