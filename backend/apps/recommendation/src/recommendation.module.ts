import { Module } from '@nestjs/common'
import { RecommendationController } from './recommendation.controller'
import { RecommendationService } from './recommendation.service'
import { Neo4jModule } from '@app/neo4j'
import { ConfigModule } from '@nestjs/config/dist/config.module'
import { PrismaModule } from '../prisma/prisma.module'
import { QdrantModule } from '@app/qdrant/qdrant.module'
import { UtilModule } from '@app/util'
import { RedisModule } from '@app/redis'
import { PythonRecommendationClient } from './python-recommendation.client'
import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq'
import { EXCHANGE_RMQ } from 'libs/constant/rmq/exchange'
import { UserSnapshotSyncService } from './services/user-snapshot-sync.service'
import { UserSnapshotSyncSubscriber } from './rmq/subscribers/user-snapshot-sync.subscriber'

@Module({
  imports: [
    PrismaModule,
    Neo4jModule,
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: process.cwd() + '/apps/recommendation/.env',
    }),
    QdrantModule,
    UtilModule,
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
          name: EXCHANGE_RMQ.USER_EVENTS,
          type: 'topic',
        },
      ],
      uri: process.env.RABBITMQ_URL || 'amqp://user:user@localhost:5672',
      connectionInitOptions: { wait: true },
    }),
  ],
  controllers: [RecommendationController],
  providers: [
    RecommendationService,
    PythonRecommendationClient,
    UserSnapshotSyncService,
    UserSnapshotSyncSubscriber,
  ],
})
export class RecommendationModule {}
