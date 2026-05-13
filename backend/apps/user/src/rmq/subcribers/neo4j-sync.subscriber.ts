import { Injectable } from '@nestjs/common'
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq'
import { EXCHANGE_RMQ } from 'libs/constant/rmq/exchange'
import { ROUTING_RMQ } from 'libs/constant/rmq/routing'
import { QUEUE_RMQ } from 'libs/constant/rmq/queue'
import { safeExecute } from '@app/common/rpc/safe-execute'
import { Neo4jGraphSyncService } from '../../services/neo4j-graph-sync.service'
import {
  UserCreatedPayload,
  UserUpdateStatusMakeFriendPayload,
} from 'libs/constant/rmq/payload'

@Injectable()
export class Neo4jSyncSubscriber {
  constructor(private readonly neo4jGraphSyncService: Neo4jGraphSyncService) {}

  @RabbitSubscribe({
    exchange: EXCHANGE_RMQ.USER_EVENTS,
    routingKey: ROUTING_RMQ.USER_CREATED,
    queue: QUEUE_RMQ.USER_NEO4J_CREATED,
  })
  async handleUserCreated(payload: UserCreatedPayload): Promise<void> {
    await safeExecute(() => this.neo4jGraphSyncService.syncUserCreated(payload))
  }

  @RabbitSubscribe({
    exchange: EXCHANGE_RMQ.USER_EVENTS,
    routingKey: ROUTING_RMQ.USER_UPDATE_STATUS_MAKE_FRIEND,
    queue: QUEUE_RMQ.USER_NEO4J_UPDATE_STATUS_MAKE_FRIEND,
  })
  async handleFriendshipAccepted(
    payload: UserUpdateStatusMakeFriendPayload,
  ): Promise<void> {
    await safeExecute(() =>
      this.neo4jGraphSyncService.syncFriendshipAccepted(payload),
    )
  }
}
