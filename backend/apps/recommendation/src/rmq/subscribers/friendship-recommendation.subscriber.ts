import { Injectable } from '@nestjs/common'
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq'
import { EXCHANGE_RMQ } from 'libs/constant/rmq/exchange'
import { ROUTING_RMQ } from 'libs/constant/rmq/routing'
import { QUEUE_RMQ } from 'libs/constant/rmq/queue'
import { safeExecute } from '@app/common/rpc/safe-execute'
import { RecommendationFriendshipService } from '../../services/recommendation-friendship.service'
import type { UserUpdateStatusMakeFriendPayload } from 'libs/constant/rmq/payload'

@Injectable()
export class FriendshipRecommendationSubscriber {
  constructor(
    private readonly recommendationFriendshipService: RecommendationFriendshipService,
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

    await safeExecute(() =>
      this.recommendationFriendshipService.onFriendshipAccepted(
        payload.inviterId,
        payload.inviteeId,
      ),
    )
  }
}
