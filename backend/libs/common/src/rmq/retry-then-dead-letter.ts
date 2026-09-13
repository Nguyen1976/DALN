import { Logger, type LoggerService } from '@nestjs/common'
import type { MessageErrorHandler } from '@golevelup/nestjs-rabbitmq'
import type { Channel, ConfirmChannel, ConsumeMessage, Options } from 'amqplib'
import { headerToNumber, headerToText } from './amqp-headers'
import { EVENT_TYPE_HEADER, EVENT_VERSION_HEADER } from './event-version'
import { isNonRetryableError } from './non-retryable.error'

/**
 * Error handler cho subscriber: retry có giới hạn, hết lượt thì dead-letter.
 *
 * Bối cảnh: mặc định golevelup là REQUEUE — handler ném lỗi vĩnh viễn thì
 * message quay lại queue và lặp vô hạn (sự cố 2026-09-12: SEND_MESSAGE ~280
 * lỗi/s). Còn ACK khi lỗi thì mất message trong im lặng. Ở giữa:
 *
 *  - Lỗi thường, `x-retry-count` < maxRetries: publish lại NGUYÊN content +
 *    properties vào ĐÚNG queue đang consume (default exchange, routingKey = tên
 *    queue — không fan-out sang queue của service khác cùng bind routing key),
 *    tăng `x-retry-count`, CHỜ broker confirm rồi mới ack bản gốc. Republish
 *    lỗi thì rơi xuống nhánh dead-letter: không bao giờ ack khi chưa chắc bản
 *    retry đã nằm trong queue.
 *  - Hết lượt, hoặc NonRetryableError: log rồi `nack(msg, false, false)`. Policy
 *    `daln-dlx` gắn `dead-letter-exchange = daln.dlx` cho mọi queue, nên message
 *    sang fanout `daln.dlx` -> queue `daln.dead-letters` để xem / replay. Chưa
 *    có policy thì broker BỎ message — hạ tầng phải lên trước hoặc cùng lúc.
 *
 * Replay từ `daln.dead-letters`: publish lại vào default exchange với
 * routingKey = `x-death[0].queue` (queue gốc), bỏ header `x-retry-count` để có
 * lại đủ lượt retry.
 *
 * Retry chạy ngay, không backoff: bản retry xếp cuối queue. Đủ cho lỗi thoáng
 * qua cỡ mili-giây (write conflict, transaction P2034...), không đủ cho sự cố DB
 * kéo dài — khi đó message nằm ở dead-letter chờ replay.
 *
 * Không bao giờ ném lỗi: golevelup `await` handler này bên trong consumer.
 */

export const RETRY_COUNT_HEADER = 'x-retry-count'
/** Routing key lúc publish gốc — lần retry đầu ghi lại vì routingKey đã thành tên queue. */
export const ORIGINAL_ROUTING_KEY_HEADER = 'x-original-routing-key'
export const DEFAULT_MAX_RETRIES = 3

/** Chờ broker confirm bản retry tối đa bấy lâu, quá thì coi như thất bại. */
const REPUBLISH_CONFIRM_TIMEOUT_MS = 10_000

export interface RetryThenDeadLetterOptions {
  /** Queue handler đang consume — bản retry được publish lại đúng queue này. */
  queue: string
  /**
   * Số lần retry, KHÔNG tính lần giao đầu (3 -> tối đa 4 lần xử lý). Mặc định
   * env RMQ_MAX_RETRIES hoặc 3 — đọc lúc xảy ra lỗi chứ không phải lúc
   * decorator chạy, để .env nạp muộn vẫn có hiệu lực.
   */
  maxRetries?: number
  logger?: Pick<LoggerService, 'warn' | 'error'>
}

/**
 * Các property AMQP được chép sang bản retry. amqplib khai báo chúng là `any`;
 * view này ghi rõ kiểu và cũng là danh sách những gì được giữ lại.
 */
interface CopiedProperties {
  contentType?: string
  contentEncoding?: string
  headers?: Record<string, unknown>
  deliveryMode?: number
  priority?: number
  correlationId?: string
  replyTo?: string
  expiration?: string
  messageId?: string
  timestamp?: number
  type?: string
  appId?: string
}

export function resolveMaxRetries(explicit?: number): number {
  const fromEnv = process.env.RMQ_MAX_RETRIES
  const value =
    explicit ??
    (fromEnv === undefined || fromEnv.trim() === ''
      ? DEFAULT_MAX_RETRIES
      : Number(fromEnv))
  return Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : DEFAULT_MAX_RETRIES
}

export function readRetryCount(msg: ConsumeMessage): number {
  const raw = headersOf(msg)[RETRY_COUNT_HEADER]
  const count = raw === undefined || raw === null ? 0 : headerToNumber(raw)
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0
}

export function retryThenDeadLetter(
  options: RetryThenDeadLetterOptions,
): MessageErrorHandler {
  const logger = options.logger ?? new Logger('RmqRetryThenDeadLetter')

  return async (channel, msg, error: unknown) => {
    try {
      const maxRetries = resolveMaxRetries(options.maxRetries)
      const retryCount = readRetryCount(msg)
      const nonRetryable = isNonRetryableError(error)

      if (!nonRetryable && retryCount < maxRetries) {
        const next = retryCount + 1
        if (await republish(channel, msg, options.queue, next)) {
          channel.ack(msg)
          logger.warn(
            `Retry ${next}/${maxRetries} ${describe(options.queue, msg)}: ${errorMessage(error)}`,
          )
          return
        }
        logger.error(
          `Không republish được bản retry ${describe(options.queue, msg)} -> dead-letter`,
        )
      }

      const reason = nonRetryable
        ? 'non-retryable'
        : `hết ${maxRetries} lần retry`
      logger.error(
        `Dead-letter ${describe(options.queue, msg)} (${reason}): ${errorMessage(error)}`,
        (error as Error | undefined)?.stack,
      )
      channel.nack(msg, false, false)
    } catch (handlerError) {
      // Channel đã đóng thì ack/nack cũng ném; broker sẽ tự giao lại message
      // chưa ack. Tuyệt đối không ném tiếp ra consumer của golevelup.
      try {
        logger.error(
          `retryThenDeadLetter lỗi ở queue ${options.queue}: ${errorMessage(handlerError)}`,
        )
      } catch {
        /* không còn gì để làm */
      }
    }
  }
}

function republish(
  channel: Channel,
  msg: ConsumeMessage,
  queue: string,
  retryCount: number,
): Promise<boolean> {
  const props = msg.properties as CopiedProperties
  const headers: Record<string, unknown> = {
    ...headersOf(msg),
    [RETRY_COUNT_HEADER]: retryCount,
  }
  if (headers[ORIGINAL_ROUTING_KEY_HEADER] === undefined) {
    headers[ORIGINAL_ROUTING_KEY_HEADER] = msg.fields.routingKey
  }

  const publishOptions: Options.Publish = {
    contentType: props.contentType,
    contentEncoding: props.contentEncoding,
    headers,
    deliveryMode: props.deliveryMode,
    priority: props.priority,
    correlationId: props.correlationId,
    replyTo: props.replyTo,
    expiration: props.expiration,
    messageId: props.messageId,
    timestamp: props.timestamp,
    type: props.type,
    appId: props.appId,
    // Cố ý bỏ userId: broker bắt user-id phải trùng user của kết nối, copy từ
    // message gốc có thể khiến broker đóng luôn channel.
  }

  return new Promise<boolean>((resolve) => {
    let settled = false
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(ok)
    }
    const timer = setTimeout(() => finish(false), REPUBLISH_CONFIRM_TIMEOUT_MS)
    timer.unref()

    try {
      if (isConfirmChannel(channel)) {
        // golevelup consume trên ConfirmChannel: callback nhận null khi broker
        // ack, lỗi khi broker nack hoặc channel đóng.
        channel.publish('', queue, msg.content, publishOptions, (err) =>
          finish(!err),
        )
      } else {
        channel.publish('', queue, msg.content, publishOptions)
        finish(true)
      }
    } catch {
      finish(false)
    }
  })
}

function isConfirmChannel(channel: Channel): channel is ConfirmChannel {
  return (
    typeof (channel as Partial<ConfirmChannel>).waitForConfirms === 'function'
  )
}

function headersOf(msg: ConsumeMessage): Record<string, unknown> {
  return (msg.properties as CopiedProperties | undefined)?.headers ?? {}
}

function describe(queue: string, msg: ConsumeMessage): string {
  const headers = headersOf(msg)
  const routingKey =
    headers[ORIGINAL_ROUTING_KEY_HEADER] ?? msg.fields?.routingKey
  const messageId = (msg.properties as CopiedProperties | undefined)?.messageId
  return (
    `[queue=${queue} routingKey=${headerToText(routingKey)} ` +
    `messageId=${messageId ?? '-'} ` +
    `eventType=${headerToText(headers[EVENT_TYPE_HEADER])} ` +
    `version=${headerToText(headers[EVENT_VERSION_HEADER])}]`
  )
}

function errorMessage(error: unknown): string {
  return (error as Error | undefined)?.message ?? String(error)
}
