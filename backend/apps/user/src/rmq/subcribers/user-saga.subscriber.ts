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
import { randomUUID } from 'crypto'
import { EXCHANGE_RMQ } from 'libs/constant/rmq/exchange'
import { ROUTING_RMQ } from 'libs/constant/rmq/routing'
import type { UserFriendshipRevertedPayload } from 'libs/constant/rmq/payload'
import {
  buildReply,
  SAGA_CONSUMER,
  SAGA_QUEUE,
  SAGA_ROUTING,
  type RevertFriendshipCommandPayload,
  type SagaEnvelope,
} from 'libs/constant/rmq/saga'
import { PrismaService } from 'apps/user/prisma/prisma.service'

@Injectable()
export class UserSagaSubscriber {
  private readonly logger = new Logger(UserSagaSubscriber.name)

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  /**
   * Compensation: rollback friendship đã tạo ở bước đồng bộ (HTTP) khi saga thất bại.
   * Xoá 2 bản ghi friendship 2 chiều + đưa friendRequest về PENDING, rồi reply OK.
   */
  @RabbitSubscribeWithRetry({
    exchange: EXCHANGE_RMQ.SAGA_EVENTS,
    routingKey: SAGA_ROUTING.CMP_REVERT_FRIENDSHIP,
    queue: SAGA_QUEUE.USER_REVERT_FRIENDSHIP,
  })
  async revertFriendship(
    envelope: SagaEnvelope<RevertFriendshipCommandPayload>,
    raw?: ConsumeMessage,
  ): Promise<void> {
    assertSupportedVersion(raw, SUPPORTED_SAGA_VERSIONS)
    await consumeIdempotent(
      this.prisma,
      {
        messageId: envelope.messageId,
        consumer: SAGA_CONSUMER.USER_REVERT_FRIENDSHIP,
        sagaId: envelope.sagaId,
      },
      async (tx) => {
        const p = envelope.payload
        await tx.friendship.deleteMany({
          where: {
            OR: [
              { userId: p.inviterId, friendId: p.inviteeId },
              { userId: p.inviteeId, friendId: p.inviterId },
            ],
          },
        })
        await tx.friendRequest.updateMany({
          where: { fromUserId: p.inviterId, toUserId: p.inviteeId },
          data: { status: 'PENDING' },
        })

        // Services holding a copy of the friendship (recommendation's graph)
        // must drop it too; sent from the outbox in this same transaction.
        const reverted: UserFriendshipRevertedPayload = {
          inviterId: p.inviterId,
          inviteeId: p.inviteeId,
        }
        await enqueueOutbox(tx, {
          messageId: randomUUID(),
          exchange: EXCHANGE_RMQ.USER_EVENTS,
          routingKey: ROUTING_RMQ.USER_FRIENDSHIP_REVERTED,
          payload: reverted,
        })

        const reply = buildReply(envelope, 'OK')
        await enqueueOutbox(tx, {
          messageId: reply.messageId,
          exchange: EXCHANGE_RMQ.SAGA_EVENTS,
          routingKey: SAGA_ROUTING.REPLY,
          payload: reply,
        })

        this.logger.log(`Đã revert friendship cho saga ${envelope.sagaId}`)
      },
    )
  }
}
