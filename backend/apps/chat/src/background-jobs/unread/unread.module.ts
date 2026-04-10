import { Module } from '@nestjs/common'
import { UnreadCron } from './unread.cron'
import { UnreadProcessor } from './unread.processor'
import {
  ConversationMemberRepository,
  ConversationRepository,
} from '../../repositories'

@Module({
  providers: [
    ConversationRepository,
    ConversationMemberRepository,
    UnreadCron,
    UnreadProcessor,
  ],
  exports: [UnreadCron, UnreadProcessor], // 👈 bắt buộc nếu module khác dùng
})
export class UnreadModule {}
