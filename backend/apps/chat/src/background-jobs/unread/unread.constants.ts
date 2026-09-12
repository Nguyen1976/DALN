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

/**
 * Số conversation flush đồng thời trong một lô.
 * Đủ lớn để 500 conversation xong trong cửa sổ 5 giây, đủ nhỏ để không dội
 * quá tải connection pool của Mongo.
 */
export const FLUSH_CONCURRENCY = 25

/** Hash `senderId -> số tin`, cộng dồn chờ cron cộng vào unreadCount. */
export const unreadCountKey = (conversationId: string) =>
  `unread_count:${conversationId}`

/** JSON tin nhắn cuối cùng, chờ cron ghi xuống conversation. */
export const lastMessageKey = (conversationId: string) =>
  `last_message:${conversationId}`

/**
 * Hash `senderId -> id tin mới nhất` của người gửi đó trong cửa sổ chờ flush.
 *
 * Cron dùng nó để KHÔNG cộng unread cho người đã đọc tới tin đó. Trước đây
 * người đang mở hội thoại đọc tin N ngay (unread=0), tối đa 5 giây sau cron vẫn
 * cộng +1 cho chính tin N, và con số 1 ảo đó kẹt mãi.
 */
export const unreadLastKey = (conversationId: string) =>
  `unread_last:${conversationId}`

/**
 * HSET chỉ khi id mới LỚN HƠN id đang lưu, để lệnh đến trễ/đảo thứ tự không
 * kéo id mới nhất lùi lại. ObjectId hex chữ thường cùng dài 24 ký tự nên so
 * sánh chuỗi cũng là so sánh thời điểm tạo.
 *
 * KEYS[1] = unread_last:<c>, ARGV[1] = senderId, ARGV[2] = messageId
 */
export const SET_NEWEST_ID_SCRIPT = `
local cur = redis.call('HGET', KEYS[1], ARGV[1])
if (not cur) or cur < ARGV[2] then
  redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
  return 1
end
return 0
`

/**
 * Lấy-và-xoá NGUYÊN TỬ cả ba key của một conversation.
 *
 * Trước đây cron đọc (HGETALL/GET) rồi mới DEL ở một lệnh khác: tin đến giữa
 * hai bước bị xoá theo, mất luôn số đếm. Lua chạy liền một mạch nên không lệnh
 * nào chen vào giữa: tin đến sau rơi vào key mới tinh, lượt sau xử lý. Key
 * không tồn tại thì trả rỗng, không phải lỗi.
 *
 * KEYS = unread_count, last_message, unread_last
 * Trả về [HGETALL counts, GET last (nil nếu không có), HGETALL newest]
 */
export const CLAIM_SCRIPT = `
local counts = redis.call('HGETALL', KEYS[1])
local last = redis.call('GET', KEYS[2])
local newest = redis.call('HGETALL', KEYS[3])
redis.call('DEL', KEYS[1], KEYS[2], KEYS[3])
return { counts, last, newest }
`

/**
 * Trả lại phần đã claim khi ghi Mongo thất bại, để lượt sau thử lại:
 * - số đếm: HINCRBY cộng lại (dồn chung với tin mới đến trong lúc flush);
 * - id mới nhất: chỉ nâng lên, không bao giờ hạ;
 * - last_message: chỉ đặt lại khi chưa có bản mới hơn được ghi sau lúc claim.
 *
 * KEYS = unread_count, last_message, unread_last
 * ARGV[1] = JSON { counts: {senderId: "delta"}, newest: {senderId: id},
 *                  last: string | "", lastId: string | "" }
 */
export const RESTORE_SCRIPT = `
local data = cjson.decode(ARGV[1])
for sender, delta in pairs(data.counts) do
  redis.call('HINCRBY', KEYS[1], sender, delta)
end
for sender, id in pairs(data.newest) do
  local cur = redis.call('HGET', KEYS[3], sender)
  if (not cur) or cur < id then
    redis.call('HSET', KEYS[3], sender, id)
  end
end
if type(data.last) == 'string' and data.last ~= '' then
  local cur = redis.call('GET', KEYS[2])
  local restore = true
  if cur then
    restore = false
    local ok, parsed = pcall(cjson.decode, cur)
    if ok and type(parsed) == 'table' and type(parsed.lastMessageId) == 'string'
      and type(data.lastId) == 'string' and data.lastId ~= ''
      and parsed.lastMessageId < data.lastId then
      restore = true
    end
  end
  if restore then
    redis.call('SET', KEYS[2], data.last)
  end
end
return 1
`
