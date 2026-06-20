import { RedisService } from '@app/redis'
import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Job } from 'bullmq'

export interface UnreadSyncJobPayload {
  conversationId: string
  senderId: string
  lastMessageAt?: string | Date
  lastMessageText?: string
  lastMessageSenderId?: string
  lastMessageSenderName?: string | null
  lastMessageSenderAvatar?: string | null
}

@Processor('unreadQueue')
export class UnreadProcessor extends WorkerHost {
  constructor(private readonly redisService: RedisService) {
    super()
  }

  async process(job: Job<UnreadSyncJobPayload>): Promise<void> {
    const { conversationId, senderId, ...lastMessageData } = job.data
    if (!conversationId || !senderId) return

    const unreadKey = `unread_count:${conversationId}`
    await this.redisService.hincrby(unreadKey, senderId, 1)

    const lastMessageKey = `last_message:${conversationId}`
    const payloadToSave = JSON.stringify({
      senderId,
      ...lastMessageData,
      lastMessageAt: lastMessageData.lastMessageAt
        ? new Date(lastMessageData.lastMessageAt).toISOString()
        : undefined,
    })

    await this.redisService.set(lastMessageKey, payloadToSave)
  }
}
