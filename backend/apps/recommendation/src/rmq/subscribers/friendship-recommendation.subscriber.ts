import { Injectable } from '@nestjs/common'
import { RabbitSubscribeWithRetry } from '@app/common/rmq'
import { EXCHANGE_RMQ } from 'libs/constant/rmq/exchange'
import { ROUTING_RMQ } from 'libs/constant/rmq/routing'
import { QUEUE_RMQ } from 'libs/constant/rmq/queue'
import { RecommendationFriendshipService } from '../../services/recommendation-friendship.service'
import { FriendGraphService } from '../../services/friend-graph.service'
import type {
  UserFriendshipRevertedPayload,
  UserUpdateStatusMakeFriendPayload,
} from 'libs/constant/rmq/payload'

@Injectable()
export class FriendshipRecommendationSubscriber {
  constructor(
    private readonly recommendationFriendshipService: RecommendationFriendshipService,
    private readonly friendGraphService: FriendGraphService,
  ) {}

  @RabbitSubscribeWithRetry({
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
    await this.friendGraphService.upsertFriendship(
      payload.inviterId,
      payload.inviteeId,
    )

    // 2. Drop each other from any cached recommendation lists.
    await this.recommendationFriendshipService.onFriendshipAccepted(
      payload.inviterId,
      payload.inviteeId,
    )
  }

  /**
   * The accept saga failed later on and undid the friendship: drop it from
   * the graph copy too, and let both lists be recomputed.
   */
  @RabbitSubscribeWithRetry({
    exchange: EXCHANGE_RMQ.USER_EVENTS,
    routingKey: ROUTING_RMQ.USER_FRIENDSHIP_REVERTED,
    queue: QUEUE_RMQ.RECOMMENDATION_USER_FRIENDSHIP_REVERTED,
  })
  async handleFriendshipReverted(
    payload: UserFriendshipRevertedPayload,
  ): Promise<void> {
    await this.friendGraphService.removeFriendship(
      payload.inviterId,
      payload.inviteeId,
    )
    await this.recommendationFriendshipService.onFriendshipReverted(
      payload.inviterId,
      payload.inviteeId,
    )
  }
}
