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
