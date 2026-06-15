import { Injectable } from '@nestjs/common'
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq'
import { OutboxRelay } from '@app/saga'
import { PrismaService } from '../../prisma/prisma.service'

@Injectable()
export class NotificationOutboxRelay extends OutboxRelay {
  constructor(prisma: PrismaService, amqp: AmqpConnection) {
    super(prisma as any, amqp, { name: 'NotificationOutboxRelay' })
  }
}
