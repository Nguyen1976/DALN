import { ForbiddenException, Logger } from '@nestjs/common'
import type { MessageSendPayload } from 'libs/constant/rmq/payload'
import type { MessageService } from '../../services'
import type { ChatEventsPublisher } from '../publishers/chat-events.publisher'
import { MessageSubscriber } from './chat-subcribers'

// Chỉ cần hình dạng: không kéo Prisma/Redis của các service vào test.
jest.mock('../../services', () => ({
  ConversationService: class {},
  MessageService: class {},
}))
jest.mock('../publishers/chat-events.publisher', () => ({
  ChatEventsPublisher: class {},
}))

describe('MessageSubscriber.sendMessage', () => {
  const data = {
    senderId: 'u1',
    conversationId: 'c1',
    clientMessageId: 'tmp-1',
  } as MessageSendPayload

  let chatService: { sendMessage: jest.Mock }
  let publisher: { publishMessageError: jest.Mock }
  let subscriber: MessageSubscriber
  let warn: jest.SpyInstance

  beforeEach(() => {
    chatService = { sendMessage: jest.fn() }
    publisher = { publishMessageError: jest.fn() }
    subscriber = new MessageSubscriber(
      {} as never,
      chatService as unknown as MessageService,
      publisher as unknown as ChatEventsPublisher,
    )
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {})
    jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => jest.restoreAllMocks())

  it('4xx: báo lỗi cho client một lần rồi ack — không retry, không dead-letter', async () => {
    chatService.sendMessage.mockRejectedValue(
      new ForbiddenException('Không còn là thành viên'),
    )

    await expect(subscriber.sendMessage(data)).resolves.toBeUndefined()
    expect(publisher.publishMessageError).toHaveBeenCalledTimes(1)
    expect(publisher.publishMessageError).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({
        clientMessageId: 'tmp-1',
        conversationId: 'c1',
      }),
    )
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('(403)'))
  })

  it('lỗi hệ thống: ném tiếp để retryThenDeadLetter thử lại', async () => {
    const failure = new Error('mongo down')
    chatService.sendMessage.mockRejectedValue(failure)

    // The error itself goes on, so the retry handler (and the dead-letter log)
    // see what actually failed; the client gets a generic sentence.
    await expect(subscriber.sendMessage(data)).rejects.toBe(failure)
    expect(publisher.publishMessageError).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({
        message: 'Unable to create message. Please retry or upload again.',
      }),
    )
    expect(warn).not.toHaveBeenCalled()
  })
})
