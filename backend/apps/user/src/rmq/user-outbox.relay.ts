import { Injectable } from '@nestjs/common'
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq'
import { OutboxRelay } from '@app/saga'
import { PrismaService } from 'apps/user/prisma/prisma.service'

@Injectable()
export class UserOutboxRelay extends OutboxRelay {
  constructor(prisma: PrismaService, amqp: AmqpConnection) {
    super(prisma as any, amqp, { name: 'UserOutboxRelay' })
  }
}
