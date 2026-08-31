import { Test, TestingModule } from '@nestjs/testing'
import { NotificationController } from './notification.controller'
import { NotificationService } from './notification.service'

/** Smoke test with a stubbed service; see chat.controller.spec.ts. */
describe('NotificationController', () => {
  let notificationController: NotificationController

  const notificationServiceStub = {
    getNotifications: jest.fn().mockResolvedValue({ notifications: [] }),
    getUnreadCount: jest.fn().mockResolvedValue({ unreadCount: 0 }),
  }

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [NotificationController],
      providers: [
        { provide: NotificationService, useValue: notificationServiceStub },
      ],
    }).compile()

    notificationController = app.get<NotificationController>(
      NotificationController,
    )
  })

  it('khởi tạo được', () => {
    expect(notificationController).toBeDefined()
  })

  it('số chưa đọc được hỏi theo đúng người dùng đang đăng nhập', async () => {
    await notificationController.getUnreadCount({ userId: 'u1' })
    expect(notificationServiceStub.getUnreadCount).toHaveBeenCalledWith('u1')
  })
})
