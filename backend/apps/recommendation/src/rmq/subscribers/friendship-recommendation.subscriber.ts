import { Injectable } from '@nestjs/common'
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq'
import { EXCHANGE_RMQ } from 'libs/constant/rmq/exchange'
import { ROUTING_RMQ } from 'libs/constant/rmq/routing'
import { QUEUE_RMQ } from 'libs/constant/rmq/queue'
import { safeExecute } from '@app/common/rpc/safe-execute'
import { RecommendationFriendshipService } from '../../services/recommendation-friendship.service'
import { FriendGraphService } from '../../services/friend-graph.service'
import type { UserUpdateStatusMakeFriendPayload } from 'libs/constant/rmq/payload'

@Injectable()
export class FriendshipRecommendationSubscriber {
  constructor(
    private readonly recommendationFriendshipService: RecommendationFriendshipService,
    private readonly friendGraphService: FriendGraphService,
  ) {}

  @RabbitSubscribe({
    exchange: EXCHANGE_RMQ.USER_EVENTS,
    routingKey: ROUTING_RMQ.USER_UPDATE_STATUS_MAKE_FRIEND,
    queue: QUEUE_RMQ.RECOMMENDATION_USER_UPDATE_STATUS_MAKE_FRIEND,
  })
  async handleFriendRequestStatusUpdated(
    payload: UserUpdateStatusMakeFriendPayload,
  ): Promise<void> {
    if (payload.status !== 'ACCEPTED') {
      return
    }

    // 1. Persist the friendship into the MongoDB replica (graph source for RCM).
    await safeExecute(() =>
      this.friendGraphService.upsertFriendship(
        payload.inviterId,
        payload.inviteeId,
      ),
    )

    // 2. Drop each other from any cached recommendation lists.
    await safeExecute(() =>
      this.recommendationFriendshipService.onFriendshipAccepted(
        payload.inviterId,
        payload.inviteeId,
      ),
    )
  }
}
