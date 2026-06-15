import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq'
import { EXCHANGE_RMQ } from 'libs/constant/rmq/exchange'
import { LoggerModule } from '@app/logger'
import { PrismaModule } from '../prisma/prisma.module'
import { FriendshipAcceptSaga } from './friendship-accept.saga'
import { OrchestratorSubscriber } from './rmq/orchestrator.subscriber'
import { OrchestratorOutboxRelay } from './rmq/orchestrator-outbox.relay'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: process.cwd() + '/apps/saga-orchestrator/.env',
    }),
    PrismaModule,
    RabbitMQModule.forRoot({
      exchanges: [
        {
          name: EXCHANGE_RMQ.SAGA_EVENTS,
          type: 'topic',
        },
      ],
      uri: process.env.RABBITMQ_URL || 'amqp://user:user@localhost:5672',
      connectionInitOptions: { wait: true },
    }),
    LoggerModule.forService('Saga-Orchestrator'),
  ],
  providers: [
    FriendshipAcceptSaga,
    OrchestratorSubscriber,
    OrchestratorOutboxRelay,
  ],
})
export class SagaOrchestratorModule {}
