# Thiết kế: số thứ tự `seq` cho tin nhắn

Trạng thái: **đã triển khai §1–§9** trên branch `perf/query-enhancements` (2026-11-04). Kế hoạch: `docs/superpowers/plans/2026-11-04-query-enhancements.md`. Xem mục 12 cho các chỗ lệch so với bản nháp.

## 1. Vấn đề

Hiện tại thứ tự tin nhắn là cặp `(createdAt, _id)`. Cách này đủ để hiển thị đúng thứ tự, nhưng không trả lời được câu hỏi **"mình có bỏ lỡ tin nào không?"**. Từ đó sinh ra các lỗi sau:

| # | Lỗi | Nguyên nhân gốc |
|---|---|---|
| 1 | Socket rớt rồi nối lại: tin gửi trong lúc rớt không hiện, phải F5 | Client không có cách phát hiện mình bị hụt tin. Khi nối lại, `useProtectedRouteChatSockets` chỉ gửi lại tin của chính mình |
| 2 | Danh sách hội thoại hiện tin cũ hơn làm "tin cuối" (audit 2026-09-30: 10/10 lần) | `set lastMessageKey` ghi đè vô điều kiện; frontend `updateNewMessage` cũng lấy sự kiện đến sau là mới nhất |
| 3 | Mốc "đã đọc" so sánh bằng `ObjectId` | Từ group commit, `_id = new ObjectId(seconds)`: trong cùng một giây, thứ tự `_id` **không** trùng thứ tự `createdAt`, nên so sánh `lt` của `markerBefore` có thể sai |
| 4 | Đếm unread phải cộng dồn qua Redis, có cron và transaction | `unreadCount` là bộ đếm cộng dồn. Đo 2026-11-01: 25% transaction của cron bị abort vì hai `updateMany` cùng ghi một document |
| 5 | Đọc tin xong phải đếm lại (findMany tối đa `UNREAD_RECOUNT_CAP` tin) | Không có cách lấy hiệu hai mốc |

Cả 5 lỗi có chung một lời giải: **mỗi hội thoại có một dãy số nguyên tăng dần**.

## 2. Mục tiêu và ngoài phạm vi

**Mục tiêu**
- Mỗi tin có `seq`: số nguyên, duy nhất trong hội thoại, tăng theo thứ tự ghi.
- Client phát hiện được tin bị hụt và tự lấy bù, kể cả sau khi nối lại.
- Tin cuối, mốc đã đọc và số chưa đọc đều tính theo `seq`. Không còn so sánh `ObjectId`, không còn bộ đếm cộng dồn.
- Không làm giảm throughput đáng kể: chi phí thêm phải đo được bằng `qc/throughput.mjs`.

**Ngoài phạm vi** (ghi lại để làm sau)
- Phiên bản cho sửa, xoá, thu hồi tin và poll (mục 10).
- Đồng bộ đa thiết bị đầy đủ: nháp, trạng thái tắt thông báo.
- Chaos test (bài toán số 3).

## 3. Bất biến

1. **Duy nhất:** không bao giờ có hai tin cùng `(conversationId, seq)`. Unique index giữ bất biến này, không dựa vào code.
2. **Đơn điệu:** tin được cấp `seq` sau thì có `seq` lớn hơn.
3. **Được phép có lỗ:** dãy `seq` có thể thiếu số. Ví dụ đã giữ chỗ `seq` nhưng ghi thất bại hẳn, hoặc tin bị chống trùng. Client **không** được chờ một số bị thiếu mãi.
4. **Server là nguồn sự thật cho một khoảng:** server trả "các tin có `seq` trong `(a, b]`". Client coi khoảng đó là đầy đủ; số nào không có nghĩa là lỗ.

Bất biến 3 và 4 là lựa chọn quan trọng nhất của thiết kế. Không có lỗ thì phải cấp `seq` và ghi tin trong cùng một thao tác nguyên tử, tức quay lại transaction. Cho phép lỗ thì cấp số rẻ, và client vẫn đúng.

## 4. Cấp `seq` ở đâu

| Cách | Ưu | Nhược | Kết luận |
|---|---|---|---|
| **A. Bộ đếm trên document `conversation`**, `$inc: {lastSeq: n}` để giữ chỗ cả khoảng | Đúng từ mọi instance và mọi đường ghi (text, media, poll, tin hệ thống, log cuộc gọi). Bền như chính DB. | Thêm một round-trip mỗi hội thoại mỗi lô | **Chọn** |
| B. Bộ đếm trong RAM của instance đang giữ partition | Không tốn round-trip | Tin hệ thống và log cuộc gọi đi qua handler khác, không nằm trên partition owner. Khi chuyển partition phải nạp lại `max(seq)`. | Bỏ |
| C. `INCR` trên Redis | Nhanh | Redis mất dữ liệu thì dãy số đi lùi và đụng unique index hàng loạt. Phải đối soát với Mongo. | Bỏ |

**Cách A chạy cụ thể**

```
SeqAllocator.reserve(conversationId, n) -> firstSeq
  findAndModify conversation { _id } { $inc: { lastSeq: n } } returnNew
  firstSeq = lastSeq - n + 1
```

- Dùng lệnh thô `$runCommandRaw`, không dùng Prisma `update`. Theo phát hiện ngày 2026-11-01, `updateMany` của Prisma trên Mongo chạy trong transaction.
- **Batch writer:** trong `flush()`, gom lô theo `conversationId`. Gọi `reserve` song song cho từng hội thoại, rồi gán `seq` theo đúng thứ tự trong buffer. Thứ tự buffer đã là thứ tự lane, nên `seq` bám theo thứ tự đến của hội thoại.
- **Retry:** dùng lại đúng các dòng đã gán `seq`, giống cách đang làm với `_id` và `createdAt`. Không giữ chỗ lại.
- **Tin trùng `clientMessageId`:** trả về bản đã lưu, kèm `seq` cũ. Số vừa giữ chỗ thành lỗ.
- **Các đường ghi khác** (`createWithRelations`, `createCallLog`, `createSystemMessageAndSync`): gọi `reserve(conversationId, 1)` ngay trước khi `create`.
- **Có thể nhìn thấy lệch:** tin media giữ `seq = 10`, rồi tin text `seq = 11` ghi xong trước. Client sẽ thấy 11 trước 10. Không sao: client lấy bù, chưa thấy 10 thì coi là lỗ; khi 10 đến qua socket thì vẫn chèn vào đúng chỗ (mục 7).

**Chi phí cần đo:** một lô 100 tin trải trên k hội thoại sẽ thêm k lệnh `findAndModify` chạy song song. Mỗi lệnh khoảng 1–2 ms trên một document nhỏ. Đo bằng `MODE=spread` (64 hội thoại) và `MODE=hot` trước và sau khi đổi.

## 5. Mô hình dữ liệu

### `message`
| Thay đổi | Ghi chú |
|---|---|
| + `seq Int` | Bắt buộc sau khi migration xong |
| + unique index `{conversationId: 1, seq: 1}` | Index thường, không partial, vì Prisma bọc truy vấn trong `$expr` và `$expr` không dùng được partial index. Tạo **sau** backfill: lúc đó mọi tin đều có `seq`, không còn giá trị `null` trùng nhau. |
| − index `{conversationId, createdAt, id}` | Xoá ở giai đoạn dọn dẹp, khi không còn truy vấn nào sắp theo `createdAt`. Thu lại dung lượng tương đương index mới. |
| `createdAt` | Giữ lại, chỉ để **hiển thị** giờ gửi. Không dùng để sắp xếp nữa. |

### `conversation`
| Thay đổi | Ghi chú |
|---|---|
| + `lastSeq Int @default(0)` | Bộ đếm cấp số |
| + `lastMessageSeq Int?` | `seq` của tin đang làm snapshot "tin cuối". Chỉ ghi khi số mới lớn hơn, để sửa lỗi #2. |

### `conversationMember`
| Thay đổi | Ghi chú |
|---|---|
| + `lastReadSeq Int @default(0)` | Thay `lastReadMessageId`. Chỉ tăng, dùng `$max`. |
| + `lastMessageSeq Int @default(0)` | Phi chuẩn hoá cùng chỗ với `lastMessageAt` (đã được ghi lan ra mọi thành viên). Nhờ đó tính unread trên từng dòng mà không cần join. |
| + `lastMentionSeq Int?` | Thay `lastMentionMessageId` |
| + `clearedHistorySeq Int?` | Thay `clearedHistoryAt` khi lọc lịch sử |
| `unreadCount` | **Không lưu nữa**, tính bằng `max(0, lastMessageSeq − lastReadSeq)` |
| `lastReadMessageId`, `lastReadAt`, `lastMentionMessageId` | Giữ một thời gian cho client cũ, xoá ở giai đoạn dọn dẹp |

**Tin của chính mình không được tính là chưa đọc:** khi một thành viên gửi tin, server cũng đặt `lastReadSeq = $max(seq)` cho người gửi. Đây là quy tắc chung của Messenger và Telegram, và nó làm cho phép trừ ở trên đúng.

**Đánh đổi:** tin bị "xoá với tôi" và tin hệ thống nằm sau mốc đọc vẫn được tính vào unread. Hiện tại cũng đang tính tin hệ thống. Nếu cần loại ra thì phải quay lại đếm thật, nên đề xuất chấp nhận.

## 6. Thay đổi phía backend

### Ghi tin
| File | Thay đổi |
|---|---|
| mới `repositories/seq-allocator.ts` | `reserve(prisma, conversationId, n): Promise<number>`, dùng find-and-modify thô |
| `services/message-batch-writer.service.ts` | Trong `flush`: gom theo hội thoại, `reserve`, gán `seq` vào document. Retry giữ nguyên `seq`. Kết quả `BatchedMessage` có thêm `seq`. Trong `loadStored`: đọc kèm `seq`. |
| `repositories/message-raw.queries.ts` | Projection thêm `seq` |
| `repositories/message.repository.ts` | `createWithRelations` và `createCallLog`: gọi `reserve` trước khi `create` |
| `services/message.service.ts` | Sau khi ghi: đẩy mốc đọc của người gửi lên (`$max`). `enqueueConversationSyncJob` bỏ `HINCRBY` unread; snapshot `lastMessage` mang thêm `seq`. |

### Tin cuối và lan ra thành viên (cron unread)
- Sau mục 5, cron **không còn đếm unread**. Việc còn lại:
  - (a) snapshot tin cuối trên `conversation`;
  - (b) `lastMessageAt` và `lastMessageSeq` trên từng thành viên, để sắp xếp danh sách và tính unread.
- Redis `lastMessageKey`: Lua chỉ `SET` khi `seq` mới lớn hơn `seq` đang lưu. Hiện đã có mẫu tương tự là `SET_NEWEST_ID_SCRIPT`.
- Ghi xuống Mongo bằng một lệnh `update` thô, không transaction:
  - `conversation`: `{_id, $or: [{lastMessageSeq: null}, {lastMessageSeq: {$lt: seq}}]}`, rồi `$set` snapshot.
  - `conversationMember`: `{conversationId}` multi, rồi `$max: {lastMessageAt, lastMessageSeq}`.
- Hai lệnh `$max` và lệnh có điều kiện đều chạy lại được nhiều lần mà không sai, nên không cần transaction, `restoreClaim` cho phần đếm, hay `newestMessageId`. Lỗi abort 25% biến mất vì không còn transaction nào.

### Đọc tin
| Đường | Hiện tại | Sau khi đổi |
|---|---|---|
| Lịch sử, trang cũ hơn | cursor `(createdAt, id)` | cursor `beforeSeq`: `seq < beforeSeq`, sắp `seq desc`. Index `{conversationId, seq}`. |
| **Mới:** lấy bù | — | `afterSeq`: `seq > afterSeq`, sắp `seq asc`, `limit`, trả `hasMore` |
| Lọc lịch sử đã xoá | `createdAt > clearedHistoryAt` | `seq > clearedHistorySeq` |
| Media của hội thoại | cursor `createdAt` | cursor `seq` |
| `updateLastRead` | Tìm tin, so `ObjectId`, 3 lệnh `updateMany` và một lần đếm lại | Một lệnh: `updateOne {conversationId, userId, isActive} {$max: {lastReadSeq: s}}`, kèm tắt badge nhắc tên khi `lastMentionSeq ≤ s`. Chặn `s` không vượt quá `conversation.lastSeq`; trước đây đã có lỗi client gửi một id giả "tương lai". |
| Danh sách hội thoại | `unreadCount` đọc từ DB | Tính `lastMessageSeq − lastReadSeq` trong mapper |

### API và socket
| Điểm | Thay đổi |
|---|---|
| DTO tin nhắn (`MessageMapper.toResponse`) | + `seq` |
| `GET messages/:conversationId` | + `beforeSeq` / `afterSeq` (thay cursor cũ). Trả `nextCursor` dạng số. |
| DTO hội thoại và thành viên | + `lastSeq`, `lastMessageSeq`, `lastReadSeq` cho từng thành viên (để vẽ "đã xem") |
| Socket `message:new`, `message:ack`, `message:system` | Payload có `seq` (đi theo DTO) |
| Socket đánh dấu đã đọc | Gửi `lastReadSeq` (số) thay cho `lastReadMessageId`. Sự kiện phát lại cho người khác cũng mang `seq`. |

## 7. Thay đổi phía frontend

| Chỗ | Thay đổi |
|---|---|
| `redux/slices/messageSlice.ts` | `Message.seq?: number`. `compareNewestFirst` sắp theo `seq`; tin đang chờ (chưa có `seq`) luôn ở dưới cùng, theo thứ tự gửi. `ackMessage` sắp xếp lại khi nhận được `seq`, sửa lỗ hổng "ackMessage không re-sort" của audit. |
| Trạng thái theo hội thoại | `syncedSeq`: số lớn nhất mà mọi khoảng phía dưới đã được server xác nhận |
| Nhận `message:new` | Nếu `seq ≤ syncedSeq + 1` thì chèn, và tăng `syncedSeq` nếu liền mạch. Nếu `seq > syncedSeq + 1` thì vẫn chèn, đồng thời lên lịch lấy bù `afterSeq = syncedSeq` (debounce khoảng 300 ms để gộp nhiều lần nhảy). Lấy bù xong thì đặt `syncedSeq` bằng số lớn nhất trong khoảng server trả. |
| `useProtectedRouteChatSockets` (reconnect) | Gửi lại tin đang chờ như hiện nay, **rồi** tải lại trang đầu danh sách hội thoại để có `lastSeq` và unread mới. Với hội thoại đang mở: lấy bù `afterSeq = syncedSeq`. Các hội thoại có cache khác: nếu `lastSeq > syncedSeq` thì đánh dấu cũ, lấy bù khi mở. |
| Phân trang trong `Messages` | Cursor là `seq` |
| `conversationSlice.updateNewMessage` | Chỉ thay tin cuối khi `seq` mới lớn hơn, sửa lỗi #2 phía client |
| Đã xem (`useChatSocketEvents`, `useChatConversationContext`, `hydrateSeenStatusFromMembers`) | So `lastReadSeq` với `seq` thay cho id |
| Badge unread | Đọc giá trị server đã tính, không đổi giao diện |

Tin gửi lạc quan vẫn dùng `clientMessageId` để gộp như hiện nay. Chỉ có thứ tự là chuyển sang `seq` khi nhận ack.

## 8. Migration (`backend/migrations/chat/0008-message-seq.ts`)

Mẫu viết theo `0007-message-client-id-unique.ts`, mode `deploy`, chạy khi chat đã dừng ghi. Prod hiện không dùng nên không cần cơ chế chạy song song.

1. Với mỗi hội thoại: duyệt tin theo `(createdAt asc, _id asc)` bằng index cũ. Gán `seq` từ 1 đến n bằng `bulkWrite` theo lô 1000. Sau đó đặt `conversation.lastSeq = n` và `lastMessageSeq` bằng `seq` của `lastMessageId`.
2. Với mỗi thành viên:
   - `lastReadSeq` = `seq` của `lastReadMessageId`, hoặc 0 nếu chưa có.
   - `lastMentionSeq` lấy tương tự.
   - `clearedHistorySeq` = `seq` lớn nhất có `createdAt ≤ clearedHistoryAt`.
   - `lastMessageSeq` = `conversation.lastSeq`.
3. Tạo unique index `{conversationId: 1, seq: 1}`. Nếu bước này lỗi tức là backfill sai, phải dừng.
4. Chạy lại được: bỏ qua hội thoại đã có `lastSeq` bằng số tin. `dryRun` chỉ in ra số lượng.
5. Thời gian dự kiến: với khoảng 5,4 triệu tin đang có trên máy dev, cỡ vài phút. Có thể xoá dữ liệu đo (`seed-`, `lt-`) trước khi chạy cho nhanh.

Thêm vào `schema.prisma`: các field ở mục 5 và `@@unique([conversationId, seq])`. Kiểm tra lại rằng `docker/db-push.sh` không cố tạo index đó trước bước backfill. Nếu có, đặt index ở migration và không khai báo trong Prisma, giống cách đã làm với 0007.

## 9. Các giai đoạn triển khai

Mỗi giai đoạn chạy được độc lập, có test và một lượt QC trên dev.

| GĐ | Nội dung | Thấy được gì |
|---|---|---|
| **1** | `SeqAllocator`, gán `seq` ở mọi đường ghi, migration 0008, DTO có `seq`. Client chưa dùng. | Mọi tin có `seq` duy nhất. Throughput đo lại không giảm quá 10%. |
| **2** | API `beforeSeq`/`afterSeq`; frontend sắp theo `seq`, phát hiện thiếu tin, lấy bù khi nối lại | Sửa lỗi #1: tắt mạng 10 s trong lúc người kia gửi, bật lại thì tin hiện ra mà không cần F5 |
| **3** | Đọc, unread, nhắc tên và tin cuối theo `seq`; cron chỉ còn snapshot và `$max` | Sửa lỗi #2, #3, #4, #5. Gửi tin trả lời rồi tin thường liền nhau: từ 10/10 lần sai xuống 0/10. Không còn transaction abort. |
| **4** | Dọn dẹp: bỏ cursor `createdAt`, index cũ, `lastReadMessageId`, `unreadCount`, phần Redis đếm unread | Bớt code và bớt một index |

## 10. Rủi ro và câu hỏi mở

1. **Có cho phép lỗ không?** Đề xuất: có (mục 3). Nếu bắt buộc liền mạch thì phải dùng transaction cho mỗi lô.
2. **Document `conversation` của một hội thoại nóng thành điểm ghi nóng.** Mỗi lô chỉ có một `$inc` cho mỗi hội thoại, không phải một lệnh cho mỗi tin. Với một hội thoại ở khoảng 2.800 msg/s, lô 30–100 tin, ước tính 30–90 lệnh/s trên một document, tức trong khả năng của Mongo. Cần đo bằng `MODE=hot`.
3. **Sửa, thu hồi, poll** không có `seq`: lấy bù chỉ mang về tin mới, không mang về thay đổi của tin cũ trong lúc rớt mạng. Hướng sau này: mỗi tin có `version`, và một luồng sự kiện theo hội thoại (`eventSeq`). Đây là nền cho đồng bộ đa thiết bị, nên để thành bài toán riêng.
4. **Tin hệ thống và tin "xoá với tôi" vẫn tính vào unread** (mục 5). Cần bạn chốt có chấp nhận không.
5. **Client cũ** (tab đang mở lúc deploy) gửi `lastReadMessageId`. Ở giai đoạn 3, server nhận cả hai kiểu: có id thì tra ra `seq`. Bỏ ở giai đoạn 4.
6. **Đổi chủ partition giữa chừng:** không ảnh hưởng, vì bộ đếm nằm trong DB chứ không trong RAM. Có zombie ghi trùng thì unique index chặn lại, lô đó retry và giữ chỗ khoảng mới.

## 11. Kiểm thử

- **Unit:**
  - `SeqAllocator` trả đúng khoảng.
  - Batch writer gán `seq` liên tục trong từng hội thoại; retry giữ nguyên `seq`; tin trùng trả `seq` cũ.
  - `updateLastRead` chỉ tăng, chặn `s > lastSeq`.
  - Mapper tính unread đúng, kể cả khi bị âm thì về 0.
- **Migration:** dữ liệu mẫu có `createdAt` trùng nhau, `lastReadMessageId` rỗng, lịch sử đã xoá. Chạy hai lần cho cùng kết quả.
- **Tích hợp trên docker:**
  - Hai instance chat cùng ghi, cộng tin hệ thống chen vào giữa: 0 `seq` trùng.
  - Kiểm tra bằng aggregate theo `{conversationId, seq}` có count > 1.
- **Throughput:** `qc/throughput.mjs` ở `MODE=hot` và `MODE=spread` trước và sau giai đoạn 1. Bước kiểm tra sau khi đo thêm điều kiện "`seq` tăng nghiêm ngặt theo `(createdAt, _id)` trong từng hội thoại".
- **QC trên trình duyệt** (Puppeteer, trên dev):
  - (a) Thiếu tin khi offline: A offline 10 s (`page.setOfflineMode`), B gửi 5 tin, A online lại; trong 3 s phải thấy đủ 5 tin, không F5.
  - (b) Tin cuối: B gửi tin trả lời rồi tin thường, lặp 10 lần; danh sách bên A luôn hiện tin thường.
  - (c) Unread: B gửi 7 tin thì badge A = 7; A mở hội thoại thì về 0; A gửi tin thì badge của A không tăng.

## 12. Triển khai thực tế: những chỗ lệch so với bản nháp

| Bản nháp | Triển khai | Vì sao |
|---|---|---|
| Field phi chuẩn hoá trên thành viên tên `lastMessageSeq` | Đặt tên **`latestSeq`** | Danh sách hội thoại trải document `conversation` và `conversationMember` chồng lên nhau. Trùng tên thì field của thành viên đè mất field của hội thoại |
| Mốc đọc sau migration suy từ `lastReadMessageId` | `lastReadSeq = lastSeq − unreadCount`, kẹp trong khoảng [0, lastSeq] | Giữ đúng badge người dùng đang thấy. Số đếm cũ không tính tin của chính mình, còn vị trí của `lastReadMessageId` thì có |
| Tab tài nguyên (chưa có trong bản nháp) | Ba cờ boolean `hasMedia`, `hasFile`, `hasLink`, mỗi cờ một index `{conversationId, hasX, seq:-1}` | Prisma bọc điều kiện trong `$expr`, và `$expr` không dùng được index trên trường mảng (đo được 25.000 key cho 0 kết quả) |
| Đụng `(conversationId, seq)` | Chỉ hội thoại bị đụng mới giữ chỗ lại; tin của hội thoại đã xoá hoặc chưa đánh số thì bị reject, không retry | Một hội thoại lỗi không được kéo theo cả lô của người khác |
| Lấy bù khi nối lại cho mọi hội thoại có cache | Chỉ hội thoại **đang mở**, tối đa 2 trang. Hội thoại khác bị bỏ cache và tải lại trang đầu khi mở | Hạn mức Kong là 200 request/phút theo IP |
| Xoá hội thoại (chưa có trong bản nháp) | Ẩn ngay bằng `deletedAt` cộng `isActive = false`; cron `conversation-purge` dọn theo lô 1.000 tin | Transaction một lần với `$in` toàn bộ id vượt giới hạn: đo được 504 ở 100.000 tin |
| Lỗ trong dãy `seq` | Mỗi lỗ (tin trùng bị loại) làm unread dư 1 | Chấp nhận (§3) |
| Ngoài phạm vi | `changeSeq` và bia mộ cho sửa/xoá hẳn (§10.3) | Bài toán riêng |
