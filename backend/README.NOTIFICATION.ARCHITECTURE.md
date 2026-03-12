# Notification Service Architecture (NestJS + Microservice + Event-driven)

## Scope

Tài liệu này thiết kế lại Notification Service để scale tốt, linh hoạt, đa kênh và tương thích với hạ tầng hiện tại của dự án DALN.

## Assumptions

1. Không thay hạ tầng cốt lõi: vẫn dùng NestJS, RabbitMQ, MongoDB (qua Prisma), Mailer service, Realtime gateway.
2. Các service domain (user/chat/...) tiếp tục publish event vào RabbitMQ.
3. Frontend hiện đã có socket listener cho `notification.new_notification` và REST API lấy notification.
4. Một user có thể có nhiều device/session đồng thời.
5. Mục tiêu ưu tiên: at-least-once delivery + idempotent processing.

---

## A. High-level Architecture

### Components

1. Notification Ingestion Consumer (notification service): nhận domain event từ `user.events`, `chat.events`, `group.events`.
2. Notification Orchestrator: resolve template + apply user preferences + tạo plan cho channel.
3. Channel Dispatchers:
   - InApp Dispatcher: ghi DB.
   - Email Dispatcher: publish message gửi mail.
   - Realtime Dispatcher: publish event đến realtime exchange để gateway emit websocket.
4. Digest Scheduler Worker: cron gom unread notifications và gửi digest email.
5. Delivery Tracker: theo dõi trạng thái từng channel (pending/sent/failed/retried/dead-lettered).
6. Preference Cache: Redis cache user preferences để giảm DB load.

### Event flow (text)

```text
User/Chat/Group Service
    -> publish Domain Event (RabbitMQ)
    -> Notification Service consumes
    -> Normalize to NotificationCreatedEvent (v1)
    -> Load user preferences (Redis -> Mongo fallback)
    -> Build channel plan (IN_APP / EMAIL / REALTIME)
    -> Persist notification + delivery records
    -> Publish channel-specific events:
         - NotificationSendEmailEvent -> notification.email.main
         - NotificationSendRealtimeEvent -> realtime.emitEvent
    -> Realtime Gateway consume -> socket emit to online users
    -> Email worker consume -> call mailer service -> update delivery status
```

### Sequence diagram (text)

```text
Participant ChatService
Participant RabbitMQ
Participant NotificationService
Participant MongoDB
Participant Redis
Participant RealtimeGateway
Participant MailerService
Participant FrontendClient

ChatService->RabbitMQ: message.created(domain event)
RabbitMQ->NotificationService: consume event
NotificationService->Redis: get pref:userId
alt cache miss
  NotificationService->MongoDB: read user_notification_preferences
  NotificationService->Redis: set pref:userId (TTL 10m)
end
NotificationService->MongoDB: insert notifications
NotificationService->MongoDB: insert notification_deliveries (IN_APP/EMAIL/REALTIME)
NotificationService->RabbitMQ: publish NotificationSendRealtimeEvent
NotificationService->RabbitMQ: publish NotificationSendEmailEvent (if enabled)
RabbitMQ->RealtimeGateway: realtime.emitEvent
RealtimeGateway->FrontendClient: websocket notification.new_notification
RabbitMQ->MailerService: send email command
MailerService-->NotificationService: ack/fail callback event
NotificationService->MongoDB: update delivery status
```

### Sync vs Async

1. Sync path (HTTP/GRPC API của notification):
   - List notifications, mark read, read preferences, update preferences.
   - Độ trễ thấp, query tối ưu bằng index.
2. Async path (core delivery):
   - Ingestion từ RabbitMQ, channel dispatch, retry, digest cron.
   - Tối ưu throughput, chịu lỗi tốt.

---

## B. Database Design (MongoDB)

Lưu ý: đặt tên collection theo chuẩn hiện tại lowercase, thêm fields dần theo migration.

### 1) `notification_templates`

Purpose: template cho từng type + từng channel + locale + version.

```json
{
  "_id": "ObjectId",
  "templateKey": "FRIEND_REQUEST_SENT",
  "channel": "EMAIL|IN_APP|REALTIME",
  "locale": "vi-VN",
  "version": 1,
  "subject": "{actorName} đã gửi lời mời kết bạn",
  "title": "Bạn có lời mời kết bạn mới",
  "body": "{actorName} vừa gửi lời mời cho bạn.",
  "cta": {
    "label": "Xem ngay",
    "url": "/friends/requests"
  },
  "variables": ["actorName", "friendRequestId"],
  "isActive": true,
  "createdAt": "Date",
  "updatedAt": "Date"
}
```

Indexes:

1. `{ templateKey: 1, channel: 1, locale: 1, version: -1 }` unique partial cho `isActive=true`.
2. `{ isActive: 1, updatedAt: -1 }`.

### 2) `notifications`

Purpose: bản ghi notification canonical cho user.

```json
{
  "_id": "ObjectId",
  "notificationId": "uuid",
  "userId": "ObjectId|string",
  "type": "MESSAGE_RECEIVED|FRIEND_REQUEST_SENT|...",
  "title": "...",
  "message": "...",
  "payload": {
    "actorId": "...",
    "actorName": "...",
    "conversationId": "...",
    "friendRequestId": "...",
    "groupId": "..."
  },
  "channelsRequested": ["IN_APP", "EMAIL", "REALTIME"],
  "status": "CREATED|DISPATCHED|PARTIAL_FAILED|FAILED",
  "isRead": false,
  "readAt": null,
  "digestEligible": true,
  "digestBatchId": null,
  "eventVersion": 1,
  "correlationId": "uuid",
  "idempotencyKey": "sha256(...)",
  "createdAt": "Date",
  "updatedAt": "Date"
}
```

Indexes (quan trọng):

1. `{ userId: 1, isRead: 1, createdAt: -1 }` -> query unread/login.
2. `{ userId: 1, createdAt: -1 }` -> notification feed paging.
3. `{ idempotencyKey: 1 }` unique -> chống duplicate do resend.
4. `{ type: 1, createdAt: -1 }` -> analytics theo loại.
5. `{ digestEligible: 1, isRead: 1, createdAt: 1 }` -> digest scan.

### 3) `user_notification_preferences`

Purpose: preference cấp user + cấp type.

```json
{
  "_id": "ObjectId",
  "userId": "ObjectId|string",
  "global": {
    "enabled": true,
    "channels": {
      "IN_APP": true,
      "EMAIL": true,
      "REALTIME": true
    }
  },
  "overrides": {
    "MESSAGE_RECEIVED": { "IN_APP": true, "EMAIL": false, "REALTIME": true },
    "SYSTEM_NOTIFICATION": { "IN_APP": true, "EMAIL": true, "REALTIME": false }
  },
  "digest": {
    "enabled": true,
    "minUnread": 5,
    "cooldownMinutes": 30,
    "lastDigestAt": null
  },
  "updatedAt": "Date",
  "createdAt": "Date",
  "version": 1
}
```

Indexes:

1. `{ userId: 1 }` unique.
2. `{ updatedAt: -1 }` cho invalidate cache jobs.

Default preference strategy:

1. Seed default document khi user created event.
2. Cache key `notif_pref:{userId}` trên Redis TTL 10-30 phút.
3. Invalidate cache ngay khi user update preferences.

### 4) `notification_deliveries`

Purpose: tracking trạng thái từng channel, retry, lỗi.

```json
{
  "_id": "ObjectId",
  "deliveryId": "uuid",
  "notificationId": "uuid",
  "userId": "ObjectId|string",
  "channel": "IN_APP|EMAIL|REALTIME",
  "status": "PENDING|SENT|FAILED|RETRYING|DLQ",
  "attempt": 0,
  "maxAttempts": 3,
  "lastError": null,
  "providerMessageId": null,
  "nextRetryAt": null,
  "sentAt": null,
  "correlationId": "uuid",
  "idempotencyKey": "sha256(notificationId+channel)",
  "createdAt": "Date",
  "updatedAt": "Date"
}
```

Indexes:

1. `{ notificationId: 1, channel: 1 }` unique.
2. `{ status: 1, nextRetryAt: 1 }`.
3. `{ userId: 1, createdAt: -1 }`.
4. `{ idempotencyKey: 1 }` unique.

TTL:

1. Không TTL cho dữ liệu hoạt động 90 ngày gần nhất.
2. Có thể dùng TTL index `createdAt` 180 ngày cho `status in [SENT, FAILED, DLQ]` nếu cần giảm storage.

### 5) `notification_digest_tracking`

Purpose: chống gửi digest trùng + lock theo user.

```json
{
  "_id": "ObjectId",
  "digestId": "uuid",
  "userId": "ObjectId|string",
  "windowStart": "Date",
  "windowEnd": "Date",
  "notificationIds": ["uuid1", "uuid2"],
  "totalCount": 12,
  "status": "PENDING|SENT|FAILED",
  "emailDeliveryId": "uuid",
  "idempotencyKey": "sha256(userId+windowEnd)",
  "createdAt": "Date",
  "updatedAt": "Date"
}
```

Indexes:

1. `{ userId: 1, windowEnd: -1 }`.
2. `{ idempotencyKey: 1 }` unique.
3. `{ status: 1, createdAt: 1 }`.

---

## C. Event Design

### Unified envelope (bắt buộc versioning + tracing)

```json
{
  "eventId": "uuid",
  "eventName": "notification.created",
  "eventVersion": 1,
  "occurredAt": "2026-03-12T09:00:00Z",
  "correlationId": "uuid",
  "causationId": "uuid",
  "idempotencyKey": "sha256(sourceEventId+targetUserId+type)",
  "producer": "chat-service",
  "payload": {}
}
```

### 1) `NotificationCreatedEvent` (`notification.created.v1`)

Payload:

```json
{
  "notificationId": "uuid",
  "userId": "...",
  "type": "MESSAGE_RECEIVED",
  "templateKey": "MESSAGE_RECEIVED",
  "data": {
    "actorId": "...",
    "actorName": "A",
    "conversationId": "...",
    "messagePreview": "hello"
  },
  "channelsRequested": ["IN_APP", "EMAIL", "REALTIME"]
}
```

### 2) `NotificationSendEmailEvent` (`notification.send.email.v1`)

```json
{
  "notificationId": "uuid",
  "deliveryId": "uuid",
  "userId": "...",
  "email": "user@example.com",
  "templateKey": "MESSAGE_RECEIVED",
  "templateVersion": 2,
  "subject": "...",
  "variables": { "actorName": "A" }
}
```

### 3) `NotificationSendRealtimeEvent` (`notification.send.realtime.v1`)

```json
{
  "notificationId": "uuid",
  "deliveryId": "uuid",
  "userId": "...",
  "socketEvent": "notification.new_notification",
  "data": {
    "id": "uuid",
    "type": "MESSAGE_RECEIVED",
    "title": "...",
    "message": "...",
    "createdAt": "..."
  }
}
```

Versioning strategy:

1. Không sửa breaking trực tiếp payload v1.
2. Khi đổi format: publish event mới `...v2`, consumer chạy dual-read trong giai đoạn migrate.

---

## D. Channel Strategy Pattern

### Interface

```text
NotificationChannelInterface
  - channelName(): NotificationChannel
  - prepare(context): ChannelMessage
  - send(context): SendResult
  - supports(type): boolean (optional)
```

### Implementations

1. `InAppChannel`: persist notification/feed update.
2. `EmailChannel`: publish sang mail command queue (không gọi SMTP trực tiếp trong orchestrator).
3. `RealtimeChannel`: publish `realtime.emitEvent` payload.
4. Future `SmsChannel`: chỉ thêm class mới + config mapping, không sửa orchestration core.

### Orchestrator behavior

1. Resolve enabled channels theo preferences.
2. Iterate danh sách channel handlers từ DI registry (`Map<channel, handler>`).
3. Mỗi channel ghi `notification_deliveries` riêng.
4. Không dùng if-else theo type/channel trong service chính.

Type-to-template mapping:

```text
NotificationType -> TemplateResolver -> template(channel, locale, version)
```

---

## E. Retry Strategy với RabbitMQ (max 3)

### Topology

Exchange:

1. `notification.events` (topic)
2. `notification.retry` (topic)
3. `notification.dlq` (topic)

Queues (ví dụ channel email):

1. `notification.email.main`
2. `notification.email.retry.1` (delay 5s)
3. `notification.email.retry.2` (delay 30s)
4. `notification.email.retry.3` (delay 120s)
5. `notification.email.dlq`

Routing keys:

1. `notification.send.email`
2. `notification.send.email.retry.1`
3. `notification.send.email.retry.2`
4. `notification.send.email.retry.3`
5. `notification.send.email.dlq`

### Retry mechanics

1. Consumer fail lần 1: publish sang retry.1 với header `x-attempt=1`.
2. Lần 2: retry.2 (`x-attempt=2`).
3. Lần 3: retry.3 (`x-attempt=3`).
4. Quá 3 lần: route vào DLQ, update delivery status = `DLQ`.

### Queue config (concept)

1. Retry queue set `x-message-ttl` tương ứng delay.
2. Retry queue set `x-dead-letter-exchange=notification.events` và routing key quay lại main.
3. Main queue consumer đọc header `x-attempt`; nếu >3 thì reject về DLQ.

### NestJS integration notes

1. `@golevelup/nestjs-rabbitmq` + manual publish cho retry path.
2. Không rely vào retry vô hạn của broker/client.
3. Dùng ack/nack rõ ràng theo outcome.

---

## F. Digest Scheduler Design

### Trigger

Cron mỗi 5 phút (config được): `*/5 * * * *`.

### Selection logic

1. Lấy users đủ điều kiện digest:
   - preference.digest.enabled = true
   - unread count >= minUnread
   - `now - lastDigestAt >= cooldownMinutes`
2. Query unread notifications trong time window (ví dụ 24h gần nhất) và `digestEligible=true`.
3. Group by user, aggregate theo type + actor.

### Anti-duplicate

1. Tạo `idempotencyKey = hash(userId + windowEnd + unreadVersion)`.
2. Upsert `notification_digest_tracking` unique key.
3. Nếu record đã `SENT`, skip.

### Marking

1. Khi email digest gửi thành công:
   - update `digest_tracking.status=SENT`
   - set `user_pref.digest.lastDigestAt=now`
   - update notifications thuộc batch: `digestBatchId=<digestId>`
2. Nếu fail: tăng attempt trong delivery, retry tối đa 3 lần như channel email thường.

### Performance (tránh full scan)

1. Dùng index `{ userId, isRead, createdAt }`.
2. Dùng query window `createdAt >= now - 24h`.
3. Batch process theo pagination userId.
4. Có distributed lock cho cron instance (Redis lock `digest:lock:{shard}`).

---

## G. Scalability Strategy

### Scenario 1: 1 triệu users

Bottlenecks:

1. Query preferences per event.
2. Query unread feed theo user login peak.
3. Digest scan nếu không shard.

Giải pháp:

1. Redis cache preferences (hit ratio mục tiêu >95%).
2. Read model riêng cho unread count (`user_notification_counters`) update async.
3. Shard digest worker theo `userId % N`.
4. Mongo indexes bắt buộc như phần B.

### Scenario 2: 10k notifications/giây

Bottlenecks:

1. Insert notifications + deliveries write amplification.
2. Realtime emit flood.
3. Email throughput/third-party limit.

Giải pháp:

1. Horizontal scale notification consumers theo queue partition logic (nhiều replicas).
2. Tách queue theo channel (`main.inapp`, `main.email`, `main.realtime`) để isolate pressure.
3. Batch insert Mongo (`insertMany`) cho bursts.
4. Rate limit email dispatcher + circuit breaker mail provider.
5. Realtime payload lightweight, không nhét data lớn.

Observability:

1. Metric cần có: queue lag, consume rate, retry rate, DLQ size, channel success rate, end-to-end latency p95.
2. CorrelationId xuyên suốt logs để trace.

---

## H. Idempotency & Consistency

### Duplicate event

1. Mỗi event có `idempotencyKey`.
2. Trước khi tạo notification: upsert theo unique `idempotencyKey`.
3. Nếu duplicate: trả existing notification, không tạo mới.

### Message resend / consumer restart

1. `notification_deliveries` unique `(notificationId, channel)`.
2. Send function kiểm tra status `SENT` trước khi gửi provider.

### Mail gửi trùng

1. Dùng providerMessageId/idempotency key ở request mailer nếu hỗ trợ.
2. Nếu không hỗ trợ: dedupe nội bộ qua `delivery.idempotencyKey`.

### Realtime emit trùng

1. Event realtime chứa `notificationId`.
2. Frontend reducer đã dedupe theo `id` (hiện có trong notification slice).

Consistency model:

1. Eventual consistency giữa channels là chấp nhận được.
2. In-app là source of truth cho lịch sử notification.

---

## I. Folder Structure (NestJS)

```text
apps/notification/src
  main.ts
  notification.module.ts

  modules/
    notification/
      notification.http.controller.ts
      notification.grpc.controller.ts
      notification.query.service.ts
      notification.command.service.ts

    preferences/
      preference.http.controller.ts
      preference.service.ts

    templates/
      template.admin.controller.ts
      template.service.ts

  application/
    orchestrators/
      notification-orchestrator.ts
    use-cases/
      create-notification.usecase.ts
      dispatch-notification.usecase.ts
      mark-read.usecase.ts

  domain/
    entities/
      notification.entity.ts
      preference.entity.ts
      delivery.entity.ts
    enums/
      notification-type.enum.ts
      notification-channel.enum.ts
      delivery-status.enum.ts
    events/
      notification-created.event.ts
      notification-send-email.event.ts
      notification-send-realtime.event.ts
    interfaces/
      notification-channel.interface.ts

  infrastructure/
    persistence/
      repositories/
        notification.repository.ts
        preference.repository.ts
        delivery.repository.ts
      schemas/
        notification.schema.ts
        preference.schema.ts
    messaging/
      consumers/
        notification-ingestion.consumer.ts
        notification-email.consumer.ts
      publishers/
        realtime.publisher.ts
        email.publisher.ts
      rabbitmq/
        topology.config.ts
    channels/
      in-app.channel.ts
      email.channel.ts
      realtime.channel.ts
    templates/
      template-resolver.ts

  workers/
    retry/
      retry-policy.service.ts
    cleanup/
      old-delivery-cleaner.worker.ts

  cron/
    digest.cron.ts

  shared/
    constants/
    utils/
    telemetry/
```

---

## J. Migration Plan (No Downtime + Backward Compatible)

### Phase 0: Preparation

1. Giữ nguyên luồng cũ đang chạy.
2. Tạo collections mới: templates, preferences, deliveries, digest_tracking.
3. Seed templates cho 9 notification types bắt buộc.
4. Seed default preferences cho user hiện có (job nền).

### Phase 1: Dual-write

1. Notification service khi nhận event sẽ:
   - vẫn tạo record kiểu cũ (để API cũ hoạt động),
   - đồng thời tạo model mới + deliveries.
2. Realtime event vẫn giữ socket event name hiện tại: `notification.new_notification`.

### Phase 2: Read switch

1. Thêm API v2 (hoặc feature flag) để FE đọc model mới.
2. FE rollout theo cờ `notificationV2Enabled`.
3. Theo dõi mismatch metrics giữa v1/v2.

### Phase 3: Channel hardening

1. Bật retry 3 lần + DLQ cho email/realtime dispatcher.
2. Dashboard theo dõi retry rate và DLQ growth.

### Phase 4: Digest rollout

1. Bật digest cho 5% users (feature flag).
2. Tăng dần 25% -> 50% -> 100% khi ổn định.

### Phase 5: Decommission legacy

1. Ngừng ghi model cũ sau khi FE chuyển xong.
2. Chạy migration script archive dữ liệu cũ nếu cần.

Rollback strategy:

1. Feature flags cho từng channel và digest.
2. Nếu lỗi, tắt channel mới, fallback in-app only.

---

## Frontend Completion Plan (để test end-to-end)

Mục tiêu: không chỉ backend, FE phải test được toàn bộ loại notification + preferences + digest status.

### FE APIs cần có

1. `GET /notification?limit=&page=` (đã có).
2. `PATCH /notification/:id/read` (đã có).
3. `PATCH /notification/read-all` (đã có).
4. `GET /notification/preferences` (mới).
5. `PUT /notification/preferences` (mới).
6. `GET /notification/unread-count` (mới, tối ưu badge polling fallback).
7. `GET /notification/types` (mới, trả enum + label để render settings động).

### FE UI cần thêm

1. Notification Settings page:
   - Toggle global enable/disable.
   - Toggle IN_APP/EMAIL/REALTIME global.
   - Toggle theo từng notification type.
   - Digest settings (enabled, minUnread, cooldown).
2. Notification list filter theo type + unread.
3. Realtime toast UI hiển thị title/message/action.

### FE state strategy

1. Redux slice tách:
   - `notificationFeedSlice`
   - `notificationPreferenceSlice`
2. Socket dedupe theo `notificationId` (đã có pattern dedupe id).
3. Khi user update preferences, optimistic update + rollback nếu API fail.

### FE test scenarios

1. User online: tạo `MESSAGE_RECEIVED` -> nhận realtime ngay.
2. User offline + email enabled: notification vào DB + email delivery `SENT`.
3. Tắt EMAIL cho type cụ thể: không có email delivery record cho type đó.
4. Retry email fail 3 lần -> vào DLQ.
5. Digest cron chạy -> 1 email tổng hợp, không gửi trùng trong cooldown window.

---

## Notification Types (mandatory)

1. `MESSAGE_RECEIVED`
2. `FRIEND_REQUEST_SENT`
3. `FRIEND_REQUEST_ACCEPTED`
4. `FRIEND_REQUEST_REJECTED`
5. `SYSTEM_NOTIFICATION`
6. `USER_JOINED_GROUP`
7. `USER_LEFT_GROUP`
8. `USER_KICKED_FROM_GROUP`
9. `USER_ADDED_TO_GROUP`

Mỗi type map riêng cho template EMAIL + IN_APP (+ optional REALTIME title/body ngắn).

---

## Key Decisions Summary

1. In-app là source of truth; email/realtime là derived delivery channels.
2. Retry tối đa 3 với retry queue phân tầng + DLQ, không retry vô hạn.
3. User preferences filter trước khi dispatch để giảm noise/cost.
4. Digest chạy theo cron có idempotency + lock để tránh trùng/spam.
5. Thiết kế channel strategy mở rộng được SMS/push mà không sửa lõi orchestration.

---

## Production-grade Upgrade Review (10M users, peak 50k notification/s)

Phần này không thay stack và không viết lại từ đầu. Mục tiêu là nâng cấp trực tiếp thiết kế hiện tại để chịu tải production lớn.

### Assumptions bổ sung

1. MongoDB chạy replica set và có thể mở rộng sang sharded cluster.
2. RabbitMQ có quorum queue hoặc mirrored setup production, có monitoring queue depth.
3. Notification service có thể scale ngang nhiều instance.
4. Có Redis riêng cho cache + lock.
5. SLO mục tiêu:
   - P99 ingest-to-realtime dưới 400ms khi provider bình thường.
   - Không mất event khi crash giữa DB write và MQ publish.
   - Không retry vô hạn, không duplicate user-visible quá 1 lần trên cùng channel.

### 1. Kiến trúc hiện tại có điểm yếu gì

#### 1.1 Write amplification chưa tối ưu

Hiện tại mỗi notification thường tạo:

1. 1 bản ghi notifications.
2. 1 đến 3 bản ghi deliveries (IN_APP, EMAIL, REALTIME).

Ở 50k notif/s và 3 channels, write có thể lên đến 200k ops/s (chưa tính retry update status). Đây là IO pressure rất lớn cho Mongo primary.

Điểm yếu cốt lõi:

1. IN_APP không cần delivery record đầy đủ như EMAIL vì không có external provider ack semantics.
2. Update trạng thái delivery kiểu chatty update (PENDING -> RETRYING -> SENT) làm tăng random write.
3. Tracking quá chi tiết cho mọi channel khiến storage growth rất nhanh.

#### 1.2 Event consistency có gap DB -> MQ

Nếu insert notification thành công nhưng publish RabbitMQ fail hoặc service crash ngay sau insert, event sẽ bị mất cho EMAIL/REALTIME. Đây là classic dual-write inconsistency.

#### 1.3 Digest scan tiềm ẩn full scan

Digest dựa trên scan unread notifications theo user có thể thành hotspot khi 10M users, nhất là khi cron chạy đồng loạt và unread phân bố không đều.

#### 1.4 Queue coupling và backpressure chưa cứng

Mặc dù đã tách queue logic theo channel ở mức design, nhưng chưa đủ chi tiết để chống các failure modes:

1. Email provider chậm kéo dài gây backlog và tăng memory broker.
2. Retry storms đẩy ngược vào main queue.
3. Realtime burst có thể ăn hết consumer CPU, làm chậm ingestion.

#### 1.5 Idempotency mới ở mức nền

Chưa khóa chặt toàn chuỗi ở từng bước:

1. Ingest dedupe.
2. Outbox publish dedupe.
3. Channel send dedupe.
4. Provider callback dedupe.

Chỉ cần thiếu 1 mắt xích là vẫn có duplicate user-visible.

#### 1.6 Data growth chưa có tiering rõ

Với 100M+ notifications, nếu giữ full delivery history lâu và index nhiều trường, chi phí lưu trữ và index RAM tăng mạnh, ảnh hưởng read latency.

---

### 2. Kiến trúc nâng cấp đề xuất

#### 2.1 Diagram text (after)

```text
Domain Services (user/chat/group)
  -> RabbitMQ domain exchanges
  -> Notification Ingest Consumer
      -> Mongo transaction:
           (a) notifications upsert (idempotent)
           (b) outbox insert (channel commands)
           (c) counter model updates (unread/digest)
      -> ack consume

Outbox Relay Workers (separate pool)
  -> poll outbox by status=NEW and shard bucket
  -> publish to channel exchanges
  -> mark outbox PUBLISHED (idempotent)

Channel Workers (isolated pools)
  -> realtime.main -> publish realtime.emitEvent -> realtime gateway
  -> email.main -> call mailer service
  -> inapp.main -> optional lightweight post-process only

Retry Pipelines (per channel)
  main -> retry.1 -> retry.2 -> retry.3 -> dlq

Digest Workers
  -> read counter model candidates only
  -> acquire per-user lock
  -> aggregate bounded window
  -> send digest via outbox/email channel

Observability Stack
  -> metrics, traces, queue lag, dlq alerts, end-to-end latency
```

#### 2.2 Flow chi tiết

Ingestion flow:

1. Consume domain event.
2. Tạo idempotency key từ sourceEventId + targetUserId + type.
3. Mongo transaction:
   - upsert notification bằng idempotency key.
   - tạo outbox messages cho channels enabled theo preferences.
   - update unread counter model.
4. Ack MQ chỉ sau khi transaction commit.

Outbox relay flow:

1. Đọc outbox status NEW theo batch nhỏ (ví dụ 500).
2. Publish RabbitMQ từng message với publisher confirm.
3. Mark PUBLISHED bằng compare-and-set để tránh double mark.
4. Nếu publish fail, tăng attempt, set nextAttemptAt.

Channel dispatch flow:

1. Realtime worker: ưu tiên low latency, payload compact.
2. Email worker: có rate limiter + circuit breaker + retry policy.
3. In-app channel: không cần queue nặng nếu notification đã persist trong ingest transaction.

#### 2.3 Before vs After

Before:

1. DB write xong publish MQ trực tiếp.
2. Delivery records chi tiết cho mọi channel.
3. Digest scan unread tương đối rộng.

After:

1. DB + outbox atomically, relay publish bất đồng bộ.
2. Giảm write amplification bằng channel-aware tracking model.
3. Digest dựa trên counter/indexed candidates, không scan toàn cục.
4. Queue isolation cứng theo channel và retry lanes.

---

### 3. Database thay đổi gì

#### 3.1 Tối ưu write amplification

Khuyến nghị production:

1. Giữ notifications là canonical store.
2. Không tạo delivery record đầy đủ cho IN_APP mặc định.
3. Chỉ tạo delivery record cho external side-effect channels: EMAIL, REALTIME.
4. Với IN_APP chỉ cần embedded delivery summary nhẹ:

```json
{
  "deliverySummary": {
    "inAppCreatedAt": "Date",
    "realtime": { "status": "PENDING|SENT|FAILED", "lastAttemptAt": "Date" },
    "email": { "status": "PENDING|SENT|FAILED", "lastAttemptAt": "Date" }
  }
}
```

Trade-off:

1. Ưu điểm: giảm write records và index pressure.
2. Nhược điểm: mất granularity attempt-by-attempt cho IN_APP, nhưng IN_APP không cần retry phức tạp như provider external.

#### 3.2 Outbox schema (bắt buộc)

Collection mới: outbox_events

```json
{
  "_id": "ObjectId",
  "outboxId": "uuid",
  "aggregateType": "notification",
  "aggregateId": "notificationId",
  "eventName": "notification.send.email.v1",
  "routing": {
    "exchange": "notification.channel.email",
    "routingKey": "notification.send.email"
  },
  "payload": { "...": "..." },
  "status": "NEW|PUBLISHED|FAILED|DEAD",
  "attempt": 0,
  "maxAttempts": 10,
  "nextAttemptAt": "Date",
  "correlationId": "uuid",
  "idempotencyKey": "sha256(notificationId+channel)",
  "createdAt": "Date",
  "updatedAt": "Date",
  "publishedAt": null,
  "error": null
}
```

Indexes outbox:

1. `{ status: 1, nextAttemptAt: 1, createdAt: 1 }`.
2. `{ idempotencyKey: 1 }` unique.
3. `{ aggregateId: 1, eventName: 1 }`.

Cleanup strategy:

1. Soft cleanup: giữ PUBLISHED 3 đến 7 ngày.
2. TTL hoặc archival job để chuyển cold data sang storage rẻ hơn.
3. Không xóa FAILED hoặc DEAD quá sớm, cần cho forensic.

#### 3.3 Counter/read model cho digest

Collection: user_notification_counters

```json
{
  "_id": "ObjectId",
  "userId": "...",
  "unreadTotal": 125,
  "unreadByType": {
    "MESSAGE_RECEIVED": 80,
    "FRIEND_REQUEST_SENT": 4
  },
  "oldestUnreadAt": "Date",
  "latestUnreadAt": "Date",
  "digestCandidate": true,
  "lastDigestAt": "Date",
  "nextDigestAt": "Date",
  "version": 1482,
  "updatedAt": "Date"
}
```

Counter update flow:

1. Trong ingest transaction: increment unreadTotal và unreadByType.
2. Khi mark read: decrement counter atomically.
3. Nếu underflow risk do duplicate read, dùng max(0) guard + periodic reconcile job.

Race handling:

1. Dùng optimistic field version trong counter updates.
2. Reconcile background job chạy incremental theo updatedAt.

Lock strategy digest:

1. Redis lock key `digest:user:{userId}` TTL ngắn (30s-2m).
2. Compare nextDigestAt trước khi gửi.
3. Sau khi gửi thành công update lastDigestAt và nextDigestAt atomically.

#### 3.4 Sharding strategy (100M+ notifications)

Shard key đề xuất cho notifications:

1. `{ userId: "hashed" }` cho phân tán write đều.

Trade-off:

1. Ưu điểm: ingest write phân tán tốt, giảm hot shard.
2. Nhược điểm: query range theo createdAt trên toàn hệ khó targeted.

Vì workload chính là per-user feed/unread, hashed userId là hợp lý nhất.

Nếu cần analytics global theo thời gian:

1. Tạo read-model analytics riêng hoặc collection phụ rollup theo giờ/ngày.
2. Không ép collection notifications phục vụ cả OLTP và OLAP cùng lúc.

---

### 4. Messaging topology mới

#### 4.1 Exchanges

1. domain.events (topic): nhận sự kiện từ user/chat/group.
2. notification.channel.realtime (topic)
3. notification.channel.email (topic)
4. notification.retry.realtime (topic)
5. notification.retry.email (topic)
6. notification.dlq.realtime (topic)
7. notification.dlq.email (topic)

#### 4.2 Queues

Ingestion:

1. notification.ingest.main
2. notification.ingest.dlq

Realtime lane:

1. notification.realtime.main
2. notification.realtime.retry.1 (ttl 1s)
3. notification.realtime.retry.2 (ttl 5s)
4. notification.realtime.retry.3 (ttl 20s)
5. notification.realtime.dlq

Email lane:

1. notification.email.main
2. notification.email.retry.1 (ttl 10s)
3. notification.email.retry.2 (ttl 60s)
4. notification.email.retry.3 (ttl 300s)
5. notification.email.dlq

Outbox relay lane:

1. notification.outbox.relay.main

#### 4.3 Queue isolation & backpressure controls

1. Worker pool tách riêng theo lane:
   - ingest workers
   - realtime workers
   - email workers
   - outbox relay workers
2. Prefetch khác nhau:
   - realtime prefetch cao hơn (ví dụ 500-2000)
   - email prefetch thấp (ví dụ 20-100)
3. Token bucket rate limit per user cho realtime lane:
   - ví dụ 20 notif/10s/user vượt ngưỡng thì coalesce thành summary event.
4. Email circuit breaker:
   - open khi lỗi provider vượt threshold trong cửa sổ 1 phút.
   - khi open: đẩy vào retry lane chậm hơn, không nghẽn main.
5. Retry queue tách hoàn toàn khỏi main queue, tránh retry storm chặn fresh traffic.

---

### 5. Failure scenarios và cách xử lý

#### 5.1 RabbitMQ down

1. Ingestion consumer không ack message mới.
2. Outbox relay tạm dừng publish, outbox status giữ NEW/FAILED.
3. Khi broker hồi phục, relay tiếp tục quét theo nextAttemptAt.
4. Không mất event vì outbox nằm trong Mongo.

#### 5.2 Mongo chậm hoặc lock contention

1. Ingestion giảm batch size và giảm consumer concurrency tự động theo latency guard.
2. Kích hoạt backpressure upstream qua queue depth alert.
3. Ưu tiên write path tối thiểu: notification + outbox + counter; defer non-critical enrich.

#### 5.3 Mail provider timeout hoặc degraded

1. Email worker timeout cứng (ví dụ 2-5s call timeout).
2. Retry theo lane email riêng, tối đa 3.
3. Circuit breaker open để chặn flood provider.
4. Eventual deliver hoặc DLQ; không ảnh hưởng realtime lane.

#### 5.4 Worker crash giữa chừng

1. Nếu crash trước ack: RabbitMQ redeliver.
2. Idempotency key ở notification/outbox/delivery chặn duplicate side effect.
3. Nếu crash sau publish trước mark state: relay dùng idempotent publish mark compare-and-set.

#### 5.5 Network partition service <-> Redis

1. Preference cache miss fallback Mongo.
2. Digest lock nếu Redis lỗi: degrade safe mode, chạy single scheduler instance hoặc postpone digest.

#### 5.6 Retry duplicate publish

1. Mỗi outgoing message mang messageId = deliveryId/outboxId.
2. Consumer kiểm tra dedupe store theo messageId + channel trước khi side-effect.

#### 5.7 DLQ growth bất thường

1. Alert ngay khi dlq_depth tăng liên tục.
2. Auto-pause replay nếu lỗi root cause chưa fix.
3. Replay tool có rate limit + canary replay trước toàn bộ.

---

### 6. Benchmark reasoning

Đây là ước lượng kiến trúc, không phải kết quả benchmark thực đo.

#### 6.1 Throughput reasoning

At 10k notif/s:

1. Nếu mỗi notif tạo 1 notification + 2 outbox (email/realtime) = 30k writes/s logical.
2. Với bulk write theo batch 200-1000, số round-trip giảm rất mạnh so với single insert.
3. CPU bottleneck chủ yếu ở template render và JSON serialization, IO bottleneck ở Mongo writes.

At 50k notif/s peak:

1. Không thể xử lý ổn định nếu insert đơn lẻ và update chatty.
2. Bắt buộc dùng:
   - bulkWrite/insertMany ở ingest và outbox relay.
   - precompiled template cache (không parse template mỗi message).
   - tách lane realtime/email để tránh head-of-line blocking.
3. Realtime payload tối giản giảm network egress và CPU encode.

#### 6.2 Template optimization

1. Precompute template AST hoặc compile sẵn theo templateKey+version.
2. Cache template trong memory + Redis invalidation theo template updatedAt.
3. Chỉ render channel cần dùng sau khi qua preference filter.

#### 6.3 Batch strategy

1. Ingest consumer gom event 5-20ms micro-batch trước khi bulk write.
2. Outbox relay publish theo batch nhưng vẫn gắn idempotency từng message.
3. Counter updates dùng bulk update với $inc.

Trade-off:

1. Batch tăng throughput nhưng tăng tail latency nhẹ.
2. Nên adaptive batch: low traffic dùng batch nhỏ để giữ latency, high traffic tăng batch để giữ throughput.

#### 6.4 Metrics và alert production hardening

Metrics bắt buộc:

1. ingest_rate, process_success_rate, process_error_rate.
2. outbox_new_count, outbox_publish_latency_p95, outbox_stuck_age_max.
3. queue_depth theo từng queue, consumer_lag_seconds.
4. retry_rate theo channel và attempt level.
5. dlq_depth theo channel.
6. e2e_latency từ domain event đến channel sent (p50/p95/p99).
7. digest_candidate_count, digest_sent_count, digest_skip_count.
8. mongo_write_latency, mongo_lock_time, redis_cache_hit_ratio.

Alert conditions đề xuất:

1. queue_depth main tăng liên tục hơn 5 phút.
2. dlq_depth > ngưỡng cố định hoặc tốc độ tăng đột biến.
3. outbox oldest NEW age > 60s.
4. e2e p99 vượt SLO liên tục 10 phút.
5. email circuit breaker open quá lâu.
6. cache hit ratio preferences dưới 85%.

---

## Kết luận nâng cấp

Không thay stack nhưng nâng kiến trúc lên production-grade bằng 5 trụ cột:

1. Transactional outbox để triệt tiêu dual-write inconsistency.
2. Queue isolation + retry lanes để chống backpressure chéo kênh.
3. Counter/read model cho digest để loại full scan.
4. Write amplification reduction bằng channel-aware tracking (không over-track IN_APP).
5. Idempotency end-to-end + observability đầy đủ để vận hành 10M users và peak 50k/s.

Thiết kế này giữ nguyên triết lý event-driven, RabbitMQ, MongoDB, NestJS, và tương thích với realtime + mail hiện hữu.
