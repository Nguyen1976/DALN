import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq'
import { retryThenDeadLetter } from './retry-then-dead-letter'

type RabbitSubscribeConfig = Parameters<typeof RabbitSubscribe>[0]

export type RabbitSubscribeWithRetryOptions = Omit<
  RabbitSubscribeConfig,
  'queue' | 'errorHandler' | 'errorBehavior'
> & {
  /** Bắt buộc: bản retry được publish lại theo tên queue. */
  queue: string
  /** Ghi đè RMQ_MAX_RETRIES cho riêng handler này. */
  maxRetries?: number
}

/**
 * `@RabbitSubscribe` + `retryThenDeadLetter` gắn sẵn vào đúng `queue`.
 *
 * Dùng thay cho `@RabbitSubscribe` ở MỌI subscriber — có test quét apps/ để chặn
 * `@RabbitSubscribe` trần. Queue vô danh (golevelup tự sinh tên) không có địa
 * chỉ để publish lại bản retry, nên `queue` là bắt buộc.
 */
export function RabbitSubscribeWithRetry(
  options: RabbitSubscribeWithRetryOptions,
) {
  const { maxRetries, ...config } = options
  return RabbitSubscribe({
    ...config,
    errorHandler: retryThenDeadLetter({ queue: config.queue, maxRetries }),
  })
}
