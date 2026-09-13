/**
 * Các version envelope saga (SagaEnvelope ở libs/constant/rmq/saga) mà
 * subscriber saga hiểu được.
 *
 * Mọi event đi qua outbox hiện đều là envelope saga, publish với header
 * `x-event-version` = version của bản ghi outbox (mặc định 1). Subscriber saga
 * chặn version lạ bằng `assertSupportedVersion(raw, SUPPORTED_SAGA_VERSIONS)` ->
 * dead-letter thay vì chạy sai state machine. Đổi envelope kiểu breaking: thêm
 * version mới vào đây và triển khai consumer TRƯỚC publisher.
 */
export const SUPPORTED_SAGA_VERSIONS: readonly number[] = [1]
