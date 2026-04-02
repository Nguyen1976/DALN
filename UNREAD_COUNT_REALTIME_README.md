# Unread Count Realtime README

Tai lieu nay mo ta cach he thong dang xu ly unread count theo thoi gian thuc (realtime) trong code hien tai.

## 1. Muc tieu

Unread count can dat 2 yeu cau:

1. Tang ngay khi co tin nhan moi toi mot conversation ma user khong mo conversation do.
2. Ve 0 khi user da mo conversation va doc tin nhan.

## 2. Thanh phan lien quan

Frontend:

- `frontend/src/components/ProtectedRoute/index.tsx`
- `frontend/src/redux/slices/conversationSlice.ts`
- `frontend/src/components/ChatWindow/index.tsx`

Backend:

- `backend/apps/chat/src/rmq/publishers/chat-events.publisher.ts`
- `backend/apps/realtime-gateway/src/realtime/realtime.gateway.ts`
- `backend/apps/chat/src/chat.service.ts`
- `backend/apps/chat/src/chat.controller.ts`

## 3. Event realtime lien quan unread

Khi server tao message thanh cong, backend publish cac event:

1. `message:ack` -> gui cho sender (xac nhan gui thanh cong).
2. `message:new` -> gui cho cac thanh vien khac sender.
3. `chat.new_message` -> gui cho tat ca thanh vien conversation.

Frontend (`ProtectedRoute`) dang nghe ca:

- `chat.new_message`
- `message:new`

Sau khi nhan message, frontend se:

- `dispatch(addMessage(message))`
- `dispatch(updateNewMessage({ conversationId, lastMessage }))`
- Neu conversation cua message KHONG phai conversation dang mo:
  - `dispatch(upUnreadCount({ conversationId }))`

## 4. Co che tang unread count (UI realtime)

File: `frontend/src/redux/slices/conversationSlice.ts`

Reducer `upUnreadCount`:

- Tim conversation theo `conversationId`.
- Neu khong tim thay -> bo qua.
- Neu da la `"5+"` -> giu nguyen.
- Nguoc lai tang len 1, neu >5 thi chuyen thanh `"5+"`.

Nghia la unread realtime tren UI duoc cap nhat theo event socket, khong doi API polling.

## 5. Co che reset unread count (doc tin nhan)

File: `frontend/src/components/ChatWindow/index.tsx`

Khi dang mo conversation va co message moi nhat KHONG phai cua minh:

1. Frontend emit socket:

- `message:read` voi payload `{ conversationId, lastMessageId }`

2. Frontend dong thoi goi HTTP:

- `POST /chat/read_message` voi payload `{ conversationId, lastReadMessageId }`

3. Redux local reset unread:

- `readMessage.fulfilled` set `conversation.unreadCount = "0"`

## 6. Co che persist tren server

### 6.1 API read_message

File: `backend/apps/chat/src/chat.controller.ts`

- Endpoint: `POST /chat/read_message`

File: `backend/apps/chat/src/chat.service.ts`

- `readMessage(data)`:
  - Kiem tra message hop le.
  - Cap nhat `conversationMember.lastReadAt` va `lastReadMessageId`.

### 6.2 Socket message:read

File: `backend/apps/realtime-gateway/src/realtime/realtime.gateway.ts`

- Nhan event `message:read`.
- Broadcast `user:read` cho cac member khac de hien seen status.
- Publish RMQ `UPDATE_MESSAGE_READ` de chat service cap nhat DB async.

Ghi chu:

- Luong `user:read` chu yeu phuc vu seen status (avatar da xem), khong truc tiep tang/giu unread count.

## 7. Unread khi load lai trang

Unread count ban dau khi vao app khong den tu realtime event, ma den tu API list conversation:

- `GET /chat/conversations`
- Backend goi `calculateUnreadCounts(conversations, userId)`

`calculateUnreadCounts`:

- Lay `lastReadAt` cua user trong moi conversation.
- Dem message chua doc qua `messageRepo.findUnreadMessages(...)`.
- Mapping:
  - 0 -> `"0"`
  - 1..5 -> `"1".."5"`
  - > 5 -> `"5+"`

Vi vay unread count se duoc "chot lai dung" sau khi reload app hoac fetch lai conversations.

## 8. Co che tranh duplicate event

File: `frontend/src/components/ProtectedRoute/index.tsx`

Do frontend nghe ca `chat.new_message` va `message:new`, cung 1 message co the den 2 lan.
De tranh tang unread 2 lan:

- Co `processedMessageKeysRef` + TTL 5s.
- Neu trung key message trong cua so 5s -> bo qua phan tang unread.

Tuy vay, `addMessage` va `updateNewMessage` van duoc goi truoc khi check duplicate trong code hien tai.
Unnread thi da duoc chan duplicate.

## 9. Tom tat sequence

### 9.1 Tang unread

1. User B gui message.
2. User A nhan socket `chat.new_message`/`message:new`.
3. Neu A khong mo conversation do:

- `upUnreadCount` -> unread +1 (toi da `5+`).

### 9.2 Reset unread

1. User A mo conversation va thay tin nhan moi.
2. A goi `readMessage` (HTTP) + emit `message:read` (socket).
3. Redux local set unread ve `0`.
4. Server cap nhat `lastReadAt/lastReadMessageId` de lan load sau dung.

## 10. Hanh vi hien tai va gioi han

1. Realtime unread count hien tai la client-driven (dua tren socket event + state local).
2. Du lieu unread chinh xac cuoi cung duoc server recompute khi fetch conversations.
3. Co gioi han hien thi unread toi da `5+`.
4. Neu conversation chua co trong state local, `upUnreadCount` se bo qua.
5. Co dedupe theo TTL 5s de tranh tang 2 lan khi nhan 2 event gan nhau.

## 11. De xuat nang cap (optional)

1. Dong bo unread qua mot event server-side rieng (vd: `conversation:unread_updated`) de giam phu thuoc logic local.
2. Khi duplicate message, can nhac skip ca `addMessage/updateNewMessage` de giam side-effect.
3. Co the bo sung co che "mark as read on focus" chi khi user thuc su o dung conversation va cua so dang active.

---

Tai lieu nay phan anh dung implementation hien tai de team de debug va mo rong unread realtime.
