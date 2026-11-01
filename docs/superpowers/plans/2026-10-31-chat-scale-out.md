# Nhiều instance chat và nhiều realtime-gateway — Kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chạy được N realtime-gateway và N instance chat ở local, thêm hoặc bớt instance ngay khi đang chạy, với điều kiện không mất tin, không trùng tin, không đảo thứ tự trong một hội thoại. QC bằng tải và bằng trình duyệt thật chứng minh điều đó.

**Architecture:**
- **Gửi tin:** gateway băm `conversationId` ra 16 partition RabbitMQ (`chat.send.p0..15`, single-active-consumer).
- **Chia partition:** các instance chat tự chia partition qua Redis. Mỗi instance có heartbeat, cùng chạy một hàm `stickyAssign`, giữ partition bằng lease `SET NX PX`, và nhả partition theo trình tự HOLD → FINISH → CLOSE.
- **Bên trong instance:** mỗi hội thoại một làn. Chặn trùng bằng partial unique index `(senderId, clientMessageId)`.
- **Gateway:** sharded Redis adapter, presence nguyên tử bằng Lua, timer gọi nhóm chuyển vào Redis, publish có chờ confirm để báo `SERVER_BUSY`.

**Tech Stack:** NestJS 11 · @golevelup/nestjs-rabbitmq 6.1 + amqplib 0.10 · ioredis · `redis` 5.11 + `@socket.io/redis-adapter` 8.3 · Prisma 6.19 (MongoDB) · Jest 30 + ts-jest · Kong 3.7 (DB-less) · React 19 + socket.io-client · puppeteer-core + socket.io-client (QC)

**Spec:** [`docs/superpowers/specs/2026-10-31-chat-scale-out-design.md`](../specs/2026-10-31-chat-scale-out-design.md)

## Global Constraints

- **Chỉ local.** Không sửa `docker-compose.prod.yml`, không sửa CI/CD. `kong/kong.yml` không đổi.
- **Hằng số chốt trong spec:**
  - `PARTITION_COUNT = 16`. Băm bằng FNV-1a 32-bit.
  - Exchange `chat.send` (direct). Queue `chat.send.p{n}`. Routing key `send.p{n}`.
  - Policy `chat-send-partitions`: priority 1, `max-length` 20000, `overflow: reject-publish`, `dead-letter-exchange: daln.dlx`.
  - Thời gian: nhịp 2000ms · TTL thành viên 6000ms · TTL lease 6000ms · chờ trước khi tham gia 3000ms.
  - Retry trong làn: 50/200/800ms. Gateway chờ confirm 5000ms.
  - Timer gọi nhóm: pending 35000ms, empty 15000ms, quét mỗi 1000ms.
  - Client gửi lại khi gặp `SERVER_BUSY` sau 2s/4s/8s.
- **Không đổi hành vi hiện có**, ngoài những gì spec nêu:
  - Lỗi 4xx vẫn trả `MESSAGE_ERROR` rồi ack.
  - Mention, reply, unread cron giữ nguyên.
  - Payload `MESSAGE_ACK` và `MESSAGE_NEW` giữ nguyên.
- **Lệnh test backend** chạy trong `backend/`: `npx jest <path>`, `npm run typecheck`, `npm run lint:check`.
- **Commit** dưới danh tính git của người dùng. Không thêm Claude làm author hay co-author. Không commit `.claude/`. Làm trên branch `feat/chat-scale-out` cắt từ `develop`.
- **Không task nào được báo "xong" chỉ dựa vào unit test.** Task có đường chạy thật thì phải có bước kiểm trên stack local. Toàn bộ plan chỉ xong khi qua **Final Verification Gate**: QC tải và QC trình duyệt thật bằng puppeteer-core với Chrome.
- **Toàn quyền với DB và volume local.** Được `docker compose down -v`, tạo tài khoản QC, và ghi thẳng Redis/Mongo khi QC cần.

## Review Focus

1. **Tin tới đúng lúc partition đang bàn giao.** Người dùng kỳ vọng tin không mất và không đảo thứ tự. → Task 7 `holds deliveries that arrive while draining and closes without acking them`, cộng QC kịch bản 3 và 4.
2. **Gửi lại cùng `clientMessageId`** (client gửi lại sau khi gateway chết, hoặc broker giao lại). Kỳ vọng chỉ có một bản ghi và client nhận ACK với id cũ. → Task 2 `returns the stored message when the same clientMessageId is written twice` và `resolves every caller when one row of the batch is a duplicate`.
3. **Thông báo `chat:rebalance` tới đúng lúc đang tính dở.** Kỳ vọng instance vẫn tính lại ngay, không chờ 2 giây. → Task 9 `runs another tick when notified during a tick`.
4. **Redis chập chờn trong khi đang giữ partition.** Kỳ vọng vẫn tiếp tục xử lý tin, không tự nhả toàn bộ. → Task 9 `keeps its partitions when redis is unreachable`.
5. **Hai tab của một user kết nối vào hai gateway cùng lúc.** Kỳ vọng chỉ phát online một lần, và chỉ phát offline khi tab cuối cùng đóng. → Task 13 `reports online exactly once for two concurrent connections`.

---

## File Structure

| File | Trách nhiệm |
|---|---|
| `backend/libs/constant/rmq/partition.ts` (mới) | Hằng số partition, `partitionOf`, tên queue và routing key |
| `backend/libs/common/src/rmq/send-topology.ts` (mới) | Khai báo exchange, 16 queue và binding (dùng chung cho gateway và chat) |
| `backend/docker/rabbitmq-init.sh` | Thêm policy `chat-send-partitions` |
| `backend/apps/chat/prisma/schema.prisma` | `message.clientMessageId String?` |
| `backend/migrations/chat/0007-message-client-id-unique.ts` (mới) | Partial unique index |
| `backend/apps/chat/src/services/message-batch-writer.service.ts` | Insert `ordered:false`, xử lý trùng, đổi hook tắt máy |
| `backend/apps/chat/src/repositories/message.repository.ts` | Truyền `clientMessageId`, đường media gặp trùng thì trả bản cũ |
| `backend/apps/chat/src/partitions/conversation-lanes.ts` (mới) | Làn tuần tự theo hội thoại |
| `backend/apps/chat/src/partitions/send-message.handler.ts` (mới) | Làn + retry tại chỗ + `MESSAGE_ERROR` (thay `MessageSubscriber.sendMessage`) |
| `backend/apps/chat/src/partitions/sticky-assign.ts` (mới) | Hàm chia partition (hàm thuần) |
| `backend/apps/chat/src/partitions/partition-consumer.ts` (mới) | Một channel cho mỗi partition, HOLD → FINISH → CLOSE |
| `backend/apps/chat/src/partitions/lease-store.ts` (mới) | Interface `LeaseStore` + `RedisLeaseStore` (Lua) |
| `backend/apps/chat/src/partitions/partition-coordinator.ts` (mới) | Vòng tính lại, giành/nhả lease, tắt máy |
| `backend/apps/chat/src/partitions/partitions.module.ts` (mới) | Wiring DI |
| `backend/apps/realtime-gateway/src/realtime/realtime.gateway.ts` | Publish theo partition + confirm, log node, dùng presence và timer mới |
| `backend/apps/realtime-gateway/src/realtime/redis.adapter.ts` | Sharded adapter |
| `backend/apps/realtime-gateway/src/realtime/user-status.store.ts` | `addConnection` / `removeConnection` nguyên tử |
| `backend/apps/realtime-gateway/src/realtime/group-call-timers.ts` (mới) | Timer gọi nhóm trong Redis + sweeper |
| `backend/docker-compose.yml` | Profile `scale`, alias, `KONG_DNS_VALID_TTL` |
| `frontend/src/hooks/useProtectedRouteChatSockets.ts` | Gửi lại khi reconnect, retry `SERVER_BUSY` |
| `frontend/src/lib/resendPending.ts` (mới) | Chọn tin pending cần gửi lại, lịch retry |
| `qc/calls-fixtures.mjs` | Export thêm `register`, `befriend`, `api` |
| `qc/chat-scale-load.mjs` (mới) | Tải + checker + 6 kịch bản |
| `qc/chat-scale-browser.mjs` (mới) | QC trình duyệt, kịch bản 7–9 + tái hiện 2/3/5 bằng UI |
| `qc/README.md` | Mục "Scale-out" |

---

### Task 0: Dựng lại stack local và chụp baseline

**Files:** không sửa code.

- [ ] **Step 1: Tạo branch** — `git checkout develop && git pull && git checkout -b feat/chat-scale-out`
- [ ] **Step 2: Dựng stack từ volume trống** — trong `backend/`: `docker compose down -v && docker compose up -d --build`. Chờ tới khi `docker compose ps` cho thấy mọi app service ở trạng thái `running` và `daln-migrate` đã thoát với mã 0.
- [ ] **Step 3: Chạy frontend** — trong `frontend/`: `npm run dev -- --port 5174`. Mở `http://localhost:5174/auth` phải ra form đăng nhập.
- [ ] **Step 4: Baseline QC** — `cd qc && npm install && ./auth-api.sh`. Kỳ vọng: không có dòng `❌`. Ghi lại số `✅` vào ghi chú PR để so sánh về sau.
- [ ] **Step 5: Baseline test** — trong `backend/`: `npx jest` và `npm run typecheck` đều xanh. Nếu có test đỏ sẵn từ trước thì ghi lại tên, không sửa trong plan này.

---

### Task 1: `clientMessageId` và partial unique index

**Files:**
- Modify: `backend/apps/chat/prisma/schema.prisma` (model `message`)
- Create: `backend/migrations/chat/0007-message-client-id-unique.ts`
- Test: `backend/migrations/chat/0007-message-client-id-unique.spec.ts`

**Interfaces:**
- Produces: field `clientMessageId?: string | null` trên model `message`. Index tên `message_sender_client_id`.

- [ ] **Step 1: Viết test lỗi** — dùng harness trong `libs/migrations/src/testing` (giống các spec migration khác). Hai test:
  - `creates a unique index scoped to documents that have a clientMessageId`: chạy `up`, rồi khẳng định `indexes()` có `{ name: 'message_sender_client_id', key: { senderId: 1, clientMessageId: 1 }, unique: true, partialFilterExpression: { clientMessageId: { $type: 'string' } } }`.
  - `still allows many legacy messages without clientMessageId`: chèn 3 document không có field này. Không được ném lỗi.
- [ ] **Step 2: Chạy** `npx jest migrations/chat/0007` → FAIL (chưa có file).
- [ ] **Step 3: Viết migration** — `id: '0007-message-client-id-unique'`, `mode: 'deploy'`, `up` gọi `db.collection('message').createIndex(...)` với đúng các option trên. Khi `dryRun` thì chỉ log. Thêm `clientMessageId String?` vào model `message` kèm comment một dòng: "Khoá chống trùng; unique index partial nằm ở migration chat/0007 vì Prisma không khai báo được partial index".
- [ ] **Step 4: Chạy lại test** → PASS. Chạy `npx prisma generate --schema=apps/chat/prisma/schema.prisma`.
- [ ] **Step 5: Kiểm trên stack thật** — `docker compose restart db-push migrate` rồi:
  `docker exec daln-mongo mongosh chat-service --quiet --eval 'db.message.getIndexes().map(i=>i.name)'`
  Kỳ vọng: có `message_sender_client_id`. Sau đó chạy **lại** `docker compose restart db-push` rồi kiểm tra một lần nữa: index **vẫn còn**. Mục đích là chắc chắn `prisma db push` không xoá index lạ. Nếu bị xoá, chuyển việc tạo index sang `docker/db-push.sh`, chạy ngay sau `db push`, và ghi lý do vào commit.
- [ ] **Step 6: Commit** — `feat(chat): store clientMessageId with a partial unique index per sender`

---

### Task 2: Ghi tin idempotent

**Files:**
- Modify: `backend/apps/chat/src/services/message-batch-writer.service.ts`
- Modify: `backend/apps/chat/src/repositories/message.repository.ts:27-60`
- Modify: `backend/apps/chat/src/services/message.service.ts:189-197` (truyền `clientMessageId` vào `messageRepo.create`)
- Test: `backend/apps/chat/src/services/message-batch-writer.service.spec.ts` (mới)

**Interfaces:**
- Consumes: `clientMessageId` từ Task 1.
- Produces:
  - `BatchMessageInput.clientMessageId: string` (bắt buộc).
  - `MessageRepository.create(data: { …; clientMessageId: string })` resolve ra tin đã lưu. Nếu tin đã tồn tại thì là **bản cũ** (cùng `id` và `createdAt`).

- [ ] **Step 1: Viết test lỗi** — mock `prisma.$runCommandRaw` và `prisma.message.findMany`. Ba test:
  - `writes a batch with one insert command using ordered false`: khẳng định lệnh có `insert: 'message'`, `ordered: false`, và mỗi document có `clientMessageId`.
  - `returns the stored message when the same clientMessageId is written twice`: lệnh trả về `writeErrors: [{ index: 0, code: 11000 }]`, còn `findMany` trả về bản cũ với `id: 'old'`. Caller resolve với `id === 'old'`.
  - `resolves every caller when one row of the batch is a duplicate`: lô 3 tin, dòng thứ 2 bị trùng. Cả 3 caller đều resolve, và caller thứ 2 nhận bản cũ.
- [ ] **Step 2: Chạy** `npx jest message-batch-writer` → FAIL.
- [ ] **Step 3: Implement trong `flush()`:**
  - Thay `createMany` bằng `prisma.$runCommandRaw({ insert: 'message', documents, ordered: false })`. ObjectId và Date viết theo Extended JSON: `{ $oid }`, `{ $date }`.
  - Gom các `writeErrors` có `code === 11000`, rồi đọc lại bằng **một** `findMany({ where: { OR: [{ senderId, clientMessageId }…] } })`.
  - Lỗi khác 11000 thì reject cả lô (giữ hành vi cũ).
  - Đổi `onModuleDestroy` thành `beforeApplicationShutdown`. Thứ tự tắt máy xem Task 10.
- [ ] **Step 4: Đường media/poll** trong `message.repository.ts`: bọc nested create. Nếu gặp lỗi trùng khoá (`P2002`, hoặc message chứa `E11000`) thì trả về bản có cùng `(senderId, clientMessageId)`. Thêm test `returns the existing message when a media message is retried` vào `backend/apps/chat/src/repositories/message.repository.spec.ts` (mới).
- [ ] **Step 5: Chạy** `npx jest message-batch-writer message.repository` → PASS. Chạy `npm run typecheck` → xanh.
- [ ] **Step 6: Kiểm trên stack thật** — đăng nhập một tài khoản QC, gửi một tin qua UI. Sau đó `docker exec daln-mongo mongosh chat-service --quiet --eval 'db.message.find({}, {clientMessageId:1}).sort({_id:-1}).limit(1).toArray()'`. Kỳ vọng: có `clientMessageId` bắt đầu bằng `temp-id`.
- [ ] **Step 7: Commit** — `feat(chat): make message writes idempotent on (senderId, clientMessageId)`

---

### Task 3: Topology partition

**Files:**
- Create: `backend/libs/constant/rmq/partition.ts`
- Create: `backend/libs/common/src/rmq/send-topology.ts` (export trong `libs/common/src/rmq/index.ts`)
- Modify: `backend/docker/rabbitmq-init.sh` (thêm policy, cùng kiểu lệnh `api PUT` với `daln-dlx`)
- Test: `backend/libs/constant/rmq/partition.spec.ts`, `backend/libs/common/src/rmq/send-topology.spec.ts`

**Interfaces:**
- Produces:
  - `PARTITION_COUNT = 16`, `SEND_EXCHANGE = 'chat.send'`
  - `partitionOf(conversationId: string): number`
  - `partitionQueue(p: number): string` → `chat.send.p${p}`
  - `partitionRoutingKey(p: number): string` → `send.p${p}`
  - `assertSendTopology(channel: Pick<Channel, 'assertExchange' | 'assertQueue' | 'bindQueue'>): Promise<void>`

- [ ] **Step 1: Viết test lỗi:**
  - `partitionOf is stable and in range`: `partitionOf('6a3500000000000000000001')` gọi hai lần cho cùng kết quả. 1000 id ngẫu nhiên đều nằm trong `[0, 16)`. 1000 id dạng ObjectId trải đều đủ cả 16 partition.
  - `partitionOf matches FNV-1a`: `partitionOf('a') === 0xe40c292c % 16` và `partitionOf('') === 0x811c9dc5 % 16`.
  - `asserts one exchange and 16 single-active-consumer queues`: dùng channel giả ghi lại lệnh. Khẳng định có `assertExchange('chat.send','direct',{durable:true})`, đúng 16 lệnh `assertQueue(name,{durable:true, arguments:{'x-single-active-consumer':true}})`, và 16 lệnh `bindQueue`.
- [ ] **Step 2: Chạy** → FAIL.
- [ ] **Step 3: Implement.** Thuật toán băm (dùng `TextEncoder` để lấy byte UTF-8):
  ```ts
  let h = 0x811c9dc5
  for (const byte of utf8Bytes(conversationId)) { h ^= byte; h = Math.imul(h, 0x01000193) >>> 0 }
  return h % PARTITION_COUNT
  ```
  Trong `rabbitmq-init.sh` thêm policy:
  `{"pattern":"^chat\\.send\\.p\\d+$","definition":{"dead-letter-exchange":"daln.dlx","max-length":20000,"overflow":"reject-publish"},"apply-to":"queues","priority":1}`, kèm comment giải thích vì sao phải chép lại `dead-letter-exchange`.
- [ ] **Step 4: Chạy** → PASS.
- [ ] **Step 5: Kiểm trên stack thật** — `docker compose up -d rabbitmq-init`, sau đó `curl -s -u user:user localhost:15672/api/policies/%2F | jq '.[].name'`. Kỳ vọng: có `daln-dlx` và `chat-send-partitions`.
- [ ] **Step 6: Commit** — `feat(rmq): partitioned chat.send topology and queue policy`

---

### Task 4: Gateway publish theo partition và chờ confirm

**Files:**
- Modify: `backend/apps/realtime-gateway/src/realtime/realtime.gateway.ts` (`handleCreateMessage`, khoảng dòng 459–492, và `onApplicationBootstrap` để gọi `assertSendTopology(this.amqpConnection.channel)`)
- Test: `backend/apps/realtime-gateway/src/realtime/realtime.gateway.spec.ts` (thêm case)

**Interfaces:**
- Consumes: `partitionOf`, `partitionRoutingKey`, `SEND_EXCHANGE`, `assertSendTopology` từ Task 3.
- Produces: socket event `MESSAGE_ERROR` với `{ code: 'SERVER_BUSY', retryable: true, clientMessageId, conversationId, message }`.

- [ ] **Step 1: Viết test lỗi:**
  - `publishes to the conversation's partition`: khẳng định `amqpConnection.publish` được gọi với `('chat.send', 'send.p<partitionOf(cid)>', payload, …)`.
  - `emits SERVER_BUSY when the broker rejects the publish`: `publish` reject. Khẳng định client nhận `MESSAGE_ERROR` với `code: 'SERVER_BUSY'` và `retryable: true`.
  - `emits SERVER_BUSY when the broker does not confirm within 5000ms`: dùng fake timers, `publish` không bao giờ resolve.
- [ ] **Step 2: Chạy** → FAIL.
- [ ] **Step 3: Implement** — `handleCreateMessage` thành `async`, gọi `await withTimeout(publishEvent(this.amqpConnection, SEND_EXCHANGE, partitionRoutingKey(partitionOf(cid)), message), 5000)`. Bắt lỗi thì emit `SERVER_BUSY`. Các route khác vẫn dùng `this.publish` cũ (fire-and-forget).
- [ ] **Step 4: Chạy** → PASS.
- [ ] **Step 5: Commit** — `feat(gateway): publish messages to their partition and surface broker back-pressure`

> Từ commit này tới Task 10, gửi tin trên stack thật **sẽ không tới người nhận**: tin nằm trong `chat.send.p*` vì chưa có ai consume. Đây là trạng thái trung gian có chủ đích, không phải lỗi. Đường gửi được kiểm lại end-to-end ở Task 10 Step 5.

---

### Task 5: Làn theo hội thoại và retry tại chỗ

**Files:**
- Create: `backend/apps/chat/src/partitions/conversation-lanes.ts`
- Create: `backend/apps/chat/src/partitions/send-message.handler.ts`
- Test: `conversation-lanes.spec.ts`, `send-message.handler.spec.ts` (cùng thư mục)

**Interfaces:**
- Consumes:
  - `MessageService.sendMessage(data: MessageSendPayload)`
  - `ChatEventsPublisher.publishMessageError(senderId, { clientMessageId, conversationId, code, message, retryable })`
- Produces:
  - `class ConversationLanes { run<T>(key: string, task: () => Promise<T>): Promise<T>; get size(): number }`
  - `@Injectable() class SendMessageHandler { handle(payload: MessageSendPayload): Promise<'ack' | 'dead-letter'> }`
  - `export const RETRY_DELAYS_MS = [50, 200, 800]`

- [ ] **Step 1: Viết test lỗi cho lanes:**
  - `runs tasks of one key in submission order even when the first is slower`: task A mất 30ms, task B mất 1ms, cùng key. Thứ tự hoàn thành phải là `['A','B']`.
  - `runs different keys concurrently`: hai key, mỗi task mất 30ms. Tổng thời gian < 50ms.
  - `a failed task does not block the next one on the same key`
  - `forgets idle keys`: sau khi chạy xong, `size === 0`.
- [ ] **Step 2: Viết test lỗi cho handler:**
  - `acks after sendMessage resolves`
  - `retries in place with 50/200/800ms then dead-letters`: dùng fake timers, `sendMessage` luôn ném `Error`. Khẳng định gọi đúng 4 lần, `publishMessageError` nhận `retryable: true`, và kết quả là `'dead-letter'`.
  - `acks without retry on a 4xx HttpException and reports the error`
  - `keeps conversation order across a retried message`: tin 1 lỗi một lần rồi thành công, tin 2 cùng hội thoại. Thứ tự gọi `sendMessage` thành công phải là 1 rồi 2.
- [ ] **Step 3: Chạy** → FAIL.
- [ ] **Step 4: Implement:**
  - `ConversationLanes`: `Map<string, Promise<unknown>>`. Promise mới = `prev.catch(() => {}).then(task)`. Trong `finally` xoá key nếu promise trong map vẫn là promise này.
  - `SendMessageHandler.handle`: `lanes.run(payload.conversationId, …)`. Phân loại lỗi giống `MessageSubscriber.sendMessage` hiện tại (`chat-subcribers.ts:50-80`), nhưng retry ngay trong làn thay vì ném ra ngoài.
- [ ] **Step 5: Chạy** → PASS.
- [ ] **Step 6: Commit** — `feat(chat): per-conversation lanes with in-place retry for sends`

---

### Task 6: `stickyAssign`

**Files:**
- Create: `backend/apps/chat/src/partitions/sticky-assign.ts`
- Test: `backend/apps/chat/src/partitions/sticky-assign.spec.ts`

**Interfaces:**
- Produces: `stickyAssign(members: string[], owners: (string | null)[]): string[]`. Độ dài kết quả = `owners.length`. Trả về `[]` khi `members` rỗng.

- [ ] **Step 1: Viết test lỗi** với `ABC = ["A","A","A","A","A","A","C","C","B","B","B","B","B","C","C","C"]`. Các giá trị này đã được kiểm chứng bằng bản TS, Python và C++ khớp nhau trên 300 case ngẫu nhiên:
  - `cold start gives everything to the only member`: `(['A'], Array(16).fill(null))` → 16 × `'A'`
  - `a joining member takes exactly its quota`: `(['A','B','C','D'], ABC)` → `["A","A","A","A","D","D","C","C","B","B","B","B","D","C","C","D"]`
  - `a dead member's partitions are the only ones that move`: `(['A','B'], ABC)` → `["A","A","A","A","A","A","B","A","B","B","B","B","B","B","A","B"]`
  - `member order and duplicates do not change the result`: `(['B','A','C','A'], ABC)` → `ABC`
  - `is a fixed point`: với mọi kết quả `r` ở trên, `stickyAssign(members, r)` vẫn ra `r`.
  - `balances within one and moves the minimum` (property test, 300 case ngẫu nhiên): mọi member có số partition chênh nhau ≤ 1. Số vị trí đổi chủ = Σ partition của member đã chết + Σ max(0, đang giữ − quota).
- [ ] **Step 2: Chạy** → FAIL.
- [ ] **Step 3: Implement** theo đúng 3 bước của spec §3. Hàm thuần: không đọc giờ, không random, không có state.
- [ ] **Step 4: Chạy** → PASS.
- [ ] **Step 5: Commit** — `feat(chat): sticky balanced partition assignment`

---

### Task 7: `PartitionConsumer`

**Files:**
- Create: `backend/apps/chat/src/partitions/partition-consumer.ts`
- Test: `backend/apps/chat/src/partitions/partition-consumer.spec.ts`

**Interfaces:**
- Consumes: `partitionQueue` (Task 3), `SendMessageHandler.handle` (Task 5).
- Produces:
  - `type PartitionHandler = (payload: MessageSendPayload) => Promise<'ack' | 'dead-letter'>`
  - `class PartitionConsumer { static start(source: { createChannel(): Promise<Channel> }, partition: number, handler: PartitionHandler, prefetch: number): Promise<PartitionConsumer>; readonly partition: number; drain(): Promise<void>; onLost(cb: () => void): void }`

- [ ] **Step 1: Viết test lỗi** với channel giả: lưu callback `consume`, ghi lại `ack`/`nack`/`close`, phát được sự kiện `close`.
  - `acks after the handler returns ack`, `nacks without requeue on dead-letter`
  - `sets prefetch before consuming`
  - `holds deliveries that arrive while draining and closes without acking them`: một tin đang xử lý, gọi `drain()`, rồi giao thêm 2 tin. Khẳng định handler chỉ được gọi 1 lần, tin đang xử lý được ack, 2 tin sau **không** ack cũng **không** nack, và `close` được gọi **sau** khi tin đầu xong.
  - `drain is idempotent`
  - `reports loss when the channel closes on its own`: phát `close` khi không drain thì `onLost` được gọi. Đóng do chính `drain()` thì `onLost` không được gọi.
- [ ] **Step 2: Chạy** → FAIL.
- [ ] **Step 3: Implement** — HOLD, FINISH, CLOSE theo spec §3. Tin không parse được JSON thì `nack(false, false)`.
- [ ] **Step 4: Chạy** → PASS.
- [ ] **Step 5: Commit** — `feat(chat): partition consumer with hold-finish-close drain`

---

### Task 8: `RedisLeaseStore`

**Files:**
- Create: `backend/apps/chat/src/partitions/lease-store.ts`
- Test: `backend/apps/chat/src/partitions/lease-store.spec.ts`. Chạy trên Redis thật; tự `skip` khi không có `LEASE_STORE_REDIS_URL`.

**Interfaces:**
- Produces:
  ```ts
  export interface LeaseStore {
    heartbeat(memberId: string, ttlMs: number): Promise<string[]> // danh sách còn sống, đã sort
    leave(memberId: string): Promise<void>
    owners(): Promise<(string | null)[]>                            // độ dài PARTITION_COUNT
    acquire(p: number, memberId: string, ttlMs: number): Promise<boolean>
    renew(p: number, memberId: string, ttlMs: number): Promise<'renewed' | 'lost'>
    release(p: number, memberId: string): Promise<void>
    notify(): Promise<void>
    onNotify(cb: () => void): Promise<void>
  }
  export class RedisLeaseStore implements LeaseStore { constructor(redis: Redis, subscriber: Redis) }
  ```
  Key, channel và giá trị theo spec §3.

- [ ] **Step 1: Viết test** (với `LEASE_STORE_REDIS_URL=redis://localhost:6380/15`, dùng DB 15 và `flushdb` trước mỗi test):
  - `heartbeat lists live members and drops members silent for longer than the ttl` (dùng ttl 300ms)
  - `acquire succeeds only when the lease is free`
  - `renew reports lost once someone else owns the lease`
  - `release never deletes another member's lease`
  - `a lease expires on its own after the ttl`
  - `notify reaches onNotify subscribers`
- [ ] **Step 2: Chạy** `LEASE_STORE_REDIS_URL=redis://localhost:6380/15 npx jest lease-store` → FAIL.
- [ ] **Step 3: Implement.** Heartbeat dùng một script Lua:
  ```lua
  local t = redis.call('TIME'); local now = t[1]*1000 + math.floor(t[2]/1000)
  redis.call('ZADD', KEYS[1], now, ARGV[1])
  redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, now - tonumber(ARGV[2]))
  return redis.call('ZRANGE', KEYS[1], 0, -1)
  ```
  `renew` = `GET` so sánh rồi `PEXPIRE`. `release` = `GET` so sánh rồi `DEL`, cả hai đều là Lua. `acquire` = `SET … NX PX`. `owners` = `MGET` 16 key.
- [ ] **Step 4: Chạy** → PASS. Chạy thêm `npx jest lease-store` không có biến môi trường → hiển thị skipped, không đỏ.
- [ ] **Step 5: Commit** — `feat(chat): redis lease store for partition ownership`

---

### Task 9: `PartitionCoordinator`

**Files:**
- Create: `backend/apps/chat/src/partitions/partition-coordinator.ts`
- Test: `backend/apps/chat/src/partitions/partition-coordinator.spec.ts`

**Interfaces:**
- Consumes: `LeaseStore` (Task 8), `stickyAssign` (Task 6), giao diện `{ partition; drain(); onLost(cb) }` của `PartitionConsumer` (Task 7).
- Produces:
  ```ts
  export interface CoordinatorOptions { tickMs: number; memberTtlMs: number; leaseTtlMs: number; settleMs: number; now: () => number }
  export class PartitionCoordinator {
    constructor(store: LeaseStore, startConsumer: (p: number) => Promise<{ partition: number; drain(): Promise<void>; onLost(cb: () => void): void }>, memberId: string, options: CoordinatorOptions)
    start(): Promise<void>        // subscribe notify + interval
    tick(): Promise<void>         // một vòng; gọi chồng thì gộp lại
    ownedPartitions(): number[]
    shutdown(): Promise<void>     // leave → notify → drain tất cả → release tất cả
  }
  ```

- [ ] **Step 1: Viết test lỗi** với `FakeLeaseStore` (lưu trong bộ nhớ, `now` giả) và consumer giả có `drain` ghi lại lời gọi:
  - `does nothing before the settle period`
  - `claims all 16 partitions when it is the only member`
  - `hands partitions to a new member and only those`: hai coordinator A và B dùng chung một store, gọi tick xen kẽ. Cuối cùng A giữ p0–p7, B giữ p8–p15 (đúng `stickyAssign`). Mỗi partition chỉ có một chủ tại mọi thời điểm (kiểm sau mỗi tick).
  - `does not subscribe until the previous owner released`: `acquire` trả `false` thì không gọi `startConsumer`.
  - `drains before releasing`: thứ tự gọi phải là `drain(p)` rồi `release(p)` rồi `notify()`.
  - `runs another tick when notified during a tick`: `heartbeat` chờ một promise. Gọi `tick()` hai lần trong lúc đang chờ. Khẳng định `heartbeat` được gọi đúng 2 lần, không phải 1 và không phải 3.
  - `releases a partition when renew returns lost`
  - `keeps its partitions when redis is unreachable`: `renew` ném lỗi. Khẳng định không drain, không release.
  - `takes over a crashed member's partitions after its ttl`: B dừng tick, tăng `now` thêm 6000ms. A giữ cả 16 partition.
  - `drops a partition whose channel was lost and reclaims it on the next tick`
  - `shutdown leaves, notifies, drains every partition and releases them`
- [ ] **Step 2: Chạy** → FAIL.
- [ ] **Step 3: Implement** theo đúng vòng tính lại ở spec §3. Gộp các lần gọi tick chồng nhau bằng hai cờ `running` và `pending`. Mỗi lần tính lại log một dòng `[partitions] member=<id> owned=<list> moved=<+a,-b>`. QC đọc dòng này.
- [ ] **Step 4: Chạy** → PASS.
- [ ] **Step 5: Commit** — `feat(chat): partition coordinator with leases, rebalance and graceful drain`

---

### Task 10: Nối dây vào service chat

**Files:**
- Create: `backend/apps/chat/src/partitions/partitions.module.ts`
- Modify: `backend/apps/chat/src/chat.module.ts` (import module, bỏ handler `sendMessage` khỏi `MessageSubscriber`)
- Modify: `backend/apps/chat/src/rmq/subcribers/chat-subcribers.ts` (xoá `sendMessage`)
- Modify: `backend/libs/constant/rmq/queue.ts` (xoá `CHAT_SEND_MESSAGE`)
- Modify: `backend/apps/chat/prisma/prisma.service.ts` (`onModuleDestroy` → `onApplicationShutdown`)
- Test: `backend/apps/chat/src/partitions/partitions.module.spec.ts`

**Interfaces:**
- Consumes: mọi thứ từ Task 3, 5, 7, 8, 9.
- Produces:
  - Provider `PartitionCoordinator`. `memberId = ${os.hostname()}-${randomUUID().slice(0,8)}`.
  - Options lấy từ env, mặc định theo spec.
  - `startConsumer = (p) => PartitionConsumer.start(amqpConnection.connection, p, (m) => handler.handle(m), Number(process.env.CHAT_PARTITION_PREFETCH ?? 100))`.

**Thứ tự tắt máy (chốt):**

| Phase | Việc |
|---|---|
| `onModuleDestroy` | Coordinator `shutdown()`, outbox relay dừng |
| `beforeApplicationShutdown` | BatchWriter flush lần cuối (Task 2) |
| `onApplicationShutdown` | Prisma ngắt kết nối, golevelup đóng kết nối |

Nest chạy xong toàn bộ một phase rồi mới sang phase tiếp theo. Vì vậy drain luôn xong trước khi BatchWriter và Prisma đóng.

- [ ] **Step 1: Viết test lỗi** `assembles the coordinator and declares topology on bootstrap`: Nest testing module với AMQP và Redis giả. Khẳng định `assertSendTopology` được gọi và `coordinator.start()` được gọi một lần.
- [ ] **Step 2: Chạy** → FAIL. **Step 3: Implement.** **Step 4: Chạy** → PASS. Sau đó chạy `npx jest apps/chat`, `npm run typecheck`, `npm run lint:check` → đều xanh.
- [ ] **Step 5: Kiểm trên stack thật (1 instance):**
  - `docker compose restart chat`. Trong `docker logs daln-chat` phải có dòng `[partitions] … owned=0,1,…,15`.
  - `docker exec daln-redis redis-cli mget $(printf 'chat:lease:p%d ' $(seq 0 15))` trả về 16 lần cùng một memberId.
  - Gửi tin qua UI. Tin tới người nhận như trước.
  - `docker stop daln-chat` rồi xem log: phải có các dòng drain và release, và **không** có lỗi Prisma hay "Connection closed".
- [ ] **Step 6: Commit** — `feat(chat): consume sends through coordinated partitions`

---

### Task 11: Chạy nhiều instance ở local

**Files:**
- Modify: `backend/docker-compose.yml`
- Modify: `backend/apps/realtime-gateway/src/realtime/realtime.gateway.ts` (log khi socket kết nối)

**Interfaces:**
- Produces:
  - Các service `chat-2`, `chat-3`, `realtime-gateway-2`, `realtime-gateway-3` thuộc `profiles: ['scale']`. Dùng `<<: *app-common`, có `container_name` `daln-chat-2`… và `daln-realtime-2`…, không có `ports`. Network `backend` với `aliases: [chat]` hoặc `[realtime-gateway]`. Env giống service gốc.
  - Kong có env `KONG_DNS_VALID_TTL: 5`.
  - Gateway log: `socket connected user=<id> node=<hostname>`.

- [ ] **Step 1: Sửa compose và thêm log.** Cập nhật comment đầu file với lệnh `docker compose --profile scale up -d`.
- [ ] **Step 2: Kiểm DNS:**
  - `docker compose --profile scale up -d`
  - `docker exec daln-kong getent ahostsv4 realtime-gateway | awk '{print $1}' | sort -u | wc -l` → `3`
  - `docker exec daln-kong getent ahostsv4 chat | awk '{print $1}' | sort -u | wc -l` → `3`
  - Nếu Kong chỉ dùng một địa chỉ (QC Task 16 sẽ thấy mọi socket nằm ở cùng một node), chuyển sang khai báo `upstreams` có 3 target trong một file Kong **chỉ dùng cho dev**, `kong/kong.dev.yml`, mount qua compose dev. `kong/kong.yml` của prod giữ nguyên.
- [ ] **Step 3: Kiểm phân phối** — mở 6 tab ẩn danh (hoặc chạy nhanh `qc/chat-scale-load.mjs --only-connect` sau Task 16). `docker logs` của ba gateway cộng lại có đủ 3 giá trị `node=` khác nhau.
- [ ] **Step 4: Kiểm chia partition** — log của chat cho thấy 3 instance giữ 6/5/5 partition. `mget` lease ra đúng 3 memberId.
- [ ] **Step 5: Commit** — `chore(dev): compose profile to run several chat and gateway instances`

---

### Task 12: Sharded Redis adapter

**Files:**
- Modify: `backend/apps/realtime-gateway/src/realtime/redis.adapter.ts`
- Test: `backend/apps/realtime-gateway/src/realtime/redis.adapter.spec.ts` (mới)

- [ ] **Step 1: Viết test lỗi** `uses the sharded adapter in dynamic mode`: mock `@socket.io/redis-adapter`. Khẳng định `createShardedAdapter` được gọi với `{ subscriptionMode: 'dynamic' }` và `createAdapter` không được gọi.
- [ ] **Step 2: Chạy** → FAIL. **Step 3: Implement.** **Step 4: Chạy** → PASS.
- [ ] **Step 5: Kiểm trên stack thật** — chạy profile scale. `docker exec daln-redis redis-cli pubsub shardchannels | head` có các kênh dạng `socket.io#/realtime#user:…`. Hai user ở hai gateway khác nhau nhắn qua lại được (kiểm thủ công một lần, QC Task 17 sẽ chứng minh đầy đủ).
- [ ] **Step 6: Commit** — `feat(gateway): sharded redis adapter so rooms only reach nodes that need them`

---

### Task 13: Presence nguyên tử

**Files:**
- Modify: `backend/apps/realtime-gateway/src/realtime/user-status.store.ts`
- Modify: `backend/apps/realtime-gateway/src/realtime/realtime.gateway.ts` (connect và disconnect dùng kết quả trả về, bỏ `isOnline` trước và sau)
- Test: `backend/apps/realtime-gateway/src/realtime/user-status.store.spec.ts` (mới). Dùng Redis thật, skip khi không có `LEASE_STORE_REDIS_URL` (cùng biến với Task 8).

**Interfaces:**
- Produces:
  - `addConnection(userId, socketId): Promise<{ cameOnline: boolean }>`
  - `removeConnection(userId, socketId): Promise<{ wentOffline: boolean }>`
  - Key và TTL giữ nguyên: `user:{id}:sockets`, `socket:{id}` EX 90, `online:users`.

- [ ] **Step 1: Viết test lỗi:**
  - `reports online exactly once for two concurrent connections`: `Promise.all` hai lệnh `addConnection` khác socket. Đúng một kết quả có `cameOnline: true`.
  - `reports offline only when the last live socket leaves`
  - `ignores expired sockets when deciding`: một socket cũ đã hết TTL vẫn nằm trong set. Kết nối mới vẫn được tính là `cameOnline: true`.
- [ ] **Step 2: Chạy** → FAIL.
- [ ] **Step 3: Implement** mỗi hàm bằng một script Lua. Trước khi đếm, dọn khỏi set các socket không còn key `socket:{id}`, rồi mới thêm hoặc gỡ socket.
- [ ] **Step 4: Chạy** → PASS. Chạy `npx jest apps/realtime-gateway` → xanh.
- [ ] **Step 5: Commit** — `fix(gateway): decide online/offline atomically across gateways`

---

### Task 14: Timer gọi nhóm trong Redis

**Files:**
- Create: `backend/apps/realtime-gateway/src/realtime/group-call-timers.ts`
- Modify: `backend/apps/realtime-gateway/src/realtime/realtime.gateway.ts` (thay `groupPendingTimers` / `groupEmptyTimers` và các hàm `schedule…`/`clear…`, khoảng dòng 121–126 và 1436–1475)
- Test: `group-call-timers.spec.ts` (Redis thật, skip giống Task 13)

**Interfaces:**
- Produces:
  ```ts
  export class GroupCallTimers {
    constructor(redis: Redis, onDue: (kind: 'pending' | 'empty', callId: string) => Promise<void>, pollMs = 1000)
    schedule(kind: 'pending' | 'empty', callId: string, delayMs: number): Promise<void>
    cancel(kind: 'pending' | 'empty', callId: string): Promise<void>
    start(): void; stop(): void
  }
  ```
  ZSET `call:group:deadlines`, member `${kind}:${callId}`.

- [ ] **Step 1: Viết test lỗi:**
  - `fires a due timer once even with two sweepers`: hai instance cùng Redis, `schedule` 50ms. `onDue` được gọi đúng 1 lần.
  - `a cancelled timer never fires`
  - `a timer survives the instance that scheduled it`: instance 1 `schedule` rồi `stop()`. Instance 2 vẫn chạy `onDue`.
- [ ] **Step 2: Chạy** → FAIL.
- [ ] **Step 3: Implement** — mỗi `pollMs` lấy `ZRANGEBYSCORE key 0 now LIMIT 0 50`. Với từng member, chỉ ai `ZREM` trả về 1 mới gọi `onDue`. Trong gateway: `onDue('pending')` gọi `cancelGroupIfEmpty`, `onDue('empty')` gọi `finishGroupCall`. Hai hàm này đã tự kiểm tra lại trạng thái, giữ nguyên.
- [ ] **Step 4: Chạy** → PASS. Chạy `npx jest apps/realtime-gateway` → xanh (gồm cả các spec gọi nhóm hiện có).
- [ ] **Step 5: Commit** — `fix(gateway): keep group-call deadlines in redis so any gateway can fire them`

---

### Task 15: Client gửi lại tin

**Files:**
- Create: `frontend/src/lib/resendPending.ts`
- Modify: `frontend/src/hooks/useProtectedRouteChatSockets.ts` (`errorHandler` khoảng dòng 113, và đăng ký `socket.on('connect')`)
- Modify: `frontend/src/hooks/chat/useChatComposer.ts` (tách hàm emit để dùng lại)

**Interfaces:**
- Consumes: `MessageState.messages`, các action `retryMessage` / `failMessage` có sẵn trong `messageSlice`.
- Produces:
  - `pendingTextMessages(state: MessageState): Array<{ conversationId: string; clientMessageId: string; content: string; replyToMessageId?: string }>`
  - `BUSY_RETRY_DELAYS_MS = [2000, 4000, 8000]`
  - `nextBusyDelay(attempt: number): number | null` (trả `null` khi đã hết lượt)

Frontend không có framework test. Hai hàm thuần trên được kiểm bằng QC Task 17 (kịch bản 5 và 6), cộng `npm run build` và `npm run lint`.

- [ ] **Step 1: Implement:**
  - `socket.on('connect')`: bỏ qua lần kết nối đầu. Từ lần thứ hai trở đi, emit lại `message:create` cho từng phần tử của `pendingTextMessages`, giữ nguyên `clientMessageId`.
  - `errorHandler`: nếu `code === 'SERVER_BUSY'` và `nextBusyDelay(n) !== null` thì hẹn gửi lại sau khoảng đó. Ngược lại thì `failMessage` như hiện tại.
- [ ] **Step 2: Kiểm** — trong `frontend/`: `npm run build && npm run lint` → xanh.
- [ ] **Step 3: Commit** — `feat(web): resend unacknowledged messages after reconnect and on server busy`

---

### Task 16: QC tải và checker (kịch bản 1–6)

**Files:**
- Modify: `qc/calls-fixtures.mjs` (export `register`, `befriend`, `api`)
- Modify: `qc/package.json` (thêm `socket.io-client` vào devDependencies, thêm script `"scale": "node ./chat-scale-load.mjs"`)
- Create: `qc/chat-scale-load.mjs`
- Modify: `qc/README.md` (mục "Scale-out": chuẩn bị, lệnh, bảng kịch bản)

**Hành vi của script:**
- **Fixture:** 6 tài khoản và 24 nhóm (mỗi nhóm 3 người ngẫu nhiên) để phủ được nhiều partition. In ra số partition khác nhau mà 24 nhóm rơi vào (dùng cùng FNV-1a). Phải ≥ 12.
- **Client:**
  - Mỗi tài khoản một `socket.io-client` qua Kong (`ws://localhost:8080/realtime`, cookie của tài khoản đó).
  - Mỗi người gửi vào các nhóm của mình theo burst 1–4 tin, cách nhau 5–30ms. Nội dung `qc:<runId>:<sender>:<seq>`, `clientMessageId = qc-<runId>-<sender>-<seq>`.
  - Có cùng logic gửi lại như frontend: tự gửi lại tin chưa ACK sau khi reconnect, và retry `SERVER_BUSY` sau 2/4/8s.
- **Theo dõi:** mỗi 100ms đọc 16 lease (`docker exec daln-redis redis-cli mget …`) và ghi lại lúc nào partition nào đổi chủ.
- **Checker** (sau khi tắt tải và chờ 15s):
  - Đọc `db.message.find({content:/^qc:<runId>:/})` qua `docker exec daln-mongo mongosh`, sort theo `(createdAt, _id)`.
  - **Mất** = đã nhận ACK nhưng không có trong DB.
  - **Trùng** = một `clientMessageId` có >1 bản ghi.
  - **Đảo** = trong cùng (hội thoại, người gửi), `seq` giảm.
  - Đo p50 và p99 độ trễ từ lúc gửi tới lúc nhận ACK.
- **Kịch bản** (`SCENARIO=`, tải 30s, sự kiện ở giây thứ 12):

  | Tên | Sự kiện | Đạt khi (spec §9) |
  |---|---|---|
  | `steady` | không có | 0/0/0 |
  | `crash-chat` | `docker kill daln-chat-2` | 0/0/0, các partition của nó có chủ mới ≤ 10s |
  | `stop-chat` | `docker stop daln-chat-2` | 0/0/0, mỗi partition chuyển chủ dừng < 1s |
  | `add-chat` | `docker compose --profile scale up -d chat-3` (lúc bắt đầu chỉ chạy `chat` và `chat-2`) | 0/0/0, tập partition chuyển sang khớp `stickyAssign` |
  | `kill-gateway` | `docker kill daln-realtime-2` | 0/0/0, mọi client reconnect được |
  | `overload` | đổi policy `max-length` thành `5` qua management API trong 8s, rồi trả về `20000` | có ít nhất 1 `SERVER_BUSY`, sau đó 0/0/0 |

- **Đầu ra:** mỗi kịch bản in một dòng `SCENARIO <tên> PASS|FAIL lost=… dup=… reorder=… takeover=…ms p99=…ms` và một bảng partition: trước, sau, đã chuyển. Exit code khác 0 nếu có FAIL.

- [ ] **Step 1: Viết script** theo mô tả trên.
- [ ] **Step 2: Tự kiểm checker.** Chạy `steady`, rồi chèn tay một bản sao vào Mongo và chạy lại phần checker (`CHECK_ONLY=<runId>`). Kỳ vọng FAIL `dup=1`. Xoá bản sao, chạy lại, kỳ vọng PASS. Bước này chứng minh phép đo không mù.
- [ ] **Step 3: Chạy cả 6 kịch bản** trên stack profile scale. Trước mỗi kịch bản, dựng lại đúng trạng thái ban đầu (`docker compose --profile scale up -d` rồi dừng các instance không dùng). Kỳ vọng cả 6 PASS.
- [ ] **Step 4: Kịch bản đối chứng (chứng minh từng cơ chế có tác dụng):** tạm tắt từng cơ chế bằng env chỉ dùng cho QC: `CHAT_QC_DISABLE_LANES=1`, `CHAT_QC_DISABLE_DEDUP=1`. Đọc các biến này trong `SendMessageHandler` và `MessageBatchWriter`, có comment rõ là chỉ dành cho QC.
  - `steady` với lanes tắt → kỳ vọng `reorder > 0`.
  - `crash-chat` với dedup tắt → kỳ vọng `dup > 0` (có thể phải chạy vài lần vì phụ thuộc thời điểm kill). Nếu sau 5 lần không lần nào ra `dup > 0`, ghi vào kết quả là chưa tái hiện được, không bịa số.
  - Ghi kết quả vào PR.
- [ ] **Step 5: Commit** — `test(qc): load and correctness harness for chat scale-out`

---

### Task 17: QC trình duyệt thật (kịch bản 7–9, và 2/3/5 qua UI)

**Files:**
- Create: `qc/chat-scale-browser.mjs` (cùng kiểu với `calls-browser.mjs`: puppeteer-core, Chrome thật, đăng nhập qua form, ảnh lưu ở `qc/shots/scale-*.png`)
- Modify: `qc/README.md`

**Hành vi:**
- **Chuẩn bị:** 3 tài khoản A, B, C với một nhóm (dùng `fixtures()`), mỗi tài khoản một Chrome. Sau khi đăng nhập, đọc log `socket connected user=… node=…` của các gateway. Nếu cả 3 nằm cùng node thì reload tab của B hoặc C (tối đa 10 lần) cho tới khi có ít nhất 2 node khác nhau. Không đạt thì FAIL với lý do "Kong không chia tải" (xem Task 11 Step 2).
- **Nhóm kiểm:**
  - **7a.** A gửi chữ. B và C thấy tin trong ≤ 3s.
  - **7b.** A gõ phím. B thấy "đang gõ".
  - **7c.** B mở nhóm. A thấy B đã xem.
  - **7d.** Chỉ báo online của A trên màn hình B bật **một lần**. Đếm số lần phát `USER_ONLINE` cho A bằng một consumer tạm bind vào `user.events` qua management API. Kỳ vọng `= 1` khi A mở 2 tab.
  - **8.** A gửi ảnh, ngay sau đó (< 100ms) gửi chữ. Trên màn hình B ảnh nằm trên chữ. Reload trang B, thứ tự vẫn giữ.
  - **9.** Thu hồi phiên của B từ thiết bị khác (API logout-all). Socket của B bị ngắt dù nằm ở gateway nào.
  - **2 qua UI.** A gửi 5 tin liên tiếp, đúng lúc đó `docker kill` instance chat đang giữ partition của nhóm (đọc lease). B nhận đủ 5 tin, đúng thứ tự, không trùng. Thời gian chờ ≤ 10s.
  - **3 qua UI.** Giống 2, nhưng dùng `docker stop`. Thời gian chờ < 2s.
  - **5 qua UI.** B gửi một tin, rồi trong vòng 50ms `docker kill` gateway mà B đang nằm. B tự reconnect, tin của B tới A đúng **một** lần, và bong bóng của B chuyển sang "đã gửi" (không phải "lỗi").
- **Chế độ hiển thị:** chụp mỗi nhóm hai ảnh, 1280px và 375px, ở dark mode, để thấy giao diện không vỡ khi reconnect.

- [ ] **Step 1: Viết script.**
- [ ] **Step 2: Chạy** `node qc/chat-scale-browser.mjs` trên stack profile scale với Vite ở 5174. Kỳ vọng: không có dòng `❌`. Mở và xem ảnh trong `qc/shots/` bằng mắt.
- [ ] **Step 3: Chạy lại bộ QC cũ** để bắt regression: `./auth-api.sh`, `node auth-browser.mjs` → không có `❌`.
- [ ] **Step 4: Commit** — `test(qc): browser QC for multi-gateway, multi-chat messaging`

---

### Task 18 (tuỳ chọn): Phát hiện crash nhanh bằng `rabbitmq_event_exchange`

**Files:**
- Modify: `backend/docker-compose.yml` (mount `docker/rabbitmq-enabled-plugins` có `[rabbitmq_management,rabbitmq_event_exchange].`)
- Modify: `backend/apps/chat/src/partitions/partition-coordinator.ts` + `lease-store.ts` (thêm `forceRelease(memberId)`)

**Interfaces:**
- Produces: khi nhận `connection.closed` từ `amq.rabbitmq.event` của một kết nối mang `connection_name = memberId` (đặt qua client properties), thì xoá các lease của member đó và tính lại ngay.

- [ ] **Step 1: Viết test lỗi** `reclaims a crashed member's partitions immediately on connection.closed` trong spec của coordinator.
- [ ] **Step 2: Chạy** → FAIL. **Step 3: Implement.** **Step 4: Chạy** → PASS.
- [ ] **Step 5: Chạy lại** `SCENARIO=crash-chat`. Kỳ vọng `takeover` < 1000ms (so với khoảng 6–8s khi chưa có task này).
- [ ] **Step 6: Commit** — `feat(chat): reclaim partitions immediately when a chat instance's connection drops`

---

## Final Verification Gate

Chỉ được báo plan đã hoàn thành khi **mọi** mục dưới đây có bằng chứng: output lệnh hoặc ảnh chụp, dán vào mô tả PR.

- [ ] `cd backend && npx jest && npm run typecheck && npm run lint:check` → xanh.
- [ ] `LEASE_STORE_REDIS_URL=redis://localhost:6380/15 npx jest lease-store user-status group-call-timers` → xanh.
- [ ] `cd frontend && npm run build && npm run lint` → xanh.
- [ ] Stack dựng lại từ đầu (`docker compose down -v && docker compose --profile scale up -d --build`), migrate thành công, index `message_sender_client_id` có mặt.
- [ ] `node qc/chat-scale-load.mjs` với cả 6 kịch bản → 6 dòng `PASS`. Kịch bản đối chứng cho kết quả `reorder > 0`, và nếu tái hiện được thì cả `dup > 0`.
- [ ] `node qc/chat-scale-browser.mjs` → không có `❌`. Ảnh đã được xem bằng mắt.
- [ ] `./auth-api.sh` và `node auth-browser.mjs` → không có `❌`. Số `✅` của `auth-api.sh` bằng baseline ở Task 0.
- [ ] Artifact "Chat Scale-out Plan" cập nhật mục 04: chọn cách B (lease + `stickyAssign`), và kết quả đo thật của 6 kịch bản.
