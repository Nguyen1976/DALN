import { Module } from '@nestjs/common'
import { UnreadModule } from './unread/unread.module'

@Module({
  imports: [UnreadModule],
})
export class BackgroundJobModule {}
