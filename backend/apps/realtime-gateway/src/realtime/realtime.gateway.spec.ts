import { Test, TestingModule } from '@nestjs/testing'
import { JwtService } from '@nestjs/jwt'
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq'
import { EVENT_TYPE_HEADER, EVENT_VERSION_HEADER } from '@app/common/rmq'
import { EXCHANGE_RMQ } from 'libs/constant/rmq/exchange'
import { ROUTING_RMQ } from 'libs/constant/rmq/routing'
import { RealtimeGateway } from './realtime.gateway'

/**
 * Smoke test: the gateway constructs against stubbed JWT, Redis and RabbitMQ.
 *
 * Also pins the rules that do not need a live socket to check — a client with
 * no authenticated user must not be able to publish a message, and what does
 * get published carries the event version header.
 */
describe('RealtimeGateway', () => {
  let gateway: RealtimeGateway

  const amqpStub = { publish: jest.fn() }
  const redisStub = {
    smembers: jest.fn().mockResolvedValue([]),
    sadd: jest.fn(),
    srem: jest.fn(),
    pipeline: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
  }

  beforeEach(async () => {
    jest.clearAllMocks()
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RealtimeGateway,
        { provide: JwtService, useValue: { verify: jest.fn() } },
        { provide: 'REDIS_CLIENT', useValue: redisStub },
        { provide: AmqpConnection, useValue: amqpStub },
      ],
    }).compile()

    gateway = module.get<RealtimeGateway>(RealtimeGateway)
  })

  it('khởi tạo được', () => {
    expect(gateway).toBeDefined()
  })

  it('không cho gửi tin nhắn khi socket chưa xác thực', async () => {
    const client: any = { data: {}, emit: jest.fn() }

    await gateway.handleCreateMessage(
      { conversationId: 'c1', clientMessageId: 'tmp-1', content: 'xin chao' },
      client,
    )

    expect(amqpStub.publish).not.toHaveBeenCalled()
    expect(client.emit).toHaveBeenCalledWith(
      expect.stringContaining('error'),
      expect.objectContaining({ code: 'UNAUTHORIZED' }),
    )
  })

  it('socket đã xác thực -> publish SEND_MESSAGE kèm header version, body giữ nguyên', async () => {
    const client: any = { data: { userId: 'u1' }, emit: jest.fn() }

    await gateway.handleCreateMessage(
      { conversationId: 'c1', clientMessageId: 'tmp-1', content: 'xin chao' },
      client,
    )

    expect(amqpStub.publish).toHaveBeenCalledWith(
      EXCHANGE_RMQ.REALTIME_EVENTS,
      ROUTING_RMQ.SEND_MESSAGE,
      expect.objectContaining({
        conversationId: 'c1',
        senderId: 'u1',
        text: 'xin chao',
        clientMessageId: 'tmp-1',
      }),
      expect.objectContaining({
        persistent: true,
        headers: {
          [EVENT_VERSION_HEADER]: 1,
          [EVENT_TYPE_HEADER]: ROUTING_RMQ.SEND_MESSAGE,
        },
      }),
    )
  })
})
