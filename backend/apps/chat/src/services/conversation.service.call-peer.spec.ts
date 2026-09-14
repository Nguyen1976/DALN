import { BadRequestException, ForbiddenException } from '@nestjs/common'
import { ConversationService } from './conversation.service'

const CONV = '6a35000000000000000c0001'
const ME = '6a35000000000000000a0001'
const PEER = '6a35000000000000000a0002'
const STRANGER = '6a35000000000000000a0003'

/**
 * ConversationService kéo theo Prisma, Redis, RabbitMQ và S3 — không thứ nào
 * liên quan tới việc duyệt quyền gọi thoại, nên chỉ hai repository thật sự
 * được dùng mới có stub.
 */
function setup() {
  const conversationRepo = { findById: jest.fn() }
  const memberRepo = { findByConversationId: jest.fn() }
  const service = new ConversationService(
    conversationRepo as never,
    memberRepo as never,
    {} as never, // messageRepo
    {} as never, // eventsPublisher
    {} as never, // messageMediaService
    {} as never, // s3StorageService
  )
  return { service, conversationRepo, memberRepo }
}

describe('ConversationService.getCallPeer', () => {
  it('DIRECT + đúng thành viên -> trả về đối phương', async () => {
    const { service, conversationRepo, memberRepo } = setup()
    conversationRepo.findById.mockResolvedValue({ id: CONV, type: 'DIRECT' })
    memberRepo.findByConversationId.mockResolvedValue([
      { userId: ME },
      { userId: PEER },
    ])

    await expect(
      service.getCallPeer({ conversationId: CONV, userId: ME }),
    ).resolves.toEqual({ peerId: PEER })
  })

  it('người gọi không phải thành viên -> 403', async () => {
    const { service, conversationRepo, memberRepo } = setup()
    conversationRepo.findById.mockResolvedValue({ id: CONV, type: 'DIRECT' })
    memberRepo.findByConversationId.mockResolvedValue([
      { userId: ME },
      { userId: PEER },
    ])

    await expect(
      service.getCallPeer({ conversationId: CONV, userId: STRANGER }),
    ).rejects.toThrow(ForbiddenException)
  })

  it('cuộc trò chuyện nhóm -> 403 và không đọc danh sách thành viên', async () => {
    const { service, conversationRepo, memberRepo } = setup()
    conversationRepo.findById.mockResolvedValue({ id: CONV, type: 'GROUP' })

    await expect(
      service.getCallPeer({ conversationId: CONV, userId: ME }),
    ).rejects.toThrow(ForbiddenException)
    expect(memberRepo.findByConversationId).not.toHaveBeenCalled()
  })

  it('không tìm thấy cuộc trò chuyện -> 403 (không lộ việc tồn tại)', async () => {
    const { service, conversationRepo } = setup()
    conversationRepo.findById.mockResolvedValue(null)

    await expect(
      service.getCallPeer({ conversationId: CONV, userId: ME }),
    ).rejects.toThrow(ForbiddenException)
  })

  it('đối phương đã rời cuộc trò chuyện -> 403', async () => {
    const { service, conversationRepo, memberRepo } = setup()
    conversationRepo.findById.mockResolvedValue({ id: CONV, type: 'DIRECT' })
    memberRepo.findByConversationId.mockResolvedValue([{ userId: ME }])

    await expect(
      service.getCallPeer({ conversationId: CONV, userId: ME }),
    ).rejects.toThrow(ForbiddenException)
  })

  it.each([
    ['thiếu conversationId', { conversationId: undefined, userId: ME }],
    ['thiếu userId', { conversationId: CONV, userId: undefined }],
    ['conversationId rỗng', { conversationId: '   ', userId: ME }],
    ['userId rỗng', { conversationId: CONV, userId: '' }],
  ])('%s -> 400', async (_label, query) => {
    const { service, conversationRepo } = setup()

    await expect(service.getCallPeer(query as never)).rejects.toThrow(
      BadRequestException,
    )
    expect(conversationRepo.findById).not.toHaveBeenCalled()
  })

  it('conversationId không phải ObjectId -> 403, không chạm tới Prisma', async () => {
    const { service, conversationRepo } = setup()

    await expect(
      service.getCallPeer({
        conversationId: 'khong-phai-objectid',
        userId: ME,
      }),
    ).rejects.toThrow(ForbiddenException)
    expect(conversationRepo.findById).not.toHaveBeenCalled()
  })
})
