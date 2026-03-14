import { AmqpConnection } from '@golevelup/nestjs-rabbitmq'
import { Injectable } from '@nestjs/common'
import { EXCHANGE_RMQ } from 'libs/constant/rmq/exchange'
import type { EmitToUserPayload } from 'libs/constant/rmq/payload'
import { ROUTING_RMQ } from 'libs/constant/rmq/routing'

@Injectable()
export class NotificationEventsPublisher {
  constructor(private readonly amqpConnection: AmqpConnection) {}

  emitToUsers(userIds: string[], event: string, data: any) {
    this.amqpConnection.publish(
      EXCHANGE_RMQ.REALTIME_EVENTS,
      ROUTING_RMQ.EMIT_REALTIME_EVENT,
      {
        userIds,
        event,
        data,
      } as EmitToUserPayload,
    )
  }
}
