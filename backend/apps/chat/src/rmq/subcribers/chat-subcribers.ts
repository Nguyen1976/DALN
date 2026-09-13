import { HttpException, Injectable, Logger } from '@nestjs/common'
import { ChatService } from '../../chat.service'
import { RabbitSubscribeWithRetry } from '@app/common/rmq'
import { EXCHANGE_RMQ } from 'libs/constant/rmq/exchange'
import { ROUTING_RMQ } from 'libs/constant/rmq/routing'
import { QUEUE_RMQ } from 'libs/constant/rmq/queue'
import { safeExecute } from '@app/common/rpc/safe-execute'
import type {
  CallEndedPayload,
  MessageSendPayload,
  UserUpdatedPayload,
  UserUpdateStatusMakeFriendPayload,
  UpdateMessageReadPayload,
} from 'libs/constant/rmq/payload'
import { ChatEventsPublisher } from '../publishers/chat-events.publisher'

@Injectable()
export class MessageSubscriber {
  private readonly logger = new Logger(MessageSubscriber.name)

  constructor(
    private readonly chatService: ChatService,
    private readonly chatEventsPublisher: ChatEventsPublisher,
  ) {}

  // NOTE: Việc tạo conversation khi accept friend đã được chuyển sang
  // saga orchestration (ChatSagaSubscriber.createConversation) để có outbox +
  // idempotency + compensation. Subscriber choreography cũ được vô hiệu hoá để
  // tránh tạo conversation trùng.
  //
  // @RabbitSubscribeWithRetry({
  //   exchange: EXCHANGE_RMQ.USER_EVENTS,
  //   routingKey: ROUTING_RMQ.USER_UPDATE_STATUS_MAKE_FRIEND,
  //   queue: QUEUE_RMQ.CHAT_USER_UPDATE_STATUS_MAKE_FRIEND,
  // })
  // async createConversationWhenAcceptFriend(
  //   data: UserUpdateStatusMakeFriendPayload,
  // ): Promise<void> {
  //   await safeExecute(() =>
  //     this.chatService.createConversationWhenAcceptFriend(data),
  //   )
  // }

  @RabbitSubscribeWithRetry({
    exchange: EXCHANGE_RMQ.USER_EVENTS,
    routingKey: ROUTING_RMQ.USER_UPDATED,
    queue: QUEUE_RMQ.CHAT_USER_UPDATED,
  })
  async handleUserUpdated(data: UserUpdatedPayload): Promise<void> {
    await safeExecute(() => this.chatService.handleUserUpdated(data))
  }

  @RabbitSubscribeWithRetry({
    exchange: EXCHANGE_RMQ.REALTIME_EVENTS,
    routingKey: ROUTING_RMQ.CALL_ENDED,
    queue: QUEUE_RMQ.CHAT_CALL_ENDED,
  })
  async recordCallOutcome(data: CallEndedPayload): Promise<void> {
    await safeExecute(() => this.chatService.recordCallOutcome(data))
  }

  @RabbitSubscribeWithRetry({
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
      // 4xx (không còn là thành viên, payload sai, file chưa upload...) là lỗi
      // nghiệp vụ và client đã nhận MESSAGE_ERROR: thử lại chỉ ra đúng lỗi đó,
      // còn dead-letter thì làm nhiễu số dead-letter (dành cho sự cố thật cần
      // xem/replay). Log rồi ack. Lỗi 5xx vẫn được retry có giới hạn.
      if (
        error instanceof HttpException &&
        error.getStatus() >= 400 &&
        error.getStatus() < 500
      ) {
        this.logger.warn(
          `SEND_MESSAGE bị từ chối (${error.getStatus()}) conversation=${data.conversationId} sender=${data.senderId}: ${error.message}`,
        )
        return
      }
      throw error
    }
  }

  @RabbitSubscribeWithRetry({
    exchange: EXCHANGE_RMQ.REALTIME_EVENTS,
    routingKey: ROUTING_RMQ.UPDATE_MESSAGE_READ,
    queue: QUEUE_RMQ.CHAT_UPDATE_MESSAGE_READ,
  })
  async updateMessageRead(data: UpdateMessageReadPayload): Promise<void> {
    await safeExecute(() => this.chatService.updateMessageRead(data))
  }
}
