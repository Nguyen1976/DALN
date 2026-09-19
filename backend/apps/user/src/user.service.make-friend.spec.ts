import 'reflect-metadata'
import { UserService } from './user.service'

const inviter = { id: '6aa55a491bea4834e8549a01', username: 'alice' }
const invitee = {
  id: '6aa55a491bea4834e8549a02',
  username: 'bob',
  email: 'bob@example.test',
}

function setup(found: { id: string; username: string; email: string } | null = invitee) {
  const userRepo = {
    findByUsername: jest.fn().mockResolvedValue(found),
    findByEmail: jest.fn().mockResolvedValue(found),
  }
  const friendRequestRepo = {
    findPendingBetweenUsers: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue({ id: 'fr1' }),
  }
  const friendShipRepo = {
    findFriendshipBetweenUsers: jest.fn().mockResolvedValue(null),
  }
  const eventsPublisher = { publishUserMakeFriend: jest.fn() }

  const service = new UserService(
    userRepo as any,
    friendRequestRepo as any,
    friendShipRepo as any,
    {} as any, // jwtService
    {} as any, // utilService
    eventsPublisher as any,
    {} as any, // s3StorageService
    {} as any, // redisService
    {} as any, // logger
    {} as any, // prisma
  )
  return { service, userRepo, friendRequestRepo, eventsPublisher }
}

describe('UserService.makeFriend', () => {
  it('gửi theo username (thẻ gợi ý): tìm theo username và event mang email thật của người nhận', async () => {
    const { service, userRepo, friendRequestRepo, eventsPublisher } = setup()

    await service.makeFriend({
      inviterId: inviter.id,
      inviterName: inviter.username,
      inviteeUsername: invitee.username,
    })

    expect(userRepo.findByUsername).toHaveBeenCalledWith(invitee.username)
    expect(userRepo.findByEmail).not.toHaveBeenCalled()
    expect(friendRequestRepo.create).toHaveBeenCalledWith({
      fromUserId: inviter.id,
      toUserId: invitee.id,
    })
    // Notification gửi mail mời kết bạn tới địa chỉ này — trước đây nó lấy
    // từ request, nên gửi theo username sẽ ra một email rỗng.
    expect(eventsPublisher.publishUserMakeFriend).toHaveBeenCalledWith(
      expect.objectContaining({ inviteeId: invitee.id, inviteeEmail: invitee.email }),
    )
  })

  it('gửi theo email (ô "Thêm bạn") vẫn chạy như cũ', async () => {
    const { service, userRepo, eventsPublisher } = setup()

    await service.makeFriend({
      inviterId: inviter.id,
      inviterName: inviter.username,
      inviteeEmail: invitee.email,
    })

    expect(userRepo.findByEmail).toHaveBeenCalledWith(invitee.email)
    expect(userRepo.findByUsername).not.toHaveBeenCalled()
    expect(eventsPublisher.publishUserMakeFriend).toHaveBeenCalledWith(
      expect.objectContaining({ inviteeEmail: invitee.email }),
    )
  })

  it('username không tồn tại -> báo không tìm thấy, không tạo lời mời', async () => {
    const { service, friendRequestRepo } = setup(null)

    await expect(
      service.makeFriend({
        inviterId: inviter.id,
        inviterName: inviter.username,
        inviteeUsername: 'khong-ton-tai',
      }),
    ).rejects.toBeTruthy()
    expect(friendRequestRepo.create).not.toHaveBeenCalled()
  })

  it('tự gửi cho chính mình theo username -> bị chặn', async () => {
    const { service, friendRequestRepo } = setup({ ...invitee, id: inviter.id })

    await expect(
      service.makeFriend({
        inviterId: inviter.id,
        inviterName: inviter.username,
        inviteeUsername: inviter.username,
      }),
    ).rejects.toBeTruthy()
    expect(friendRequestRepo.create).not.toHaveBeenCalled()
  })
})

describe('UserService.detailMakeFriend', () => {
  const request = {
    id: 'fr1',
    fromUserId: inviter.id,
    toUserId: invitee.id,
    status: 'PENDING',
  }

  function setupDetail(found: typeof request | null = request) {
    // The sender comes along with the request (a Prisma relation).
    const friendRequestRepo = {
      findWithSender: jest.fn().mockResolvedValue(
        found && {
          ...found,
          fromUser: { ...inviter, email: 'alice@example.test' },
        },
      ),
    }
    const userRepo = {}
    const service = new UserService(
      userRepo as any,
      friendRequestRepo as any,
      {} as any, // friendShipRepo
      {} as any, // jwtService
      {} as any, // utilService
      {} as any, // eventsPublisher
      {} as any, // s3StorageService
      {} as any, // redisService
      {} as any, // logger
      {} as any, // prisma
    )
    return { service, userRepo }
  }

  it('người nhận xem được lời mời kèm người gửi', async () => {
    const { service } = setupDetail()

    const detail = await service.detailMakeFriend('fr1', invitee.id)

    expect(detail).toEqual(
      expect.objectContaining({
        id: 'fr1',
        status: 'PENDING',
        counterpart: expect.objectContaining({ id: inviter.id }),
      }),
    )
  })

  it('tài khoản khác (kể cả người gửi) nhận "không tìm thấy", không lộ người gửi', async () => {
    const { service } = setupDetail()

    await expect(service.detailMakeFriend('fr1', inviter.id)).rejects.toThrow(
      'Không tìm thấy lời mời kết bạn',
    )
  })

  it('id không tồn tại -> không tìm thấy', async () => {
    const { service } = setupDetail(null)

    await expect(service.detailMakeFriend('nope', invitee.id)).rejects.toThrow(
      'Không tìm thấy lời mời kết bạn',
    )
  })
})

describe('UserService.respondToFriendRequest', () => {
  const request = {
    id: 'fr1',
    fromUserId: inviter.id,
    toUserId: invitee.id,
    status: 'PENDING',
  }

  function setupRespond(found: object | null = request) {
    const friendRequestRepo = {
      findById: jest.fn().mockResolvedValue(found),
      decline: jest.fn().mockResolvedValue({ count: 1 }),
    }
    const eventsPublisher = { publishUserUpdateStatusMakeFriend: jest.fn() }
    const prisma = { $transaction: jest.fn() }
    const service = new UserService(
      {} as any, // userRepo
      friendRequestRepo as any,
      {} as any, // friendShipRepo
      {} as any, // jwtService
      {} as any, // utilService
      eventsPublisher as any,
      {} as any, // s3StorageService
      {} as any, // redisService
      {} as any, // logger
      prisma as any,
    )
    return { service, friendRequestRepo, eventsPublisher, prisma }
  }

  it('từ chối: đúng lời mời theo id, event mang người gửi lấy từ lời mời', async () => {
    const { service, friendRequestRepo, eventsPublisher } = setupRespond()

    await service.respondToFriendRequest({
      requestId: 'fr1',
      inviteeId: invitee.id,
      inviteeName: invitee.username,
      status: 'REJECTED',
    })

    expect(friendRequestRepo.decline).toHaveBeenCalledWith('fr1')
    expect(eventsPublisher.publishUserUpdateStatusMakeFriend).toHaveBeenCalledWith(
      expect.objectContaining({ inviterId: inviter.id, inviteeId: invitee.id }),
    )
  })

  it('người không phải người nhận (kể cả người gửi) -> không tìm thấy, không ghi gì', async () => {
    const { service, friendRequestRepo, prisma } = setupRespond()

    await expect(
      service.respondToFriendRequest({
        requestId: 'fr1',
        inviteeId: inviter.id,
        inviteeName: inviter.username,
        status: 'ACCEPTED',
      }),
    ).rejects.toThrow('Không tìm thấy lời mời kết bạn')
    expect(friendRequestRepo.decline).not.toHaveBeenCalled()
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('lời mời đã được trả lời -> báo đã phản hồi', async () => {
    const { service } = setupRespond({ ...request, status: 'ACCEPTED' })

    await expect(
      service.respondToFriendRequest({
        requestId: 'fr1',
        inviteeId: invitee.id,
        inviteeName: invitee.username,
        status: 'REJECTED',
      }),
    ).rejects.toThrow()
  })
})
