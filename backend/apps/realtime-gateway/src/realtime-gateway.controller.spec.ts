import { Test, TestingModule } from '@nestjs/testing'
import { RealtimeGatewayController } from './realtime-gateway.controller'
import { RealtimeGatewayService } from './realtime-gateway.service'
import { RealtimeGateway } from './realtime/realtime.gateway'

describe('RealtimeGatewayController', () => {
  let realtimeGatewayController: RealtimeGatewayController

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [RealtimeGatewayController],
      providers: [
        RealtimeGatewayService,
        // Controller giờ ủy thác webhook LiveKit cho gateway; test này chỉ chạm
        // route root nên một stub là đủ.
        {
          provide: RealtimeGateway,
          useValue: { applyLivekitWebhook: jest.fn() },
        },
      ],
    }).compile()

    realtimeGatewayController = app.get<RealtimeGatewayController>(
      RealtimeGatewayController,
    )
  })

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(realtimeGatewayController.getHello()).toBe('Hello World!')
    })
  })
})
