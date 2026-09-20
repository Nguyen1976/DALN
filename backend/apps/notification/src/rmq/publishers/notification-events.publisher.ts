import { AmqpConnection } from '@golevelup/nestjs-rabbitmq'
import { Injectable, Logger } from '@nestjs/common'
import { publishEvent } from '@app/common/rmq'
import { EXCHANGE_RMQ } from 'libs/constant/rmq/exchange'
import type { EmitToUserPayload } from 'libs/constant/rmq/payload'
import { ROUTING_RMQ } from 'libs/constant/rmq/routing'

@Injectable()
export class NotificationEventsPublisher {
  private readonly logger = new Logger(NotificationEventsPublisher.name)

  constructor(private readonly amqpConnection: AmqpConnection) {}

  /** Fire-and-forget: the notification is already saved either way. */
  emitToUsers(userIds: string[], event: string, data: unknown) {
    const payload: EmitToUserPayload = { userIds, event, data }
    publishEvent(
      this.amqpConnection,
      EXCHANGE_RMQ.REALTIME_EVENTS,
      ROUTING_RMQ.EMIT_REALTIME_EVENT,
      payload,
    ).catch((error: unknown) =>
      this.logger.error(`emit ${event} failed`, error),
    )
  }
}
