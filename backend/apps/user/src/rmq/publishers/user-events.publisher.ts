import { AmqpConnection } from '@golevelup/nestjs-rabbitmq'
import { Injectable } from '@nestjs/common'
import { publishEvent } from '@app/common/rmq'
import { EXCHANGE_RMQ } from 'libs/constant/rmq/exchange'
import {
  EmitToUserPayload,
  UserCreatedPayload,
  UserInterestsUpdatedPayload,
  UserMakeFriendPayload,
  UserRegisterOtpPayload,
  UserUpdatedPayload,
  UserUpdateStatusMakeFriendPayload,
} from 'libs/constant/rmq/payload'
import { ROUTING_RMQ } from 'libs/constant/rmq/routing'
import { SOCKET_EVENTS } from 'libs/constant/websocket/socket.events'
import type { FriendView } from '../../domain/user.domain'

@Injectable()
export class UserEventsPublisher {
  constructor(private readonly amqpConnection: AmqpConnection) {}

  publishUserCreated(payload: UserCreatedPayload): void {
    publishEvent(
      this.amqpConnection,
      EXCHANGE_RMQ.USER_EVENTS,
      ROUTING_RMQ.USER_CREATED,
      payload,
    )
  }

  publishUserRegisterOtp(payload: UserRegisterOtpPayload): void {
    publishEvent(
      this.amqpConnection,
      EXCHANGE_RMQ.USER_EVENTS,
      ROUTING_RMQ.USER_REGISTER_OTP,
      payload,
    )
  }

  publishUserMakeFriend(payload: UserMakeFriendPayload): void {
    publishEvent(
      this.amqpConnection,
      EXCHANGE_RMQ.USER_EVENTS,
      ROUTING_RMQ.USER_MAKE_FRIEND,
      payload,
    )
  }

  publishUserUpdateStatusMakeFriend(
    payload: UserUpdateStatusMakeFriendPayload,
  ): void {
    publishEvent(
      this.amqpConnection,
      EXCHANGE_RMQ.USER_EVENTS,
      ROUTING_RMQ.USER_UPDATE_STATUS_MAKE_FRIEND,
      payload,
    )
  }

  publishUserUpdated(payload: UserUpdatedPayload): void {
    publishEvent(
      this.amqpConnection,
      EXCHANGE_RMQ.USER_EVENTS,
      ROUTING_RMQ.USER_UPDATED,
      payload,
    )
  }

  publishUserInterestsUpdated(payload: UserInterestsUpdatedPayload): void {
    publishEvent(
      this.amqpConnection,
      EXCHANGE_RMQ.USER_EVENTS,
      ROUTING_RMQ.USER_INTERESTS_UPDATED,
      payload,
    )
  }

  /**
   * `friend` came online; their friends get the row their list shows, so
   * someone not loaded yet can be put on it without asking the server again.
   */
  publisherUserOnline(payload: { userIds: string[]; friend: FriendView }): void {
    publishEvent(
      this.amqpConnection,
      EXCHANGE_RMQ.REALTIME_EVENTS,
      ROUTING_RMQ.EMIT_REALTIME_EVENT,
      {
        userIds: payload.userIds,
        event: SOCKET_EVENTS.USER.ONLINE_STATUS_CHANGED,
        data: { userId: payload.friend.id, friend: payload.friend },
      } as EmitToUserPayload,
    )
  }
  publisherUserOffline(payload: {
    userIds: string[]
    userId: string
    lastSeen: string
  }): void {
    publishEvent(
      this.amqpConnection,
      EXCHANGE_RMQ.REALTIME_EVENTS,
      ROUTING_RMQ.EMIT_REALTIME_EVENT,
      {
        userIds: payload.userIds,
        event: SOCKET_EVENTS.USER.OFFLINE_STATUS_CHANGED,
        data: {
          userId: payload.userId,
          lastSeen: payload.lastSeen,
        },
      } as EmitToUserPayload,
    )
  }
}
