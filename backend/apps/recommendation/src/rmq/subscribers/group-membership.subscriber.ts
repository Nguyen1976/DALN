import { Injectable } from '@nestjs/common'
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq'
import { EXCHANGE_RMQ } from 'libs/constant/rmq/exchange'
import { ROUTING_RMQ } from 'libs/constant/rmq/routing'
import { QUEUE_RMQ } from 'libs/constant/rmq/queue'
import { safeExecute } from '@app/common/rpc/safe-execute'
import { RecommendationGroupMembershipService } from '../../services/recommendation-group-membership.service'
import type {
  UserJoinGroupPayload,
  UserLeftGroupPayload,
} from 'libs/constant/rmq/payload'

@Injectable()
export class GroupMembershipSubscriber {
  constructor(
    private readonly recommendationGroupMembershipService: RecommendationGroupMembershipService,
  ) {}

  @RabbitSubscribe({
    exchange: EXCHANGE_RMQ.USER_EVENTS,
    routingKey: ROUTING_RMQ.USER_JOINED_GROUP,
    queue: QUEUE_RMQ.RECOMMENDATION_USER_JOINED_GROUP,
  })
  async handleUserJoined(payload: UserJoinGroupPayload): Promise<void> {
    await safeExecute(() =>
      this.recommendationGroupMembershipService.onUserJoinedGroup(payload),
    )
  }

  @RabbitSubscribe({
    exchange: EXCHANGE_RMQ.USER_EVENTS,
    routingKey: ROUTING_RMQ.USER_LEFT_GROUP,
    queue: QUEUE_RMQ.RECOMMENDATION_USER_LEFT_GROUP,
  })
  async handleUserLeft(payload: UserLeftGroupPayload): Promise<void> {
    await safeExecute(() =>
      this.recommendationGroupMembershipService.onUserLeftGroup(payload),
    )
  }
}
