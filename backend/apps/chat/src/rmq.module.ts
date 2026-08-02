import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq'
import { Global, Module } from '@nestjs/common'
import { EXCHANGE_RMQ } from 'libs/constant/rmq/exchange'

@Global()
@Module({
  imports: [
    RabbitMQModule.forRoot({
      // Khai báo mọi exchange service này chạm tới (publish lẫn subscribe),
      // không chỉ exchange nó sở hữu. Khai báo topic exchange là idempotent,
      // nên trùng với service khác vẫn an toàn và loại bỏ phụ thuộc thứ tự
      // khởi động (bind vào exchange chưa tồn tại -> 404 NOT_FOUND -> app chết).
      exchanges: [
        { name: EXCHANGE_RMQ.CHAT_EVENTS, type: 'topic' },
        { name: EXCHANGE_RMQ.SAGA_EVENTS, type: 'topic' },
        { name: EXCHANGE_RMQ.USER_EVENTS, type: 'topic' },
        { name: EXCHANGE_RMQ.REALTIME_EVENTS, type: 'topic' },
      ],
      uri: process.env.RABBITMQ_URL || 'amqp://user:user@localhost:5672',
      connectionInitOptions: { wait: true },
    }),
  ],
  exports: [RabbitMQModule],
})
export class RmqModule {}
