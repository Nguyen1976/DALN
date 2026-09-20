import { Test, TestingModule } from '@nestjs/testing'
import { RealtimeGatewayController } from './realtime-gateway.controller'
import { RealtimeGateway } from './realtime/realtime.gateway'

describe('RealtimeGatewayController', () => {
  let realtimeGatewayController: RealtimeGatewayController

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [RealtimeGatewayController],
      providers: [
        // Controller ủy thác webhook LiveKit cho gateway; một stub là đủ.
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

  it('khởi tạo được', () => {
    expect(realtimeGatewayController).toBeDefined()
  })
})
