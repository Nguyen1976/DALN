# Presence Online/Offline với Socket.IO — Lecture đầy đủ

> Tài liệu này mô tả **toàn bộ luồng hoạt động** của hệ thống theo dõi trạng thái online/offline trong dự án DALN, dựa trên code hiện tại.  
> Mục tiêu: giúp bạn hiểu **Socket.IO room dùng để làm gì**, **tại sao vẫn cần Redis presence store**, và **mỗi file/event xử lý trường hợp nào**.

---

## Mục lục

1. [Presence là gì? Tại sao chat app cần?](#1-presence-là-gì-tại-sao-chat-app-cần)
2. [Hai lớp tách biệt: Room (Socket.IO) vs Redis (shared state)](#2-hai-lớp-tách-biệt-room-socketio-vs-redis-shared-state)
3. [Kiến trúc tổng thể trong dự án](#3-kiến-trúc-tổng-thể-trong-dự-án)
4. [Bản đồ file & trách nhiệm](#4-bản-đồ-file--trách-nhiệm)
5. [Hạ tầng kết nối: Socket.IO](#5-hạ-tầng-kết-nối-socketio)
6. [Redis presence sâu: keys, TTL, zombie cleanup](#6-redis-presence-sâu-keys-ttl-zombie-cleanup)
7. [Luồng chính: User online (Happy Path)](#7-luồng-chính-user-online-happy-path)
8. [Luồng chính: User offline (Happy Path)](#8-luồng-chính-user-offline-happy-path)
9. [Tất cả trường hợp trong code hiện tại](#9-tất-cả-trường-hợp-trong-code-hiện-tại)
10. [State machine presence](#10-state-machine-presence)
11. [UI & trải nghiệm người dùng](#11-ui--trải-nghiệm-người-dùng)
12. [Ai đọc `isOnline()` và để làm gì?](#12-ai-đọc-isonline-và-để-làm-gì)
13. [Giới hạn hiện tại & hướng mở rộng](#13-giới-hạn-hiện-tại--hướng-mở-rộng)
14. [FAQ cho sinh viên](#14-faq-cho-sinh-viên)

---

## 1. Presence là gì? Tại sao chat app cần?

**Presence** (hiện diện) = biết user **đang online hay offline**, và nếu offline thì **lần cuối hoạt động khi nào** (`lastSeen`).

Trong DALN, presence phục vụ:

| Nhu cầu | Ví dụ trong app |
|---------|-----------------|
| UI bạn bè | Chấm xanh "Đang online" / "5 phút trước" |
| Realtime cập nhật | Bạn bè thấy ngay khi user A vừa login/logout |
| Routing thông báo | Online → push in-app qua socket; offline → gửi email |
| API danh sách bạn | `GET /user/list-friends` trả `status: true/false` |

### Điểm quan trọng nhất

**Online/offline không chỉ là chuyện của WebSocket.**

- WebSocket biết *socket này* còn sống.
- Product cần biết *user X* còn online trên hệ thống — kể cả khi service `user`, `notification` (không có Socket.IO) cần đọc trạng thái đó.

```
┌──────────────┐     "Bạn A online không?"     ┌──────────────┐
│ user service │ ────────────────────────────▶ │    Redis     │
│ (HTTP API)   │                               │ presence     │
└──────────────┘                               └──────▲───────┘
                                                      │ ghi khi connect/disconnect
┌──────────────┐                                      │
│ realtime-    │ ─────────────────────────────────────┘
│ gateway      │   Room `user:{id}` + UserStatusStore
└──────────────┘
```

---

## 2. Hai lớp tách biệt: Room (Socket.IO) vs Redis (shared state)

Đây là phần dễ nhầm nhất. Trong project có **hai cơ chế song song**, mỗi cái một việc.

### Lớp 1 — Socket.IO Room (trong RAM gateway)

| Việc | Cách làm |
|------|----------|
| Gom socket theo user | `client.join('user:' + userId)` |
| Emit realtime tới user | `server.to('user:' + userId).emit(event, data)` |
| Gom socket theo hội thoại | `client.join('conversation:' + conversationId)` |

Room **chỉ tồn tại trong process gateway** (hoặc đồng bộ cross-node qua Redis Adapter khi emit).

### Lớp 2 — Redis UserStatusStore (shared giữa microservices)

| Việc | Cách làm |
|------|----------|
| `user` service biết bạn online | `redisService.isOnline(friendId)` |
| `notification` chọn kênh gửi | `isOnline` → socket vs email |
| Đếm multi-tab trước khi báo offline | Set `user:{id}:sockets` |
| Lưu `lastSeen` tạm | Key `user:{id}:lastSeen` |

### Lớp 3 — Redis Io Adapter (khác hẳn presence store)

File `redis.adapter.ts` dùng `@socket.io/redis-adapter` để **pub/sub emit cross-instance** khi scale nhiều gateway.

| Thành phần | Mục đích |
|------------|----------|
| **Room** | Routing emit trong gateway |
| **Redis Adapter** | Nhiều gateway instance emit được tới nhau |
| **UserStatusStore** | Shared presence cho toàn hệ thống |

### So sánh nhanh

| Câu hỏi | Room đủ không? | Redis presence cần không? |
|---------|----------------|---------------------------|
| Gửi `user.online_status_changed` tới bạn bè? | ✅ `server.to('user:friendId').emit(...)` | ❌ không cần để emit |
| `GET /list-friends` biết ai online? | ❌ user service không có `server` | ✅ `redisService.isOnline()` |
| Gửi email hay socket khi có lời mời kết bạn? | ❌ notification service không có room | ✅ `redisService.isOnline()` |
| User mở 2 tab, đóng 1 tab có báo offline? | ✅ có thể `fetchSockets()` trong gateway | ✅ code hiện tại dùng Redis Set đếm socket |

> **Ghi chú thiết kế:** Trong gateway, room và Redis Set đang **mirror** cùng ý nghĩa (user → danh sách socket). Về lý thuyết gateway có thể chỉ dùng `fetchSockets()` trên room `user:{userId}`; Redis Set chủ yếu để **các service khác** đọc được.

---

## 3. Kiến trúc tổng thể trong dự án

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         FRONTEND (React)                                 │
├─────────────────────────────────────────────────────────────────────────┤
│  App.tsx                                                                 │
│    ├── socket.connect() khi user login                                  │
│    ├── listen "user.online_status_changed"  → upsertOnlineFriend        │
│    └── listen "user.offline_status_changed" → updateStatusOffline         │
│                                                                          │
│  ListFriend.tsx                                                          │
│    └── chấm xanh nếu friend.status; else formatLastSeen(lastSeen)       │
│                                                                          │
│  lib/socket.ts              ← singleton Socket.IO client                 │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │ WebSocket (namespace: /realtime)
                                │ Cookie: accessToken (JWT)
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│              BACKEND: realtime-gateway (port 3001)                       │
├─────────────────────────────────────────────────────────────────────────┤
│  handleConnection                                                        │
│    → verify JWT → join room user:{userId}                               │
│    → UserStatusStore.addConnection (Redis)                              │
│    → nếu lần đầu online: publish USER_ONLINE → RabbitMQ                 │
│                                                                          │
│  handleDisconnect                                                        │
│    → UserStatusStore.removeConnection                                   │
│    → nếu không còn socket: publish USER_OFFLINE + lastSeen             │
│                                                                          │
│  @RabbitSubscribe EMIT_REALTIME_EVENT                                    │
│    → server.to('user:X').emit(...)   // push tới client                 │
└───────────────┬───────────────────────────────┬─────────────────────────┘
                │ RabbitMQ                       │ Redis
                ▼                                ▼
┌───────────────────────────┐      ┌──────────────────────────────────────┐
│ user service              │      │ Keys:                                 │
│  USER_ONLINE subscriber   │      │  user:{userId}:sockets  (SET)         │
│  USER_OFFLINE subscriber  │      │  socket:{socketId}      (STRING+TTL)  │
│  → update MongoDB         │      │  user:{userId}:lastSeen (STRING+TTL)  │
│  → emit status tới bạn bè │      └──────────────────────────────────────┘
└───────────────────────────┘
                │
                ▼
┌───────────────────────────┐
│ notification service      │
│  redisService.isOnline()  │  ← chọn in-app vs email
└───────────────────────────┘
```

### Vai trò từng tầng

1. **Transport layer** (`socket.ts`, `handleConnection`): giữ kết nối WebSocket, gắn `userId`.
2. **Gateway presence layer** (`UserStatusStore`, rooms): quyết định user có đang có socket sống không.
3. **Event bus** (RabbitMQ `USER_ONLINE` / `USER_OFFLINE`): tách gateway khỏi business logic.
4. **Domain layer** (`user.service`): cập nhật DB, fan-out tới bạn bè.
5. **Consumer layer** (notification): đọc presence để chọn kênh gửi.

---

## 4. Bản đồ file & trách nhiệm

### Frontend

| File | Trách nhiệm |
|------|-------------|
| `frontend/src/lib/socket.ts` | Singleton Socket.IO, `autoConnect: false`, `withCredentials: true` |
| `frontend/src/lib/socket.events.ts` | Hằng số event presence (khớp backend) |
| `frontend/src/App.tsx` | `socket.connect()` khi login; listen online/offline events |
| `frontend/src/redux/slices/friendSlice.ts` | `upsertOnlineFriend`, `updateStatusOffline`, `getFriends` |
| `frontend/src/pages/Friend/ListFriend.tsx` | UI chấm xanh + `formatLastSeen` |
| `frontend/src/utils/index.ts` | `formatLastSeen(isoString)` — "X phút trước" |

### Backend — realtime-gateway

| File | Trách nhiệm |
|------|-------------|
| `backend/apps/realtime-gateway/src/main.ts` | Gắn `RedisIoAdapter` cho Socket.IO |
| `backend/apps/realtime-gateway/src/realtime/redis.adapter.ts` | Pub/sub cross-instance (`@socket.io/redis-adapter`) |
| `backend/apps/realtime-gateway/src/realtime/realtime.gateway.ts` | `handleConnection`, `handleDisconnect`, emit qua room |
| `backend/apps/realtime-gateway/src/realtime/user-status.store.ts` | Redis SET/TTL cho presence |

### Backend — shared & microservices

| File | Trách nhiệm |
|------|-------------|
| `backend/libs/constant/websocket/socket.events.ts` | `ONLINE_STATUS_CHANGED`, `OFFLINE_STATUS_CHANGED` |
| `backend/libs/constant/rmq/routing.ts` | `USER_ONLINE`, `USER_OFFLINE`, `EMIT_REALTIME_EVENT` |
| `backend/libs/redis/src/redis.service.ts` | `isOnline()` — dùng chung bởi user & notification |
| `backend/apps/user/src/rmq/subcribers/user-subcribers.ts` | Subscribe `USER_ONLINE` / `USER_OFFLINE` |
| `backend/apps/user/src/user.service.ts` | `handleUserOnline`, `handleUserOffline`, `listFriends` |
| `backend/apps/user/src/rmq/publishers/user-events.publisher.ts` | Publish emit event tới bạn bè |
| `backend/apps/notification/src/notification.service.ts` | `isOnline` → socket vs email |

---

## 5. Hạ tầng kết nối: Socket.IO

### Khởi tạo socket (frontend)

```ts
// frontend/src/lib/socket.ts
export const socket = io(SOCKET_URL, {
  transports: ["websocket"],
  withCredentials: true,
  autoConnect: false,  // chỉ connect khi đã login
  reconnection: true,
  reconnectionAttempts: Infinity,
});
```

### Khi nào socket connect?

```ts
// App.tsx — khi có user.id (sau login)
useEffect(() => {
  if (!user?.id) return;
  socket.connect();
  return () => socket.disconnect();
}, [user?.id]);
```

Logout hoặc unmount App → `socket.disconnect()` → gateway chạy `handleDisconnect`.

### Backend xác thực & gắn user

Khi client kết nối (`handleConnection`):

1. Đọc cookie `accessToken` từ handshake
2. `jwtService.verify(accessToken)` → lấy `userId`
3. `client.data.userId = userId`
4. `client.join('user:' + userId)` ← room để emit tới user này
5. `userStatusStore.addConnection(userId, client.id)` ← ghi Redis

Nếu thiếu cookie/token/userId hợp lệ → `client.disconnect()` ngay.

### Cấu hình heartbeat Socket.IO

```ts
// realtime.gateway.ts — @WebSocketGateway options
pingInterval: 40000,  // 40s gửi ping
pingTimeout: 10000,   // 10s không pong → coi là chết
```

Socket.IO tự detect connection chết sau ~50s và gọi `handleDisconnect`.

### Relay event tới user (từ RabbitMQ)

```ts
// realtime.gateway.ts
@RabbitSubscribe({ routingKey: ROUTING_RMQ.EMIT_REALTIME_EVENT, ... })
async emitToUser({ userIds, event, data }: EmitToUserPayload) {
  for (const userId of userIds) {
    this.server.to(`user:${userId}`).emit(event, data)
  }
}
```

Mọi service (`user`, `notification`, …) muốn push realtime → publish `EMIT_REALTIME_EVENT` → gateway emit vào room.

---

## 6. Redis presence sâu: keys, TTL, zombie cleanup

### Cấu trúc key

| Key | Kiểu | TTL | Ý nghĩa |
|-----|------|-----|---------|
| `user:{userId}:sockets` | SET | 300s (gia hạn khi touch) | Danh sách `socketId` đang thuộc user |
| `socket:{socketId}` | STRING | 90s | Map ngược socket → userId; hết TTL = socket zombie |
| `user:{userId}:lastSeen` | STRING (ISO) | 7 ngày | Thời điểm offline gần nhất (buffer trước/ghi DB) |

### `addConnection` — khi có socket mới

```ts
// user-status.store.ts
.multi()
.sadd(userKey, socketId)                    // thêm vào set
.set(socketKey, userId, 'EX', 90)           // TTL socket
.expire(userKey, 300)                       // gia hạn set user
.exec()
```

### `touchConnection` — giữ socket sống

Gọi khi:

- Mỗi **25 giây** (`setInterval` trong `handleConnection`)
- Nhận packet **`pong`** từ engine Socket.IO
- Client emit event **`pong`** (`@SubscribeMessage('pong')`)

→ Gia hạn TTL `socket:{id}` và `user:{id}:sockets`.

### `isOnline` — kiểm tra + dọn zombie

```ts
const sockets = await redis.smembers(`user:${userId}:sockets`)
for (const socketId of sockets) {
  const exists = await redis.exists(`socket:${socketId}`)
  if (exists) alive++
  else await redis.srem(userKey, socketId)  // socket hết TTL → cleanup
}
return alive > 0
```

**Zombie** = socketId còn trong SET nhưng key `socket:{id}` đã hết TTL (crash, mất mạng đột ngột trước khi `handleDisconnect` chạy).

### Tại sao cần TTL song song với Socket.IO ping?

| Cơ chế | Ai trigger offline event? |
|--------|---------------------------|
| `handleDisconnect` (graceful) | ✅ publish `USER_OFFLINE` ngay |
| Socket.IO ping timeout (~50s) | ✅ engine disconnect → `handleDisconnect` |
| Redis TTL hết (90s không touch) | ⚠️ `isOnline()` trả `false` khi đọc, **nhưng không tự publish offline** |

→ TTL chủ yếu để **API `isOnline` chính xác**, không phải để broadcast realtime (xem mục 13).

---

## 7. Luồng chính: User online (Happy Path)

**Kịch bản:** User A login, mở app, socket connect lần đầu (chưa có tab/socket nào khác).

```
Browser A                realtime-gateway          Redis           RabbitMQ          user service           Browser B (bạn A)
    │                          │                    │                  │                    │                      │
    │──── WebSocket connect ──▶│                    │                  │                    │                      │
    │     (cookie JWT)         │                    │                  │                    │                      │
    │                          │── isOnline(A)? ──▶│                  │                    │                      │
    │                          │◀─ false ──────────│                  │                    │                      │
    │                          │── join user:A ────│ (RAM room)       │                    │                      │
    │                          │── addConnection ─▶│                  │                    │                      │
    │                          │                    │                  │                    │                      │
    │                          │── publish USER_ONLINE {userId:A} ───▶│                    │                      │
    │                          │                    │                  │── consume ────────▶│                      │
    │                          │                    │                  │                    │── find friends of A  │
    │                          │                    │                  │                    │── updateLastSeen null│
    │                          │                    │                  │◀─ EMIT_REALTIME ──│                      │
    │                          │◀──────────────────────────────────────│  online_status_changed(A)                  │
    │                          │── to user:B emit ──────────────────────────────────────────────────────────────▶│
    │                          │                    │                  │                    │  upsertOnlineFriend  │
```

### Các bước chi tiết

1. **Gateway** `handleConnection`: verify JWT, `prevOnline = false`.
2. Join room `user:A`, ghi Redis `addConnection`.
3. Vì `!prevOnline`:
   - Xóa `user:A:lastSeen` trên Redis (nếu có).
   - Publish RabbitMQ `REALTIME_EVENTS` / `user.online` / `{ userId: A }`.
4. **user service** `handleUserOnline(A)`:
   - Lấy danh sách `friendId` của A.
   - `userRepo.updateLastSeen(A, null)` — xóa lastSeen trên MongoDB.
   - Publish `EMIT_REALTIME_EVENT` tới **từng bạn bè** với event `user.online_status_changed`, data = `userId` của A.
5. **Gateway** nhận `EMIT_REALTIME_EVENT`, emit vào room `user:{friendId}`.
6. **Frontend bạn bè** (`App.tsx`): `upsertOnlineFriend(A)` → Redux `status: true`.

### Multi-tab: tab thứ 2 connect

- `prevOnline = true` (tab 1 vẫn sống).
- Vẫn `addConnection` (thêm socketId mới vào SET).
- **Không** publish `USER_ONLINE` lần nữa → bạn bè không nhận event trùng.

---

## 8. Luồng chính: User offline (Happy Path)

**Kịch bản:** User A đóng app (graceful disconnect), không còn tab nào.

```
Browser A                realtime-gateway          Redis           RabbitMQ          user service           Browser B
    │                          │                    │                  │                    │                      │
    │──── disconnect ─────────▶│                    │                  │                    │                      │
    │                          │── removeConnection▶│                  │                    │                      │
    │                          │── isOnline(A)? ──▶│                  │                    │                      │
    │                          │◀─ false ──────────│                  │                    │                      │
    │                          │── set lastSeen ──▶│                  │                    │                      │
    │                          │── publish USER_OFFLINE ───────────────▶│                    │                      │
    │                          │                    │                  │── consume ────────▶│                      │
    │                          │                    │                  │                    │── updateLastSeen DB │
    │                          │                    │                  │◀─ EMIT_REALTIME ──│                      │
    │                          │◀──────────────────────────────────────│ offline_status_changed                     │
    │                          │── to user:B emit ──────────────────────────────────────────────────────────────▶│
    │                          │                    │                  │                    │  status=false, lastSeen
```

### Các bước chi tiết

1. **Gateway** `handleDisconnect`:
   - Dọn typing timers, read batch, packet listeners.
   - `removeConnection(userId, socketId)`.
   - `stillOnline = isOnline(userId)`.
2. Nếu `!stillOnline` (socket cuối cùng):
   - `lastSeen = new Date().toISOString()`.
   - Redis `SET user:A:lastSeen` (TTL 7 ngày).
   - Publish `USER_OFFLINE` / `{ userId, lastSeen }`.
3. **user service** `handleUserOffline`:
   - `updateLastSeen(userId, lastSeen)` → MongoDB `User.lastSeen`.
   - Publish `user.offline_status_changed` tới bạn bè với `{ userId, lastSeen }`.
4. **Frontend bạn bè**: `updateStatusOffline` → `status: false`, hiển thị "X phút trước".

### Multi-tab: đóng 1 tab, còn tab khác

- `removeConnection` xóa 1 socketId.
- `stillOnline = true` → **không** publish `USER_OFFLINE`.
- Bạn bè vẫn thấy A online — đúng hành vi mong muốn.

---

## 9. Tất cả trường hợp trong code hiện tại

| # | Tình huống | Hành vi |
|---|------------|---------|
| 1 | Connect lần đầu (offline → online) | `USER_ONLINE` → bạn bè nhận `online_status_changed` |
| 2 | Connect thêm tab/thiết bị | Chỉ `addConnection`; không `USER_ONLINE` |
| 3 | Disconnect 1 tab, còn tab khác | `removeConnection`; không `USER_OFFLINE` |
| 4 | Disconnect tab/socket cuối | `USER_OFFLINE` + `lastSeen` |
| 5 | JWT/cookie invalid khi connect | `disconnect()` ngay; không ghi presence |
| 6 | `GET /list-friends` | Mỗi friend: `redisService.isOnline(id)` + `lastSeen` từ MongoDB |
| 7 | Bạn bè chưa có trong Redux list | `upsertOnlineFriend` fetch profile qua `GET /user?userId=` |
| 8 | Lời mời kết bạn, invitee offline | Gửi email thay vì socket notification |
| 9 | Lời mời kết bạn, invitee online | `emitToUsers` → socket `notification.new_notification` |
| 10 | Saga accept friend, inviter online | Push notification realtime |
| 11 | Mất mạng đột ngột | Socket.IO ping timeout ~50s → `handleDisconnect` (giống graceful) |
| 12 | Socket zombie (TTL 90s hết) | `isOnline()` cleanup khi đọc; **không** tự broadcast offline |

---

## 10. State machine presence

Trạng thái **theo user** (không phải theo socket):

```
                    ┌─────────────────────────────────────┐
                    │              OFFLINE                 │
                    │  Redis: không còn socket alive       │
                    │  MongoDB: lastSeen có giá trị        │
                    └──────────────┬──────────────────────┘
                                   │
                          connect (prevOnline=false)
                                   │
                                   ▼
                    ┌─────────────────────────────────────┐
                    │              ONLINE                  │
                    │  Redis SET có ≥1 socket alive        │
                    │  MongoDB: lastSeen = null            │
                    └──────────────┬──────────────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              │                    │                    │
     thêm tab (connect)    đóng 1 tab          đóng tab cuối
              │                    │                    │
              ▼                    ▼                    ▼
         vẫn ONLINE           vẫn ONLINE            OFFLINE
         (no event)           (no event)         (USER_OFFLINE event)
```

Trạng thái **theo socket** (trong 1 gateway process):

```
CONNECT → join rooms → touch TTL ──(pong/interval)──▶ touch TTL ...
   │
   └── DISCONNECT → remove Redis → cleanup timers
```

---

## 11. UI & trải nghiệm người dùng

### Lần đầu vào trang bạn bè

1. `ListFriend` gọi `getFriends` → API trả `status` + `lastSeen` từ server.
2. `status: true` → chấm xanh + text "Đang online".
3. `status: false` → `formatLastSeen(lastSeen)` — "3 giờ trước", v.v.

### Realtime cập nhật (không cần refresh)

| Event socket | Redux action | UI |
|--------------|--------------|-----|
| `user.online_status_changed` (payload = friendId) | `upsertOnlineFriend` | Chấm xanh |
| `user.offline_status_changed` ({ userId, lastSeen }) | `updateStatusOffline` | Mất chấm xanh, hiện lastSeen |

### Socket connect scope

- Chỉ connect khi `user?.id` có (đã login).
- Một singleton socket cho cả app → mọi trang đều nhận presence events.

---

## 12. Ai đọc `isOnline()` và để làm gì?

| Service | File | Mục đích |
|---------|------|----------|
| **user** | `user.service.ts` → `listFriends`, `searchFriends` | Trả `status` trong API |
| **notification** | `notification.service.ts` → `handleMakeFriend` | Offline → email lời mời KB |
| **notification** | `handleUpdateStatusMakeFriend` | Online → push socket |
| **notification** | `runDigestSweep` | Online → push digest qua socket |
| **notification** | `notification-saga.subscriber.ts` | Accept friend → push nếu inviter online |
| **realtime-gateway** | `user-status.store.ts` | Quyết định có publish USER_ONLINE/OFFLINE |

Tất cả đọc **cùng schema Redis** (`user:{id}:sockets` + `socket:{id}` TTL).

---

## 13. Giới hạn hiện tại & hướng mở rộng

### Đã có

- [x] JWT cookie auth khi WebSocket connect
- [x] Room `user:{userId}` cho emit realtime
- [x] Redis presence store + TTL zombie cleanup
- [x] Multi-tab: chỉ báo online/offline khi socket đầu/cuối
- [x] RabbitMQ tách gateway ↔ user service
- [x] Fan-out presence tới bạn bè qua socket
- [x] `lastSeen` lưu MongoDB + hiển thị UI
- [x] `isOnline` dùng cho notification routing
- [x] Redis Io Adapter (sẵn sàng scale gateway)

### Chưa có / hạn chế

| Hạng mục | Mô tả |
|----------|-------|
| Broadcast offline khi chỉ TTL hết | `isOnline()` trả false nhưng không publish `USER_OFFLINE` nếu `handleDisconnect` không chạy và ping timeout chưa kịp |
| Double bookkeeping | Gateway vừa `join room` vừa mirror socketId vào Redis SET |
| `getOnlineUsers()` | Dùng `KEYS user:*:sockets` — không scale trên Redis lớn |
| Presence privacy | Mọi bạn bè đều thấy online status; chưa có "ẩn trạng thái" |
| Typing indicator | Dùng room `conversation:*`, không liên quan presence Redis |
| Push khi app đóng hẳn | User offline thật → không có Web Push; bạn bè chỉ thấy khi họ đang mở app |
| Idle vs online | Chỉ có online/offline; chưa phân biệt "away" |
| Validate presence khi gọi WebRTC | Call signaling chưa check callee online từ Redis |

### Hướng mở rộng

1. **Cron / keyspace notification**: khi `socket:{id}` hết TTL → publish `USER_OFFLINE` (đồng bộ broadcast với API).
2. **Đơn giản hóa gateway**: dùng `fetchSockets()` trong room cho logic nội bộ; Redis chỉ lưu `user:{id}:online = 1` cho cross-service.
3. **`SSCAN` thay `KEYS`**: liệt kê user online an toàn hơn.
4. **Presence service riêng**: tách read/write presence khỏi gateway.
5. **"Last active" vs "online"**: heartbeat app-level phân biệt đang dùng app vs chỉ mở tab background.

---

## 14. FAQ cho sinh viên

### Q1: SocketId đã nằm trong RAM, sao còn cần Redis?

RAM của Socket.IO **chỉ có trong gateway process**. Service `user` và `notification` **không có** `server.to(...)`. Họ cần Redis (hoặc HTTP API presence) để hỏi "user X online không?".

### Q2: Room `user:{userId}` chưa đủ để biết online?

**Trong gateway** — đủ để emit. **Ngoài gateway** — không đủ. Room không expose cho `GET /list-friends`.

### Q3: Tại sao không báo offline mỗi lần đóng tab?

User có thể mở **nhiều tab/thiết bị**. Chỉ khi `isOnline()` trả `false` (không còn socket alive) mới publish `USER_OFFLINE`.

### Q4: `status` trong API và event socket khác gì?

| Nguồn | Khi nào |
|-------|---------|
| API `list-friends` | Lúc load trang / pagination |
| Socket `online/offline_status_changed` | Realtime khi bạn bè connect/disconnect |

### Q5: Redis Adapter và UserStatusStore khác gì?

- **Adapter**: giúp **nhiều gateway** emit tới socket trên instance khác (pub/sub).
- **UserStatusStore**: lưu **user nào đang online** cho cả hệ thống đọc.

Hai thứ độc lập; có thể cần cả hai khi scale.

### Q6: `lastSeen` lưu ở đâu?

1. Redis `user:{id}:lastSeen` (TTL 7 ngày) — lúc disconnect trên gateway.
2. MongoDB `User.lastSeen` — `user.service` ghi khi consume `USER_OFFLINE`.
3. Redux `friend.lastSeen` — frontend cập nhật khi nhận socket event.

### Q7: Làm sao debug presence?

1. Redis CLI: `SMEMBERS user:{userId}:sockets`, `TTL socket:{socketId}`.
2. Gateway log connect/disconnect.
3. RabbitMQ Management: queue `user_online_queue`, `user_offline_queue`.
4. Browser DevTools → Network → WS → xem frame connect/disconnect.
5. Frontend: listen `user.online_status_changed` / `user.offline_status_changed` trong console.

### Q8: User login nhưng chưa mở socket thì online không?

**Không.** Presence chỉ bật khi `socket.connect()` chạy (sau login, trong `App.tsx`). Chỉ login HTTP không làm user online.

### Q9: Có thể dùng `fetchSockets()` thay Redis Set trong gateway không?

Có — với Redis Adapter, `server.in('user:'+id).fetchSockets()` gom socket cross-instance. Code hiện tại chọn Redis Set để **cùng một nguồn** cho gateway lẫn `user`/`notification` service.

### Q10: Event `user_online` / `user_offline` trong `socket.events.ts` dùng không?

Trong `SOCKET_EVENTS` có `CONNECTION: 'user_online'` và `DISCONNECTION: 'user_offline'` — đây là **tên nội bộ / legacy**, **không** phải event client listen. Client thực tế listen:

- `user.online_status_changed`
- `user.offline_status_changed`

---

## Phụ lục A — RabbitMQ routing

| Routing key | Queue | Publisher | Consumer |
|-------------|-------|-----------|----------|
| `user.online` | `user_online_queue` | realtime-gateway | user-subscribers |
| `user.offline` | `user_offline_queue` | realtime-gateway | user-subscribers |
| `realtime.emitEvent` | `realtime_queue_emit_event` | user-events-publisher, notification-events-publisher | realtime-gateway |

Exchange: `realtime.events` (`EXCHANGE_RMQ.REALTIME_EVENTS`).

---

## Phụ lục B — Socket events (client listen)

### `user.online_status_changed`

**Payload:** `string` — `userId` của người vừa online.

```json
"507f1f77bcf86cd799439011"
```

### `user.offline_status_changed`

**Payload:** object.

```json
{
  "userId": "507f1f77bcf86cd799439011",
  "lastSeen": "2026-06-28T10:30:00.000Z"
}
```

---

## Phụ lục C — Tham số TTL & heartbeat

| Tham số | Giá trị | File |
|---------|---------|------|
| `socketTtlSeconds` | 90s | `user-status.store.ts` |
| `userSetTtlSeconds` | 300s | `user-status.store.ts` |
| `socketTouchIntervalMs` | 25s | `realtime.gateway.ts` |
| `pingInterval` | 40s | `@WebSocketGateway` |
| `pingTimeout` | 10s | `@WebSocketGateway` |
| `lastSeen` Redis TTL | 7 ngày | `handleDisconnect` |

---

*Tài liệu đồng bộ với codebase tại thời điểm viết. Khi thêm presence cron, đơn giản hóa Redis schema, hoặc tách presence service — cập nhật mục 13 và sequence diagram.*
