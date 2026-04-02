# Unread Count Realtime README

Tai lieu nay mo ta implementation hien tai sau khi toi uu unread realtime.

## 1. Muc tieu

1. Unread tang ngay khi co tin nhan moi.
2. Unread reset ve 0 khi user doc.
3. Load sidebar nhanh, khong N+1 query dem unread.
4. Frontend xu ly message event don gian, khong dedupe TTL.

## 2. Thanh phan lien quan

Frontend:
- `frontend/src/components/ProtectedRoute/index.tsx`
- `frontend/src/redux/slices/conversationSlice.ts`
- `frontend/src/components/ChatWindow/index.tsx`
- `frontend/src/apis/index.ts`

Backend:
- `backend/apps/chat/prisma/schema.prisma`
- `backend/apps/chat/src/repositories/conversation-member.repository.ts`
- `backend/apps/chat/src/chat.service.ts`
- `backend/apps/chat/src/chat.controller.ts`
- `backend/apps/chat/src/rmq/publishers/chat-events.publisher.ts`
- `backend/apps/realtime-gateway/src/realtime/realtime.gateway.ts`

## 3. Denormalization unreadCount (chong N+1)

He thong da them truong:
- `conversationMember.unreadCount` (Int, default 0)

Khi gui message moi:
- Chat Service goi `increaseUnreadForOthers(conversationId, senderId)`
- DB tang `unreadCount += 1` cho tat ca member active, tru sender

Khi user read:
- Chat Service goi `updateLastRead(...)`
- DB set:
  - `lastReadAt = now`
  - `lastReadMessageId = ...`
  - `unreadCount = 0`

Khi load danh sach conversation:
- Backend khong dem unread theo tung conversation nua
- `calculateUnreadCounts` chi doc gia tri `me.unreadCount` da denormalized

## 4. Event message realtime (da hop nhat)

Backend `publishMessageSent` hien tai:

1. `message:ack` -> gui cho sender
2. `message:new` -> gui cho cac member khac sender

Da bo event trung lap:
- `chat.new_message`

Frontend (`ProtectedRoute`) chi nghe:
- `message:new`
- `message:ack`

Khong con co che `processedMessageKeysRef` dedupe TTL 5s.

## 5. Luong tang unread tren frontend

Khi nhan `message:new`:

1. Frontend normalize message
2. Neu conversation chua co trong Redux:
  - Goi `GET /chat/conversations/:conversationId`
  - Upsert conversation vao store
3. `addMessage` + `updateNewMessage`
4. Neu khong dung conversation dang mo:
  - `upUnreadCount({ conversationId })`

Gioi han hien thi:
- `0..5`, qua 5 thi hien `5+`

## 6. Xu ly Ghost Conversation

Da bo sung endpoint:
- `GET /chat/conversations/:conversationId`

Muc dich:
- Khi co tin nhan den 1 conversation chua duoc load trong sidebar, frontend co the hydrate va day len dau danh sach ngay, khong can F5.

## 7. Luong read (socket-only)

Frontend `ChatWindow`:
- Emit `message:read` voi payload `{ conversationId, lastMessageId }`
- Reset unread local bang action `markConversationRead`

Backend Gateway:
- Nhan `message:read`
- Publish RabbitMQ `UPDATE_MESSAGE_READ` cho Chat Service

Backend Chat Service:
- `updateMessageRead(...)` cap nhat DB async
- Reset unreadCount ve 0 trong `conversationMember`

Da loai bo:
- HTTP endpoint `POST /chat/read_message`
- DTO/service method phu thuoc endpoint nay

## 8. Seen status batching

Gateway da throttle event read:
- Gom read trong cua so 1 giay
- Broadcast 1 event:
  - `user:read_batch`
  - payload: `{ conversationId, users: [{ userId, lastReadMessageId }] }`

Frontend `useChatSocketEvents`:
- Nhan `user:read_batch`
- Update seen status theo lo de giam giat UI khi nhieu user doc cung luc

## 9. Sequence tom tat

### 9.1 New message -> unread tang

1. Sender gui message
2. Chat Service luu message, tang unreadCount cho member khac
3. Realtime emit `message:new` den nguoi nhan
4. Frontend nguoi nhan cap nhat sidebar/message
5. Neu khong mo conversation do, unread local +1

### 9.2 Read message -> unread reset

1. User mo conversation va emit `message:read`
2. Frontend reset unread local ngay (`markConversationRead`)
3. Gateway publish RMQ update read
4. Chat Service reset unreadCount DB = 0
5. Seen status gui theo batch `user:read_batch`

## 10. Trang thai hien tai

1. Sidebar load nhanh hon do bo N+1 unread query.
2. Event message da don gian hoa, khong con duplicate path.
3. Ghost conversation da duoc hydrate tu dong.
4. Luong read da socket-only.
5. Seen status da co batching 1 giay.

---

Tai lieu nay phan anh dung implementation hien tai de team backend/frontend van hanh va mo rong unread realtime.
