import { Logger } from '@nestjs/common'
import { MessageService } from './message.service'

const conversationId = '6a3500000000000000000c01'
const messageId = '6a35000000000000000b0001'
const createdAt = new Date('2026-11-07T10:00:00.000Z')

const stored = (seq: number | null = 42) => ({
  id: messageId,
  conversationId,
  senderId: 'u1',
  content: 'nội dung bí mật',
  type: 'TEXT',
  seq,
  isRevoked: false,
  createdAt,
  updatedAt: createdAt,
  medias: [],
})

function setup(seq: number | null = 42) {
  const messageRepo = {
    findById: jest.fn().mockResolvedValue(stored(seq)),
    revokeMessage: jest.fn().mockResolvedValue({ count: 1 }),
  }
  const memberRepo = {
    findByConversationId: jest.fn().mockResolvedValue([
      { userId: 'u1', username: 'an', fullName: 'An', avatar: 'a.png' },
      { userId: 'u2', username: 'binh', fullName: 'Bình', avatar: null },
    ]),
  }
  const events = { publishMessageRevoked: jest.fn() }
  const conversationRepo = {
    saveRevokedLastMessage: jest.fn().mockResolvedValue({ count: 1 }),
  }
  const service = new MessageService(
    memberRepo as never,
    messageRepo as never,
    events as never,
    {} as never,
    {} as never,
    {} as never,
    conversationRepo as never,
  )
  return { service, events, conversationRepo }
}

const revoke = (service: MessageService) =>
  service.revokeMessage({ conversationId, messageId, userId: 'u1' })

describe('MessageService.revokeMessage: preview ở danh sách hội thoại', () => {
  it('ghi preview đã thu hồi, không còn nội dung gốc', async () => {
    const { service, conversationRepo } = setup()

    await revoke(service)

    expect(conversationRepo.saveRevokedLastMessage).toHaveBeenCalledWith(
      conversationId,
      {
        seq: 42,
        lastMessageId: messageId,
        lastMessageAt: createdAt,
        lastMessageText: 'Tin nhắn đã bị thu hồi',
        lastMessageSenderId: 'u1',
        lastMessageSenderName: 'An',
        lastMessageSenderAvatar: 'a.png',
      },
    )
  })

  it('ghi preview lỗi: tin vẫn được báo là đã thu hồi', async () => {
    const { service, events, conversationRepo } = setup()
    conversationRepo.saveRevokedLastMessage.mockRejectedValue(new Error('db'))
    const log = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined)

    await expect(revoke(service)).resolves.toMatchObject({ isRevoked: true })

    expect(events.publishMessageRevoked).toHaveBeenCalledTimes(1)
    log.mockRestore()
  })

  it('tin chưa đánh số thì không so được với tin cuối: bỏ qua', async () => {
    const { service, conversationRepo } = setup(null)

    await revoke(service)

    expect(conversationRepo.saveRevokedLastMessage).not.toHaveBeenCalled()
  })
})
