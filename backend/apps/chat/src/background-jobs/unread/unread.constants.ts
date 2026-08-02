/**
 * Set chỉ mục các conversation có thay đổi chưa đồng bộ xuống Mongo.
 *
 * Trước đây cron dò việc bằng `KEYS 'unread_count:*'` — lệnh này duyệt toàn bộ
 * keyspace và CHẶN Redis (đơn luồng), đo được 45,7ms ở 1 triệu key, lặp lại mỗi
 * 5 giây. Với set chỉ mục: SADD O(1) lúc ghi, SPOP O(số việc thật) lúc quét,
 * hệ thống rảnh thì cron thoát sau đúng 1 lệnh.
 */
export const DIRTY_CONVERSATIONS_KEY = 'dirty:conversations'

/** Số conversation xử lý tối đa mỗi lượt cron, tránh một lượt chạy quá dài. */
export const DIRTY_BATCH_SIZE = 500
