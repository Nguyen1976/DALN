import { Inject, Injectable, Logger } from '@nestjs/common'
import type { ConsumeMessage } from 'amqplib'
import {
  assertSupportedVersion,
  RabbitSubscribeWithRetry,
} from '@app/common/rmq'
import {
  consumeIdempotent,
  enqueueOutbox,
  SUPPORTED_SAGA_VERSIONS,
} from '@app/saga'
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
import {
  ConversationMemberRepository,
  ConversationRepository,
} from '../../repositories'
import { buildMemberRow } from '../../domain/member-row'

@Injectable()
export class ChatSagaSubscriber {
  private readonly logger = new Logger(ChatSagaSubscriber.name)

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly eventsPublisher: ChatEventsPublisher,
    private readonly memberRepo: ConversationMemberRepository,
    private readonly conversationRepo: ConversationRepository,
  ) {}

  /**
   * Command từ saga: tạo conversation DIRECT cho 2 người bạn vừa accept.
   * Tạo conversation + members + reply OK(conversationId) trong cùng transaction.
   * Lỗi -> reply FAILED để saga chạy compensation (revert friendship).
   */
  @RabbitSubscribeWithRetry({
    exchange: EXCHANGE_RMQ.SAGA_EVENTS,
    routingKey: SAGA_ROUTING.CMD_CREATE_CONVERSATION,
    queue: SAGA_QUEUE.CHAT_CREATE_CONVERSATION,
  })
  async createConversation(
    envelope: SagaEnvelope<CreateConversationCommandPayload>,
    raw?: ConsumeMessage,
  ): Promise<void> {
    // Đặt NGOÀI try: version lạ phải dead-letter, không được biến thành reply
    // FAILED (saga sẽ compensate oan cho một bước nó không hiểu).
    assertSupportedVersion(raw, SUPPORTED_SAGA_VERSIONS)
    try {
      const { processed, result } = await consumeIdempotent(
        this.prisma,
        {
          messageId: envelope.messageId,
          consumer: SAGA_CONSUMER.CHAT_CREATE_CONVERSATION,
          sagaId: envelope.sagaId,
        },
        async (tx) => {
          const members = envelope.payload.members ?? []
          const uniqueMembers = Array.from(
            new Map(members.map((m) => [m.userId, m])).values(),
          )

          const conversation = await tx.conversation.create({
            data: { type: 'DIRECT', memberCount: uniqueMembers.length },
          })

          await tx.conversationMember.createMany({
            data: uniqueMembers.map((m) =>
              buildMemberRow(conversation.id, m, {
                type: 'DIRECT',
                members: uniqueMembers,
              }),
            ),
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

          return conversation.id
        },
      )

      // Best-effort realtime "new conversation" (chỉ phát khi xử lý lần đầu).
      if (processed && result) {
        // The stored conversation, members included: each side's copy names
        // the other, with real timestamps.
        const conversation =
          await this.conversationRepo.findByIdWithMembers(result)
        if (conversation) {
          this.eventsPublisher.publishConversationCreated(conversation)
        }
        this.logger.log(`Saga ${envelope.sagaId}: đã tạo conversation ${result}`)
      }
    } catch (error) {
      await this.replyFailed(envelope, (error as Error)?.message)
    }
  }

  /**
   * Compensation: xoá conversation đã tạo (khi bước sau của saga thất bại).
   */
  @RabbitSubscribeWithRetry({
    exchange: EXCHANGE_RMQ.SAGA_EVENTS,
    routingKey: SAGA_ROUTING.CMP_DELETE_CONVERSATION,
    queue: SAGA_QUEUE.CHAT_DELETE_CONVERSATION,
  })
  async deleteConversation(
    envelope: SagaEnvelope<DeleteConversationCommandPayload>,
    raw?: ConsumeMessage,
  ): Promise<void> {
    assertSupportedVersion(raw, SUPPORTED_SAGA_VERSIONS)
    await consumeIdempotent(
      this.prisma,
      {
        messageId: envelope.messageId,
        consumer: SAGA_CONSUMER.CHAT_DELETE_CONVERSATION,
        sagaId: envelope.sagaId,
      },
      async (tx) => {
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
      this.prisma,
      {
        messageId: envelope.messageId,
        consumer: SAGA_CONSUMER.CHAT_CREATE_CONVERSATION,
        sagaId: envelope.sagaId,
      },
      async (tx) => {
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
