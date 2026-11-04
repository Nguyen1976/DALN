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

/**
 * Hash `senderId -> số tin` của bản cũ (trước seq). Không còn ghi; claim vẫn
 * xoá key này để dữ liệu còn sót không nằm lại mãi.
 */
export const unreadCountKey = (conversationId: string) =>
  `unread_count:${conversationId}`

/** JSON tin nhắn cuối cùng (kèm `seq`), chờ cron ghi xuống conversation. */
export const lastMessageKey = (conversationId: string) =>
  `last_message:${conversationId}`

/**
 * Hash `senderId -> seq lớn nhất` của tin người đó gửi trong cửa sổ chờ flush.
 * Cron đẩy mốc đọc của người gửi lên tới đó: tin của chính mình không bao giờ
 * là chưa đọc (unreadCount = latestSeq − lastReadSeq).
 */
export const unreadLastKey = (conversationId: string) =>
  `unread_last:${conversationId}`

/**
 * HSET chỉ khi seq mới LỚN HƠN seq đang lưu, để lệnh đến trễ không kéo lùi.
 * Giá trị không phải số (ObjectId của bản cũ) coi như chưa có.
 *
 * KEYS[1] = unread_last:<c>, ARGV[1] = senderId, ARGV[2] = seq
 */
export const SET_NEWEST_SEQ_SCRIPT = `
local cur = tonumber(redis.call('HGET', KEYS[1], ARGV[1]))
local new = tonumber(ARGV[2])
if new and ((not cur) or cur < new) then
  redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
  return 1
end
return 0
`

/**
 * SET tin cuối chỉ khi seq mới LỚN HƠN seq của bản đang chờ. Trước đây SET vô
 * điều kiện: tin trả lời (chờ tra tin được trích) tới sau tin thường gửi ngay
 * sau nó, và danh sách hội thoại hiện tin cũ hơn làm tin cuối (10/10 lần).
 *
 * KEYS[1] = last_message:<c>, ARGV[1] = seq, ARGV[2] = JSON
 */
export const SET_LAST_MESSAGE_SCRIPT = `
local cur = redis.call('GET', KEYS[1])
if cur then
  local ok, parsed = pcall(cjson.decode, cur)
  if ok and type(parsed) == 'table' and tonumber(parsed.seq)
    and tonumber(parsed.seq) >= tonumber(ARGV[1]) then
    return 0
  end
end
redis.call('SET', KEYS[1], ARGV[2])
return 1
`

/**
 * Lấy-và-xoá NGUYÊN TỬ các key của một conversation.
 *
 * Trước đây cron đọc rồi mới DEL ở một lệnh khác: tin đến giữa hai bước bị xoá
 * theo. Lua chạy liền một mạch nên không lệnh nào chen vào giữa: tin đến sau
 * rơi vào key mới tinh, lượt sau xử lý. Key không tồn tại thì trả rỗng.
 *
 * KEYS = unread_count (bản cũ, chỉ xoá), last_message, unread_last
 * Trả về [GET last (nil nếu không có), HGETALL newest]
 */
export const CLAIM_SCRIPT = `
local last = redis.call('GET', KEYS[2])
local newest = redis.call('HGETALL', KEYS[3])
redis.call('DEL', KEYS[1], KEYS[2], KEYS[3])
return { last, newest }
`

/**
 * Trả lại phần đã claim khi ghi Mongo thất bại, để lượt sau thử lại:
 * - seq mới nhất của người gửi: chỉ nâng lên, không bao giờ hạ;
 * - last_message: chỉ đặt lại khi chưa có bản mới hơn (theo seq) được ghi sau
 *   lúc claim.
 *
 * KEYS = unread_count, last_message, unread_last
 * ARGV[1] = JSON { newest: {senderId: seq}, last: string | "", lastSeq: number }
 */
export const RESTORE_SCRIPT = `
local data = cjson.decode(ARGV[1])
for sender, seq in pairs(data.newest) do
  local cur = tonumber(redis.call('HGET', KEYS[3], sender))
  if (not cur) or cur < tonumber(seq) then
    redis.call('HSET', KEYS[3], sender, seq)
  end
end
if type(data.last) == 'string' and data.last ~= '' then
  local cur = redis.call('GET', KEYS[2])
  local restore = true
  if cur then
    local ok, parsed = pcall(cjson.decode, cur)
    restore = not (ok and type(parsed) == 'table' and tonumber(parsed.seq)
      and tonumber(parsed.seq) >= tonumber(data.lastSeq))
  end
  if restore then
    redis.call('SET', KEYS[2], data.last)
  end
end
return 1
`
