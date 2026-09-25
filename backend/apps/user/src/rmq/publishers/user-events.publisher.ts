import { AmqpConnection } from '@golevelup/nestjs-rabbitmq'
import { Injectable, Logger } from '@nestjs/common'
import { publishEvent } from '@app/common/rmq'
import { EXCHANGE_RMQ } from 'libs/constant/rmq/exchange'
import {
  EmitToUserPayload,
  UserCreatedPayload,
  UserInterestsUpdatedPayload,
  UserMakeFriendPayload,
  UserPasswordChangedPayload,
  UserChangePasswordOtpPayload,
  UserPasswordResetPayload,
  SessionRevokedPayload,
  UserRegisterOtpPayload,
  UserUpdatedPayload,
  UserUpdateStatusMakeFriendPayload,
} from 'libs/constant/rmq/payload'
import { ROUTING_RMQ } from 'libs/constant/rmq/routing'
import { SOCKET_EVENTS } from 'libs/constant/websocket/socket.events'
import type { FriendView } from '../../domain/user.domain'

@Injectable()
export class UserEventsPublisher {
  private readonly logger = new Logger(UserEventsPublisher.name)

  constructor(private readonly amqpConnection: AmqpConnection) {}

  /**
   * Every event leaves through here. Fire-and-forget: the change it reports
   * is already saved, so a broker failure is logged, not thrown.
   */
  private publish(exchange: string, routingKey: string, payload: unknown) {
    publishEvent(this.amqpConnection, exchange, routingKey, payload).catch(
      (error: unknown) =>
        this.logger.error(`publish ${routingKey} failed`, error),
    )
  }

  publishUserCreated(payload: UserCreatedPayload): void {
    this.publish(EXCHANGE_RMQ.USER_EVENTS, ROUTING_RMQ.USER_CREATED, payload)
  }

  publishUserRegisterOtp(payload: UserRegisterOtpPayload): void {
    this.publish(
      EXCHANGE_RMQ.USER_EVENTS,
      ROUTING_RMQ.USER_REGISTER_OTP,
      payload,
    )
  }

  publishUserChangePasswordOtp(payload: UserChangePasswordOtpPayload): void {
    this.publish(
      EXCHANGE_RMQ.USER_EVENTS,
      ROUTING_RMQ.USER_CHANGE_PASSWORD_OTP,
      payload,
    )
  }

  publishUserPasswordReset(payload: UserPasswordResetPayload): void {
    this.publish(
      EXCHANGE_RMQ.USER_EVENTS,
      ROUTING_RMQ.USER_PASSWORD_RESET,
      payload,
    )
  }

  publishSessionRevoked(payload: SessionRevokedPayload): void {
    this.publish(
      EXCHANGE_RMQ.USER_EVENTS,
      ROUTING_RMQ.AUTH_SESSION_REVOKED,
      payload,
    )
  }

  publishUserPasswordChanged(payload: UserPasswordChangedPayload): void {
    this.publish(
      EXCHANGE_RMQ.USER_EVENTS,
      ROUTING_RMQ.USER_PASSWORD_CHANGED,
      payload,
    )
  }

  publishUserMakeFriend(payload: UserMakeFriendPayload): void {
    this.publish(
      EXCHANGE_RMQ.USER_EVENTS,
      ROUTING_RMQ.USER_MAKE_FRIEND,
      payload,
    )
  }

  publishUserUpdateStatusMakeFriend(
    payload: UserUpdateStatusMakeFriendPayload,
  ): void {
    this.publish(
      EXCHANGE_RMQ.USER_EVENTS,
      ROUTING_RMQ.USER_UPDATE_STATUS_MAKE_FRIEND,
      payload,
    )
  }

  publishUserUpdated(payload: UserUpdatedPayload): void {
    this.publish(EXCHANGE_RMQ.USER_EVENTS, ROUTING_RMQ.USER_UPDATED, payload)
  }

  publishUserInterestsUpdated(payload: UserInterestsUpdatedPayload): void {
    this.publish(
      EXCHANGE_RMQ.USER_EVENTS,
      ROUTING_RMQ.USER_INTERESTS_UPDATED,
      payload,
    )
  }

  /**
   * `friend` came online; their friends get the row their list shows, so
   * someone not loaded yet can be put on it without asking the server again.
   */
  publisherUserOnline(payload: {
    userIds: string[]
    friend: FriendView
  }): void {
    this.publish(
      EXCHANGE_RMQ.REALTIME_EVENTS,
      ROUTING_RMQ.EMIT_REALTIME_EVENT,
      {
        userIds: payload.userIds,
        event: SOCKET_EVENTS.USER.ONLINE_STATUS_CHANGED,
        data: { userId: payload.friend.id, friend: payload.friend },
      } satisfies EmitToUserPayload,
    )
  }
  publisherUserOffline(payload: {
    userIds: string[]
    userId: string
    lastSeen: string
  }): void {
    this.publish(
      EXCHANGE_RMQ.REALTIME_EVENTS,
      ROUTING_RMQ.EMIT_REALTIME_EVENT,
      {
        userIds: payload.userIds,
        event: SOCKET_EVENTS.USER.OFFLINE_STATUS_CHANGED,
        data: {
          userId: payload.userId,
          lastSeen: payload.lastSeen,
        },
      } satisfies EmitToUserPayload,
    )
  }
}
