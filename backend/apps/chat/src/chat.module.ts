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
} from './repositories'
import { ChatEventsPublisher } from './rmq/publishers/chat-events.publisher'
import { MessageSubscriber } from './rmq/subcribers/chat-subcribers'
import { RmqModule } from './rmq.module'
import { LoggerModule } from '@app/logger'
import { StorageR2Module } from '@app/storage-r2/storage-r2.module'
import { r2Config } from './storage-r2.config'
import { ConfigModule } from '@nestjs/config/dist/config.module'
import { AuthGuard, CommonModule } from '@app/common'
import { APP_GUARD } from '@nestjs/core'
import { PrismaModule } from '../prisma/prisma.module'
import { PrometheusModule } from '@willsoto/nestjs-prometheus/dist/module'
import { RedisModule } from '@app/redis/redis.module'
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
    BullModule.forRoot({
      connection: {
        host: 'localhost', // Hoặc config từ file .env
        port: 6379,
      },
    }),
    BullModule.registerQueue({
      name: 'unreadQueue', // Tên cái xe buýt chở event
    }),
    BackgroundJobModule,
    RedisModule.forRoot(
      {
        host: process.env.REDIS_HOST || 'localhost',
        port: Number(process.env.REDIS_PORT || 6379),
        db: 0,
      },
      'REDIS_CLIENT',
    ),
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
    ChatEventsPublisher,
    MessageSubscriber,
  ],
})
export class ChatModule {}
