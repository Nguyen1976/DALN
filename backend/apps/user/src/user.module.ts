import { Module } from '@nestjs/common'
import { UserService } from './user.service'
import { RedisModule } from '@app/redis'
import { AuthGuard, CommonModule } from '@app/common'
import { UtilModule } from '@app/util'
import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq'
import { EXCHANGE_RMQ } from 'libs/constant/rmq/exchange'
import { S3StorageModule, getS3StorageConfigFromEnv } from '@app/storage-s3'
import { ConfigModule } from '@nestjs/config'
import { storageConfig } from './storage.config'
import {
  UserRepository,
  FriendRequestRepository,
  FriendShipRepository,
} from './repositories'
import { UserEventsPublisher } from './rmq/publishers/user-events.publisher'
import { LoggerModule } from '@app/logger/logger.module'
import { MessageSubscriber } from './rmq/subcribers/user-subcribers'
import { UserSagaSubscriber } from './rmq/subcribers/user-saga.subscriber'
import { UserOutboxRelay } from './rmq/user-outbox.relay'
import { UserHttpController } from './http/user-http.controller'
import { APP_GUARD } from '@nestjs/core'
import { PrismaModule } from '../prisma/prisma.module'
import { PrometheusModule } from '@willsoto/nestjs-prometheus'

@Module({
  imports: [
    PrometheusModule.register({
      path: '/metrics', // Endpoint để Prometheus kéo data
      defaultMetrics: {
        enabled: true, // Tự động lấy CPU, RAM, Heap của Node.js
      },
    }),
    PrismaModule,
    CommonModule,
    UtilModule,
    RabbitMQModule.forRoot({
      exchanges: [
        {
          name: EXCHANGE_RMQ.USER_EVENTS,
          type: 'topic',
        },
        {
          name: EXCHANGE_RMQ.SAGA_EVENTS,
          type: 'topic',
        },
      ],
      uri: process.env.RABBITMQ_URL || 'amqp://user:user@localhost:5672',
      connectionInitOptions: { wait: true },
    }),
    S3StorageModule,
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: process.cwd() + '/apps/user/.env',
      load: [storageConfig],
    }),
    S3StorageModule.forRoot(getS3StorageConfigFromEnv()),
    LoggerModule.forService('User-Service'),
    RedisModule.forRoot(() => ({}), 'REDIS_CLIENT'),
  ],
  controllers: [UserHttpController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    UserService,
    UserRepository,
    FriendRequestRepository,
    UserEventsPublisher,
    FriendShipRepository,
    MessageSubscriber,
    UserSagaSubscriber,
    UserOutboxRelay,
  ],
})
export class UserModule {}
