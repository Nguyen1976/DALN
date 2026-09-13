import { Module } from '@nestjs/common'
import { RealtimeGatewayController } from './realtime-gateway.controller'
import { RealtimeGatewayService } from './realtime-gateway.service'
import { RealtimeGateway } from './realtime/realtime.gateway'
import { RedisModule } from '@app/redis'
import { CommonModule } from '@app/common'
import {
  MessageHandlerErrorBehavior,
  RabbitMQModule,
} from '@golevelup/nestjs-rabbitmq'
import { EXCHANGE_RMQ } from 'libs/constant/rmq/exchange'

@Module({
  imports: [
    RedisModule.forRoot(() => ({}), 'REDIS_CLIENT'),
    RabbitMQModule.forRoot({
      exchanges: [
        {
          name: EXCHANGE_RMQ.REALTIME_EVENTS,
          type: 'topic',
        },
      ],
      uri: process.env.RABBITMQ_URL || 'amqp://user:user@localhost:5672',
      connectionInitOptions: { wait: true },
      // Lưới an toàn: lỗi lọt khỏi handler thì NACK không requeue (-> dead-letter
      // qua policy daln-dlx) thay cho REQUEUE mặc định của golevelup — REQUEUE
      // từng làm một message lỗi vĩnh viễn lặp vô hạn (sự cố 2026-09-12). Mọi
      // subscriber đã dùng @RabbitSubscribeWithRetry (retry có giới hạn trước).
      defaultSubscribeErrorBehavior: MessageHandlerErrorBehavior.NACK,
    }),
    CommonModule,
  ],
  controllers: [RealtimeGatewayController],
  providers: [RealtimeGatewayService, RealtimeGateway],
})
export class RealtimeGatewayModule {}
