import { Injectable, Logger } from '@nestjs/common'
import { v4 as uuid } from 'uuid'
import { consumeIdempotent, enqueueOutbox } from '@app/saga'
import { EXCHANGE_RMQ } from 'libs/constant/rmq/exchange'
import {
  SAGA_CONSUMER,
  SAGA_ROUTING,
  SAGA_STEP,
  SAGA_TYPE,
  type CreateConversationCommandPayload,
  type CreateConversationReplyPayload,
  type DeleteConversationCommandPayload,
  type FriendshipAcceptTriggerPayload,
  type NotifyAcceptedCommandPayload,
  type RevertFriendshipCommandPayload,
  type SagaEnvelope,
  type SagaMember,
  type SagaStep,
} from 'libs/constant/rmq/saga'
import { PrismaService } from '../prisma/prisma.service'

const MAX_NOTIFY_ATTEMPTS = 3

@Injectable()
export class FriendshipAcceptSaga {
  private readonly logger = new Logger(FriendshipAcceptSaga.name)

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Nhận trigger từ User service: khởi tạo state machine và phát command đầu tiên
   * (tạo conversation). Toàn bộ nằm trong 1 transaction idempotent.
   */
  async handleTrigger(
    envelope: SagaEnvelope<FriendshipAcceptTriggerPayload>,
  ): Promise<void> {
    const { processed } = await consumeIdempotent(
      this.prisma as any,
      {
        messageId: envelope.messageId,
        consumer: SAGA_CONSUMER.ORCHESTRATOR_TRIGGER,
        sagaId: envelope.sagaId,
      },
      async (tx) => {
        const payload = envelope.payload
        const sagaModel = (tx as any).friendshipAcceptSaga

        const existing = await sagaModel.findUnique({
          where: { sagaId: envelope.sagaId },
        })
        // Trigger trùng (saga đã tồn tại) -> không tạo lại, không phát command lại.
        if (existing) return

        await sagaModel.create({
          data: {
            sagaId: envelope.sagaId,
            state: 'STARTED',
            inviterId: payload.inviterId,
            inviteeId: payload.inviteeId,
            inviteeName: payload.inviteeName,
            friendRequestId: payload.friendRequestId,
            members: payload.members as object,
            correlationId: envelope.correlationId ?? null,
          },
        })

        await this.enqueueCreateConversation(
          tx,
          envelope.sagaId,
          payload.inviterId,
          payload.inviteeId,
          payload.members,
          envelope.correlationId,
        )
      },
    )

    if (!processed) {
      this.logger.debug(`Trigger trùng đã bỏ qua: ${envelope.sagaId}`)
    }
  }

  /**
   * Nhận reply từ các participant -> chuyển trạng thái / phát bước tiếp theo /
   * chạy compensation. Idempotent theo messageId của reply.
   */
  async handleReply(envelope: SagaEnvelope): Promise<void> {
    await consumeIdempotent(
      this.prisma as any,
      {
        messageId: envelope.messageId,
        consumer: SAGA_CONSUMER.ORCHESTRATOR_REPLY,
        sagaId: envelope.sagaId,
      },
      async (tx) => {
        const sagaModel = (tx as any).friendshipAcceptSaga
        const saga = await sagaModel.findUnique({
          where: { sagaId: envelope.sagaId },
        })
        if (!saga) {
          this.logger.warn(`Reply cho saga không tồn tại: ${envelope.sagaId}`)
          return
        }
        // Saga đã kết thúc -> bỏ qua reply muộn.
        if (['COMPLETED', 'COMPENSATED', 'FAILED'].includes(saga.state)) {
          return
        }

        const ok = envelope.status === 'OK'

        switch (envelope.step as SagaStep) {
          case SAGA_STEP.CREATE_CONVERSATION:
            await this.onCreateConversationReply(tx, saga, envelope, ok)
            break
          case SAGA_STEP.NOTIFY_ACCEPTED:
            await this.onNotifyReply(tx, saga, envelope, ok)
            break
          case SAGA_STEP.DELETE_CONVERSATION:
            // Đã xoá conversation -> tiếp tục revert friendship.
            await this.enqueueRevertFriendship(tx, saga, envelope.correlationId)
            break
          case SAGA_STEP.REVERT_FRIENDSHIP:
            await sagaModel.update({
              where: { sagaId: saga.sagaId },
              data: { state: 'COMPENSATED' },
            })
            break
          default:
            this.logger.warn(`Reply step lạ: ${envelope.step}`)
        }
      },
    )
  }

  private async onCreateConversationReply(
    tx: any,
    saga: any,
    envelope: SagaEnvelope,
    ok: boolean,
  ): Promise<void> {
    const sagaModel = tx.friendshipAcceptSaga
    if (ok) {
      const payload = envelope.payload as CreateConversationReplyPayload
      await sagaModel.update({
        where: { sagaId: saga.sagaId },
        data: {
          state: 'CONVERSATION_CREATED',
          conversationId: payload?.conversationId ?? null,
        },
      })
      await this.enqueueNotify(tx, saga, envelope.correlationId)
    } else {
      // Bước critical thất bại -> rollback friendship đã tạo ở User.
      await sagaModel.update({
        where: { sagaId: saga.sagaId },
        data: { state: 'COMPENSATING', lastError: envelope.error ?? null },
      })
      await this.enqueueRevertFriendship(tx, saga, envelope.correlationId)
    }
  }

  private async onNotifyReply(
    tx: any,
    saga: any,
    envelope: SagaEnvelope,
    ok: boolean,
  ): Promise<void> {
    const sagaModel = tx.friendshipAcceptSaga
    if (ok) {
      await sagaModel.update({
        where: { sagaId: saga.sagaId },
        data: { state: 'COMPLETED' },
      })
      return
    }

    const attempts = (saga.notifyAttempts ?? 0) + 1
    if (attempts < MAX_NOTIFY_ATTEMPTS) {
      // Non-critical: thử lại notify thay vì rollback ngay.
      await sagaModel.update({
        where: { sagaId: saga.sagaId },
        data: { notifyAttempts: attempts, lastError: envelope.error ?? null },
      })
      await this.enqueueNotify(tx, saga, envelope.correlationId)
      return
    }

    // Hết lượt thử -> rollback: xoá conversation rồi revert friendship.
    await sagaModel.update({
      where: { sagaId: saga.sagaId },
      data: {
        state: 'COMPENSATING',
        notifyAttempts: attempts,
        lastError: envelope.error ?? null,
      },
    })
    if (saga.conversationId) {
      await this.enqueueDeleteConversation(tx, saga, envelope.correlationId)
    } else {
      await this.enqueueRevertFriendship(tx, saga, envelope.correlationId)
    }
  }

  // ---- helpers phát command/compensation qua outbox ----

  private async enqueueCreateConversation(
    tx: any,
    sagaId: string,
    inviterId: string,
    inviteeId: string,
    members: SagaMember[],
    correlationId?: string,
  ): Promise<void> {
    const payload: CreateConversationCommandPayload = {
      inviterId,
      inviteeId,
      members,
    }
    await this.dispatch(
      tx,
      sagaId,
      SAGA_ROUTING.CMD_CREATE_CONVERSATION,
      SAGA_STEP.CREATE_CONVERSATION,
      'COMMAND',
      payload,
      correlationId,
    )
  }

  private async enqueueNotify(
    tx: any,
    saga: any,
    correlationId?: string,
  ): Promise<void> {
    const payload: NotifyAcceptedCommandPayload = {
      inviterId: saga.inviterId,
      inviteeId: saga.inviteeId,
      inviteeName: saga.inviteeName,
    }
    await this.dispatch(
      tx,
      saga.sagaId,
      SAGA_ROUTING.CMD_NOTIFY_ACCEPTED,
      SAGA_STEP.NOTIFY_ACCEPTED,
      'COMMAND',
      payload,
      correlationId,
    )
  }

  private async enqueueDeleteConversation(
    tx: any,
    saga: any,
    correlationId?: string,
  ): Promise<void> {
    const payload: DeleteConversationCommandPayload = {
      conversationId: saga.conversationId,
    }
    await this.dispatch(
      tx,
      saga.sagaId,
      SAGA_ROUTING.CMP_DELETE_CONVERSATION,
      SAGA_STEP.DELETE_CONVERSATION,
      'COMPENSATE',
      payload,
      correlationId,
    )
  }

  private async enqueueRevertFriendship(
    tx: any,
    saga: any,
    correlationId?: string,
  ): Promise<void> {
    const payload: RevertFriendshipCommandPayload = {
      inviterId: saga.inviterId,
      inviteeId: saga.inviteeId,
      friendRequestId: saga.friendRequestId,
    }
    await this.dispatch(
      tx,
      saga.sagaId,
      SAGA_ROUTING.CMP_REVERT_FRIENDSHIP,
      SAGA_STEP.REVERT_FRIENDSHIP,
      'COMPENSATE',
      payload,
      correlationId,
    )
  }

  /**
   * Tạo envelope và ghi vào outbox trong cùng transaction. messageId dùng chung
   * cho cả outbox row lẫn envelope để consumer dedupe đúng khi relay publish lặp.
   */
  private async dispatch(
    tx: any,
    sagaId: string,
    routingKey: string,
    step: SagaStep,
    kind: 'COMMAND' | 'COMPENSATE',
    payload: unknown,
    correlationId?: string,
  ): Promise<void> {
    const envelope: SagaEnvelope = {
      messageId: uuid(),
      sagaId,
      sagaType: SAGA_TYPE.FRIENDSHIP_ACCEPT,
      step,
      kind,
      payload,
      correlationId,
      occurredAt: new Date().toISOString(),
    }
    await enqueueOutbox(tx, {
      messageId: envelope.messageId,
      exchange: EXCHANGE_RMQ.SAGA_EVENTS,
      routingKey,
      payload: envelope,
    })
  }
}
