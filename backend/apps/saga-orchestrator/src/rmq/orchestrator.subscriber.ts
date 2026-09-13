import { Injectable } from '@nestjs/common'
import type { ConsumeMessage } from 'amqplib'
import {
  assertSupportedVersion,
  RabbitSubscribeWithRetry,
} from '@app/common/rmq'
import { SUPPORTED_SAGA_VERSIONS } from '@app/saga'
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

  @RabbitSubscribeWithRetry({
    exchange: EXCHANGE_RMQ.SAGA_EVENTS,
    routingKey: SAGA_ROUTING.FRIENDSHIP_ACCEPT_REQUESTED,
    queue: SAGA_QUEUE.ORCHESTRATOR_TRIGGER,
  })
  async onTrigger(
    envelope: SagaEnvelope<FriendshipAcceptTriggerPayload>,
    raw?: ConsumeMessage,
  ): Promise<void> {
    // Envelope saga là hợp đồng giữa các service: version lạ thì dead-letter
    // thay vì đoán nghĩa rồi chạy sai state machine.
    assertSupportedVersion(raw, SUPPORTED_SAGA_VERSIONS)
    await this.saga.handleTrigger(envelope)
  }

  @RabbitSubscribeWithRetry({
    exchange: EXCHANGE_RMQ.SAGA_EVENTS,
    routingKey: SAGA_ROUTING.REPLY,
    queue: SAGA_QUEUE.ORCHESTRATOR_REPLY,
  })
  async onReply(envelope: SagaEnvelope, raw?: ConsumeMessage): Promise<void> {
    assertSupportedVersion(raw, SUPPORTED_SAGA_VERSIONS)
    await this.saga.handleReply(envelope)
  }
}
