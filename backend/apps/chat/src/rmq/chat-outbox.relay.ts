import { Injectable } from '@nestjs/common'
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq'
import { OutboxRelay } from '@app/saga'
import { PrismaService } from 'apps/chat/prisma/prisma.service'

@Injectable()
export class ChatOutboxRelay extends OutboxRelay {
  constructor(prisma: PrismaService, amqp: AmqpConnection) {
    super(prisma as any, amqp, { name: 'ChatOutboxRelay' })
  }
}
