import { Module } from '@nestjs/common'
import { UserController } from './user.controller'
import { UserService } from './user.service'
import { RedisModule } from '@app/redis'
import { PrismaModule } from '@app/prisma'
import { AuthGuard, CommonModule } from '@app/common'
import { UtilModule } from '@app/util'
import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq'
import { EXCHANGE_RMQ } from 'libs/constant/rmq/exchange'
import { StorageR2Module } from '@app/storage-r2'
import { ConfigModule } from '@nestjs/config'
import { r2Config } from './storage-r2.config'
import {
  UserRepository,
  FriendRequestRepository,
  FriendShipRepository,
} from './repositories'
import { UserEventsPublisher } from './rmq/publishers/user-events.publisher'
import { LoggerModule } from '@app/logger/logger.module'
import { MessageSubscriber } from './rmq/subcribers/user-subcribers'
import { UserHttpController } from './http/user-http.controller'
import { APP_GUARD } from '@nestjs/core'

@Module({
  imports: [
    PrismaModule,
    CommonModule,
    UtilModule,
    RabbitMQModule.forRoot({
      exchanges: [
        {
          name: EXCHANGE_RMQ.USER_EVENTS,
          type: 'topic',
        },
      ],
      uri: process.env.RABBITMQ_URL || 'amqp://user:user@localhost:5672',
      connectionInitOptions: { wait: true },
    }),
    StorageR2Module,
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: process.cwd() + '/apps/user/.storage-r2.env',
      load: [r2Config],
    }),
    StorageR2Module.forRoot({
      accessKey: process.env.R2_ACCESS_KEY!,
      secretKey: process.env.R2_SECRET_KEY!,
      endpoint: process.env.R2_ENDPOINT!,
      bucket: process.env.R2_BUCKET!,
      publicUrl: process.env.R2_PUBLIC_URL!,
    }),
    LoggerModule.forService('Api-Gateway'),
    RedisModule.forRoot(
      {
        host: process.env.REDIS_HOST || 'localhost',
        port: Number(process.env.REDIS_PORT || 6379),
        db: 0,
      },
      'REDIS_CLIENT',
    ),
  ],
  controllers: [UserController, UserHttpController],
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
  ],
})
export class UserModule {}
