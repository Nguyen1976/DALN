# Conversation Loading README

Tai lieu nay mo ta chinh xac cach ung dung load danh sach conversation va du lieu di kem theo implementation hien tai (da toi uu unread realtime).

## 1. Tong quan luong load

Luong chinh:

1. Frontend vao trang chat -> component sidebar kiem tra store conversation.
2. Neu store rong, frontend goi API `GET /chat/conversations?limit=...&cursor=...`.
3. Backend lay danh sach membership cua user theo `lastMessageAt` (co phan trang bang cursor).
4. Backend lay conversation + members + tin nhan cuoi (lastMessage).
5. Backend tra `unreadCount` tu du lieu denormalized (`conversationMember.unreadCount`) thay vi dem message.
6. Backend format payload tra ve.
7. Frontend merge vao Redux state, normalize ten/avatar cho DIRECT chat.
8. UI sidebar render danh sach conversation va nut `Tai them` de lay trang tiep theo.

## 2. Frontend: diem bat dau load

File: `frontend/src/components/ChatSidebar/index.tsx`

- Luu tru hien tai doc tu Redux qua `selectConversation`.
- Trong `useEffect`, neu `conversations.length === 0` thi dispatch:
  - `getConversations({ limit: 10, cursor: null })`
- Khi bam `Tai them`, frontend lay cursor tu conversation cuoi:
  - `members.find(m => m.userId === user.id)?.lastMessageAt`
  - Sau do dispatch tiep `getConversations({ limit: 10, cursor })`

Ghi chu:

- Cursor dang dung la `lastMessageAt` cua membership cua user hien tai trong conversation cuoi.

## 3. Frontend: thunk goi API va xu ly response

File: `frontend/src/redux/slices/conversationSlice.ts`

Thunk:

- `getConversations` goi:
  - `GET ${API_ROOT}/chat/conversations?limit=${limit}&cursor=${cursor ?? ""}`
- Truoc khi goi API, cursor duoc xu ly:
  - `cursor?.replaceAll("+", "%2B")`
- Ket qua doc tu:
  - `response.data.data.conversations`

Khi `fulfilled`:

- Redux map moi conversation de normalize:
  - Neu `type === "DIRECT"`:
    - `groupName` = username cua doi phuong
    - `groupAvatar` = avatar cua doi phuong
  - `lastMessage` neu undefined thi set `null`
  - `membershipStatus` mac dinh `"ACTIVE"`
  - `canSendMessage` mac dinh `true`
- Danh sach moi duoc append vao state hien tai.

## 4. Frontend: hydration khi co message realtime (ghost conversation)

File: `frontend/src/components/ProtectedRoute/index.tsx`

Khi nhan event `message:new`:

1. Frontend normalize message.
2. Neu `conversationId` chua co trong Redux:

- Goi `GET /chat/conversations/:conversationId` qua `getConversationByIdAPI`.
- `applyConversationUpdate(...)` de them/upsert vao dau danh sach.

3. Cap nhat `lastMessage` cho sidebar.
4. Neu user khong mo dung conversation do, tang unread local (`upUnreadCount`).

Muc dich:

- Tranh mat tin nhan moi voi conversation nam o trang pagination sau.
- Sidebar luon "song" ma khong can reload toan bo.

## 5. Frontend: schema du lieu conversation

File: `frontend/src/redux/slices/conversationSlice.ts`

### Conversation

- `id: string`
- `type: string` (DIRECT/GROUP)
- `unreadCount?: string` (`"0"`, `"1".."5"`, `"5+"`)
- `membershipStatus?: "ACTIVE" | "REMOVED" | "LEFT"`
- `canSendMessage?: boolean`
- `groupName?: string`
- `groupAvatar?: string`
- `createdAt: string`
- `updatedAt?: string`
- `members: ConversationMember[]`
- `lastMessage: Message | null`

### ConversationMember

- `userId: string`
- `role?: "ADMIN" | "MEMBER" | "OWNER"`
- `lastReadMessageId?: string`
- `lastReadAt?: string`
- `unreadCount?: number` (du lieu denormalized tu backend)
- `username?: string`
- `avatar?: string`
- `fullName?: string`
- `lastMessageAt?: string`

## 6. Backend API load conversations

File: `backend/apps/chat/src/chat.controller.ts`

Endpoint:

- `GET /chat/conversations`
- `GET /chat/conversations/:conversationId` (hydrate conversation le)
- Query:
  - `limit` (default 20)
  - `cursor` (optional)

Controller goi:

- `chatService.getConversations(userInfo.userId, { limit, cursor })`

Controller tra ve:

- `{ conversations: [...] }` (sau khi format)
- `{ conversation: {...} }` voi endpoint by id

Moi conversation duoc format co:

- `id, type, groupName, groupAvatar`
- `unreadCount`
- `createdAt, updatedAt`
- `members` (co role, username, avatar, fullName, lastReadAt, lastMessageAt)
- `lastMessage` (tin nhan moi nhat hoac null)

## 7. Backend service: logic phan trang va unread

File: `backend/apps/chat/src/chat.service.ts`

`getConversations(userId, params)`:

1. `take = Number(params.limit) || 20`
2. `cursor = params.cursor ? new Date(params.cursor) : null`
3. Goi repository:
   - `conversationRepo.findByUserIdPaginated(userId, cursor, take)`
4. Tinh unread:
   - `calculateUnreadCounts(conversations, userId)`
5. Tra ve:
   - `{ conversations, unreadMap }`

`calculateUnreadCounts`:

- Tim `me` trong `conversation.members`.
- Doc truc tiep `me.unreadCount` (denormalized counter).
- Quy doi unread hien thi:
  - 0 -> `"0"`
  - 1..5 -> `"1".."5"`
  - > 5 -> `"5+"`

Cap nhat counter:

- Khi message moi: increment unread cho member khac sender.
- Khi read: reset unread = 0 trong `updateLastRead`.

## 8. Backend repository: du lieu duoc lay kem

File: `backend/apps/chat/src/repositories/conversation.repository.ts`

Ham chinh:

- `findByUserIdPaginated(userId, cursor, take)`

Buoc 1 - lay membership:

- Query `conversationMember` theo `userId`, `isActive: true`.
- Neu co cursor thi loc `lastMessageAt < cursor`.
- Sort `lastMessageAt desc`.
- `take` phan tu.

Buoc 2 - lay conversation details:

- Query conversation theo danh sach `conversationId` vua lay.
- Include:
  - `members` (active)
    - co `unreadCount`
  - `messages` (order by createdAt desc, take 1)
    - include `senderMember`
    - include `medias` (sortOrder asc)

Buoc 3 - reorder ket qua:

- Vi query conversation bang `in` khong dam bao thu tu, repo map lai theo thu tu memberships ban dau.

## 9. Du lieu kem theo khi load conversation

Khi frontend load danh sach conversation, moi item da co du lieu du de render sidebar ma khong can goi API phu:

- Metadata conversation:
  - id, type, groupName, groupAvatar, createdAt, updatedAt
- Thong tin member:
  - userId, role, username, avatar, fullName
  - lastReadAt, lastMessageAt, unreadCount
- Last message:
  - id, content/text, type, sender info, createdAt, medias
- Unread state:
  - unreadCount render tu unread counter denormalized
- Frontend derived state:
  - voi DIRECT chat, `groupName/groupAvatar` duoc map tu thanh vien con lai

## 10. Realtime interaction voi loading

1. Event message da hop nhat:

- Frontend chi nghe `message:new` (khong con `chat.new_message`).

2. Read flow socket-only:

- Frontend emit `message:read`.
- Gateway publish RMQ de Chat Service cap nhat DB async.
- Frontend reset unread local qua `markConversationRead`.
- Khong con `POST /chat/read_message`.

3. Seen status batching:

- Gateway gom event read trong 1 giay va emit `user:read_batch`.

## 11. Cac diem quan trong de tranh loi

1. Cursor format:

- Frontend dang replace `+` thanh `%2B` truoc khi gui query.
- Backend parse cursor bang `new Date(cursor)`.

2. Co che append:

- `getConversations.fulfilled` dang append du lieu moi vao state cu.
- Neu backend tra trung item giua cac trang, frontend hien tai khong dedupe trong nhanh nay.

3. Uu tien truong sap xep:

- Phan trang dua tren `conversationMember.lastMessageAt`, khong phai `conversation.updatedAt`.

4. Unread theo counter denormalized:

- UnreadCount khong dem lai message khi load danh sach.
- Gia tri chinh xac duoc duy tri boi update increment/reset tren `conversationMember`.

## 12. Cac file lien quan

Frontend:

- `frontend/src/components/ChatSidebar/index.tsx`
- `frontend/src/components/ProtectedRoute/index.tsx`
- `frontend/src/redux/slices/conversationSlice.ts`
- `frontend/src/apis/index.ts`
- `frontend/src/redux/store.ts`

Backend:

- `backend/apps/chat/src/chat.controller.ts`
- `backend/apps/chat/src/chat.service.ts`
- `backend/apps/chat/src/repositories/conversation.repository.ts`
- `backend/apps/chat/src/repositories/conversation-member.repository.ts`
- `backend/apps/chat/src/rmq/publishers/chat-events.publisher.ts`
- `backend/apps/realtime-gateway/src/realtime/realtime.gateway.ts`

---

Tai lieu nay da dong bo voi implementation unread realtime hien tai.
