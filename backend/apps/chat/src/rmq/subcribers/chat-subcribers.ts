import { Injectable } from '@nestjs/common'
import { ChatService } from '../../chat.service'
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq'
import { EXCHANGE_RMQ } from 'libs/constant/rmq/exchange'
import { ROUTING_RMQ } from 'libs/constant/rmq/routing'
import { QUEUE_RMQ } from 'libs/constant/rmq/queue'
import { safeExecute } from '@app/common/rpc/safe-execute'
import type {
  MessageSendPayload,
  UserUpdatedPayload,
  UserUpdateStatusMakeFriendPayload,
  UpdateMessageReadPayload,
} from 'libs/constant/rmq/payload'
import { ChatEventsPublisher } from '../publishers/chat-events.publisher'

@Injectable()
export class MessageSubscriber {
  constructor(
    private readonly chatService: ChatService,
    private readonly chatEventsPublisher: ChatEventsPublisher,
  ) {}

  @RabbitSubscribe({
    exchange: EXCHANGE_RMQ.USER_EVENTS,
    routingKey: ROUTING_RMQ.USER_UPDATE_STATUS_MAKE_FRIEND,
    queue: QUEUE_RMQ.CHAT_USER_UPDATE_STATUS_MAKE_FRIEND,
  })
  async createConversationWhenAcceptFriend(
    data: UserUpdateStatusMakeFriendPayload,
  ): Promise<void> {
    await safeExecute(() =>
      this.chatService.createConversationWhenAcceptFriend(data),
    )
  }

  @RabbitSubscribe({
    exchange: EXCHANGE_RMQ.USER_EVENTS,
    routingKey: ROUTING_RMQ.USER_UPDATED,
    queue: QUEUE_RMQ.CHAT_USER_UPDATED,
  })
  async handleUserUpdated(data: UserUpdatedPayload): Promise<void> {
    await safeExecute(() => this.chatService.handleUserUpdated(data))
  }

  @RabbitSubscribe({
    exchange: EXCHANGE_RMQ.REALTIME_EVENTS,
    routingKey: ROUTING_RMQ.SEND_MESSAGE,
    queue: QUEUE_RMQ.CHAT_SEND_MESSAGE,
  })
  async sendMessage(data: MessageSendPayload): Promise<void> {
    try {
      await safeExecute(() => this.chatService.sendMessage(data))
    } catch (error: any) {
      this.chatEventsPublisher.publishMessageError(data.senderId, {
        clientMessageId: data.clientMessageId || data.tempMessageId,
        conversationId: data.conversationId,
        code: 'MESSAGE_CREATE_FAILED',
        message:
          error?.message ||
          'Unable to create message. Please retry or upload again.',
        retryable: true,
      })
      throw error
    }
  }

  @RabbitSubscribe({
    exchange: EXCHANGE_RMQ.REALTIME_EVENTS,
    routingKey: ROUTING_RMQ.UPDATE_MESSAGE_READ,
    queue: QUEUE_RMQ.CHAT_UPDATE_MESSAGE_READ,
  })
  async updateMessageRead(data: UpdateMessageReadPayload): Promise<void> {
    await safeExecute(() => this.chatService.updateMessageRead(data))
  }
}
