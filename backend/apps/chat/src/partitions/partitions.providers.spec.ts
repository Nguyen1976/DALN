import { Test } from '@nestjs/testing'
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq'
import { PartitionCoordinator } from './partition-coordinator'
import { partitionProviders } from './partitions.providers'

// Chỉ cần hình dạng: không kéo Prisma/Redis của các service vào test.
jest.mock('../services', () => ({ MessageService: class {} }))
jest.mock('../rmq/publishers/chat-events.publisher', () => ({
  ChatEventsPublisher: class {},
}))
const { MessageService } = jest.requireMock<{
  MessageService: new () => object
}>('../services')
const { ChatEventsPublisher } = jest.requireMock<{
  ChatEventsPublisher: new () => object
}>('../rmq/publishers/chat-events.publisher')

describe('partition providers', () => {
  it('assembles the coordinator, declares topology on bootstrap and drains on destroy', async () => {
    const start = jest
      .spyOn(PartitionCoordinator.prototype, 'start')
      .mockResolvedValue()
    const shutdown = jest
      .spyOn(PartitionCoordinator.prototype, 'shutdown')
      .mockResolvedValue()
    const channel = {
      assertExchange: jest.fn().mockResolvedValue({}),
      assertQueue: jest.fn().mockResolvedValue({}),
      bindQueue: jest.fn().mockResolvedValue({}),
    }
    const redis = { duplicate: jest.fn(() => ({})) }

    const moduleRef = await Test.createTestingModule({
      providers: [
        ...partitionProviders,
        { provide: MessageService, useValue: {} },
        { provide: ChatEventsPublisher, useValue: {} },
        { provide: 'REDIS_CLIENT', useValue: redis },
        { provide: AmqpConnection, useValue: { channel, connection: {} } },
      ],
    }).compile()
    await moduleRef.init()

    expect(channel.assertQueue).toHaveBeenCalledTimes(16)
    expect(start).toHaveBeenCalledTimes(1)
    expect(redis.duplicate).toHaveBeenCalledTimes(1)
    const coordinator = moduleRef.get(PartitionCoordinator)
    expect(coordinator.memberId).toMatch(/^.+-[0-9a-f]{8}$/)

    await moduleRef.close()
    expect(shutdown).toHaveBeenCalledTimes(1)
  })
})
