import { Inject, Injectable, Logger } from '@nestjs/common'
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq'
import { RedisService } from '@app/redis'
import { consumeIdempotent, enqueueOutbox } from '@app/saga'
import { EXCHANGE_RMQ } from 'libs/constant/rmq/exchange'
import { SOCKET_EVENTS } from 'libs/constant/websocket/socket.events'
import {
  buildReply,
  SAGA_CONSUMER,
  SAGA_QUEUE,
  SAGA_ROUTING,
  type NotifyAcceptedCommandPayload,
  type SagaEnvelope,
} from 'libs/constant/rmq/saga'
import { PrismaService } from '../../prisma/prisma.service'
import { NotificationEventsPublisher } from './publishers/notification-events.publisher'

@Injectable()
export class NotificationSagaSubscriber {
  private readonly logger = new Logger(NotificationSagaSubscriber.name)

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly eventsPublisher: NotificationEventsPublisher,
  ) {}

  /**
   * Command từ saga: tạo notification báo "đã chấp nhận kết bạn" cho người mời.
   * Tạo notification + reply OK trong cùng transaction (idempotent theo messageId).
   * Lỗi -> reply FAILED để saga retry/compensate.
   */
  @RabbitSubscribe({
    exchange: EXCHANGE_RMQ.SAGA_EVENTS,
    routingKey: SAGA_ROUTING.CMD_NOTIFY_ACCEPTED,
    queue: SAGA_QUEUE.NOTIFICATION_NOTIFY_ACCEPTED,
  })
  async notifyAccepted(
    envelope: SagaEnvelope<NotifyAcceptedCommandPayload>,
  ): Promise<void> {
    const p = envelope.payload
    const message = `Lời mời kết bạn của ${p.inviteeName} đã được chấp nhận.`

    try {
      const { processed, result } = await consumeIdempotent(
        this.prisma as any,
        {
          messageId: envelope.messageId,
          consumer: SAGA_CONSUMER.NOTIFICATION_NOTIFY_ACCEPTED,
          sagaId: envelope.sagaId,
        },
        async (tx: any) => {
          const notification = await tx.notification.create({
            data: {
              userId: p.inviterId,
              message,
              type: 'FRIEND_REQUEST_ACCEPTED',
              digestEligible: true,
            },
          })

          const reply = buildReply(envelope, 'OK')
          await enqueueOutbox(tx, {
            messageId: reply.messageId,
            exchange: EXCHANGE_RMQ.SAGA_EVENTS,
            routingKey: SAGA_ROUTING.REPLY,
            payload: reply,
          })
          return notification
        },
      )

      if (processed && result) {
        const online = await this.redisService.isOnline(p.inviterId)
        if (online) {
          this.eventsPublisher.emitToUsers(
            [p.inviterId],
            SOCKET_EVENTS.NOTIFICATION.NEW_NOTIFICATION,
            { ...result, createdAt: result.createdAt?.toString?.() },
          )
        }
        this.logger.log(`Saga ${envelope.sagaId}: đã notify accepted`)
      }
    } catch (error) {
      await consumeIdempotent(
        this.prisma as any,
        {
          messageId: envelope.messageId,
          consumer: SAGA_CONSUMER.NOTIFICATION_NOTIFY_ACCEPTED,
          sagaId: envelope.sagaId,
        },
        async (tx: any) => {
          const reply = buildReply(
            envelope,
            'FAILED',
            {},
            (error as Error)?.message,
          )
          await enqueueOutbox(tx, {
            messageId: reply.messageId,
            exchange: EXCHANGE_RMQ.SAGA_EVENTS,
            routingKey: SAGA_ROUTING.REPLY,
            payload: reply,
          })
        },
      )
      this.logger.warn(
        `Saga ${envelope.sagaId}: notifyAccepted FAILED: ${
          (error as Error)?.message
        }`,
      )
    }
  }
}
