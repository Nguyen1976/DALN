import { BadRequestException, ForbiddenException } from '@nestjs/common'
import { ConversationService } from './conversation.service'

const CONV = '6a35000000000000000c0001'
const ME = '6a35000000000000000a0001'
const OTHER = '6a35000000000000000a0002'
const NAMELESS = '6a35000000000000000a0003'
const STRANGER = '6a35000000000000000a0009'

/**
 * Như call-peer.spec: ConversationService kéo theo Prisma, Redis, RabbitMQ và
 * S3 nhưng duyệt quyền gọi nhóm chỉ chạm hai repository, nên chỉ stub chúng.
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

describe('ConversationService.getCallMembers', () => {
  it('GROUP + đúng thành viên -> trả { id, username } cho mọi thành viên', async () => {
    const { service, conversationRepo, memberRepo } = setup()
    conversationRepo.findById.mockResolvedValue({ id: CONV, type: 'GROUP' })
    memberRepo.findByConversationId.mockResolvedValue([
      { userId: ME, username: 'me', fullName: 'Tôi' },
      // Không có username -> lùi về fullName.
      { userId: OTHER, username: null, fullName: 'Người kia' },
      // Không có cả username lẫn fullName -> lùi về userId.
      { userId: NAMELESS, username: null, fullName: null },
    ])

    await expect(
      service.getCallMembers({ conversationId: CONV, userId: ME }),
    ).resolves.toEqual({
      members: [
        { id: ME, username: 'me' },
        { id: OTHER, username: 'Người kia' },
        { id: NAMELESS, username: NAMELESS },
      ],
    })
  })

  it('DIRECT cũng trả members (không giới hạn type như call-peer)', async () => {
    const { service, conversationRepo, memberRepo } = setup()
    conversationRepo.findById.mockResolvedValue({ id: CONV, type: 'DIRECT' })
    memberRepo.findByConversationId.mockResolvedValue([
      { userId: ME, username: 'me' },
      { userId: OTHER, username: 'other' },
    ])

    await expect(
      service.getCallMembers({ conversationId: CONV, userId: ME }),
    ).resolves.toEqual({
      members: [
        { id: ME, username: 'me' },
        { id: OTHER, username: 'other' },
      ],
    })
  })

  it('người gọi không phải thành viên -> 403', async () => {
    const { service, conversationRepo, memberRepo } = setup()
    conversationRepo.findById.mockResolvedValue({ id: CONV, type: 'GROUP' })
    memberRepo.findByConversationId.mockResolvedValue([
      { userId: ME, username: 'me' },
      { userId: OTHER, username: 'other' },
    ])

    await expect(
      service.getCallMembers({ conversationId: CONV, userId: STRANGER }),
    ).rejects.toThrow(ForbiddenException)
  })

  it('không tìm thấy cuộc trò chuyện -> 403 và không đọc danh sách thành viên', async () => {
    const { service, conversationRepo, memberRepo } = setup()
    conversationRepo.findById.mockResolvedValue(null)

    await expect(
      service.getCallMembers({ conversationId: CONV, userId: ME }),
    ).rejects.toThrow(ForbiddenException)
    expect(memberRepo.findByConversationId).not.toHaveBeenCalled()
  })

  it.each([
    ['thiếu conversationId', { conversationId: undefined, userId: ME }],
    ['thiếu userId', { conversationId: CONV, userId: undefined }],
    ['conversationId rỗng', { conversationId: '   ', userId: ME }],
    ['userId rỗng', { conversationId: CONV, userId: '' }],
  ])('%s -> 400', async (_label, query) => {
    const { service, conversationRepo } = setup()

    await expect(service.getCallMembers(query as never)).rejects.toThrow(
      BadRequestException,
    )
    expect(conversationRepo.findById).not.toHaveBeenCalled()
  })

  it('conversationId không phải ObjectId -> 400, không chạm tới Prisma', async () => {
    const { service, conversationRepo } = setup()

    await expect(
      service.getCallMembers({
        conversationId: 'khong-phai-objectid',
        userId: ME,
      }),
    ).rejects.toThrow(BadRequestException)
    expect(conversationRepo.findById).not.toHaveBeenCalled()
  })
})
