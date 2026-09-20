import { AmqpConnection } from '@golevelup/nestjs-rabbitmq'
import { Injectable, Logger } from '@nestjs/common'
import { publishEvent } from '@app/common/rmq'
import { EXCHANGE_RMQ } from 'libs/constant/rmq/exchange'
import {
  EmitToUserPayload,
  PollEventPayload,
  MessageRevokedPayload,
  UserJoinGroupPayload,
  UserLeftGroupPayload,
} from 'libs/constant/rmq/payload'
import { ROUTING_RMQ } from 'libs/constant/rmq/routing'
import { SOCKET_EVENTS } from 'libs/constant/websocket/socket.events'
import {
  ConversationMapper,
  type ConversationWithMembers,
} from '../../domain/conversation.mapper'
import { type MessageDto } from '../../domain/message.mapper'

@Injectable()
export class ChatEventsPublisher {
  private readonly logger = new Logger(ChatEventsPublisher.name)

  constructor(private readonly amqpConnection: AmqpConnection) {}

  /**
   * Every event leaves through here. Publishing is fire-and-forget: the
   * change it reports is already saved, so a broker failure is logged rather
   * than failing (or crashing) whatever made that change.
   */
  private publish(exchange: string, routingKey: string, payload: unknown) {
    publishEvent(this.amqpConnection, exchange, routingKey, payload).catch(
      (error: unknown) =>
        this.logger.error(`publish ${routingKey} failed`, error),
    )
  }

  /** A socket event for these users, via the realtime gateway. */
  private emit(userIds: string[], event: string, data: unknown) {
    const payload: EmitToUserPayload = { userIds, event, data }
    this.publish(
      EXCHANGE_RMQ.REALTIME_EVENTS,
      ROUTING_RMQ.EMIT_REALTIME_EVENT,
      payload,
    )
  }

  /** The same event with a body built for each user. */
  private emitToUsers(
    userIds: string[],
    event: string,
    buildData: (userId: string) => Record<string, unknown>,
  ) {
    for (const userId of userIds) {
      try {
        this.emit([userId], event, buildData(userId))
      } catch (error) {
        this.logger.error(`${event} for ${userId} not sent`, error)
      }
    }
  }

  /** To `memberIds` when given (the creator has it already), else everyone. */
  publishConversationCreated(
    conversation: ConversationWithMembers & { memberIds?: string[] },
  ): void {
    const memberIds =
      conversation.memberIds ??
      conversation.members.map((member) => member.userId)

    this.emitToUsers(
      memberIds,
      SOCKET_EVENTS.CHAT.NEW_CONVERSATION,
      (userId) => ({
        conversation: ConversationMapper.toDetail(conversation, userId),
      }),
    )
  }

  /** `message` is already mapped (see MessageDto): sent on as is. */
  publishMessageSent(normalized: MessageDto, memberIds: string[]): void {
    const senderId = String(normalized.senderId)
    const otherMemberIds = memberIds.filter((id) => id !== senderId)

    // The saved message itself: its id, time and conversation are all on it.
    this.emit([senderId], SOCKET_EVENTS.CHAT.MESSAGE_ACK, {
      clientMessageId: normalized.clientMessageId,
      message: normalized,
    })

    this.emit(otherMemberIds, SOCKET_EVENTS.CHAT.MESSAGE_NEW, {
      message: normalized,
    })
  }

  publishMemberAddedToConversation(
    payload: ConversationWithMembers & {
      actorId: string
      newMemberIds: string[]
    },
  ): void {
    const allMemberIds = payload.members.map((m) => m.userId)
    const newMembers = payload.members.filter((member) =>
      payload.newMemberIds.includes(member.userId),
    )

    this.emit(allMemberIds, SOCKET_EVENTS.CHAT.CONVERSATION_MEMBER_ADDED, {
      conversationId: payload.id,
      actorId: payload.actorId,
      memberIds: payload.newMemberIds,
      members: newMembers,
    })

    this.emitToUsers(
      payload.newMemberIds,
      SOCKET_EVENTS.CHAT.CONVERSATION_UPDATE,
      (userId) => ({
        conversation: ConversationMapper.toDetail(payload, userId, {
          membershipStatus: 'ACTIVE',
          canSendMessage: true,
        }),
      }),
    )
  }

  publishConversationUpdated(conversation: ConversationWithMembers): void {
    const memberIds = conversation.members.map((member) => member.userId)
    this.emitToUsers(
      memberIds,
      SOCKET_EVENTS.CHAT.CONVERSATION_UPDATE,
      (userId) => ({
        conversation: ConversationMapper.toDetail(conversation, userId),
      }),
    )
  }

  publishConversationMemberRemoved(payload: {
    conversation: ConversationWithMembers
    actorId: string
    targetUserId: string
    remainingMemberIds: string[]
  }) {
    const { conversation, actorId, targetUserId, remainingMemberIds } = payload

    this.emit(
      remainingMemberIds,
      SOCKET_EVENTS.CHAT.CONVERSATION_MEMBER_REMOVED,
      {
        conversationId: conversation.id,
        actorId,
        targetUserId,
      },
    )

    this.emitToUsers(
      [targetUserId],
      SOCKET_EVENTS.CHAT.CONVERSATION_UPDATE,
      (userId) => ({
        conversation: ConversationMapper.toDetail(conversation, userId, {
          membershipStatus: 'REMOVED',
          canSendMessage: false,
        }),
      }),
    )
  }

  publishConversationMemberLeft(payload: {
    conversation: ConversationWithMembers
    actorId: string
    remainingMemberIds: string[]
    promotedUserId?: string
  }) {
    const { conversation, actorId, remainingMemberIds, promotedUserId } =
      payload

    this.emit(remainingMemberIds, SOCKET_EVENTS.CHAT.CONVERSATION_MEMBER_LEFT, {
      conversationId: conversation.id,
      actorId,
      promotedUserId,
    })

    this.emitToUsers(
      [actorId],
      SOCKET_EVENTS.CHAT.CONVERSATION_UPDATE,
      (userId) => ({
        conversation: ConversationMapper.toDetail(conversation, userId, {
          membershipStatus: 'LEFT',
          canSendMessage: false,
        }),
      }),
    )
  }

  publishSystemMessage(memberIds: string[], normalized: MessageDto) {
    this.emit(memberIds, SOCKET_EVENTS.CHAT.MESSAGE_SYSTEM, {
      message: normalized,
    })
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
    this.emit([userId], SOCKET_EVENTS.CHAT.MESSAGE_ERROR, payload)
  }

  publishMessageRevoked(
    payload: MessageRevokedPayload,
    userIds: string[],
  ): void {
    this.emit(userIds, SOCKET_EVENTS.CHAT.MESSAGE_REVOKED, payload)
  }

  publishPollUpdated(payload: PollEventPayload, userIds: string[]): void {
    this.emit(userIds, SOCKET_EVENTS.CHAT.POLL_UPDATED, payload)
  }

  publishPollClosed(payload: PollEventPayload, userIds: string[]): void {
    this.emit(userIds, SOCKET_EVENTS.CHAT.POLL_CLOSED, payload)
  }

  publishUserJoinedGroup(payload: UserJoinGroupPayload): void {
    this.publish(
      EXCHANGE_RMQ.USER_EVENTS,
      ROUTING_RMQ.USER_JOINED_GROUP,
      payload,
    )
  }

  publishUserLeftGroup(payload: UserLeftGroupPayload): void {
    this.publish(EXCHANGE_RMQ.USER_EVENTS, ROUTING_RMQ.USER_LEFT_GROUP, payload)
  }

  /**
   * Báo cho notification service biết có người vừa bị nhắc (@) trong tin nhắn,
   * để hiện thông báo — trước đây bị tag mà không mở app thì không hay biết gì.
   */
  publishMentioned(payload: {
    conversationId: string
    messageId: string
    senderId: string
    senderName: string
    userIds: string[]
    preview: string
  }): void {
    if (!payload.userIds.length) return
    this.publish(EXCHANGE_RMQ.CHAT_EVENTS, ROUTING_RMQ.CHAT_MENTION, payload)
  }
}
