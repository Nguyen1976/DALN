import { Module } from '@nestjs/common'
import { UnreadCron } from './unread.cron'
import {
  ConversationMemberRepository,
  ConversationRepository,
} from '../../repositories'
import { PrismaModule } from '../../../prisma/prisma.module'

@Module({
  imports: [PrismaModule],
  providers: [ConversationRepository, ConversationMemberRepository, UnreadCron],
  exports: [UnreadCron],
})
export class UnreadModule {}
