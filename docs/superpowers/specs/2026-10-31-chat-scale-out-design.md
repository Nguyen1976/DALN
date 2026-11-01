# Nhiều instance chat và nhiều realtime-gateway — Thiết kế

Ngày: 2026-10-31 · Phạm vi: **chỉ local** (docker compose dev). Production chưa làm.

Thiết kế này chốt lại các quyết định đã thảo luận. Bản tổng quan có sơ đồ nằm ở
artifact "Chat Scale-out Plan".

## 1. Mục tiêu

Chạy được N realtime-gateway và N instance chat cùng lúc. Thêm hoặc bớt instance
ngay khi hệ thống đang chạy. Trong mọi trường hợp (một instance chết đột ngột,
tắt có chủ đích, thêm instance, một gateway chết, quá tải), hệ thống phải đảm bảo:

- **Không mất tin.** Tin đã được ACK cho client thì đã nằm trong DB.
- **Không trùng tin.** Mỗi `(senderId, clientMessageId)` có tối đa một bản ghi.
- **Không đảo thứ tự trong một hội thoại.** Tin của cùng một người gửi được lưu
  với `createdAt` tăng dần, đúng thứ tự client đã gửi.

## 2. Đường gửi tin

```
client ─▶ gateway (bất kỳ) ─▶ exchange chat.send ─▶ queue chat.send.p{0..15} ─▶ chat instance giữ partition đó
          hash(convId) % 16    routing key send.pN    SAC + policy max-length      làn theo hội thoại → BatchWriter
```

| Hằng số | Giá trị |
|---|---|
| `PARTITION_COUNT` | `16` |
| Hàm băm | FNV-1a 32-bit trên chuỗi `conversationId` (UTF-8), lấy `% 16` |
| Exchange | `chat.send`, `direct`, durable |
| Queue | `chat.send.p{n}`, classic, durable, argument `x-single-active-consumer: true` |
| Routing key | `send.p{n}` |
| Policy RabbitMQ | `chat-send-partitions`, pattern `^chat\.send\.p\d+$`, priority `1`, definition `{"dead-letter-exchange":"daln.dlx","max-length":20000,"overflow":"reject-publish"}` |
| Prefetch mỗi partition | `CHAT_PARTITION_PREFETCH`, mặc định `100` |

Giới hạn độ dài queue để trong **policy**, không phải argument của queue. Lý do:
policy đổi được lúc đang chạy mà không phải khai báo lại queue (khai báo lại với
argument khác sẽ gây lỗi `PRECONDITION_FAILED`). Policy mới phải chép lại
`dead-letter-exchange`, vì mỗi queue chỉ chịu một policy (policy có priority cao
nhất thắng).

Gateway và chat **cùng khai báo** exchange, 16 queue và binding lúc khởi động
(idempotent). Nhờ vậy gateway publish được ngay cả khi chưa có instance chat nào.

Queue cũ `chat_queue_send_message` bị bỏ. Local đã xoá volume nên không cần rút cạn.

## 3. Chia partition cho các instance chat

| Key Redis | Kiểu | Nội dung |
|---|---|---|
| `chat:members` | ZSET | member = `memberId`, score = thời điểm heartbeat (lấy từ `TIME` của Redis) |
| `chat:lease:p{n}` | STRING, TTL | `memberId` của chủ hiện tại |
| `chat:rebalance` | pub/sub | thông báo "tính lại", không mang dữ liệu |

`memberId` = `${hostname}-${8 ký tự đầu của UUID sinh lúc khởi động}`.

| Thời gian | Giá trị |
|---|---|
| Nhịp tính lại (đồng thời là heartbeat và gia hạn lease) | `2000ms` |
| TTL thành viên | `6000ms` |
| TTL lease | `6000ms` |
| Thời gian chờ trước khi tham gia | `3000ms`. Trong lúc này instance không ghi tên, không giữ partition |

**Thuật toán `stickyAssign(members, owners)`** là hàm thuần:

1. Bỏ trùng và sort `members`. Quota = `⌊16/M⌋`. Có `16 mod M` suất `+1`, dành
   cho người đang giữ nhiều partition nhất (chỉ tính chủ còn sống). Hoà thì xét
   tên nhỏ hơn.
2. Đi từ p0 đến p15: chủ còn sống và chưa đủ quota thì giữ nguyên.
3. Các partition còn lại, xét theo chỉ số tăng dần, giao cho người thiếu nhiều
   nhất. Hoà thì xét tên nhỏ hơn.

**Vòng tính lại** chạy mỗi 2 giây và ngay khi nhận `chat:rebalance`. Nếu thông
báo tới lúc đang tính dở thì đánh dấu "còn việc" và tính tiếp ngay sau khi xong,
**không được bỏ qua**.

1. Heartbeat: ghi tên mình, dọn thành viên quá TTL, đọc danh sách. Nếu danh sách
   khác lần trước thì publish `chat:rebalance`.
2. Đọc chủ của 16 lease, chạy `stickyAssign`.
3. Với từng partition mình đang giữ: nếu không còn được giao thì nhả. Nếu gia
   hạn trả về `lost` thì nhả. Nếu Redis không trả lời thì **giữ nguyên**.
4. Với từng partition được giao mà chưa giữ: `SET NX PX` thành công thì subscribe.

**Nhả partition (drain):**
- HOLD: tin mới giao tới thì không xử lý, không ack.
- FINISH: chờ các tin đang xử lý ghi xong và ack.
- CLOSE: đóng channel của partition. RabbitMQ trả các tin đang HOLD về đầu queue.
- Xoá lease (chỉ khi lease còn mang tên mình), rồi publish `chat:rebalance`.

**Tắt có chủ đích (SIGTERM):** xoá mình khỏi `chat:members`, publish, drain toàn
bộ partition, rồi thoát.

Channel của một partition đóng ngoài ý muốn (mất kết nối RabbitMQ) thì bỏ
partition đó khỏi danh sách đang giữ và xoá lease. Lần tính sau sẽ giành lại.

## 4. Thứ tự bên trong một instance

Tin của cùng một `conversationId` đi qua một **làn**: tin sau chỉ bắt đầu xử lý
khi tin trước đã vào BatchWriter. Các hội thoại khác nhau vẫn chạy song song.

**Retry tại chỗ, không đẩy xuống cuối queue:**
- Lỗi tạm thời: thử lại trong làn, tối đa 3 lần, chờ `50`, `200`, `800` ms giữa
  các lần.
- Hết lượt thử: publish `MESSAGE_ERROR` (retryable) rồi `nack(requeue=false)`,
  tin chuyển sang `daln.dead-letters`.
- Lỗi 4xx (`HttpException` có status 400–499): publish `MESSAGE_ERROR` rồi ack.
  Giữ nguyên hành vi hiện tại.

## 5. Chống trùng (idempotency)

- Thêm field `message.clientMessageId String?` vào schema.
- Thêm partial unique index `message_sender_client_id` trên
  `{ senderId: 1, clientMessageId: 1 }`, với
  `partialFilterExpression: { clientMessageId: { $type: "string" } }`. Index được
  tạo bằng migration `chat/0007`.
- BatchWriter ghi bằng `insert` với `ordered: false`. Bản ghi nào bị E11000 thì
  đọc lại bản đã có, rồi resolve caller bằng bản đó (đúng `id` và `createdAt` cũ).
- Đường ghi có media hoặc poll (không đi qua BatchWriter) cũng làm tương tự khi
  gặp lỗi trùng khoá.

## 6. Gateway

- Publish tin vào `chat.send` và **chờ broker confirm**, timeout `5000ms`. Bị nack
  hoặc timeout thì emit `MESSAGE_ERROR`
  `{ code: 'SERVER_BUSY', retryable: true, clientMessageId, conversationId }`.
- Dùng `createShardedAdapter(pub, sub, { subscriptionMode: 'dynamic' })` thay cho
  `createAdapter`.
- **Presence nguyên tử:** thêm socket và kiểm tra "trước đó user có offline
  không" trong **một** script Lua. Gỡ socket và kiểm tra "giờ user có offline
  không" cũng vậy. `USER_ONLINE` chỉ phát khi chuyển từ 0 sang ≥1 socket còn
  sống. `USER_OFFLINE` chỉ phát khi chuyển từ ≥1 về 0.
- **Timer gọi nhóm chuyển vào Redis:** ZSET `call:group:deadlines`, member
  `pending:{callId}` hoặc `empty:{callId}`, score = thời điểm hết hạn (ms). Mỗi
  gateway quét mỗi `1000ms` và giành job bằng `ZREM` (chỉ ai `ZREM` trả về 1 mới
  xử lý). Huỷ timer = `ZREM`. Thời lượng giữ nguyên: pending `35000ms`, empty
  `15000ms`.
- Mỗi socket log một dòng khi kết nối: `socket connected user=<id> node=<hostname>`.
  QC dùng dòng này để biết user đang nằm ở gateway nào.

## 7. Client

- Khi socket **kết nối lại** (không tính lần kết nối đầu): gửi lại mọi tin văn
  bản đang `pending`, giữ nguyên `clientMessageId`.
- `MESSAGE_ERROR` với `code === 'SERVER_BUSY'`: tự gửi lại sau `2s`, `4s`, `8s`.
  Sau 3 lần vẫn lỗi thì đánh dấu `failed`.
- Tin có media đang pending thì không tự gửi lại, vẫn dùng nút "Gửi lại" như hiện
  tại.

## 8. Chạy nhiều instance ở local

`docker compose --profile scale up -d` bật thêm `chat-2`, `chat-3`,
`realtime-gateway-2`, `realtime-gateway-3`. Các service này không mở cổng ra
host, và có network alias trùng tên service gốc (`chat`, `realtime-gateway`). Nhờ
vậy DNS của Docker trả nhiều địa chỉ, Kong tự chia tải mà không phải sửa
`kong.yml`. Kong được đặt `KONG_DNS_VALID_TTL=5` để nhận ra instance mới hoặc
instance đã chết trong vòng vài giây.

## 9. Tiêu chí chấp nhận (đo bằng QC trên local)

| # | Kịch bản | Đạt khi |
|---|---|---|
| 1 | Chạy ổn định, 3 gateway × 2 chat | 0 mất · 0 trùng · 0 đảo thứ tự |
| 2 | `docker kill` một chat giữa lúc tải | Như #1. Partition của nó có chủ mới trong ≤ 10s |
| 3 | `docker stop` một chat | Như #1. Mỗi partition chuyển chủ dừng < 1s |
| 4 | Bật `chat-3` | Như #1. Đúng các partition do `stickyAssign` chọn chuyển sang `chat-3` |
| 5 | `docker kill` một gateway | Như #1. Client của gateway đó kết nối lại và gửi lại tin chưa ACK |
| 6 | Quá tải (policy `max-length` rất nhỏ) | Client nhận `SERVER_BUSY` chứ không treo. Khi trả lại giới hạn thì tin vẫn tới, không trùng |
| 7 | Trình duyệt: user nằm ở 2–3 gateway khác nhau | Tin, typing, đã xem, online đều tới đúng. Online chỉ phát một lần |
| 8 | Trình duyệt: gửi ảnh rồi gửi chữ ngay sau | Ảnh nằm trên chữ, cả lúc đang chat lẫn sau khi tải lại trang |
| 9 | Thu hồi phiên khi có nhiều gateway | Socket của phiên bị thu hồi bị ngắt, dù nằm ở gateway nào |

## 10. Ngoài phạm vi

Production, autoscaler, partition có trọng số, client gửi lại sau khi tải lại
trang (slice `message` không được persist), RabbitMQ chạy cluster.
Phát hiện crash nhanh bằng `rabbitmq_event_exchange` là task tuỳ chọn ở cuối plan.
