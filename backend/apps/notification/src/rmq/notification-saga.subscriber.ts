import { Inject, Injectable, Logger } from '@nestjs/common'
import type { ConsumeMessage } from 'amqplib'
import {
  assertSupportedVersion,
  RabbitSubscribeWithRetry,
} from '@app/common/rmq'
import { RedisService } from '@app/redis'
import {
  consumeIdempotent,
  enqueueOutbox,
  SUPPORTED_SAGA_VERSIONS,
} from '@app/saga'
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
import { NotificationService } from '../notification.service'

@Injectable()
export class NotificationSagaSubscriber {
  private readonly logger = new Logger(NotificationSagaSubscriber.name)

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly eventsPublisher: NotificationEventsPublisher,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * Command từ saga: tạo notification báo "đã chấp nhận kết bạn" cho người mời.
   * Tạo notification + reply OK trong cùng transaction (idempotent theo messageId).
   * Lỗi -> reply FAILED để saga retry/compensate.
   */
  @RabbitSubscribeWithRetry({
    exchange: EXCHANGE_RMQ.SAGA_EVENTS,
    routingKey: SAGA_ROUTING.CMD_NOTIFY_ACCEPTED,
    queue: SAGA_QUEUE.NOTIFICATION_NOTIFY_ACCEPTED,
  })
  async notifyAccepted(
    envelope: SagaEnvelope<NotifyAcceptedCommandPayload>,
    raw?: ConsumeMessage,
  ): Promise<void> {
    // Đặt NGOÀI try: version lạ phải dead-letter, không được biến thành reply
    // FAILED (saga sẽ compensate oan cho một bước nó không hiểu).
    assertSupportedVersion(raw, SUPPORTED_SAGA_VERSIONS)
    const p = envelope.payload
    const message = `Lời mời kết bạn của ${p.inviteeName} đã được chấp nhận.`

    try {
      // Switched off by the inviter: the step still succeeds, with nothing
      // to show.
      const channels = await this.notifications.channelsFor(
        p.inviterId,
        'FRIEND_REQUEST_ACCEPTED',
      )
      const { processed, result } = await consumeIdempotent(
        this.prisma,
        {
          messageId: envelope.messageId,
          consumer: SAGA_CONSUMER.NOTIFICATION_NOTIFY_ACCEPTED,
          sagaId: envelope.sagaId,
        },
        async (tx) => {
          const notification = channels.inApp
            ? await tx.notification.create({
                data: {
                  userId: p.inviterId,
                  message,
                  type: 'FRIEND_REQUEST_ACCEPTED',
                  digestEligible: true,
                },
              })
            : null

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

      if (processed && result && channels.realtime) {
        const online = await this.redisService.isOnline(p.inviterId)
        if (online) {
          this.eventsPublisher.emitToUsers(
            [p.inviterId],
            SOCKET_EVENTS.NOTIFICATION.NEW_NOTIFICATION,
            result,
          )
        }
        this.logger.log(`Saga ${envelope.sagaId}: đã notify accepted`)
      }
    } catch (error) {
      await consumeIdempotent(
        this.prisma,
        {
          messageId: envelope.messageId,
          consumer: SAGA_CONSUMER.NOTIFICATION_NOTIFY_ACCEPTED,
          sagaId: envelope.sagaId,
        },
        async (tx) => {
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
