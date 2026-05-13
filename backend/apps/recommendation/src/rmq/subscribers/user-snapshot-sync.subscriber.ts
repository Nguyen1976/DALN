import { Injectable } from '@nestjs/common'
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq'
import { EXCHANGE_RMQ } from 'libs/constant/rmq/exchange'
import { ROUTING_RMQ } from 'libs/constant/rmq/routing'
import { QUEUE_RMQ } from 'libs/constant/rmq/queue'
import { safeExecute } from '@app/common/rpc/safe-execute'
import { UserSnapshotSyncService } from '../../services/user-snapshot-sync.service'
import {
  UserCreatedPayload,
  UserUpdatedPayload,
} from 'libs/constant/rmq/payload'

@Injectable()
export class UserSnapshotSyncSubscriber {
  constructor(
    private readonly userSnapshotSyncService: UserSnapshotSyncService,
  ) {}

  @RabbitSubscribe({
    exchange: EXCHANGE_RMQ.USER_EVENTS,
    routingKey: ROUTING_RMQ.USER_CREATED,
    queue: QUEUE_RMQ.RECOMMENDATION_USER_CREATED,
  })
  async handleUserCreated(payload: UserCreatedPayload): Promise<void> {
    await safeExecute(() =>
      this.userSnapshotSyncService.syncUserCreated(payload),
    )
  }

  @RabbitSubscribe({
    exchange: EXCHANGE_RMQ.USER_EVENTS,
    routingKey: ROUTING_RMQ.USER_UPDATED,
    queue: QUEUE_RMQ.RECOMMENDATION_USER_UPDATED,
  })
  async handleUserUpdated(payload: UserUpdatedPayload): Promise<void> {
    await safeExecute(() =>
      this.userSnapshotSyncService.syncUserUpdated(payload),
    )
  }
}
