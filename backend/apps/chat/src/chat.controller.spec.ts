import { Test, TestingModule } from '@nestjs/testing'
import { ChatController } from './chat.controller'
import { ChatService } from './chat.service'

/**
 * Smoke test: the controller wires up against a stubbed service.
 *
 * ChatService pulls in Prisma, Redis, RabbitMQ and S3, none of which belong in
 * a unit test — the controller is what is under test here, so the service is
 * replaced wholesale.
 */
describe('ChatController', () => {
  let chatController: ChatController

  const chatServiceStub = {
    getConversations: jest.fn().mockResolvedValue([]),
    getMessagesByConversationId: jest.fn().mockResolvedValue({ messages: [] }),
    searchConversations: jest.fn().mockResolvedValue([]),
  }

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [ChatController],
      providers: [{ provide: ChatService, useValue: chatServiceStub }],
    }).compile()

    chatController = app.get<ChatController>(ChatController)
  })

  it('khởi tạo được', () => {
    expect(chatController).toBeDefined()
  })

  it('trả danh sách cuộc trò chuyện của đúng người gọi', async () => {
    await chatController.getConversations({ userId: 'u1' }, '10', '')
    expect(chatServiceStub.getConversations).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ limit: 10 }),
    )
  })
})
