import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
  type Provider,
} from '@nestjs/common'
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq'
import type Redis from 'ioredis'
import type { Channel } from 'amqplib'
import { hostname } from 'node:os'
import { randomUUID } from 'node:crypto'
import { assertSendTopology } from '@app/common/rmq'
import { ConversationLanes } from './conversation-lanes'
import { RedisLeaseStore } from './lease-store'
import { PartitionConsumer } from './partition-consumer'
import { PartitionCoordinator } from './partition-coordinator'
import { SendMessageHandler } from './send-message.handler'

const env = (name: string, fallback: number) =>
  Number(process.env[name] ?? fallback)

const coordinatorProvider: Provider = {
  provide: PartitionCoordinator,
  inject: ['REDIS_CLIENT', AmqpConnection, SendMessageHandler],
  useFactory: (
    redis: Redis,
    amqp: AmqpConnection,
    handler: SendMessageHandler,
  ) =>
    new PartitionCoordinator(
      // Kết nối riêng cho SUBSCRIBE: kết nối đang subscribe không chạy lệnh khác.
      new RedisLeaseStore(redis, redis.duplicate()),
      (p) =>
        PartitionConsumer.start(
          // Đọc lại mỗi lần: amqp-connection-manager thay kết nối khi nối lại.
          // golevelup khai báo kiểu `Connection`, nhưng thứ nó trả về là
          // ChannelModel của amqplib — có createChannel.
          amqp.connection as unknown as { createChannel(): Promise<Channel> },
          p,
          (payload) => handler.handle(payload),
          env('CHAT_PARTITION_PREFETCH', 100),
        ),
      `${hostname()}-${randomUUID().slice(0, 8)}`,
      {
        tickMs: env('CHAT_PARTITION_TICK_MS', 2000),
        memberTtlMs: env('CHAT_PARTITION_MEMBER_TTL_MS', 6000),
        leaseTtlMs: env('CHAT_PARTITION_LEASE_TTL_MS', 6000),
        settleMs: env('CHAT_PARTITION_SETTLE_MS', 3000),
        now: () => Date.now(),
      },
    ),
}

/**
 * Khởi động và tắt đường gửi tin theo partition.
 *
 * Thứ tự tắt máy (spec §3, plan Task 10): drain chạy ở onModuleDestroy, phase
 * ĐẦU — lúc đó BatchWriter (beforeApplicationShutdown), Prisma và kết nối
 * RabbitMQ (onApplicationShutdown) đều còn sống, nên tin đang xử lý dở ghi và
 * ack được trước khi partition được nhả.
 */
@Injectable()
export class PartitionsLifecycle
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(PartitionsLifecycle.name)

  constructor(
    @Inject(AmqpConnection) private readonly amqp: AmqpConnection,
    @Inject(PartitionCoordinator)
    private readonly coordinator: PartitionCoordinator,
  ) {}

  async onApplicationBootstrap() {
    await assertSendTopology(this.amqp.channel)
    await this.coordinator.start()
    this.logger.log(`member ${this.coordinator.memberId} sẵn sàng`)
  }

  async onModuleDestroy() {
    await this.coordinator.shutdown()
  }
}

export const partitionProviders: Provider[] = [
  ConversationLanes,
  SendMessageHandler,
  coordinatorProvider,
  PartitionsLifecycle,
]
