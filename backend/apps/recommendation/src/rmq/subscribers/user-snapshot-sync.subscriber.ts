import { Injectable } from '@nestjs/common'
import { RabbitSubscribeWithRetry } from '@app/common/rmq'
import { EXCHANGE_RMQ } from 'libs/constant/rmq/exchange'
import { ROUTING_RMQ } from 'libs/constant/rmq/routing'
import { QUEUE_RMQ } from 'libs/constant/rmq/queue'
import { safeExecute } from '@app/common/rpc/safe-execute'
import { UserSnapshotSyncService } from '../../services/user-snapshot-sync.service'
import type {
  UserCreatedPayload,
  UserInterestsUpdatedPayload,
  UserUpdatedPayload,
} from 'libs/constant/rmq/payload'

@Injectable()
export class UserSnapshotSyncSubscriber {
  constructor(
    private readonly userSnapshotSyncService: UserSnapshotSyncService,
  ) {}

  @RabbitSubscribeWithRetry({
    exchange: EXCHANGE_RMQ.USER_EVENTS,
    routingKey: ROUTING_RMQ.USER_CREATED,
    queue: QUEUE_RMQ.RECOMMENDATION_USER_CREATED,
  })
  async handleUserCreated(payload: UserCreatedPayload): Promise<void> {
    await safeExecute(() =>
      this.userSnapshotSyncService.syncUserCreated(payload),
    )
  }

  @RabbitSubscribeWithRetry({
    exchange: EXCHANGE_RMQ.USER_EVENTS,
    routingKey: ROUTING_RMQ.USER_UPDATED,
    queue: QUEUE_RMQ.RECOMMENDATION_USER_UPDATED,
  })
  async handleUserUpdated(payload: UserUpdatedPayload): Promise<void> {
    await safeExecute(() =>
      this.userSnapshotSyncService.syncUserUpdated(payload),
    )
  }

  @RabbitSubscribeWithRetry({
    exchange: EXCHANGE_RMQ.USER_EVENTS,
    routingKey: ROUTING_RMQ.USER_INTERESTS_UPDATED,
    queue: QUEUE_RMQ.RECOMMENDATION_USER_INTERESTS_UPDATED,
  })
  async handleUserInterestsUpdated(
    payload: UserInterestsUpdatedPayload,
  ): Promise<void> {
    await safeExecute(() =>
      this.userSnapshotSyncService.syncUserInterestsUpdated(payload),
    )
  }
}
