import 'reflect-metadata'
import { UserService } from './user.service'

/**
 * Đổi mật khẩu từ trang Cài đặt.
 *
 * Hai đường tự chứng minh, chọn một: biết mật khẩu hiện tại, hoặc đọc được hộp
 * thư. Bộ test này giữ hai thứ dễ trôi nhất khi sửa về sau: đường nào cũng
 * phải THẬT SỰ chặn được người không chứng minh nổi, và mật khẩu đã ghi rồi
 * thì không sự cố phụ nào được phép biến nó thành một lần thất bại.
 */

const user = {
  id: '6ab52bb2fc90004fcac0f585',
  email: 'an@example.test',
  username: 'an',
  password: 'hash-cu',
  isActive: true,
}

const CURRENT_SID = 'may-nay'

function setup(
  overrides: { passwordMatches?: boolean; otpMatches?: boolean } = {},
) {
  const userRepo = {
    findById: jest.fn().mockResolvedValue(user),
    updatePasswordById: jest.fn().mockResolvedValue(user),
  }
  const utilService = {
    hashPassword: jest.fn().mockResolvedValue('hash-moi'),
    comparePassword: jest
      .fn()
      .mockResolvedValue(overrides.passwordMatches ?? true),
  }
  const eventsPublisher = {
    publishUserPasswordChanged: jest.fn(),
    publishSessionRevoked: jest.fn(),
    publishUserChangePasswordOtp: jest.fn(),
  }
  const redisService = {
    // Có kiểu vì test đọc lại đối số đã lưu để so với mã trong mail: mock
    // không kiểu thì `.mock.calls[0]` là `any` và phép so đó không kiểm gì.
    saveChangePasswordOtp: jest
      .fn<Promise<void>, [string, string, number?]>()
      .mockResolvedValue(undefined),
    verifyChangePasswordOtp: jest
      .fn()
      .mockResolvedValue(overrides.otpMatches ?? true),
    deleteChangePasswordOtp: jest.fn().mockResolvedValue(undefined),
    claimChangePasswordOtpAttempt: jest.fn().mockResolvedValue(false),
    claimChangePasswordOtpResendSlot: jest.fn().mockResolvedValue(0),
  }
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  const sessions = {
    revokeAllExcept: jest.fn().mockResolvedValue(['dien-thoai', 'tablet']),
    revokeAllForUser: jest.fn().mockResolvedValue([]),
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

const body = (extra: Record<string, unknown>) => ({
  newPassword: 'matkhaumoi123',
  revokeOtherSessions: false,
  ...extra,
})

describe('changePassword — đường mật khẩu hiện tại', () => {
  it('mật khẩu đúng -> ghi hash mới', async () => {
    const { service, userRepo, utilService } = setup({ passwordMatches: true })

    await service.changePassword(
      user.id,
      CURRENT_SID,
      body({ currentPassword: 'matkhaucu123' }),
    )

    expect(utilService.comparePassword).toHaveBeenCalledWith(
      'matkhaucu123',
      'hash-cu',
    )
    expect(userRepo.updatePasswordById).toHaveBeenCalledWith(
      user.id,
      'hash-moi',
    )
  })

  /**
   * 400 chứ KHÔNG phải 401.
   *
   * Endpoint này đã yêu cầu đăng nhập, nên trên nó 401 chỉ được mang đúng một
   * nghĩa: phiên của bạn hỏng. Trả 401 cho "gõ sai mật khẩu cũ" làm interceptor
   * của web hiểu là phiên chết và đăng xuất người dùng — QC trình duyệt bắt
   * đúng cảnh đó: gõ nhầm một ô trong Cài đặt là bị văng ra trang chủ.
   */
  it('mật khẩu sai -> 400 CURRENT_PASSWORD_INVALID, không phải 401', async () => {
    const { service } = setup({ passwordMatches: false })

    const error = await service
      .changePassword(
        user.id,
        CURRENT_SID,
        body({ currentPassword: 'doan-bay' }),
      )
      .catch(
        (e: { getStatus?: () => number; getResponse?: () => unknown }) => e,
      )

    expect((error as { getStatus: () => number }).getStatus()).toBe(400)
    expect(
      (error as { getResponse: () => { code?: string } }).getResponse().code,
    ).toBe('CURRENT_PASSWORD_INVALID')
  })

  it('mật khẩu sai -> ném lỗi và KHÔNG ghi gì', async () => {
    const { service, userRepo, eventsPublisher } = setup({
      passwordMatches: false,
    })

    await expect(
      service.changePassword(
        user.id,
        CURRENT_SID,
        body({ currentPassword: 'doan-bay' }),
      ),
    ).rejects.toThrow()

    expect(userRepo.updatePasswordById).not.toHaveBeenCalled()
    expect(eventsPublisher.publishUserPasswordChanged).not.toHaveBeenCalled()
  })
})

describe('changePassword — đường OTP', () => {
  it('mã đúng -> ghi hash mới và TIÊU mã ngay', async () => {
    const { service, userRepo, redisService } = setup({ otpMatches: true })

    await service.changePassword(user.id, CURRENT_SID, body({ otp: '123456' }))

    expect(redisService.verifyChangePasswordOtp).toHaveBeenCalledWith(
      user.id,
      '123456',
    )
    expect(userRepo.updatePasswordById).toHaveBeenCalledWith(
      user.id,
      'hash-moi',
    )
    // Một mã dùng đúng một lần: không xoá thì nó còn sống tới hết TTL và đổi
    // được mật khẩu lần nữa.
    expect(redisService.deleteChangePasswordOtp).toHaveBeenCalledWith(user.id)
  })

  it('mã sai -> tính một lần thử, ném lỗi, không ghi', async () => {
    const { service, userRepo, redisService } = setup({ otpMatches: false })

    await expect(
      service.changePassword(user.id, CURRENT_SID, body({ otp: '000000' })),
    ).rejects.toThrow()

    expect(redisService.claimChangePasswordOtpAttempt).toHaveBeenCalledWith(
      user.id,
    )
    expect(userRepo.updatePasswordById).not.toHaveBeenCalled()
  })

  // Không có bcrypt ở đường này, nên không được đụng tới nó.
  it('không hề so mật khẩu cũ', async () => {
    const { service, utilService } = setup({ otpMatches: true })

    await service.changePassword(user.id, CURRENT_SID, body({ otp: '123456' }))

    expect(utilService.comparePassword).not.toHaveBeenCalled()
  })
})

describe('changePassword — phiên đăng nhập', () => {
  it('có tích đăng xuất thiết bị khác -> giết phiên khác, GIỮ phiên này', async () => {
    const { service, sessions, eventsPublisher } = setup()

    await service.changePassword(
      user.id,
      CURRENT_SID,
      body({ currentPassword: 'matkhaucu123', revokeOtherSessions: true }),
    )

    expect(sessions.revokeAllExcept).toHaveBeenCalledWith(user.id, CURRENT_SID)
    expect(sessions.revokeAllForUser).not.toHaveBeenCalled()
    expect(eventsPublisher.publishSessionRevoked).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: user.id,
        sids: ['dien-thoai', 'tablet'],
        reason: 'password-changed',
      }),
    )
  })

  it('không tích -> không đụng phiên nào', async () => {
    const { service, sessions, eventsPublisher } = setup()

    await service.changePassword(
      user.id,
      CURRENT_SID,
      body({ currentPassword: 'matkhaucu123', revokeOtherSessions: false }),
    )

    expect(sessions.revokeAllExcept).not.toHaveBeenCalled()
    expect(eventsPublisher.publishSessionRevoked).not.toHaveBeenCalled()
  })

  // Mật khẩu đã ghi xong rồi: ném lỗi ở đây để lại trạng thái nửa vời — người
  // dùng tưởng thất bại và đi thử lại bằng mật khẩu cũ đã không còn dùng được.
  it('thu hồi phiên hỏng -> vẫn coi là đổi thành công', async () => {
    const { service, sessions, eventsPublisher } = setup()
    sessions.revokeAllExcept.mockRejectedValue(new Error('redis chết'))

    await expect(
      service.changePassword(
        user.id,
        CURRENT_SID,
        body({ currentPassword: 'matkhaucu123', revokeOtherSessions: true }),
      ),
    ).resolves.toBeUndefined()

    expect(eventsPublisher.publishUserPasswordChanged).toHaveBeenCalled()
  })
})

describe('changePassword — thư báo', () => {
  it('luôn gửi thư "mật khẩu đã đổi", kể cả khi không thu hồi phiên nào', async () => {
    const { service, eventsPublisher } = setup()

    await service.changePassword(
      user.id,
      CURRENT_SID,
      body({ currentPassword: 'matkhaucu123', revokeOtherSessions: false }),
    )

    expect(eventsPublisher.publishUserPasswordChanged).toHaveBeenCalledWith(
      expect.objectContaining({ email: user.email, username: user.username }),
    )
  })
})

describe('sendChangePasswordOtp', () => {
  it('gửi mã 6 chữ số tới email của chính người đang đăng nhập', async () => {
    const { service, redisService, eventsPublisher } = setup()

    await service.sendChangePasswordOtp(user.id)

    const [savedUserId, savedOtp] =
      redisService.saveChangePasswordOtp.mock.calls[0]
    expect(savedUserId).toBe(user.id)
    expect(savedOtp).toMatch(/^\d{6}$/)

    expect(eventsPublisher.publishUserChangePasswordOtp).toHaveBeenCalledWith(
      expect.objectContaining({
        email: user.email,
        username: user.username,
        otp: savedOtp,
      }),
    )
  })

  it('bấm lại quá sớm -> ném lỗi và KHÔNG gửi thư', async () => {
    const { service, redisService, eventsPublisher } = setup()
    redisService.claimChangePasswordOtpResendSlot.mockResolvedValue(42)

    await expect(service.sendChangePasswordOtp(user.id)).rejects.toThrow()

    expect(redisService.saveChangePasswordOtp).not.toHaveBeenCalled()
    expect(eventsPublisher.publishUserChangePasswordOtp).not.toHaveBeenCalled()
  })
})
