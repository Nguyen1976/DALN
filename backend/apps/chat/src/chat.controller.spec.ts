import { Test, TestingModule } from '@nestjs/testing'
import { ChatController } from './chat.controller'
import {
  ConversationMemberService,
  ConversationService,
  MessageService,
  PollService,
} from './services'

// The services pull in Prisma, Redis, RabbitMQ and S3; only their shape
// matters here.
jest.mock('./services', () => ({
  ConversationService: class {},
  ConversationMemberService: class {},
  MessageService: class {},
  PollService: class {},
}))

/**
 * Smoke test: the controller wires up against stubbed services and hands the
 * caller's id and the validated page through unchanged.
 */
describe('ChatController', () => {
  let chatController: ChatController

  const conversations = {
    getConversations: jest
      .fn()
      .mockResolvedValue({ items: [], nextCursor: null }),
    searchConversations: jest.fn().mockResolvedValue([]),
  }
  const messages = {
    getMessagesByConversationId: jest.fn().mockResolvedValue({ messages: [] }),
  }

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [ChatController],
      providers: [
        { provide: ConversationService, useValue: conversations },
        { provide: ConversationMemberService, useValue: {} },
        { provide: MessageService, useValue: messages },
        { provide: PollService, useValue: {} },
      ],
    }).compile()

    chatController = app.get<ChatController>(ChatController)
  })

  it('khởi tạo được', () => {
    expect(chatController).toBeDefined()
  })

  it('trả danh sách cuộc trò chuyện của đúng người gọi', async () => {
    await chatController.getConversations('u1', { limit: 10 })
    expect(conversations.getConversations).toHaveBeenCalledWith('u1', {
      limit: 10,
    })
  })
})
