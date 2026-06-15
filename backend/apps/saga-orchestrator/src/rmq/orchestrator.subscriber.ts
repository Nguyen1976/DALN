import { Injectable } from '@nestjs/common'
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq'
import { EXCHANGE_RMQ } from 'libs/constant/rmq/exchange'
import {
  SAGA_QUEUE,
  SAGA_ROUTING,
  type FriendshipAcceptTriggerPayload,
  type SagaEnvelope,
} from 'libs/constant/rmq/saga'
import { FriendshipAcceptSaga } from '../friendship-accept.saga'

@Injectable()
export class OrchestratorSubscriber {
  constructor(private readonly saga: FriendshipAcceptSaga) {}

  @RabbitSubscribe({
    exchange: EXCHANGE_RMQ.SAGA_EVENTS,
    routingKey: SAGA_ROUTING.FRIENDSHIP_ACCEPT_REQUESTED,
    queue: SAGA_QUEUE.ORCHESTRATOR_TRIGGER,
  })
  async onTrigger(
    envelope: SagaEnvelope<FriendshipAcceptTriggerPayload>,
  ): Promise<void> {
    await this.saga.handleTrigger(envelope)
  }

  @RabbitSubscribe({
    exchange: EXCHANGE_RMQ.SAGA_EVENTS,
    routingKey: SAGA_ROUTING.REPLY,
    queue: SAGA_QUEUE.ORCHESTRATOR_REPLY,
  })
  async onReply(envelope: SagaEnvelope): Promise<void> {
    await this.saga.handleReply(envelope)
  }
}
