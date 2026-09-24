import { Injectable } from '@nestjs/common'
import { RabbitSubscribeWithRetry } from '@app/common/rmq'
import { EXCHANGE_RMQ } from 'libs/constant/rmq/exchange'
import type {
  ChatMentionPayload,
  UserCreatedPayload,
  UserMakeFriendPayload,
  SessionRevokedPayload,
  UserPasswordChangedPayload,
  UserPasswordResetPayload,
  UserRegisterOtpPayload,
  UserUpdateStatusMakeFriendPayload,
} from 'libs/constant/rmq/payload'
import { QUEUE_RMQ } from 'libs/constant/rmq/queue'
import { ROUTING_RMQ } from 'libs/constant/rmq/routing'
import { NotificationService } from '../../notification.service'

@Injectable()
export class NotificationSubscriber {
  constructor(private readonly notificationService: NotificationService) {}

  /**
   * Cảnh báo phiên bị thu hồi vì nghi token bị đánh cắp.
   *
   * Cùng routing key với hàng đợi của realtime gateway: exchange là topic nên
   * mỗi queue nhận một bản, gateway lo ngắt socket còn ở đây lo báo cho người.
   */
  @RabbitSubscribeWithRetry({
    exchange: EXCHANGE_RMQ.USER_EVENTS,
    routingKey: ROUTING_RMQ.AUTH_SESSION_REVOKED,
    queue: QUEUE_RMQ.NOTIFICATION_AUTH_SESSION_REVOKED,
  })
  async handleSessionRevoked(data: SessionRevokedPayload): Promise<void> {
    await this.notificationService.handleSessionRevoked(data)
  }

  @RabbitSubscribeWithRetry({
    exchange: EXCHANGE_RMQ.USER_EVENTS,
    routingKey: ROUTING_RMQ.USER_CREATED,
    queue: QUEUE_RMQ.NOTIFICATION_USER_CREATED,
  })
  async handleUserRegistered(data: UserCreatedPayload): Promise<void> {
    await this.notificationService.handleUserRegistered(data)
  }

  @RabbitSubscribeWithRetry({
    exchange: EXCHANGE_RMQ.USER_EVENTS,
    routingKey: ROUTING_RMQ.USER_REGISTER_OTP,
    queue: QUEUE_RMQ.NOTIFICATION_USER_REGISTER_OTP,
  })
  async handleUserRegisterOtp(data: UserRegisterOtpPayload): Promise<void> {
    await this.notificationService.handleUserRegisterOtp(data)
  }

  @RabbitSubscribeWithRetry({
    exchange: EXCHANGE_RMQ.USER_EVENTS,
    routingKey: ROUTING_RMQ.USER_PASSWORD_RESET,
    queue: QUEUE_RMQ.NOTIFICATION_USER_PASSWORD_RESET,
  })
  async handleUserPasswordReset(data: UserPasswordResetPayload): Promise<void> {
    await this.notificationService.handleUserPasswordReset(data)
  }

  @RabbitSubscribeWithRetry({
    exchange: EXCHANGE_RMQ.USER_EVENTS,
    routingKey: ROUTING_RMQ.USER_PASSWORD_CHANGED,
    queue: QUEUE_RMQ.NOTIFICATION_USER_PASSWORD_CHANGED,
  })
  async handleUserPasswordChanged(
    data: UserPasswordChangedPayload,
  ): Promise<void> {
    await this.notificationService.handleUserPasswordChanged(data)
  }

  @RabbitSubscribeWithRetry({
    exchange: EXCHANGE_RMQ.USER_EVENTS,
    routingKey: ROUTING_RMQ.USER_MAKE_FRIEND,
    queue: QUEUE_RMQ.NOTIFICATION_USER_MAKE_FRIEND,
  })
  async handleMakeFriend(data: UserMakeFriendPayload): Promise<void> {
    await this.notificationService.handleMakeFriend(data)
  }

  @RabbitSubscribeWithRetry({
    exchange: EXCHANGE_RMQ.USER_EVENTS,
    routingKey: ROUTING_RMQ.USER_UPDATE_STATUS_MAKE_FRIEND,
    queue: QUEUE_RMQ.NOTIFICATION_USER_UPDATE_STATUS_MAKE_FRIEND,
  })
  async handleUpdateStatusMakeFriend(
    data: UserUpdateStatusMakeFriendPayload,
  ): Promise<void> {
    await this.notificationService.handleUpdateStatusMakeFriend(data)
  }

  @RabbitSubscribeWithRetry({
    exchange: EXCHANGE_RMQ.CHAT_EVENTS,
    routingKey: ROUTING_RMQ.CHAT_MENTION,
    queue: QUEUE_RMQ.NOTIFICATION_CHAT_MENTION,
  })
  async handleChatMention(data: ChatMentionPayload): Promise<void> {
    await this.notificationService.handleChatMention(data)
  }
}
