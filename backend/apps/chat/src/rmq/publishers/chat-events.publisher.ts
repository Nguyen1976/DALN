import { AmqpConnection } from '@golevelup/nestjs-rabbitmq'
import { Injectable } from '@nestjs/common'
import { EXCHANGE_RMQ } from 'libs/constant/rmq/exchange'
import {
  EmitToUserPayload,
  PollClosedPayload,
  PollUpdatedPayload,
  MessageRevokedPayload,
} from 'libs/constant/rmq/payload'
import { ROUTING_RMQ } from 'libs/constant/rmq/routing'
import { SOCKET_EVENTS } from 'libs/constant/websocket/socket.events'

@Injectable()
export class ChatEventsPublisher {
  constructor(private readonly amqpConnection: AmqpConnection) {}

  publishConversationCreated(conversation: any): void {
    this.amqpConnection.publish(
      EXCHANGE_RMQ.REALTIME_EVENTS,
      ROUTING_RMQ.EMIT_REALTIME_EVENT,
      {
        userIds: conversation.memberIds,
        event: SOCKET_EVENTS.CHAT.NEW_CONVERSATION,
        data: { conversation },
      } as EmitToUserPayload,
    )
  }

  publishMessageSent(message: any, memberIds: string[]): void {
    const senderId = String(message.senderId)
    const otherMemberIds = memberIds.filter((id) => id !== senderId)

    this.amqpConnection.publish(
      EXCHANGE_RMQ.REALTIME_EVENTS,
      ROUTING_RMQ.EMIT_REALTIME_EVENT,
      {
        userIds: [senderId],
        event: SOCKET_EVENTS.CHAT.MESSAGE_ACK,
        data: {
          status: 'SUCCESS',
          clientMessageId: message.clientMessageId || message.tempMessageId,
          serverMessageId: message.id,
          conversationId: message.conversationId,
          createdAt: message.createdAt,
          message,
        },
      } as EmitToUserPayload,
    )

    this.amqpConnection.publish(
      EXCHANGE_RMQ.REALTIME_EVENTS,
      ROUTING_RMQ.EMIT_REALTIME_EVENT,
      {
        userIds: otherMemberIds,
        event: SOCKET_EVENTS.CHAT.MESSAGE_NEW,
        data: { message },
      } as EmitToUserPayload,
    )
  }

  publishMemberAddedToConversation(payload): void {
    const allMemberIds = payload.members?.map((m) => m.userId) || []
    const newMembers = (payload.members || []).filter((member) =>
      (payload.newMemberIds || []).includes(member.userId),
    )

    this.amqpConnection.publish(
      EXCHANGE_RMQ.REALTIME_EVENTS,
      ROUTING_RMQ.EMIT_REALTIME_EVENT,
      {
        userIds: allMemberIds,
        event: SOCKET_EVENTS.CHAT.CONVERSATION_MEMBER_ADDED,
        data: {
          conversationId: payload.id,
          actorId: payload.actorId,
          memberIds: payload.newMemberIds,
          members: newMembers,
        },
      } as EmitToUserPayload,
    )

    this.amqpConnection.publish(
      EXCHANGE_RMQ.REALTIME_EVENTS,
      ROUTING_RMQ.EMIT_REALTIME_EVENT,
      {
        userIds: payload.newMemberIds,
        event: SOCKET_EVENTS.CHAT.NEW_MEMBER_ADDED,
        data: payload,
      } as EmitToUserPayload,
    )

    this.amqpConnection.publish(
      EXCHANGE_RMQ.REALTIME_EVENTS,
      ROUTING_RMQ.EMIT_REALTIME_EVENT,
      {
        userIds: payload.newMemberIds,
        event: SOCKET_EVENTS.CHAT.CONVERSATION_UPDATE,
        data: {
          conversation: payload,
          canSendMessage: true,
          membershipStatus: 'ACTIVE',
        },
      } as EmitToUserPayload,
    )
  }

  publishConversationMemberRemoved(payload: {
    conversation: any
    actorId: string
    targetUserId: string
    remainingMemberIds: string[]
  }) {
    const { conversation, actorId, targetUserId, remainingMemberIds } = payload

    this.amqpConnection.publish(
      EXCHANGE_RMQ.REALTIME_EVENTS,
      ROUTING_RMQ.EMIT_REALTIME_EVENT,
      {
        userIds: remainingMemberIds,
        event: SOCKET_EVENTS.CHAT.CONVERSATION_MEMBER_REMOVED,
        data: {
          conversationId: conversation.id,
          actorId,
          targetUserId,
        },
      } as EmitToUserPayload,
    )

    this.amqpConnection.publish(
      EXCHANGE_RMQ.REALTIME_EVENTS,
      ROUTING_RMQ.EMIT_REALTIME_EVENT,
      {
        userIds: [targetUserId],
        event: SOCKET_EVENTS.CHAT.CONVERSATION_UPDATE,
        data: {
          conversation,
          canSendMessage: false,
          membershipStatus: 'REMOVED',
        },
      } as EmitToUserPayload,
    )
  }

  publishConversationMemberLeft(payload: {
    conversation: any
    actorId: string
    remainingMemberIds: string[]
    promotedUserId?: string
  }) {
    const { conversation, actorId, remainingMemberIds, promotedUserId } =
      payload

    this.amqpConnection.publish(
      EXCHANGE_RMQ.REALTIME_EVENTS,
      ROUTING_RMQ.EMIT_REALTIME_EVENT,
      {
        userIds: remainingMemberIds,
        event: SOCKET_EVENTS.CHAT.CONVERSATION_MEMBER_LEFT,
        data: {
          conversationId: conversation.id,
          actorId,
          promotedUserId,
        },
      } as EmitToUserPayload,
    )

    this.amqpConnection.publish(
      EXCHANGE_RMQ.REALTIME_EVENTS,
      ROUTING_RMQ.EMIT_REALTIME_EVENT,
      {
        userIds: [actorId],
        event: SOCKET_EVENTS.CHAT.CONVERSATION_UPDATE,
        data: {
          conversation,
          canSendMessage: false,
          membershipStatus: 'LEFT',
        },
      } as EmitToUserPayload,
    )
  }

  publishSystemMessage(memberIds: string[], message: any) {
    this.amqpConnection.publish(
      EXCHANGE_RMQ.REALTIME_EVENTS,
      ROUTING_RMQ.EMIT_REALTIME_EVENT,
      {
        userIds: memberIds,
        event: SOCKET_EVENTS.CHAT.MESSAGE_SYSTEM,
        data: { message },
      } as EmitToUserPayload,
    )
  }

  publishMessageError(
    userId: string,
    payload: {
      clientMessageId?: string
      conversationId?: string
      code: string
      message: string
      retryable: boolean
    },
  ): void {
    this.amqpConnection.publish(
      EXCHANGE_RMQ.REALTIME_EVENTS,
      ROUTING_RMQ.EMIT_REALTIME_EVENT,
      {
        userIds: [userId],
        event: SOCKET_EVENTS.CHAT.MESSAGE_ERROR,
        data: payload,
      } as EmitToUserPayload,
    )
  }

  publishMessageRevoked(
    payload: MessageRevokedPayload,
    userIds: string[],
  ): void {
    this.amqpConnection.publish(
      EXCHANGE_RMQ.REALTIME_EVENTS,
      ROUTING_RMQ.EMIT_REALTIME_EVENT,
      {
        userIds,
        event: SOCKET_EVENTS.CHAT.MESSAGE_REVOKED,
        data: payload,
      } as EmitToUserPayload,
    )
  }

  publishPollUpdated(payload: PollUpdatedPayload, userIds: string[]): void {
    this.amqpConnection.publish(
      EXCHANGE_RMQ.REALTIME_EVENTS,
      ROUTING_RMQ.EMIT_REALTIME_EVENT,
      {
        userIds,
        event: SOCKET_EVENTS.CHAT.POLL_UPDATED,
        data: payload,
      } as EmitToUserPayload,
    )
  }

  publishPollClosed(payload: PollClosedPayload, userIds: string[]): void {
    this.amqpConnection.publish(
      EXCHANGE_RMQ.REALTIME_EVENTS,
      ROUTING_RMQ.EMIT_REALTIME_EVENT,
      {
        userIds,
        event: SOCKET_EVENTS.CHAT.POLL_CLOSED,
        data: payload,
      } as EmitToUserPayload,
    )
  }
}
