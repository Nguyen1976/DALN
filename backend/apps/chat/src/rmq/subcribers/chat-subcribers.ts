import { Injectable, Logger } from '@nestjs/common'
import { ConversationService, MessageService } from '../../services'
import { RabbitSubscribeWithRetry } from '@app/common/rmq'
import { EXCHANGE_RMQ } from 'libs/constant/rmq/exchange'
import { ROUTING_RMQ } from 'libs/constant/rmq/routing'
import { QUEUE_RMQ } from 'libs/constant/rmq/queue'
import type {
  CallEndedPayload,
  UserUpdatedPayload,
  UpdateMessageReadPayload,
} from 'libs/constant/rmq/payload'
import { ChatEventsPublisher } from '../publishers/chat-events.publisher'

@Injectable()
export class MessageSubscriber {
  private readonly logger = new Logger(MessageSubscriber.name)

  // The conversation for a new friendship is created by the saga
  // (ChatSagaSubscriber.createConversation), with outbox and compensation.
  constructor(
    private readonly conversations: ConversationService,
    private readonly messages: MessageService,
    private readonly chatEventsPublisher: ChatEventsPublisher,
  ) {}

  @RabbitSubscribeWithRetry({
    exchange: EXCHANGE_RMQ.USER_EVENTS,
    routingKey: ROUTING_RMQ.USER_UPDATED,
    queue: QUEUE_RMQ.CHAT_USER_UPDATED,
  })
  async handleUserUpdated(data: UserUpdatedPayload): Promise<void> {
    await this.conversations.handleUserUpdated(data)
  }

  @RabbitSubscribeWithRetry({
    exchange: EXCHANGE_RMQ.REALTIME_EVENTS,
    routingKey: ROUTING_RMQ.CALL_ENDED,
    queue: QUEUE_RMQ.CHAT_CALL_ENDED,
  })
  async recordCallOutcome(data: CallEndedPayload): Promise<void> {
    await this.messages.recordCallOutcome(data)
  }

  // Tin gửi đi qua partition (partitions/), không qua subscriber này.

  @RabbitSubscribeWithRetry({
    exchange: EXCHANGE_RMQ.REALTIME_EVENTS,
    routingKey: ROUTING_RMQ.UPDATE_MESSAGE_READ,
    queue: QUEUE_RMQ.CHAT_UPDATE_MESSAGE_READ,
  })
  async updateMessageRead(data: UpdateMessageReadPayload): Promise<void> {
    await this.messages.updateMessageRead(data)
  }
}
