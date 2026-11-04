# Tối ưu truy vấn và `seq` cho tin nhắn — Kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sửa 7 vấn đề truy vấn đã đo được ngày 2026-11-04 và đưa `seq` vào tin nhắn theo thiết kế. Kết quả phải được chứng minh bằng ba thứ:
1. Bộ profiling **chạy y hệt trước và sau** khi sửa, cho thấy số liệu tốt lên.
2. Bộ test trình duyệt (Puppeteer) phủ mọi tính năng dùng chung các truy vấn đã sửa, chứng minh không có gì hỏng.
3. Một artifact tổng kết.

**Architecture:**
- **Thứ tự và đồng bộ:** mỗi tin có `seq` (thứ tự trong hội thoại), cấp bằng một lệnh `$inc` giữ chỗ trên `conversation.lastSeq`. Cho phép có lỗ, không dùng transaction.
- **Đọc tin:** đánh dấu đã đọc là một lệnh `$max` thô. Số chưa đọc được tính bằng `latestSeq − lastReadSeq` chứ không cộng dồn.
- **Tab tài nguyên:** đọc từ cờ lưu sẵn (`hasMedia`, `hasFile`, `hasLink`), có index riêng.
- **Xoá hội thoại:** chuyển thành ẩn ngay rồi dọn dần theo lô.
- **Thêm thành viên:** chuyển sang `bulkWrite`.
- **Bạn bè:** thêm index cho `Friendship` và `friendRequest`.

**Tech Stack:** NestJS 11 · Prisma 6.19 (MongoDB, replica set) · Redis (ioredis) · Jest 30 · React 19 + Redux Toolkit · puppeteer-core + socket.io-client (QC) · k6 (throughput)

**Review:** đã APPROVE sau 3 vòng (senior reviewer subagent), xem mục "Sửa đổi sau review".

**Spec:**
- [`docs/design/message-seq-design.md`](../../design/message-seq-design.md) (chỉ phần §1–§9; ngoài phạm vi: `changeSeq` và bia mộ của §10)
- Danh sách 7 vấn đề cùng số đo baseline nằm ở mục "Vấn đề cần sửa" bên dưới

## Vấn đề cần sửa (số đo ngày 2026-11-04, hội thoại 305.800 tin)

| # | Vấn đề | Số đo | Nơi |
|---|---|---|---|
| P1 | Tab Ảnh/Video: `$lookup` messageMedia cho **từng** tin trước khi lọc | 7.087 ms, 305.800 docs | `message.repository.ts` `findConversationAssets` |
| P2 | Đánh dấu đã đọc: khoảng 8 lượt gọi DB và 3 transaction mỗi lần | — | `conversation-member.repository.ts` `updateLastRead` |
| P3 | Tab Link: `contains 'http'` quét cả hội thoại | 733 ms, 305.800 docs | như P1 |
| P4 | `Friendship` và `friendRequest` chỉ có index `_id`, nên luôn COLLSCAN | COLLSCAN | `apps/user/prisma/schema.prisma` |
| P5 | Xoá hội thoại: nạp mọi id tin rồi xoá trong **một** transaction với `$in` khổng lồ | sẽ vượt giới hạn transaction | `conversation.repository.ts` `deleteConversationById` |
| P6 | `addMembers`: N+1, mỗi người 2–3 lệnh và 1 transaction | — | `conversation-member.repository.ts` `addMembers` |
| P7 | Cron unread: 25% transaction bị abort | đo 2026-11-01 | `unread.cron.ts` |
| P8 (phát hiện thêm) | Phân trang lịch sử: cursor `OR(createdAt<, createdAt=∧id<)` nằm trong `$expr`, nên trang càng sâu càng quét nhiều | đo ở Task 0 | `olderThanCursor` |

## Global Constraints

- **Chỉ local.** Không sửa `docker-compose.prod.yml`, CI/CD, Kong.
- **Hợp đồng API giữ tương thích:**
  - DTO tin nhắn **thêm** `seq`.
  - DTO hội thoại **thêm** `lastMessageSeq` (field của chính hội thoại, không phải `latestSeq` của thành viên), kèm `lastReadSeq` cho từng thành viên.
  - Giữ nguyên mọi field cũ: `unreadCount`, `unreadMentionCount`, `lastMentionMessageId`, `lastReadMessageId`, `lastReadAt`. Các field này vẫn có giá trị, chỉ đổi cách tính.
  - `cursor` vẫn là chuỗi mờ (opaque).
  - Socket `message:read` vẫn nhận `lastReadMessageId`.
- **Trên đường nóng không dùng `updateMany`/`deleteMany` của Prisma**, vì trên Mongo chúng chạy bằng transaction. Đường nóng gồm: gửi tin, đọc tin, nhắc tên, cron, thêm thành viên, xoá hội thoại. Thay bằng `$runCommandRaw` (`update`/`delete`/`findAndModify`).
- **Index nào truy vấn qua Prisma thì phải là index thường**, vì Prisma bọc `where` trong `$expr`. Partial index chỉ dùng khi truy vấn là lệnh thô có lặp lại điều kiện lọc.
- **Unique index `(conversationId, seq)` chỉ tạo trong migration, sau bước backfill.** Không khai báo trong `schema.prisma`, vì `db push` chạy trước migration.
- **Prisma schema:** `seq Int?` và các field mới đều optional, để document cũ vẫn đọc được trong lúc chuyển tiếp.
- **Lệnh test backend** (chạy trong `backend/`): `npx jest <path>`, `npm run typecheck`, `npm run lint:check`. Frontend (chạy trong `frontend/`): `npm run lint`, `npx tsc -b`, `npm test` nếu có.
- **Commit:**
  - Dưới danh tính git của người dùng. Không có Claude làm author hay co-author. Không commit `.claude/`.
  - Làm trên branch `perf/query-enhancements`, cắt từ `develop`.
- **Toàn quyền với DB local.** Được xoá dữ liệu đo cũ (`lt|…`, seed) và dữ liệu mồ côi. Không xoá tin, tài khoản hay hội thoại thật của người dùng.
- **Không task nào được báo xong chỉ dựa vào unit test.** Mỗi task chạm đường chạy thật phải có một bước kiểm trên stack local.

## Review Focus

1. **Tin ghi bằng các đường khác ngoài batch writer** phải có `seq`: media, poll, tin hệ thống, log cuộc gọi. Nếu thiếu, client sắp xếp sai và lấy bù hụt. → Task 2 `assigns seq on every write path`, cộng QC trình duyệt kịch bản B6 và B9.
2. **Trùng `clientMessageId` khi retry.** Phải trả về bản đã lưu, đúng `seq` cũ, và không tạo thêm `seq` trùng. → Task 2 `returns the stored seq for a duplicate clientMessageId`.
3. **Người gửi không bị tăng unread vì tin của chính mình.** Thành viên mới vào nhóm hoặc vào lại nhóm phải có unread bằng 0. → Task 4 `advances the sender's read mark`, `new and returning members start fully read`, QC B3.
4. **Phân trang sau khi xoá lịch sử hoặc xoá phía mình** vẫn đúng, khi cursor đã chuyển sang `seq`. → Task 3 `respects clearedHistorySeq`, QC B10.
5. **Hội thoại đang chờ dọn sau khi xoá** không được xuất hiện ở bất kỳ đâu: danh sách, tìm kiếm, `conversation-by-friend`, gửi tin vào. → Task 6 `hidden conversation is unreachable`, QC B8.

## Sửa đổi sau review vòng 1 (ưu tiên hơn nội dung gốc khi có mâu thuẫn)

Kiểm chứng ngày 2026-11-04: dựng collection nháp 50.000 document rồi `explain` đúng dạng `$expr` mà Prisma sinh ra.

| Dạng truy vấn | Kết quả |
|---|---|
| `seq < X`, sắp `seq desc` | IXSCAN, 30 key cho 30 dòng |
| Cờ boolean trong `$expr` | IXSCAN |
| Mảng `has` (Prisma sinh `$in: [v, "$arr"]`) | **25.000 key, không dùng được index** |
| Cursor cũ `OR(createdAt, id)` | IXSCAN, 30 key (P8 có thể không tồn tại; baseline sẽ trả lời) |
| `$or` hai cặp bạn bè | IXSCAN |

Các quyết định sửa theo kết quả trên:

- **R1 — Migration không chạy đua với chat.**
  - Task 2 dừng `daln-chat`, `daln-chat-2`, `daln-chat-3` **trước** khi lưu code mới, chạy `npm run migrate:run 0008-message-seq -- --service chat`, xong mới bật lại.
  - Migration chọn hội thoại có **bất kỳ** tin nào thiếu `seq`, đánh số lại **toàn bộ** hội thoại đó, rồi đặt `lastSeq = n`.
  - `reserveSeq` chỉ `$inc` khi document có `lastSeq` kiểu số và không có `deletedAt`. Ngược lại nó ném `ConversationNotReady`, tin bị retry hoặc dead-letter chứ không bao giờ nhận `seq` sai.
  - Mọi chỗ tạo `conversation` (tạo nhóm, saga tạo DIRECT) ghi `lastSeq: 0` ngay từ đầu.
- **R2 — Batch writer phân biệt các loại lỗi trùng khoá.**
  - E11000 trên `message_sender_client_id` hoặc `_id` → coi là đã lưu, như hiện nay.
  - E11000 trên `message_conversation_seq` → ném lỗi; lần retry **giữ chỗ khoảng `seq` mới** cho các dòng trong lô chưa được ghi. Đây là ngoại lệ duy nhất cho quy tắc "retry giữ nguyên `seq`".
  - Nhận diện bằng `keyPattern` hoặc tên index trong `errmsg`.
  - Test: `a seq collision is retried with a fresh range, never acked as stored`.
- **R3 — Cờ boolean thay cho mảng.**
  - Bỏ `attachmentKinds`. Dùng `hasMedia` (IMAGE/VIDEO), `hasFile`, `hasLink`.
  - Index `{conversationId:1, hasMedia:1, seq:-1}`, tương tự cho `hasFile` và `hasLink`.
  - `message-facets.ts` xuất `facetsOf(type, medias, content) → {hasMedia, hasFile, hasLink}`.
- **R4 — Fixtures ghi đủ `seq` và cờ.**
  - Nếu hội thoại đã có `lastSeq` (sau migration), `insertMessages` giữ chỗ bằng `$inc lastSeq` rồi ghi `seq`, `hasMedia`, `hasFile`, `hasLink`.
  - Nếu chưa có (trước migration), chèn như cũ để đo baseline.
- **R5 — Bỏ hẳn đường dự phòng, đặt tên field không trùng nhau.**
  - Field phi chuẩn hoá trên member tên là **`latestSeq`**, để không trùng với `conversation.lastMessageSeq` khi `toListRow` spread.
  - Cập nhật `LIST_ROW_SELECT`, `MEMBER_VIEW_SELECT` (`conversation.repository.ts`), `ViewerState`/`MemberView` (`conversation.mapper.ts`) và mọi chỗ dựng summary từ `findByIdWithMembers`.
  - `unreadCount = max(0, latestSeq − lastReadSeq)`. **Không** đọc lại `unreadCount` đã lưu.
  - Bỏ nhánh "trang thiếu `seq` thì đi đường cũ". Migration là bước bắt buộc khi deploy.
- **R6 — Lấy bù chỉ cho hội thoại đang mở.**
  - Nối lại socket: `syncAfter` cho **hội thoại đang mở**; các hội thoại khác đã có trong store bị đánh dấu `stale`.
  - Mở một hội thoại `stale`: tải lại trang đầu (`getMessages` không cursor) và thay cache.
  - `syncAfter` gọi tối đa **2 trang**. Vẫn còn `hasMore` thì bỏ cache và tải lại trang đầu.
- **R7 — Bộ đo không bị rate limit.**
  - Mọi request của bộ đo gửi kèm `X-Forwarded-For` ngẫu nhiên (Kong `TRUSTED_IPS 0.0.0.0/0`).
  - Gặp 429 thì kịch bản bị ghi là lỗi `rate-limited` và cả lần chạy bị coi là không hợp lệ.

- **R8 (review vòng 2) — Migrate mọi hội thoại, kể cả hội thoại chưa có tin.**
  - Migration đặt `lastSeq` (bằng số tin, 0 nếu rỗng) cho **mọi** hội thoại có `lastSeq` không phải kiểu số.
  - Đặt `lastReadSeq`/`latestSeq` cho **mọi** dòng thành viên.
  - Mapper vẫn ép `?? 0` để không bao giờ ra `NaN`.
  - Kiểm sau migration: `conversation.count({lastSeq: {$not: {$type: 'number'}}}) == 0`; điều kiện tương tự cho hai field trên `conversationMember`.
  - Test: `an empty conversation gets lastSeq 0 and can be written to`.
- **R9 (review vòng 2) — Lỗi của một hội thoại không làm hỏng cả lô.**
  - Batch writer giữ chỗ `seq` theo từng hội thoại bằng `allSettled`.
  - Hội thoại giữ chỗ thất bại: chỉ các tin của hội thoại đó bị reject. Nếu lỗi là `ConversationNotReady`, tức đã xoá hoặc chưa migrate, thì reject luôn, không retry.
  - Phần còn lại của lô vẫn được ghi.
  - Đụng `seq` (R2): chỉ giữ chỗ lại cho hội thoại bị đụng.
  - Test: `a deleted conversation in the batch does not fail the others`, `a seq collision re-reserves only that conversation`.

Góp ý non-blocking được nhận:

- **N1 — Lệnh thô cần đúng kiểu dữ liệu.** Mọi `$runCommandRaw` chuyển `{$oid}`/`{$date}` qua một helper chung (`raw-ejson.ts`). Mỗi lệnh thô mới có một bước kiểm trên Mongo thật bằng script `qc/raw-commands-check.mjs`, vì mock không bắt được lỗi id dạng chuỗi.
- **N2 — Bộ đo công bằng hơn.**
  - Có một lượt khởi động không tính số liệu.
  - Số liệu DB chỉ tính các collection của kịch bản; trừ đi số liệu đo được trong một khoảng thời gian rảnh có cùng độ dài.
  - `send-*` chạy 3 lần, lấy trung vị.
- **N3 — `read` có dữ liệu xác định.** Phần setup cho B gửi 40 tin mới, rồi A đọc lần lượt từ cũ tới mới.
- **N4 — `friends-search` vẫn có `$lookup` theo từng bạn.** Kỳ vọng chỉ là IXSCAN theo `userId`, không phải "docs ≈ số dòng trả về".
- **N5 — Thứ tự toàn phần trên client.** Tin có `seq` xếp trước, theo `seq`. Tin đang chờ ack xếp sau, theo thứ tự gửi cục bộ.
- **N6 — Dọn hội thoại không bỏ sót tin.** Khi xoá: đặt `deletedAt`, sau đó `reserveSeq` từ chối hội thoại này. Purge: xoá theo lô, xoá document hội thoại, rồi quét lại một lượt cuối.
- **N7 — Snapshot tin cuối cũ không có `seq`** được coi là `seq = 0`: chỉ ghi khi `lastMessageSeq` đang null.
- **N8 — Người gửi đọc qua lượt nhắc thì tắt luôn badge nhắc.** `advanceReadOfSenders` cũng tắt badge khi `lastMentionSeq ≤ seq`.
- **N9 — Lỗ trong dãy `seq`** (do tin trùng bị loại) làm unread dư 1 cho mỗi lỗ. Chấp nhận, và ghi vào design doc.
- **N11 — Viết bộ QC trình duyệt ngay sau Task 0** (Task 0b) và chạy nó trên code cũ.
- **N12 — Thêm kịch bản trình duyệt:**
  - B13: lightbox media (cuộn dải ảnh), "đi tới tin" từ tab tài nguyên và từ lightbox.
  - B14: log cuộc gọi qua `POST /chat/internal/group-call-log` với internal token dev, hiển thị trong khung chat.
  - B15: bộ lọc "Chưa đọc" ở sidebar; "đã xem" vẫn còn sau khi tải lại trang.
  - B16: huỷ kết bạn; từ chối lời mời.
  - B17 (QC tải, không cần trình duyệt): hai instance chat cùng chạy; vừa có tin text chảy liên tục vừa có tin hệ thống từ add/remove thành viên; kết quả phải là 0 `seq` trùng.
- **N13 — Phép kiểm `seq` trong `throughput.mjs`** chỉ áp dụng cho tin text do bộ tải gửi.

---

### Task 0: Bộ profiling và baseline (làm TRƯỚC mọi thay đổi code)

**Files:**
- Create: `qc/query-profile.mjs` — bộ chạy kịch bản và đo
- Create: `qc/query-profile-fixtures.mjs` — dựng dữ liệu lớn, chạy lại được nhiều lần
- Create: `qc/query-profile-compare.mjs` — so sánh hai lần chạy, in bảng và ghi JSON
- Output: `qc/.profile-runs/<label>.json`. `.profile-runs` phải được gitignore, giống `.scale-runs`.

**Cách đo một kịch bản:**
1. Bật profiler level 2 trên DB liên quan. `system.profile` capped 256 MB.
2. Chụp `serverStatus` trước: `opcounters`, `transactions.totalStarted/totalCommitted/totalAborted`.
3. Chạy thao tác qua **API thật** (Kong `:8080`) hoặc socket thật. Lặp N lần, ghi độ trễ wall-clock (p50, p95).
4. Chụp `serverStatus` sau. Gom `system.profile` theo `ns + lệnh`: số lệnh, `keysExamined`, `docsExamined`, `millis`, `planSummary`, các stage pipeline (có `$lookup` không), số lệnh có `txnNumber`.
5. Mỗi kịch bản ghi ra một bản ghi `{ id, wallP50, wallP95, commands, keys, docs, dbMillis, txnStarted, txnAborted, plans[] }`.

**Dữ liệu (fixtures), dựng một lần và đánh dấu bằng document `qc_fixture` trong `chat-service`:**
- Dọn dữ liệu đo cũ: tin có `content` bắt đầu bằng `lt|`, tin seed của scratchpad, các `messageMedia` mồ côi. In ra số dòng sẽ xoá trước khi xoá.
- Tài khoản: 3 người QC (A, B, C) qua `calls-fixtures.mjs`, cộng 20 người dùng thật (đăng ký qua API) để dùng cho thêm thành viên.
- **Nhóm G** (A, B, C): **300.000 tin** chèn thẳng vào Mongo, `senderId` là thành viên thật, `createdAt` tăng dần. Trong đó 2% có ảnh hoặc video (`messageMedia` thật), 1% file, 3% có link.
- **Nhóm D** (A, B): 100.000 tin, chỉ dùng cho kịch bản xoá. Dựng lại sau mỗi lần xoá.
- **Bạn bè:** 20.000 `User` giả, 200.000 `Friendship` giả, 5.000 `friendRequest` chèn thẳng. A có 300 bạn và 200 lời mời đang chờ.
- **64 nhóm cho tải** (`throughput.mjs MODE=spread` tự dựng).

**Kịch bản** (id cố định, chạy cả trước lẫn sau khi sửa):

| id | Thao tác | N |
|---|---|---|
| `assets-media` | `GET /chat/assets?kind=MEDIA` trên G, trang 1 và trang 2 | 10 |
| `assets-doc` | `kind=DOC` trên G | 10 |
| `assets-link` | `kind=LINK` trên G | 10 |
| `history-first` | `GET /chat/messages/G` trang đầu | 20 |
| `history-deep` | trang sau 3.000 tin (lấy cursor bằng cách đi 60 trang), đo trang thứ 60 | 10 |
| `read` | socket `message:read` của A trên G, mỗi lần một id mới hơn | 50 |
| `mention` | B gửi tin nhắc A qua socket, đo phần ghi `markMention` | 20 |
| `friends-list` | `GET /user/list-friend` của A | 20 |
| `friends-search` | tìm bạn theo tiền tố | 20 |
| `friend-requests` | danh sách lời mời đến và đi | 20 |
| `friendship-between` | endpoint gọi `findFriendshipBetweenUsers`, ví dụ `conversation-by-friend` hoặc profile người khác | 20 |
| `add-members` | thêm 20 người vào một nhóm mới | 3 |
| `delete-group` | xoá D: thời gian tới khi API trả về, thời gian tới khi D biến mất khỏi danh sách, thời gian tới khi không còn tin nào của D trong DB, và lỗi nếu có | 1 |
| `cron-load` | `throughput.mjs MODE=spread`, 1.000 msg/s trong 20 s: số transaction started/aborted, throughput đạt được, ack p95 | 1 |
| `send-hot` / `send-spread` | `throughput.mjs` ở r2000 (hot và spread): kiểm tra không thụt lùi | 1 |

- [ ] **Step 1:** Viết fixtures và bộ đo. Chạy với `LABEL=smoke` trên một tập nhỏ (G có 2.000 tin) để kiểm bộ đo. Expected: mọi kịch bản ghi được bản ghi; `assets-media` có plan với `$lookup`.
- [ ] **Step 2:** Dựng dữ liệu đủ lớn rồi chạy `LABEL=before`. Expected: có `qc/.profile-runs/before.json`; `assets-media` có `docs` ≈ 300.000.
- [ ] **Step 3:** Commit bộ đo: `test(qc): query profiling harness with before/after comparison`.

### Task 0b: QC trình duyệt chạy trên code cũ (N11)

- [ ] Viết `qc/query-regression-browser.mjs` gồm B1–B16 (xem Task 9), cộng `qc/seq-concurrency-load.mjs` cho B17.
- [ ] Chạy trên code cũ. Lỗi đã biết như B4 (lấy bù) và B5 (tin cuối) được phép FAIL; ghi lại đó là lỗi của code cũ. Mọi FAIL khác là lỗi của chính bộ kiểm: sửa bộ kiểm cho tới khi đúng.
- [ ] Commit: `test(qc): browser regression suite for features on the changed queries`.

### Task 1: Index cho bạn bè (P4)

**Files:** Modify `backend/apps/user/prisma/schema.prisma`
- `Friendship`: `@@index([userId, friendId])`, `@@index([friendId])` (cho phía ngược lại), `@@index([userId, id])` (cho danh sách theo thứ tự `id`).
- `friendRequest`: `@@index([toUserId, status, createdAt])`, `@@index([fromUserId, status, createdAt])`.

Không dùng unique ở bước này. Code đã kiểm trùng trong transaction rồi, còn dữ liệu cũ có thể đã trùng và làm `db push` lỗi. Ghi lại thành việc làm sau.

- [ ] **Step 1:** Sửa schema, chạy `docker compose run --rm db-push`. Expected: log có `[db-push user]` thành công; `getIndexes()` thấy các index mới.
- [ ] **Step 2:** Chạy riêng các kịch bản `friends-*` của bộ đo. Expected: `planSummary` là IXSCAN, `docs` xấp xỉ số dòng trả về.
- [ ] **Step 3:** Commit: `perf(user): index friendships and friend requests by user`.

### Task 2: Cấp `seq` ở mọi đường ghi, migration 0008 (lõi)

**Files:**
- Modify `backend/apps/chat/prisma/schema.prisma`:
  - `message.seq Int?`, `message.hasMedia Boolean?`, `message.hasFile Boolean?`, `message.hasLink Boolean?` (R3)
  - `conversation.lastSeq Int?`, `conversation.lastMessageSeq Int?`, `conversation.deletedAt DateTime?`
  - `conversationMember.lastReadSeq Int?`, `latestSeq Int?` (R5), `lastMentionSeq Int?`, `clearedHistorySeq Int?`
- Create `backend/apps/chat/src/repositories/seq-allocator.ts`: `reserveSeq(prisma: RawRunner, conversationId: string, n: number): Promise<number>`. Gọi `findAndModify` với `$inc: {lastSeq: n}`, `new: true`, `upsert: false`, và trả về `firstSeq = lastSeq − n + 1`. Hội thoại không tồn tại thì ném lỗi.
- Create `backend/apps/chat/src/domain/message-facets.ts`: `facetsOf(type, medias, content) → {hasMedia, hasFile, hasLink}` (R3). `hasLink` dùng **cùng** điều kiện với tab Link hiện tại (`http` hoặc `www.`).
- Modify `message-batch-writer.service.ts`:
  - `flush()` gom lô theo `conversationId`, gọi `reserveSeq` song song cho từng hội thoại, rồi gán `seq` theo thứ tự trong buffer.
  - Gán thêm `hasLink`; `hasMedia` và `hasFile` là `false`.
  - Retry giữ nguyên `seq`, giống cách đang giữ `_id`.
  - `BatchedMessage` có thêm `seq`.
  - Tin trùng trả `seq` đã lưu; `loadStored` projection thêm `seq`.
- Modify `message-raw.queries.ts`: projection có `seq`, `StoredKey.seq`.
- Modify `message.repository.ts`: `createWithRelations` và `createCallLog` gọi `reserveSeq(…, 1)` trước `create`, rồi ghi `seq`, `hasMedia`, `hasFile`, `hasLink`.
- Modify `domain/message.mapper.ts`: `toResponse` có thêm `seq` (`null` nếu thiếu).
- Create `backend/migrations/chat/0008-message-seq.ts` (mode `deploy`, chạy lại được, có `dryRun`):
  1. Với mỗi hội thoại có `lastSeq` không phải kiểu số, **hoặc** có bất kỳ tin nào thiếu `seq` (R1, R8): đánh số lại **toàn bộ** tin theo `(createdAt, _id)` bằng index cũ. `bulkWrite` mỗi lô 1.000 để `$set` `seq` từ 1 đến n, kèm `hasMedia`/`hasFile` (từ `messageMedia` theo `messageId` và từ `type`) và `hasLink`. Sau đó đặt `conversation.lastSeq = n` (0 nếu rỗng), và `lastMessageSeq` bằng `seq` của `lastMessageId`.
  2. Thành viên:
     - `lastReadSeq` = `seq` của `lastReadMessageId`, hoặc 0 nếu chưa có.
     - `lastMentionSeq` lấy tương tự từ `lastMentionMessageId`.
     - `clearedHistorySeq` = `seq` lớn nhất có `createdAt ≤ clearedHistoryAt`.
     - `latestSeq` = `conversation.lastSeq` (áp dụng cho **mọi** dòng thành viên, R8).
     - **Giữ nguyên `unreadCount` hiện có**: đặt `lastReadSeq = max(lastReadSeq, lastSeq − unreadCount)`, để badge sau migration bằng badge trước migration.
  3. Tạo các index: unique `{conversationId:1, seq:1}` (tên `message_conversation_seq`), cùng `{conversationId:1, hasMedia:1, seq:-1}`, `{conversationId:1, hasFile:1, seq:-1}`, `{conversationId:1, hasLink:1, seq:-1}` (R3).
- Test: `seq-allocator.spec.ts`, `message-facets.spec.ts`, `message-batch-writer.service.spec.ts` (bổ sung), `message.repository.spec.ts` (bổ sung), `backend/migrations/chat/0008-message-seq.spec.ts` (dùng helper trong `libs/migrations/src/testing`).

**Test cần có:**
- `reserves a contiguous range and returns its first seq`
- `assigns increasing seq per conversation in buffer order` (hai hội thoại xen kẽ trong một lô)
- `retries a failed batch with the same seq`
- `returns the stored seq for a duplicate clientMessageId`
- `assigns seq on every write path` (media, poll, call log, system)
- `facetsOf` (bảng giá trị: ảnh kèm chữ, file, chỉ link, `www.`, không có gì)
- Migration:
  - `numbers messages by (createdAt, _id) with ties broken by _id`
  - `keeps each member's unread count`
  - `maps lastReadMessageId and clearedHistoryAt to seq`
  - `is a no-op on a second run`
  - `dry run writes nothing`

- [ ] **Step 1:** Viết test trước, chạy và xác nhận chúng FAIL.
- [ ] **Step 2:** Code cho tới khi test PASS. Chạy `npx jest apps/chat migrations/chat`.
- [ ] **Step 3:** Chạy migration trên stack local (G có 300.000 tin). Ghi lại thời gian. Kiểm bằng aggregate: số cặp `(conversationId, seq)` trùng phải bằng 0, và mọi tin đều có `seq`.
- [ ] **Step 4:** Gửi vài tin text, ảnh, poll; thêm thành viên để sinh tin hệ thống. Kiểm trong DB: `seq` tăng dần liên tục.
- [ ] **Step 5:** Commit: `feat(chat): number messages per conversation with seq`.

### Task 3: Lịch sử và tab tài nguyên chạy trên `seq` (P1, P3, P8)

**Files:**
- `backend/libs/util/src/cursor.ts`:
  - thêm `buildSeqCursor(seq: number): string` (định dạng `s:<seq>`);
  - thêm `parseSeqCursor(raw): number | null`;
  - cursor cũ dạng `<ISO>|<id>` vẫn đọc được: trả `null` để server dùng nhánh cũ.
- `message.repository.ts`:
  - `findByConversationIdPaginatedForUser(conversationId, userId, take, beforeSeq: number|null, clearedHistorySeq: number|null)`: lọc `seq < beforeSeq` và `seq > clearedHistorySeq`, sắp `seq desc`.
  - **Mới:** `findAfterSeq(conversationId, userId, afterSeq, take, clearedHistorySeq)`: lọc `seq > afterSeq`, sắp `seq asc`, vẫn lọc tin "xoá phía mình".
  - `findConversationAssets`: `MEDIA` là `hasMedia: true`, `DOC` là `hasFile: true`, `LINK` là `hasLink: true` (R3); sắp `seq desc`, cursor là `seq`. **Bỏ `$lookup`.**
- `message.service.ts`:
  - `getMessagesByConversationId` nhận thêm `afterSeq?`. Có `afterSeq` thì trả `{items, nextCursor: null, hasMore}` theo thứ tự tăng dần. Không có thì giữ hành vi cũ, nhưng cursor đã là `seq`.
  - `getConversationAssets` dùng cursor `seq`.
- `PageQueryDto` (chat): thêm `afterSeq?: number` (validate là số nguyên ≥ 0).
- Test: `message.repository.spec.ts`, `message.service.spec.ts`, `cursor.spec.ts`

**Test cần có:**
- `pages by seq and returns a seq cursor`
- `respects clearedHistorySeq and delete-for-me`
- `afterSeq returns newer messages ascending with hasMore`
- `assets MEDIA/DOC/LINK filter on stored facets without $lookup` (kiểm `where` không có `medias`)
- `legacy timestamp cursor still returns the next page`

- [ ] **Step 1:** Test FAIL → code → test PASS.
- [ ] **Step 2:** Trên stack local, chạy riêng `assets-*`, `history-*` của bộ đo. Expected: không còn `$lookup`, `docs` ≈ `take`.
- [ ] **Step 3:** Commit: `perf(chat): page history and assets by seq on stored facets`.

### Task 4: Đã đọc, chưa đọc, nhắc tên, tin cuối trên `seq` (P2, P7)

**Files:**
- `conversation-member.repository.ts`:
  - `updateLastRead(conversationId, userId, lastReadMessageId)`:
    1. Một lệnh `findFirst` lấy `seq` của tin, kiểm tin thuộc đúng hội thoại.
    2. **Một** lệnh `update` thô, dùng pipeline: chỉ khi `lastReadSeq < s` thì đặt `lastReadSeq = s`, `lastReadMessageId`, `lastReadAt`; cùng lệnh đó, nếu `lastMentionSeq ≤ s` thì `unreadMentionCount = 0` và `lastMentionMessageId = null`.
    3. Bỏ bước đếm lại số chưa đọc.
    4. Trả `{count}` như cũ.
  - `markMention`: một lệnh `update` thô `multi`: `$inc unreadMentionCount`, `$max lastMentionSeq`, `$set lastMentionMessageId`. Giờ nhận thêm `seq`.
  - `clearMentions`: lệnh `update` thô.
  - **Mới** `advanceMembers(conversationId, {lastMessageAt, seq})`: `update` thô `multi` với `$max: {lastMessageAt, latestSeq: seq}`.
  - **Mới** `advanceReadOfSenders(conversationId, {senderId: seq})`: `update` thô, `$max lastReadSeq` cho từng người gửi.
  - Bỏ `updateUnreadCount` và `updateLastMessageAt` (cũ).
- `conversation.repository.ts`: `saveLastMessage` thành `update` thô có điều kiện `lastMessageSeq` đang null hoặc nhỏ hơn `seq`.
- `domain/conversation.mapper.ts`, cùng `LIST_ROW_SELECT`, `MEMBER_VIEW_SELECT` và các kiểu `ViewerState`/`MemberView` (R5):
  - `unreadCount = max(0, (latestSeq ?? 0) − (lastReadSeq ?? 0))`. Không đọc lại `unreadCount` đã lưu.
  - Trả thêm `lastMessageSeq` và `lastReadSeq` của từng thành viên.
- `services/message.service.ts` `enqueueConversationSyncJob`:
  - Bỏ `HINCRBY`.
  - Snapshot tin cuối mang thêm `seq`; Lua chỉ `SET` khi `seq` mới lớn hơn.
  - `unread_last` đổi thành hash `senderId → seq lớn nhất` (Lua `HSET` khi lớn hơn).
- `background-jobs/unread/unread.cron.ts` và `unread.constants.ts`:
  - Claim lấy snapshot và hash người gửi.
  - Ghi `saveLastMessage` có điều kiện, `advanceMembers`, `advanceReadOfSenders`.
  - `restore` chỉ còn trả snapshot và hash về. Bỏ nhánh số đếm.
  - Đọc được dữ liệu Redis cũ: hash cũ chứa ObjectId thì bỏ qua và ghi log.
- `addMembers` và tạo hội thoại (`buildMemberRow`): thành viên mới hoặc vào lại có `lastReadSeq = latestSeq = conversation.lastSeq`. Hội thoại mới tạo có `lastSeq: 0` (R1).
- `clearHistoryForMember`: đặt `clearedHistorySeq = lastSeq`, `lastReadSeq = lastSeq`.
- Test: các spec tương ứng

**Test cần có:**
- `read is one raw update and never moves the mark back`
- `read clears the mention badge once past the last mention`
- `unreadCount is latestSeq minus lastReadSeq, floored at 0`
- `advances the sender's read mark` (cron)
- `last message only moves forward` (Redis Lua và Mongo; tái hiện lỗi "tin trả lời rồi tin thường liền nhau")
- `new and returning members start fully read`
- `cron writes no transactions` (khẳng định không gọi Prisma `updateMany`)

- [ ] **Step 1:** Test FAIL → code → test PASS.
- [ ] **Step 2:** Trên stack local: kịch bản `read`, `mention`, `cron-load`. Expected: số transaction gần 0; `read` chỉ còn 2 lệnh.
- [ ] **Step 3:** Commit: `perf(chat): read marks, unread and last message on seq without transactions`.

### Task 5: `addMembers` một lượt (P6)

**Files:** `conversation-member.repository.ts` `addMembers(conversationId, members)`:
1. Một lệnh `find` thô lấy các dòng sẵn có `{conversationId, userId in}`.
2. Một lệnh `update` thô nhiều `updates` cho người đã có (kích hoạt lại, cập nhật hồ sơ, `lastReadSeq`/`latestSeq` = `lastSeq`).
3. Một lệnh `insert` cho người mới, dùng `buildMemberRow`.

Trả về số dòng thay đổi như cũ. `invalidateMembersCache` gọi một lần.

**Test cần có:** `adds new, reactivates removed, ignores active members in three commands`.

- [ ] Test FAIL → code → test PASS. Chạy kịch bản `add-members`. Expected: số lệnh không phụ thuộc vào N. Commit: `perf(chat): add group members in three commands`.

### Task 6: Xoá hội thoại = ẩn ngay, dọn theo lô (P5)

**Files:**
- `conversation.repository.ts` `deleteConversationById`:
  1. `update` thô `conversation.deletedAt = now`.
  2. `update` thô `multi` trên các thành viên: `isActive = false`. Đây là bước khiến hội thoại biến mất khỏi danh sách và tìm kiếm.
  3. Dọn cache thành viên.
- Create `backend/apps/chat/src/background-jobs/purge/conversation-purge.cron.ts`: chạy mỗi 10 s, có khoá Redis `SET NX PX`. Với mỗi hội thoại có `deletedAt`, lặp:
  1. Lấy 1.000 id tin theo `seq`.
  2. Xoá `messageMedia`, `deleteMessage`, `pollVote` và `poll` theo các id đó.
  3. Xoá chính các tin đó.

  Hết tin thì xoá các thành viên và document hội thoại. Mọi lệnh đều là `delete` thô, không transaction, chạy lại được.
- Kiểm mọi đường đọc hội thoại (`findById*`, `conversation-by-friend`, tìm kiếm, gửi tin) đều chặn khi `deletedAt` khác null.
- Saga bù trừ (`chat-saga.subscriber.ts` `deleteConversation`) giữ transaction: hội thoại vừa tạo nên rất nhỏ, và nó cần nằm chung transaction với outbox.

**Test cần có:**
- `delete hides the conversation at once`
- `purge removes messages and their rows in batches`
- `purge resumes after a crash midway`
- `hidden conversation is unreachable` (gửi tin, lấy chi tiết, `conversation-by-friend`)

- [ ] Test FAIL → code → test PASS. Chạy kịch bản `delete-group`. Expected: API trả về dưới 100 ms, dọn xong 100.000 tin không lỗi. Commit: `perf(chat): delete a conversation by hiding it and purging in batches`.

### Task 7: Frontend sắp theo `seq`, lấy bù khi thiếu, tin cuối chỉ tiến lên

**Files:**
- `frontend/src/redux/slices/messageSlice.ts`:
  - `Message.seq?: number | null`.
  - `compareNewestFirst` theo thứ tự toàn phần (N5): tin có `seq` xếp trước, theo `seq`; sau đó là tin đang chờ ack, theo thứ tự gửi cục bộ.
  - `ackMessage` sắp xếp lại sau khi gộp.
  - Thêm state `syncedSeq: Record<conversationId, number>`.
  - Thêm thunk `syncAfter(conversationId)` gọi `GET /chat/messages/:id?afterSeq=` theo vòng cho tới khi `hasMore = false`, gộp kết quả và đặt `syncedSeq`. Mỗi hội thoại chỉ một lần gọi đang chạy.
- `frontend/src/apis` (chỗ đang có `getMessagesAPI`): thêm tham số `afterSeq`.
- `hooks/useProtectedRouteChatSockets.ts`:
  - Khi nhận `MESSAGE_NEW`: nếu `seq > syncedSeq + 1` và hội thoại đã được tải, gọi `syncAfter` (debounce 300 ms).
  - Khi nối lại (R6): gửi lại tin đang chờ; `syncAfter` cho **hội thoại đang mở**; các hội thoại khác đã có trong store bị đánh dấu `stale`; tải lại trang đầu danh sách hội thoại.
  - `syncAfter` gọi tối đa 2 trang; vẫn còn thì bỏ cache và tải lại trang đầu.
- `redux/slices/conversationSlice.ts` `updateNewMessage`: bỏ qua nếu `lastMessage.seq` nhỏ hơn `target.lastMessageSeq`; cập nhật `lastMessageSeq`. Thêm `lastMessageSeq` vào kiểu `Conversation`.
- Test (nếu frontend có jest/vitest thì viết unit test cho reducer; nếu không, phủ bằng QC trình duyệt B1–B4):
  - `sorts by seq, pending last`
  - `ack re-sorts`
  - `older last message does not replace a newer one`
  - `gap triggers one sync`

- [ ] Code. `npx tsc -b` và lint sạch. Commit: `feat(frontend): order by seq, resync gaps and after reconnect`.

### Task 8: Đo lại và so sánh

- [ ] Chạy migration trên dữ liệu profiling (nếu chưa chạy), rồi `LABEL=after node qc/query-profile.mjs`.
- [ ] `node qc/query-profile-compare.mjs before after` ghi ra `qc/.profile-runs/compare.json` và in bảng. Expected:
  - `assets-*`: `docs` giảm từ 300.000 xuống cỡ vài chục.
  - `read`: số transaction từ 3 xuống 0.
  - `friends-*`: từ COLLSCAN sang IXSCAN.
  - `delete-group`: từ lỗi hoặc chậm sang trả về ngay, dọn theo lô.
  - `add-members`: số lệnh không phụ thuộc N.
  - `cron-load`: transaction gần 0.
  - `history-deep`: `keys` ≈ `take`.
  - `send-*`: throughput không giảm quá 10%.
- [ ] Nếu một kịch bản không tốt lên như kỳ vọng: tìm nguyên nhân bằng systematic-debugging, sửa, đo lại. Không được báo cáo che đi.

### Task 9: QC trình duyệt hồi quy (Puppeteer)

**Files:** Create `qc/query-regression-browser.mjs`. Dùng `calls-fixtures.mjs` để tạo A, B, C mới mỗi lần chạy: A–B là bạn, có nhóm A–B–C. Mỗi người một Chrome, đăng nhập qua form. Ảnh lưu ở `qc/shots/qr-*.png`. Mỗi phép kiểm in PASS/FAIL, exit code 1 nếu có FAIL.

| id | Kịch bản | Truy vấn liên quan |
|---|---|---|
| B1 | Gửi và nhận text hai chiều, đúng thứ tự; tải lại trang thì lịch sử vẫn đúng thứ tự | batch writer, `seq`, lịch sử |
| B2 | Có 120 tin (seed qua API), cuộn lên để tải trang cũ hơn: đủ tin, không trùng, không hụt | cursor `seq` |
| B3 | B gửi 7 tin thì A thấy badge 7 (cả sau khi tải lại trang); A mở hội thoại thì về 0; A gửi tin thì badge của A không tăng; B thấy "đã xem" của A | đã đọc, chưa đọc, cron |
| B4 | A offline (`setOfflineMode` + ngắt socket) trong 10 s, B gửi 5 tin, A online lại: trong 5 s thấy đủ 5 tin đúng thứ tự, không cần tải lại trang | lấy bù `afterSeq` |
| B5 | B gửi tin trả lời rồi tin thường liền nhau, lặp 5 lần: danh sách của A luôn hiện tin thường là tin cuối, kể cả sau khi tải lại trang | tin cuối |
| B6 | Nhắc tên: B @A thì A có badge nhắc; A đọc thì badge tắt; nút "đi tới lượt nhắc" hoạt động | nhắc tên |
| B7 | Gửi ảnh, file và link; mở thông tin hội thoại thì tab Ảnh/Video, File, Link hiện đúng; tải thêm trang tab | tab tài nguyên |
| B8 | Thêm 2 người vào nhóm có tin hệ thống và số thành viên đúng; xoá rồi thêm lại một người, người đó có unread 0; xoá nhóm thì nhóm biến mất ở cả 3 phía và DB dọn hết tin | `addMembers`, xoá |
| B9 | Tạo poll, bỏ phiếu; thu hồi tin; xoá phía mình; xoá lịch sử hội thoại rồi gửi tin mới | đường ghi khác, lọc lịch sử |
| B10 | Sau khi xoá lịch sử: cuộn lên không thấy tin cũ; tin bị xoá phía mình không quay lại khi lấy bù | `clearedHistorySeq`, `afterSeq` |
| B11 | Bạn bè: danh sách bạn, tìm theo tiền tố, gửi/nhận/chấp nhận lời mời, mở hội thoại với bạn | index bạn bè |
| B12 | Tìm nhóm theo tên ở thanh tìm kiếm | `searchGroups` |

- [ ] Chạy trên **code cũ** trước khi merge Task 2 nếu được, để chắc bộ kiểm không tự sai. Những kịch bản lỗi trên code cũ là đúng (như B4, B5) thì ghi nhận là lỗi đã biết.
- [ ] Chạy trên code mới. Expected: tất cả PASS.
- [ ] Chạy lại các bộ QC đã có để chắc không hỏng chỗ khác: `chat-scale-load.mjs` kịch bản `steady`, và `throughput.mjs` (bước kiểm sau khi đo thêm "`seq` tăng nghiêm ngặt trong từng hội thoại").
- [ ] Commit: `test(qc): browser regression for every feature on the changed queries`.

### Task 10: Gate cuối

- [ ] Backend: `npx jest`, `npm run typecheck`, `npm run lint:check`. Frontend: lint và `tsc`. Tất cả sạch.
- [ ] Một reviewer độc lập (subagent) review toàn branch theo Review Focus.
- [ ] Cập nhật `docs/design/message-seq-design.md`: trạng thái "đã triển khai §1–§9", kèm các chỗ lệch so với thiết kế.

### Task 11: Artifact tổng kết

Một trang gồm:
- Bảng trước và sau cho từng kịch bản, có biểu đồ (dataviz).
- Sơ đồ kiến trúc của luồng ghi tin có `seq` và luồng cron sau khi sửa (dùng skill diagram-design).
- Danh sách thay đổi theo vấn đề P1–P8.
- Kết quả QC trình duyệt, có ảnh chụp.
- Những việc còn để sau.
