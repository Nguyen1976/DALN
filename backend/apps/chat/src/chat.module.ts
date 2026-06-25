import { Module } from '@nestjs/common'
import { ScheduleModule } from '@nestjs/schedule'
import { BullModule } from '@nestjs/bullmq'
import { ChatController } from './chat.controller'
import { ChatService } from './chat.service'
import { MessageService, MessageMediaService, PollService, ConversationMemberService, ConversationService } from './services'
import { UtilModule } from '@app/util'
import {
  ConversationRepository,
  MessageRepository,
  ConversationMemberRepository,
  PollRepository,
} from './repositories'
import { ChatEventsPublisher } from './rmq/publishers/chat-events.publisher'
import { MessageSubscriber } from './rmq/subcribers/chat-subcribers'
import { ChatSagaSubscriber } from './rmq/subcribers/chat-saga.subscriber'
import { ChatOutboxRelay } from './rmq/chat-outbox.relay'
import { RmqModule } from './rmq.module'
import { LoggerModule } from '@app/logger'
import { S3StorageModule } from '@app/storage-s3/s3-storage.module'
import { getS3StorageConfigFromEnv } from '@app/storage-s3/s3-storage-env'
import { storageConfig } from './storage.config'
import { ConfigModule } from '@nestjs/config/dist/config.module'
import { AuthGuard, CommonModule } from '@app/common'
import { APP_GUARD } from '@nestjs/core'
import { PrismaModule } from '../prisma/prisma.module'
import { PrometheusModule } from '@willsoto/nestjs-prometheus/dist/module'
import { getBullMqConnectionConfig, RedisModule } from '@app/redis'
import { BackgroundJobModule } from './background-jobs/background-jobs.module'

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
    RmqModule,
    UtilModule,
    LoggerModule.forService('Chat-Service'),
    S3StorageModule,
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: process.cwd() + '/apps/chat/.env',
      load: [storageConfig],
    }),
    S3StorageModule.forRoot(getS3StorageConfigFromEnv()),
    ScheduleModule.forRoot(),
    BullModule.forRootAsync({
      useFactory: () => ({
        connection: getBullMqConnectionConfig(),
      }),
    }),
    BullModule.registerQueue({
      name: 'unreadQueue', // Tên cái xe buýt chở event
    }),
    BackgroundJobModule,
    RedisModule.forRoot(() => ({}), 'REDIS_CLIENT'),
  ],
  controllers: [ChatController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    ChatService,
    MessageService,
    MessageMediaService,
    PollService,
    ConversationMemberService,
    ConversationService,
    ConversationRepository,
    MessageRepository,
    ConversationMemberRepository,
    PollRepository,
    ChatEventsPublisher,
    MessageSubscriber,
    ChatSagaSubscriber,
    ChatOutboxRelay,
  ],
})
export class ChatModule {}
