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
import { RecommendationDirtyService } from './services/recommendation-dirty.service'
import { BullModule } from '@nestjs/bullmq'
import { getBullMqConnectionConfig } from '@app/redis'
import {
  TRAINING_QUEUE,
  isWorkerRole,
} from './background-jobs/training/training.constants'
import { TrainingProcessor } from './background-jobs/training/training.processor'

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
    BullModule.forRootAsync({
      useFactory: () => ({ connection: getBullMqConnectionConfig() }),
    }),
    BullModule.registerQueue({ name: TRAINING_QUEUE }),
  ],
  controllers: [RecommendationController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    RecommendationService,
    RecommendationDirtyService,
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
    InterestTagService,
    InterestTagSeedService,
    // Tác vụ nặng CPU chỉ chạy ở tiến trình worker. Tiến trình API vẫn giữ
    // producer của hàng đợi (BullModule.registerQueue ở trên) để đẩy job.
    ...(isWorkerRole() ? [TrainingProcessor, RecommendationCron] : []),
  ],
})
export class RecommendationModule {}
