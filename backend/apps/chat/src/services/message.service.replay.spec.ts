import { MessageService } from './message.service'

const CONV = '6a35000000000000000c0001'
const SENDER = '6a35000000000000000a0001'
const BOB = '6a35000000000000000a0002'

/**
 * Một tin GỬI LẠI (broker giao lại sau crash, hoặc client gửi lại khi ACK lạc)
 * đã có trong DB: ghi lần hai chạm unique index và trả về bản cũ với
 * `replayed: true`. Lần xử lý đầu đã cộng unread và nhắc tên, nên lần này chỉ
 * phát lại ACK/NEW — không cộng lần nữa.
 */
function setup(replayed: boolean) {
  const members = [
    { userId: SENDER, username: 'alice', fullName: 'Alice' },
    { userId: BOB, username: 'bob', fullName: 'Bob' },
  ]
  const memberRepo = {
    findByConversationId: jest.fn().mockResolvedValue(members),
    markMention: jest.fn().mockResolvedValue(undefined),
  }
  const messageRepo = {
    create: jest.fn().mockResolvedValue({
      id: '6a350000000000000000ab01',
      conversationId: CONV,
      senderId: SENDER,
      content: 'chào @bob',
      type: 'TEXT',
      createdAt: new Date('2026-10-01T10:00:00Z'),
      ...(replayed ? { replayed: true } : {}),
    }),
  }
  const eventsPublisher = {
    publishMessageSent: jest.fn(),
    publishMentioned: jest.fn(),
  }
  const redisService = { pipeline: jest.fn().mockResolvedValue([]) }
  const messageMediaService = {
    normalizeMessageType: jest.fn((t: string) => t),
  }
  const service = new MessageService(
    memberRepo as never,
    messageRepo as never,
    eventsPublisher as never,
    messageMediaService as never,
    redisService as never,
    {} as never,
  )
  return { service, memberRepo, messageRepo, eventsPublisher, redisService }
}

const payload = {
  conversationId: CONV,
  senderId: SENDER,
  content: 'chào @bob',
  clientMessageId: 'tmp-1',
}

describe('MessageService.sendMessage — tin gửi lại', () => {
  it('a fresh message counts unread and mentions', async () => {
    const { service, memberRepo, eventsPublisher, redisService } = setup(false)

    await service.sendMessage(payload)

    expect(memberRepo.markMention).toHaveBeenCalledTimes(1)
    expect(eventsPublisher.publishMentioned).toHaveBeenCalledTimes(1)
    expect(redisService.pipeline).toHaveBeenCalledTimes(1)
    expect(eventsPublisher.publishMessageSent).toHaveBeenCalledTimes(1)
  })

  it('a replayed message re-sends ACK/NEW but does not count unread or mentions again', async () => {
    const { service, memberRepo, eventsPublisher, redisService } = setup(true)

    await service.sendMessage(payload)

    expect(memberRepo.markMention).not.toHaveBeenCalled()
    expect(eventsPublisher.publishMentioned).not.toHaveBeenCalled()
    expect(redisService.pipeline).not.toHaveBeenCalled()
    expect(eventsPublisher.publishMessageSent).toHaveBeenCalledTimes(1)
  })

  it('hands the queued signal to the repository so the lane can move on', async () => {
    const { service, messageRepo } = setup(false)
    const onQueued = jest.fn()

    await service.sendMessage(payload, onQueued)

    expect(messageRepo.create).toHaveBeenCalledWith(expect.anything(), onQueued)
  })
})
