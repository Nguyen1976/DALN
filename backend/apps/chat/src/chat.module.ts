import { Module } from '@nestjs/common'
import { ScheduleModule } from '@nestjs/schedule'
import { BullModule } from '@nestjs/bullmq'
import { ChatController } from './chat.controller'
import { ChatService } from './chat.service'
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
import { StorageR2Module } from '@app/storage-r2/storage-r2.module'
import { r2Config } from './storage-r2.config'
import { ConfigModule } from '@nestjs/config/dist/config.module'
import { AuthGuard, CommonModule } from '@app/common'
import { APP_GUARD } from '@nestjs/core'
import { PrismaModule } from '../prisma/prisma.module'
import { PrometheusModule } from '@willsoto/nestjs-prometheus/dist/module'
import { getRedisConnectionConfig, RedisModule } from '@app/redis'
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
    StorageR2Module,
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: process.cwd() + '/apps/chat/.env',
      load: [r2Config],
    }),
    StorageR2Module.forRoot({
      accessKey: process.env.R2_ACCESS_KEY!,
      secretKey: process.env.R2_SECRET_KEY!,
      endpoint: process.env.R2_ENDPOINT!,
      bucket: process.env.R2_BUCKET!,
      publicUrl: process.env.R2_PUBLIC_URL!,
    }),
    ScheduleModule.forRoot(),
    BullModule.forRootAsync({
      useFactory: () => ({
        connection: getRedisConnectionConfig() as object,
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
