import { Injectable } from '@nestjs/common'
import { RabbitSubscribeWithRetry } from '@app/common/rmq'
import { EXCHANGE_RMQ } from 'libs/constant/rmq/exchange'
import { ROUTING_RMQ } from 'libs/constant/rmq/routing'
import { QUEUE_RMQ } from 'libs/constant/rmq/queue'
import { safeExecute } from '@app/common/rpc/safe-execute'
import { UserService } from '../../user.service'

@Injectable()
export class MessageSubscriber {
  constructor(private readonly userService: UserService) {}

  @RabbitSubscribeWithRetry({
    exchange: EXCHANGE_RMQ.REALTIME_EVENTS,
    routingKey: ROUTING_RMQ.USER_ONLINE,
    queue: QUEUE_RMQ.USER_ONLINE,
  })
  async handleUserOnline(data: { userId: string }): Promise<void> {
    await safeExecute(() => this.userService.handleUserOnline(data.userId))
  }

  @RabbitSubscribeWithRetry({
    exchange: EXCHANGE_RMQ.REALTIME_EVENTS,
    routingKey: ROUTING_RMQ.USER_OFFLINE,
    queue: QUEUE_RMQ.USER_OFFLINE,
  })
  async handleUserOffline(data: { userId: string, lastSeen: string }): Promise<void> {
    await safeExecute(() => this.userService.handleUserOffline(data.userId, data.lastSeen))
  }
}
