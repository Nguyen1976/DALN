import { Module } from '@nestjs/common'
import { UnreadModule } from './unread/unread.module'
import { PurgeModule } from './purge/purge.module'

@Module({
  imports: [UnreadModule, PurgeModule],
})
export class BackgroundJobModule {}
