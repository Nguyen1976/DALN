import { Inject, Injectable, Logger } from '@nestjs/common'
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq'
import { consumeIdempotent, enqueueOutbox } from '@app/saga'
import { EXCHANGE_RMQ } from 'libs/constant/rmq/exchange'
import {
  buildReply,
  SAGA_CONSUMER,
  SAGA_QUEUE,
  SAGA_ROUTING,
  type CreateConversationCommandPayload,
  type DeleteConversationCommandPayload,
  type SagaEnvelope,
} from 'libs/constant/rmq/saga'
import { PrismaService } from 'apps/chat/prisma/prisma.service'
import { ChatEventsPublisher } from '../publishers/chat-events.publisher'
import { ConversationMemberRepository } from '../../repositories'
import { buildPeerFields } from '../../domain/peer-fields'

@Injectable()
export class ChatSagaSubscriber {
  private readonly logger = new Logger(ChatSagaSubscriber.name)

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly eventsPublisher: ChatEventsPublisher,
    private readonly memberRepo: ConversationMemberRepository,
  ) {}

  /**
   * Command từ saga: tạo conversation DIRECT cho 2 người bạn vừa accept.
   * Tạo conversation + members + reply OK(conversationId) trong cùng transaction.
   * Lỗi -> reply FAILED để saga chạy compensation (revert friendship).
   */
  @RabbitSubscribe({
    exchange: EXCHANGE_RMQ.SAGA_EVENTS,
    routingKey: SAGA_ROUTING.CMD_CREATE_CONVERSATION,
    queue: SAGA_QUEUE.CHAT_CREATE_CONVERSATION,
  })
  async createConversation(
    envelope: SagaEnvelope<CreateConversationCommandPayload>,
  ): Promise<void> {
    try {
      const { processed, result } = await consumeIdempotent(
        this.prisma as any,
        {
          messageId: envelope.messageId,
          consumer: SAGA_CONSUMER.CHAT_CREATE_CONVERSATION,
          sagaId: envelope.sagaId,
        },
        async (tx: any) => {
          const members = envelope.payload.members ?? []
          const uniqueMembers = Array.from(
            new Map(members.map((m) => [m.userId, m])).values(),
          )

          const conversation = await tx.conversation.create({
            data: { type: 'DIRECT', memberCount: uniqueMembers.length },
          })

          await tx.conversationMember.createMany({
            data: uniqueMembers.map((m) => ({
              conversationId: conversation.id,
              userId: m.userId,
              username: m.username || null,
              fullName: m.fullName || null,
              avatar: m.avatar || null,
              role: 'MEMBER',
              isActive: true,
              unreadCount: 0,
              lastMessageAt: new Date(),
              // Phi chuẩn hoá đối phương -> danh sách hội thoại không cần
              // include toàn bộ members để hiển thị tên/avatar.
              ...buildPeerFields('DIRECT', m.userId, uniqueMembers),
            })),
          })

          const reply = buildReply(envelope, 'OK', {
            conversationId: conversation.id,
          })
          await enqueueOutbox(tx, {
            messageId: reply.messageId,
            exchange: EXCHANGE_RMQ.SAGA_EVENTS,
            routingKey: SAGA_ROUTING.REPLY,
            payload: reply,
          })

          return {
            conversationId: conversation.id,
            memberIds: uniqueMembers.map((m) => m.userId),
            members: uniqueMembers,
          }
        },
      )

      // Best-effort realtime "new conversation" (chỉ phát khi xử lý lần đầu).
      if (processed && result) {
        // `members` là BẮT BUỘC: ConversationMapper.resolveDisplay lấy tên +
        // avatar đối phương từ mảng này. Thiếu nó, giao diện rơi về chuỗi dự
        // phòng "Trò chuyện trực tiếp" ngay khi hội thoại vừa hiện ra, và chỉ
        // đúng lại sau khi tải lại trang (đường HTTP đọc members từ DB).
        this.eventsPublisher.publishConversationCreated({
          id: result.conversationId,
          type: 'DIRECT',
          memberIds: result.memberIds,
          members: result.members,
          memberCount: result.members.length,
        })
        this.logger.log(
          `Saga ${envelope.sagaId}: đã tạo conversation ${result.conversationId}`,
        )
      }
    } catch (error) {
      await this.replyFailed(envelope, (error as Error)?.message)
    }
  }

  /**
   * Compensation: xoá conversation đã tạo (khi bước sau của saga thất bại).
   */
  @RabbitSubscribe({
    exchange: EXCHANGE_RMQ.SAGA_EVENTS,
    routingKey: SAGA_ROUTING.CMP_DELETE_CONVERSATION,
    queue: SAGA_QUEUE.CHAT_DELETE_CONVERSATION,
  })
  async deleteConversation(
    envelope: SagaEnvelope<DeleteConversationCommandPayload>,
  ): Promise<void> {
    await consumeIdempotent(
      this.prisma as any,
      {
        messageId: envelope.messageId,
        consumer: SAGA_CONSUMER.CHAT_DELETE_CONVERSATION,
        sagaId: envelope.sagaId,
      },
      async (tx: any) => {
        const conversationId = envelope.payload.conversationId
        await tx.message.deleteMany({ where: { conversationId } })
        await tx.conversationMember.deleteMany({ where: { conversationId } })
        await tx.conversation.deleteMany({ where: { id: conversationId } })

        const reply = buildReply(envelope, 'OK')
        await enqueueOutbox(tx, {
          messageId: reply.messageId,
          exchange: EXCHANGE_RMQ.SAGA_EVENTS,
          routingKey: SAGA_ROUTING.REPLY,
          payload: reply,
        })
        this.logger.log(
          `Saga ${envelope.sagaId}: đã xoá conversation ${conversationId}`,
        )
      },
    )

    await this.memberRepo.invalidateMembersCache(
      envelope.payload.conversationId,
    )
  }

  private async replyFailed(
    envelope: SagaEnvelope,
    error?: string,
  ): Promise<void> {
    await consumeIdempotent(
      this.prisma as any,
      {
        messageId: envelope.messageId,
        consumer: SAGA_CONSUMER.CHAT_CREATE_CONVERSATION,
        sagaId: envelope.sagaId,
      },
      async (tx: any) => {
        const reply = buildReply(envelope, 'FAILED', {}, error)
        await enqueueOutbox(tx, {
          messageId: reply.messageId,
          exchange: EXCHANGE_RMQ.SAGA_EVENTS,
          routingKey: SAGA_ROUTING.REPLY,
          payload: reply,
        })
      },
    )
    this.logger.warn(`Saga ${envelope.sagaId}: createConversation FAILED: ${error}`)
  }
}
