# CURRENT CHAT CONVERSATIONS / UNREAD / UI README

Cap nhat: 2026-04-02

Tai lieu nay mo ta trang thai hien tai (as-is) cua he thong chat lien quan den:

- API lay danh sach conversation (get conversations)
- Co che cap nhat unread count va last message
- Cac hanh vi UI dang hoat dong

## 1. Tong quan hien tai

He thong da tach ro 2 payload:

- Payload list nhe cho sidebar: `GET /chat/conversations`
- Payload detail day du cho man chat: `GET /chat/conversations/:conversationId`

Muc tieu:

- Sidebar tai nhanh (khong keo full members/messages)
- Khi mo conversation thi hydrate them detail neu can

## 2. Luong GET conversations hien tai

### 2.1 Backend endpoint

- Endpoint: `GET /chat/conversations?limit=...&cursor=...`
- Controller tra ve summary qua formatter `formatConversationSummary`

Cac field summary chinh:

- `id`
- `type`
- `groupName`
- `groupAvatar`
- `unreadCount`
- `createdAt`
- `updatedAt`
- `lastMessageAt`
- `lastMessageText`
- `lastMessageSenderId`
- `lastMessageSenderName`
- `lastMessageSenderAvatar`

### 2.2 Repository query toi uu

`findByUserIdPaginated(userId, cursor, take)` trong conversation repository dang theo huong toi uu:

- Query truc tiep bang `conversationMember`
- Filter active membership (`isActive: true`)
- Sort theo `conversationMember.lastMessageAt desc`
- Cursor pagination theo `lastMessageAt < cursor`
- Select nested `conversation` chi lay field summary denormalized
- Khong include full `members/messages` trong list endpoint

Ket qua map ra danh sach summary gan voi membership:

- `unreadCount`, `lastReadAt`, `lastMessageAt` lay tu membership
- Metadata preview lay tu conversation denormalized fields

### 2.3 Frontend load danh sach

`conversationSlice.getConversations` goi API list, sau do luu vao Redux state.

`ChatSidebar`:

- Render preview bang `lastMessageText`
- Neu sender khac user hien tai thi hien prefix ten nguoi gui: `senderName: text`
- Hien badge unread khi `unreadCount > 0` hoac `unreadCount === "5+"`
- Load more dung cursor la `lastMessageAt` cua item cuoi

## 3. Co che cap nhat last message hien tai

Khi gui tin nhan (`sendMessage`):

1. Luu message vao bang message
2. Cap nhat denormalized metadata vao conversation qua `updateUpdatedAt`:
   - `lastMessageAt`
   - `lastMessageText`
   - `lastMessageSenderId`
   - `lastMessageSenderName`
   - `lastMessageSenderAvatar`
3. Cap nhat `conversationMember.lastMessageAt` cho tat ca member conversation
4. Publish realtime event (`message:ack` cho sender, `message:new` cho thanh vien con lai)

Ket qua:

- Sidebar co du lieu preview moi ngay sau khi message duoc xu ly
- Khong can join message table de render dong preview

## 4. Co che unread count hien tai

### 4.1 Write-side

Khi co message moi:

- `increaseUnreadForOthers(conversationId, senderId)` tang `unreadCount` cho tat ca member khac sender

Khi user doc tin nhan:

- Realtime gui su kien read (`message:read`) len server
- Server xu ly `updateLastRead(conversationId, userId, lastReadMessageId)`:
  - set `lastReadAt = now`
  - set `lastReadMessageId`
  - reset `unreadCount = 0`

### 4.2 Read-side

`getConversations` goi `calculateUnreadCounts(...)` de tao `unreadMap` va tra ve `unreadCount` cho tung conversation.

Frontend cung cap nhat tam thoi ngay tren client:

- Neu nhan `message:new` cho conversation khong dang mo: dispatch `upUnreadCount`
- Neu dang mo conversation va da doc message cuoi: dispatch `markConversationRead` de set ve `0`

Luu y:

- Client update tam thoi de UI phan hoi nhanh
- Nguon su that cuoi cung van la unread count duoc server persist

## 5. UI dang hoat dong nhu the nao

### 5.1 Sidebar

- Hien ten, avatar, thoi gian, preview tin nhan moi nhat, unread badge
- Khong bat buoc phai co `members` day du trong payload list
- Trai nghiem scroll va load more theo cursor `lastMessageAt`

### 5.2 Chat window

Khi mo conversation:

- Neu conversation trong state la summary nhe (thieu `members`), component se goi `GET /chat/conversations/:conversationId` de hydrate detail
- Sau hydrate, UI co du thong tin thanh vien de render title/avatar direct chat, typing/seen labels, profile panel

Trong qua trinh nhan tin realtime:

- `message:new`: add message, update lastMessage trong list, tang unread neu khong o conversation dang mo
- `message:ack`: doi message tam sang message that, dong bo lastMessage
- `message:error`: danh dau message gui that bai

### 5.3 Search va conversation theo friend

- Search endpoint va `conversation-by-friend` hien dang tra payload detail (`members + lastMessage`) de phuc vu cac man can du thong tin thanh vien ngay lap tuc.

## 6. Diem can luu y

1. Da toi uu list path:

- Sidebar khong con phu thuoc include nang (`members/messages`) trong endpoint list.

2. Detail path van giu day du:

- Cac man hinh can profile/member role van lay qua endpoint detail.

3. Unread hien tai la denormalized:

- Write nhanh, read nhanh, phu hop tai cao.

4. Co optimistic UX tren client:

- UI unread co the thay doi ngay khi nhan event, sau do dong bo lai theo state server.

## 7. Ket luan

Trang thai hien tai da dat duoc:

- List conversations nhe va phu hop quy mo lon
- Last message preview cap nhat realtime va denormalized
- Unread count cap nhat theo event va persist tren membership
- UI sidebar/chat window hoat dong theo mo hinh summary -> detail hydration ro rang
