import {
  ForbiddenException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common'
import type { MessageSendPayload } from 'libs/constant/rmq/payload'
import type { ChatService } from '../../chat.service'
import type { ChatEventsPublisher } from '../publishers/chat-events.publisher'
import { MessageSubscriber } from './chat-subcribers'

// Chỉ cần hình dạng: không kéo Prisma/Redis của ChatService vào test.
jest.mock('../../chat.service', () => ({ ChatService: class {} }))
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
      chatService as unknown as ChatService,
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
    chatService.sendMessage.mockRejectedValue(new Error('mongo down'))

    await expect(subscriber.sendMessage(data)).rejects.toBeInstanceOf(
      InternalServerErrorException,
    )
    expect(publisher.publishMessageError).toHaveBeenCalledTimes(1)
    expect(warn).not.toHaveBeenCalled()
  })
})
