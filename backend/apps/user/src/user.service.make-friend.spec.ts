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
