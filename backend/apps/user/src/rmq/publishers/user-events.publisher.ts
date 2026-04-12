import { AmqpConnection } from '@golevelup/nestjs-rabbitmq'
import { Injectable } from '@nestjs/common'
import { EXCHANGE_RMQ } from 'libs/constant/rmq/exchange'
import {
  EmitToUserPayload,
  UserCreatedPayload,
  UserMakeFriendPayload,
  UserRegisterOtpPayload,
  UserUpdatedPayload,
  UserUpdateStatusMakeFriendPayload,
} from 'libs/constant/rmq/payload'
import { ROUTING_RMQ } from 'libs/constant/rmq/routing'
import { SOCKET_EVENTS } from 'libs/constant/websocket/socket.events'

@Injectable()
export class UserEventsPublisher {
  constructor(private readonly amqpConnection: AmqpConnection) {}

  publishUserCreated(payload: UserCreatedPayload): void {
    this.amqpConnection.publish(
      EXCHANGE_RMQ.USER_EVENTS,
      ROUTING_RMQ.USER_CREATED,
      payload,
    )
  }

  publishUserRegisterOtp(payload: UserRegisterOtpPayload): void {
    this.amqpConnection.publish(
      EXCHANGE_RMQ.USER_EVENTS,
      ROUTING_RMQ.USER_REGISTER_OTP,
      payload,
    )
  }

  publishUserMakeFriend(payload: UserMakeFriendPayload): void {
    this.amqpConnection.publish(
      EXCHANGE_RMQ.USER_EVENTS,
      ROUTING_RMQ.USER_MAKE_FRIEND,
      payload,
    )
  }

  publishUserUpdateStatusMakeFriend(
    payload: UserUpdateStatusMakeFriendPayload,
  ): void {
    this.amqpConnection.publish(
      EXCHANGE_RMQ.USER_EVENTS,
      ROUTING_RMQ.USER_UPDATE_STATUS_MAKE_FRIEND,
      payload,
    )
  }

  publishUserUpdated(payload: UserUpdatedPayload): void {
    this.amqpConnection.publish(
      EXCHANGE_RMQ.USER_EVENTS,
      ROUTING_RMQ.USER_UPDATED,
      payload,
    )
  }

  publisherUserOnline(payload: { userIds: string[]; userId: string }): void {
    this.amqpConnection.publish(
      EXCHANGE_RMQ.REALTIME_EVENTS,
      ROUTING_RMQ.EMIT_REALTIME_EVENT,
      {
        userIds: payload.userIds,
        event: SOCKET_EVENTS.USER.ONLINE_STATUS_CHANGED,
        data: payload.userId,
      } as EmitToUserPayload,
    )
  }
  publisherUserOffline(payload: {
    userIds: string[]
    userId: string
    lastSeen: string
  }): void {
    this.amqpConnection.publish(
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
