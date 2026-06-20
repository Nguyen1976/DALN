import { BullModule } from '@nestjs/bullmq'
import { Module } from '@nestjs/common'
import { UnreadCron } from './unread.cron'
import { UnreadProcessor } from './unread.processor'
import {
  ConversationMemberRepository,
  ConversationRepository,
} from '../../repositories'
import { PrismaModule } from '../../../prisma/prisma.module'

@Module({
  imports: [
    PrismaModule,
    BullModule.registerQueue({
      name: 'unreadQueue',
    }),
  ],
  providers: [
    ConversationRepository,
    ConversationMemberRepository,
    UnreadCron,
    UnreadProcessor,
  ],
  exports: [UnreadCron, UnreadProcessor],
})
export class UnreadModule {}
