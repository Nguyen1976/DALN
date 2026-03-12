import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq'
import { Global, Module } from '@nestjs/common'
import { EXCHANGE_RMQ } from 'libs/constant/rmq/exchange'

@Global()
@Module({
  imports: [
    RabbitMQModule.forRoot({
      exchanges: [{ name: EXCHANGE_RMQ.CHAT_EVENTS, type: 'topic' }],
      uri: process.env.RABBITMQ_URL || 'amqp://user:user@localhost:5672',
      connectionInitOptions: { wait: true },
    }),
  ],
  exports: [RabbitMQModule],
})
export class RmqModule {}
