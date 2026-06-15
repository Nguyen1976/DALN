import { Inject, Injectable, Logger } from '@nestjs/common'
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq'
import { consumeIdempotent, enqueueOutbox } from '@app/saga'
import { EXCHANGE_RMQ } from 'libs/constant/rmq/exchange'
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
  @RabbitSubscribe({
    exchange: EXCHANGE_RMQ.SAGA_EVENTS,
    routingKey: SAGA_ROUTING.CMP_REVERT_FRIENDSHIP,
    queue: SAGA_QUEUE.USER_REVERT_FRIENDSHIP,
  })
  async revertFriendship(
    envelope: SagaEnvelope<RevertFriendshipCommandPayload>,
  ): Promise<void> {
    await consumeIdempotent(
      this.prisma as any,
      {
        messageId: envelope.messageId,
        consumer: SAGA_CONSUMER.USER_REVERT_FRIENDSHIP,
        sagaId: envelope.sagaId,
      },
      async (tx: any) => {
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
