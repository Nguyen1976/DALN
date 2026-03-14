import { Module } from '@nestjs/common'
import { NotificationController } from './notification.controller'
import { NotificationService } from './notification.service'
import { MailerModule } from '@app/mailer'
import { ConfigModule } from '@nestjs/config'
import { PrismaModule } from '@app/prisma'
import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq'
import { UtilModule } from '@app/util'
import { RedisModule } from '@app/redis'
import { EXCHANGE_RMQ } from 'libs/constant/rmq/exchange'
import { LoggerModule } from '@app/logger'
import { AuthGuard, CommonModule } from '@app/common'
import { APP_GUARD } from '@nestjs/core'
import { NotificationHttpController } from './http/notification-http.controller'
import {
  NotificationPreferenceRepository,
  NotificationRepository,
} from './repositories'
import { NotificationEventsPublisher } from './rmq/publishers/notification-events.publisher'
import { NotificationSubscriber } from './rmq/subcribers/notification-subscribers'

@Module({
  imports: [
    CommonModule,
    RedisModule.forRoot(
      {
        host: process.env.REDIS_HOST || 'localhost',
        port: Number(process.env.REDIS_PORT || 6379),
        db: 0,
      },
      'REDIS_CLIENT',
    ),
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    MailerModule,
    PrismaModule,
    RabbitMQModule.forRoot({
      exchanges: [
        {
          name: EXCHANGE_RMQ.NOTIFICATION_EVENTS,
          type: 'topic',
        },
      ],
      uri: process.env.RABBITMQ_URL || 'amqp://user:user@localhost:5672',
      connectionInitOptions: { wait: true },
    }),
    UtilModule,
    LoggerModule.forService('Notification-Service'),
  ],
  controllers: [NotificationController, NotificationHttpController],
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
  ],
})
export class NotificationModule {}
