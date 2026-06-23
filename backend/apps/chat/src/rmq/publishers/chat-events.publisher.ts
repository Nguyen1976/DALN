import { AmqpConnection } from '@golevelup/nestjs-rabbitmq'
import { Injectable } from '@nestjs/common'
import { EXCHANGE_RMQ } from 'libs/constant/rmq/exchange'
import {
  EmitToUserPayload,
  PollClosedPayload,
  PollUpdatedPayload,
  MessageRevokedPayload,
  UserJoinGroupPayload,
  UserLeftGroupPayload,
} from 'libs/constant/rmq/payload'
import { ROUTING_RMQ } from 'libs/constant/rmq/routing'
import { SOCKET_EVENTS } from 'libs/constant/websocket/socket.events'
import { ConversationMapper } from '../../domain/conversation.mapper'
import { MessageMapper } from '../../domain/message.mapper'

@Injectable()
export class ChatEventsPublisher {
  constructor(private readonly amqpConnection: AmqpConnection) {}

  private emitToUsers(
    userIds: string[],
    event: string,
    buildData: (userId: string) => Record<string, unknown>,
  ) {
    for (const userId of userIds) {
      this.amqpConnection.publish(
        EXCHANGE_RMQ.REALTIME_EVENTS,
        ROUTING_RMQ.EMIT_REALTIME_EVENT,
        {
          userIds: [userId],
          event,
          data: buildData(userId),
        } as EmitToUserPayload,
      )
    }
  }

  publishConversationCreated(conversation: any): void {
    const memberIds = conversation.memberIds || conversation.members?.map(
      (member: any) => member.userId,
    ) || []

    this.emitToUsers(memberIds, SOCKET_EVENTS.CHAT.NEW_CONVERSATION, (userId) => ({
      conversation: ConversationMapper.toDetail(conversation, userId),
    }))
  }

  publishMessageSent(message: any, memberIds: string[]): void {
    const normalized = MessageMapper.toResponse(message)
    if (!normalized) return

    const senderId = String(normalized.senderId)
    const otherMemberIds = memberIds.filter((id) => id !== senderId)

    this.amqpConnection.publish(
      EXCHANGE_RMQ.REALTIME_EVENTS,
      ROUTING_RMQ.EMIT_REALTIME_EVENT,
      {
        userIds: [senderId],
        event: SOCKET_EVENTS.CHAT.MESSAGE_ACK,
        data: {
          status: 'SUCCESS',
          clientMessageId: normalized.clientMessageId || message.tempMessageId,
          serverMessageId: normalized.id,
          conversationId: normalized.conversationId,
          createdAt: normalized.createdAt,
          message: normalized,
        },
      } as EmitToUserPayload,
    )

    this.amqpConnection.publish(
      EXCHANGE_RMQ.REALTIME_EVENTS,
      ROUTING_RMQ.EMIT_REALTIME_EVENT,
      {
        userIds: otherMemberIds,
        event: SOCKET_EVENTS.CHAT.MESSAGE_NEW,
        data: { message: normalized },
      } as EmitToUserPayload,
    )
  }

  publishMemberAddedToConversation(payload: any): void {
    const allMemberIds = payload.members?.map((m: any) => m.userId) || []
    const newMembers = (payload.members || []).filter((member: any) =>
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

    this.emitToUsers(
      payload.newMemberIds || [],
      SOCKET_EVENTS.CHAT.CONVERSATION_UPDATE,
      (userId) => ({
        conversation: ConversationMapper.toDetail(payload, userId, {
          membershipStatus: 'ACTIVE',
          canSendMessage: true,
        }),
      }),
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

    this.emitToUsers(
      [targetUserId],
      SOCKET_EVENTS.CHAT.CONVERSATION_UPDATE,
      (userId) => ({
        conversation: ConversationMapper.toDetail(conversation, userId, {
          membershipStatus: 'REMOVED',
          canSendMessage: false,
        }),
        membershipStatus: 'REMOVED',
        canSendMessage: false,
      }),
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

    this.emitToUsers(
      [actorId],
      SOCKET_EVENTS.CHAT.CONVERSATION_UPDATE,
      (userId) => ({
        conversation: ConversationMapper.toDetail(conversation, userId, {
          membershipStatus: 'LEFT',
          canSendMessage: false,
        }),
        membershipStatus: 'LEFT',
        canSendMessage: false,
      }),
    )
  }

  publishSystemMessage(memberIds: string[], message: any) {
    const normalized = MessageMapper.toResponse(message)

    this.amqpConnection.publish(
      EXCHANGE_RMQ.REALTIME_EVENTS,
      ROUTING_RMQ.EMIT_REALTIME_EVENT,
      {
        userIds: memberIds,
        event: SOCKET_EVENTS.CHAT.MESSAGE_SYSTEM,
        data: { message: normalized },
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
    const normalizedPayload = {
      ...payload,
      message: payload.message
        ? MessageMapper.toResponse(payload.message)
        : undefined,
    }

    this.amqpConnection.publish(
      EXCHANGE_RMQ.REALTIME_EVENTS,
      ROUTING_RMQ.EMIT_REALTIME_EVENT,
      {
        userIds,
        event: SOCKET_EVENTS.CHAT.MESSAGE_REVOKED,
        data: normalizedPayload,
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

  publishUserJoinedGroup(payload: UserJoinGroupPayload): void {
    try {
      this.amqpConnection.publish(
        EXCHANGE_RMQ.USER_EVENTS,
        ROUTING_RMQ.USER_JOINED_GROUP,
        payload,
      )
    } catch (e) {
      console.warn('[chat-events] publishUserJoinedGroup failed', e)
    }
  }

  publishUserLeftGroup(payload: UserLeftGroupPayload): void {
    try {
      this.amqpConnection.publish(
        EXCHANGE_RMQ.USER_EVENTS,
        ROUTING_RMQ.USER_LEFT_GROUP,
        payload,
      )
    } catch (e) {
      console.warn('[chat-events] publishUserLeftGroup failed', e)
    }
  }
}
