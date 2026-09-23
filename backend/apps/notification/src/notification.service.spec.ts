import { NotificationService } from './notification.service'

type Deps = ConstructorParameters<typeof NotificationService>

describe('NotificationService.handleMakeFriend — email', () => {
  const payload = {
    inviterId: 'u1',
    inviterName: 'binh',
    inviteeId: 'u2',
    inviteeName: 'an',
    inviteeEmail: 'an@example.test',
    friendRequestId: 'req-1',
  }

  function setup(
    options: { online?: boolean; preference?: object | null } = {},
  ) {
    const { online = false, preference = null } = options
    const mailer = {
      sendMakeFriendNotification: jest.fn().mockResolvedValue(undefined),
    }
    const redis = { isOnline: jest.fn().mockResolvedValue(online) }
    const notificationRepo = {
      create: jest
        .fn()
        .mockResolvedValue({ userId: 'u2', createdAt: new Date() }),
    }
    // A row as Prisma hands it back: what was written, plus what it fills in.
    const stored = (doc: object) => ({
      globalSettings: {},
      overrides: {},
      digestSettings: {},
      version: 1,
      updatedAt: new Date(),
      ...doc,
    })
    const preferenceRepo = {
      findByUserId: jest
        .fn()
        .mockResolvedValue(preference && stored(preference)),
      create: jest.fn((doc: object) => Promise.resolve(stored(doc))),
    }
    const publisher = { emitToUsers: jest.fn() }
    const service = new NotificationService(
      mailer as unknown as Deps[0],
      redis as unknown as Deps[1],
      notificationRepo as unknown as Deps[2],
      preferenceRepo as unknown as Deps[3],
      publisher as unknown as Deps[4],
    )
    return { service, mailer, publisher }
  }

  it('offline, chưa từng chỉnh cài đặt: gửi mail', async () => {
    const { service, mailer } = setup()

    await service.handleMakeFriend(payload)

    expect(mailer.sendMakeFriendNotification).toHaveBeenCalledWith({
      senderName: 'binh',
      friendEmail: 'an@example.test',
      receiverName: 'an',
      friendRequestId: 'req-1',
    })
  })

  const channels = { IN_APP: true, EMAIL: true, REALTIME: true }
  it.each([
    [
      'tắt kênh Email',
      {
        globalSettings: {
          enabled: true,
          channels: { ...channels, EMAIL: false },
        },
      },
    ],
    ['tắt mọi thông báo', { globalSettings: { enabled: false, channels } }],
    [
      'tắt email riêng cho lời mời kết bạn',
      { overrides: { FRIEND_REQUEST_SENT: { ...channels, EMAIL: false } } },
    ],
  ])('offline nhưng %s: không gửi mail', async (_label, preference) => {
    const { service, mailer } = setup({ preference })

    await service.handleMakeFriend(payload)

    expect(mailer.sendMakeFriendNotification).not.toHaveBeenCalled()
  })

  it('online: báo realtime, không gửi mail', async () => {
    const { service, mailer, publisher } = setup({ online: true })

    await service.handleMakeFriend(payload)

    expect(mailer.sendMakeFriendNotification).not.toHaveBeenCalled()
    expect(publisher.emitToUsers).toHaveBeenCalled()
  })
})

describe('NotificationService — mail bảo mật (đặt lại mật khẩu)', () => {
  function setup() {
    const mailer = {
      sendMakeFriendNotification: jest.fn().mockResolvedValue(undefined),
      sendPasswordReset: jest.fn().mockResolvedValue(undefined),
      sendPasswordChanged: jest.fn().mockResolvedValue(undefined),
    }
    const redis = { isOnline: jest.fn().mockResolvedValue(false) }
    const notificationRepo = {
      create: jest
        .fn()
        .mockResolvedValue({ userId: 'u2', createdAt: new Date() }),
    }
    const preferenceRepo = {
      findByUserId: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
    }
    const publisher = { emitToUsers: jest.fn() }
    const service = new NotificationService(
      mailer as unknown as Deps[0],
      redis as unknown as Deps[1],
      notificationRepo as unknown as Deps[2],
      preferenceRepo as unknown as Deps[3],
      publisher as unknown as Deps[4],
    )
    return { service, mailer, redis, preferenceRepo }
  }

  describe('mail đặt lại mật khẩu', () => {
    it('chuyển thẳng payload sang MailerService, không qua cài đặt thông báo', async () => {
      const { service, mailer, redis, preferenceRepo } = setup()

      await service.handleUserPasswordReset({
        email: 'an@example.test',
        username: 'an',
        token: 'tok',
        expiresInMinutes: 15,
      })

      expect(mailer.sendPasswordReset).toHaveBeenCalledWith({
        email: 'an@example.test',
        username: 'an',
        token: 'tok',
        expiresInMinutes: 15,
      })
      // Không đọc cài đặt kênh, không kiểm tra online: mail bảo mật đi thẳng.
      expect(redis.isOnline).not.toHaveBeenCalled()
      expect(preferenceRepo.findByUserId).not.toHaveBeenCalled()
    })

    it('mail cảnh báo cũng đi thẳng — người dùng không tắt được nó', async () => {
      const { service, mailer } = setup()

      await service.handleUserPasswordChanged({
        email: 'an@example.test',
        username: 'an',
        changedAt: '2026-09-23T08:30:00.000Z',
      })

      expect(mailer.sendPasswordChanged).toHaveBeenCalledTimes(1)
      expect(mailer.sendPasswordChanged).toHaveBeenCalledWith({
        email: 'an@example.test',
        username: 'an',
        changedAt: '2026-09-23T08:30:00.000Z',
      })
    })
  })
})
