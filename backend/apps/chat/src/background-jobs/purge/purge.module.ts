import { Module } from '@nestjs/common'
import { ConversationPurgeCron } from './conversation-purge.cron'
import { PrismaModule } from '../../../prisma/prisma.module'

@Module({
  imports: [PrismaModule],
  providers: [ConversationPurgeCron],
})
export class PurgeModule {}
