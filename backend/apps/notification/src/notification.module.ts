import { Module } from '@nestjs/common'
import { NotificationController } from './notification.controller'
import { NotificationService } from './notification.service'
import { MailerModule } from '@app/mailer'
import { ConfigModule } from '@nestjs/config'
import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq'
import { UtilModule } from '@app/util'
import { RedisModule } from '@app/redis'
import { EXCHANGE_RMQ } from 'libs/constant/rmq/exchange'
import { LoggerModule } from '@app/logger'
import { AuthGuard, CommonModule } from '@app/common'
import { APP_GUARD } from '@nestjs/core'
import {
  NotificationPreferenceRepository,
  NotificationRepository,
} from './repositories'
import { NotificationEventsPublisher } from './rmq/publishers/notification-events.publisher'
import { NotificationSubscriber } from './rmq/subcribers/notification-subscribers'
import { NotificationSagaSubscriber } from './rmq/notification-saga.subscriber'
import { NotificationOutboxRelay } from './rmq/notification-outbox.relay'
import { PrismaModule } from '../prisma/prisma.module'
import { PrometheusModule } from '@willsoto/nestjs-prometheus/dist/module'

@Module({
  imports: [
    PrometheusModule.register({
      path: '/metrics', // Endpoint để Prometheus kéo data
      defaultMetrics: {
        enabled: true, // Tự động lấy CPU, RAM, Heap của Node.js
      },
    }),
    CommonModule,
    RedisModule.forRoot(() => ({}), 'REDIS_CLIENT'),
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: process.cwd() + '/apps/notification/.env',
    }),
    MailerModule,
    PrismaModule,
    RabbitMQModule.forRoot({
      // Khai báo mọi exchange service này chạm tới (publish lẫn subscribe),
      // không chỉ exchange nó sở hữu. Khai báo topic exchange là idempotent,
      // nên trùng với service khác vẫn an toàn và loại bỏ phụ thuộc thứ tự
      // khởi động (bind vào exchange chưa tồn tại -> 404 NOT_FOUND -> app chết).
      exchanges: [
        {
          name: EXCHANGE_RMQ.NOTIFICATION_EVENTS,
          type: 'topic',
        },
        {
          name: EXCHANGE_RMQ.SAGA_EVENTS,
          type: 'topic',
        },
        {
          name: EXCHANGE_RMQ.USER_EVENTS,
          type: 'topic',
        },
        {
          name: EXCHANGE_RMQ.REALTIME_EVENTS,
          type: 'topic',
        },
      ],
      uri: process.env.RABBITMQ_URL || 'amqp://user:user@localhost:5672',
      connectionInitOptions: { wait: true },
    }),
    UtilModule,
    LoggerModule.forService('Notification-Service'),
  ],
  controllers: [NotificationController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    NotificationService,
    NotificationRepository,
    NotificationPreferenceRepository,
    NotificationEventsPublisher,
    NotificationSubscriber,
    NotificationSagaSubscriber,
    NotificationOutboxRelay,
  ],
})
export class NotificationModule {}
