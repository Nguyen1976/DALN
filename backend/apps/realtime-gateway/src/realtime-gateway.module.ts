import { Module } from '@nestjs/common'
import { RealtimeGatewayController } from './realtime-gateway.controller'
import { RealtimeGatewayService } from './realtime-gateway.service'
import { RealtimeGateway } from './realtime/realtime.gateway'
import { RedisModule } from '@app/redis'
import { CommonModule } from '@app/common'
import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq'
import { EXCHANGE_RMQ } from 'libs/constant/rmq/exchange'

@Module({
  imports: [
    RedisModule.forRoot(
      {
        host: process.env.REDIS_HOST || 'localhost',
        port: Number(process.env.REDIS_PORT || 6379),
        db: 0,
      },
      'REDIS_CLIENT',
    ),
    RabbitMQModule.forRoot({
      exchanges: [
        {
          name: EXCHANGE_RMQ.REALTIME_EVENTS,
          type: 'topic',
        },
      ],
      uri: process.env.RABBITMQ_URL || 'amqp://user:user@localhost:5672',
      connectionInitOptions: { wait: true },
    }),
    CommonModule,
  ],
  controllers: [RealtimeGatewayController],
  providers: [RealtimeGatewayService, RealtimeGateway],
})
export class RealtimeGatewayModule {}
