import { Injectable } from '@nestjs/common'
import { RabbitSubscribeWithRetry } from '@app/common/rmq'
import { EXCHANGE_RMQ } from 'libs/constant/rmq/exchange'
import type {
  ChatMentionPayload,
  UserCreatedPayload,
  UserMakeFriendPayload,
  UserRegisterOtpPayload,
  UserUpdateStatusMakeFriendPayload,
} from 'libs/constant/rmq/payload'
import { QUEUE_RMQ } from 'libs/constant/rmq/queue'
import { ROUTING_RMQ } from 'libs/constant/rmq/routing'
import { NotificationService } from '../../notification.service'

@Injectable()
export class NotificationSubscriber {
  constructor(private readonly notificationService: NotificationService) {}

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
