import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { ScheduleModule } from '@nestjs/schedule'
import { RecommendationController } from './recommendation.controller'
import { RecommendationService } from './recommendation.service'
import { ConfigModule } from '@nestjs/config/dist/config.module'
import { PrismaModule } from '../prisma/prisma.module'
import { QdrantModule } from '@app/qdrant/qdrant.module'
import { UtilModule } from '@app/util'
import { RedisModule } from '@app/redis'
import { EmbeddingService } from './services/embedding.service'
import { FeatureService } from './services/feature.service'
import { GbRankerService } from './services/gb-ranker.service'
import { DatasetBuilderService } from './services/dataset-builder.service'
import { ModelTrainingService } from './services/model-training.service'
import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq'
import { EXCHANGE_RMQ } from 'libs/constant/rmq/exchange'
import { UserSnapshotSyncService } from './services/user-snapshot-sync.service'
import { UserSnapshotSyncSubscriber } from './rmq/subscribers/user-snapshot-sync.subscriber'
import { CommonModule, AuthGuard } from '@app/common'
import { RecommendationCron } from './background-jobs/recommendation/recommendation.cron'
import { InterestTagService } from './services/interest-tag.service'
import { InterestTagSeedService } from './services/interest-tag-seed.service'
import { EmbeddingNotifyService } from './services/embedding-notify.service'
import { UserSnapshotHydrateService } from './services/user-snapshot-hydrate.service'
import { RecommendationFriendshipService } from './services/recommendation-friendship.service'
import { FriendshipRecommendationSubscriber } from './rmq/subscribers/friendship-recommendation.subscriber'
import { RecommendationGroupMembershipService } from './services/recommendation-group-membership.service'
import { GroupMembershipSubscriber } from './rmq/subscribers/group-membership.subscriber'
import { FriendGraphService } from './services/friend-graph.service'

@Module({
  imports: [
    PrismaModule,
    CommonModule,
    ScheduleModule.forRoot(),
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: process.cwd() + '/apps/recommendation/.env',
    }),
    QdrantModule,
    UtilModule,
    RedisModule.forRoot(() => ({}), 'REDIS_CLIENT'),
    RabbitMQModule.forRoot({
      exchanges: [
        {
          name: EXCHANGE_RMQ.USER_EVENTS,
          type: 'topic',
        },
      ],
      uri: process.env.RABBITMQ_URL || 'amqp://user:user@localhost:5672',
      connectionInitOptions: { wait: false },
    }),
  ],
  controllers: [RecommendationController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    RecommendationService,
    FriendGraphService,
    EmbeddingService,
    FeatureService,
    GbRankerService,
    DatasetBuilderService,
    ModelTrainingService,
    UserSnapshotSyncService,
    EmbeddingNotifyService,
    UserSnapshotHydrateService,
    RecommendationFriendshipService,
    UserSnapshotSyncSubscriber,
    FriendshipRecommendationSubscriber,
    RecommendationGroupMembershipService,
    GroupMembershipSubscriber,
    RecommendationCron,
    InterestTagService,
    InterestTagSeedService,
  ],
})
export class RecommendationModule {}
