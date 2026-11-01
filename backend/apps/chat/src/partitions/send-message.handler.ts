import { HttpException, Injectable, Logger } from '@nestjs/common'
import type { MessageSendPayload } from 'libs/constant/rmq/payload'
import { MessageService } from '../services'
import { ChatEventsPublisher } from '../rmq/publishers/chat-events.publisher'
import { ConversationLanes } from './conversation-lanes'

/** Chờ giữa các lần thử lại một tin lỗi tạm thời (spec §4). */
export const RETRY_DELAYS_MS = [50, 200, 800]

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const isClientError = (error: unknown) =>
  error instanceof HttpException &&
  error.getStatus() >= 400 &&
  error.getStatus() < 500

/**
 * Xử lý một tin gửi lấy từ partition. Kết quả cho consumer: `ack` (đã ghi, hoặc
 * lỗi nghiệp vụ đã báo client) hay `dead-letter` (hết lượt thử lại).
 *
 * Thử lại NGAY TRONG LÀN thay vì publish lại xuống cuối queue: đẩy xuống cuối là
 * để tin sau của cùng hội thoại vượt lên trước. Trong làn, chỉ hội thoại này
 * chờ, tối đa ~1 giây; các hội thoại khác không bị ảnh hưởng.
 *
 * Làn nhả ngay khi tin đã vào lô ghi (`onQueued`): lúc đó id và createdAt đã
 * chốt nên thứ tự đã cố định, tin sau không cần chờ lô này ghi xong. Giữ làn tới
 * lúc ghi xong thì mỗi hội thoại chỉ đi được một tin mỗi chu kỳ flush (~45 tin/s).
 * Lỗi xảy ra SAU khi đã vào lô thì không thử lại ở đây — thử lại sẽ sinh
 * createdAt mới, đứng sau các tin đến sau. BatchWriter tự ghi lại đúng bản cũ.
 */
@Injectable()
export class SendMessageHandler {
  private readonly logger = new Logger(SendMessageHandler.name)

  constructor(
    private readonly messages: MessageService,
    private readonly events: ChatEventsPublisher,
    private readonly lanes: ConversationLanes,
  ) {}

  async handle(payload: MessageSendPayload): Promise<'ack' | 'dead-letter'> {
    let outcome!: Promise<'ack' | 'dead-letter'>
    await this.lanes.run(payload.conversationId, () => {
      let release!: () => void
      const queued = new Promise<void>((resolve) => (release = resolve))
      outcome = this.attempt(payload, release)
      return Promise.race([queued, outcome])
    })
    return outcome
  }

  private async attempt(
    payload: MessageSendPayload,
    release: () => void,
  ): Promise<'ack' | 'dead-letter'> {
    let queued = false
    const onQueued = () => {
      queued = true
      release()
    }
    for (let attempt = 0; ; attempt++) {
      try {
        await this.messages.sendMessage(payload, onQueued)
        return 'ack'
      } catch (error) {
        // 4xx (không còn là thành viên, payload sai...): thử lại vẫn ra đúng lỗi
        // đó. Báo client rồi ack.
        if (isClientError(error)) {
          this.reportError(payload, (error as HttpException).message)
          this.logger.warn(
            `SEND_MESSAGE bị từ chối (${(error as HttpException).getStatus()}) conversation=${payload.conversationId} sender=${payload.senderId}: ${(error as HttpException).message}`,
          )
          return 'ack'
        }
        const delay = queued ? undefined : RETRY_DELAYS_MS[attempt]
        if (delay === undefined) {
          this.logger.error(
            `SEND_MESSAGE hết lượt thử lại conversation=${payload.conversationId} clientMessageId=${payload.clientMessageId}: ${String(error)}`,
          )
          this.reportError(
            payload,
            'Unable to create message. Please retry or upload again.',
          )
          return 'dead-letter'
        }
        await sleep(delay)
      }
    }
  }

  private reportError(payload: MessageSendPayload, message: string) {
    this.events.publishMessageError(payload.senderId, {
      clientMessageId: payload.clientMessageId,
      conversationId: payload.conversationId,
      code: 'MESSAGE_CREATE_FAILED',
      message,
      retryable: true,
    })
  }
}
