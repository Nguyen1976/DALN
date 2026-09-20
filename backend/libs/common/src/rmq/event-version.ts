import { randomUUID } from 'crypto'
import type { Options } from 'amqplib'
import { headerToNumber, headerToText } from './amqp-headers'
import { NonRetryableError } from './non-retryable.error'

/**
 * Version hoá event RabbitMQ — metadata nằm ở HEADER AMQP, body giữ nguyên.
 *
 * Vì sao header chứ không bọc payload: consumer hiện tại đọc thẳng body; bọc
 * thành { version, data } là breaking change cho mọi consumer cùng lúc. Header
 * thì consumer cũ bỏ qua được, consumer mới đọc khi cần.
 *
 * Quy ước:
 *  - Thêm field tuỳ chọn (additive) -> GIỮ version. Consumer phải chịu được
 *    field lạ và thiếu field mới (tolerant reader).
 *  - Đổi nghĩa / đổi kiểu / bỏ field -> TĂNG version. Triển khai consumer hỗ
 *    trợ cả [cũ, mới] TRƯỚC, rồi mới cho publisher phát version mới.
 *  - Message không có header (publish trước khi có cơ chế này, hoặc từ tool
 *    ngoài) được coi là version 1.
 *
 * Phía consumer, handler nào cần chắc chắn hiểu đúng payload thì gọi
 * `assertSupportedVersion(raw, [1])`, với `raw` là tham số thứ 2 golevelup
 * truyền vào handler (ConsumeMessage). Version lạ -> NonRetryableError ->
 * `retryThenDeadLetter` đẩy thẳng sang dead-letter thay vì xử lý sai.
 */

/** Header AMQP mang version schema của payload (số nguyên >= 1). */
export const EVENT_VERSION_HEADER = 'x-event-version'
/** Header AMQP mang loại event (= routing key lúc publish). */
export const EVENT_TYPE_HEADER = 'x-event-type'
/** Version của message không có header. */
export const DEFAULT_EVENT_VERSION = 1

/** Chỉ cần hàm publish của AmqpConnection — dễ stub trong test. */
export interface AmqpPublisher {
  publish(
    exchange: string,
    routingKey: string,
    message: unknown,
    options?: Options.Publish,
  ): Promise<boolean>
}

export interface PublishEventOptions {
  /** Version schema của payload. Mặc định 1. */
  version?: number
  /** AMQP messageId. Mặc định sinh UUID để lần theo được trong log/dead-letter. */
  messageId?: string
}

/**
 * Publish event kèm header `x-event-version` + `x-event-type`, `persistent`.
 * Body gửi đi y như trước (non-breaking), và trả về đúng promise của
 * `amqp.publish` — chỗ nào trước đây await thì vẫn await, chỗ nào fire-and-forget
 * vẫn vậy.
 */
export function publishEvent(
  amqp: AmqpPublisher,
  exchange: string,
  routingKey: string,
  payload: unknown,
  {
    version = DEFAULT_EVENT_VERSION,
    messageId = randomUUID(),
  }: PublishEventOptions = {},
): Promise<boolean> {
  return amqp.publish(exchange, routingKey, payload, {
    persistent: true,
    messageId,
    headers: {
      [EVENT_VERSION_HEADER]: version,
      [EVENT_TYPE_HEADER]: routingKey,
    },
  })
}

/** Hình dạng tối thiểu của message nhận được (khớp ConsumeMessage của amqplib). */
export interface MessageWithHeaders {
  properties?: { headers?: Record<string, unknown> | null } | null
}

/**
 * Version của message nhận được. Thiếu header -> 1 (message cũ). Header có mà
 * không phải số nguyên >= 1 -> NonRetryableError: không hiểu nổi message thì
 * thử lại cũng vô ích.
 */
export function readEventVersion(msg?: MessageWithHeaders | null): number {
  const raw = msg?.properties?.headers?.[EVENT_VERSION_HEADER]
  if (raw === undefined || raw === null) return DEFAULT_EVENT_VERSION

  const version = headerToNumber(raw)
  if (!Number.isInteger(version) || version < 1) {
    throw new NonRetryableError(
      `Header ${EVENT_VERSION_HEADER} không hợp lệ: ${headerToText(raw)}`,
    )
  }
  return version
}

/**
 * Chặn message có version consumer chưa hiểu (thường là publisher đã lên
 * version mới trước consumer). Trả về version để handler rẽ nhánh nếu hỗ trợ
 * nhiều version.
 */
export function assertSupportedVersion(
  msg: MessageWithHeaders | null | undefined,
  supported: readonly number[],
): number {
  const version = readEventVersion(msg)
  if (!supported.includes(version)) {
    const type = headerToText(msg?.properties?.headers?.[EVENT_TYPE_HEADER])
    throw new NonRetryableError(
      `Event ${type} version ${version} chưa được hỗ trợ ` +
        `(hỗ trợ: ${supported.join(', ')})`,
    )
  }
  return version
}
