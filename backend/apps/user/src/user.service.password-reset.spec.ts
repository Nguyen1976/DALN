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
  }
  const redisService = {
    claimPasswordResetIpSlot: jest.fn().mockResolvedValue(true),
    claimPasswordResetSlot: jest.fn().mockResolvedValue(true),
    savePasswordResetToken: jest
      .fn<Promise<void>, [string, string, string, number?]>()
      .mockResolvedValue(undefined),
    peekPasswordResetToken: jest.fn().mockResolvedValue(null),
    consumePasswordResetToken: jest.fn().mockResolvedValue(null),
    clearPasswordResetIndex: jest.fn().mockResolvedValue(undefined),
  }
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }

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
  )
  return { service, userRepo, utilService, eventsPublisher, redisService }
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

  it('vượt hạn mức IP: im lặng, và không tiêu tốn cả slot cooldown', async () => {
    const { service, eventsPublisher, redisService } = setup()
    redisService.claimPasswordResetIpSlot.mockResolvedValueOnce(false)

    await service.forgotPassword({ email: 'an@example.test', ip: '1.2.3.4' })

    expect(eventsPublisher.publishUserPasswordReset).not.toHaveBeenCalled()
    expect(redisService.claimPasswordResetSlot).not.toHaveBeenCalled()
  })

  it('không xác định được IP thật thì bỏ qua hạn mức IP, không khoá người dùng', async () => {
    const { service, eventsPublisher, redisService } = setup()

    await service.forgotPassword({ email: 'an@example.test' })

    // Fail-open: đoán sai IP mà khoá cứng là tự chặn chính người dùng của mình.
    expect(redisService.claimPasswordResetIpSlot).not.toHaveBeenCalled()
    expect(eventsPublisher.publishUserPasswordReset).toHaveBeenCalledTimes(1)
  })
})
