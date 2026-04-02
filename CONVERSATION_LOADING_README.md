# Conversation Loading README

Tai lieu nay mo ta chinh xac cach ung dung load danh sach conversation va du lieu di kem, theo code hien tai.

## 1. Tong quan luong load

Luong chinh:

1. Frontend vao trang chat -> component sidebar kiem tra store conversation.
2. Neu store rong, frontend goi API `GET /chat/conversations?limit=...&cursor=...`.
3. Backend lay danh sach membership cua user theo `lastMessageAt` (co phan trang bang cursor).
4. Backend lay conversation + members + tin nhan cuoi (lastMessage).
5. Backend tinh `unreadCount` cho tung conversation.
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

## 4. Frontend: schema du lieu conversation

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
- `username?: string`
- `avatar?: string`
- `fullName?: string`
- `lastMessageAt?: string`

## 5. Backend API load conversations

File: `backend/apps/chat/src/chat.controller.ts`

Endpoint:

- `GET /chat/conversations`
- Query:
  - `limit` (default 20)
  - `cursor` (optional)

Controller goi:

- `chatService.getConversations(userInfo.userId, { limit, cursor })`

Controller tra ve:

- `{ conversations: [...] }` (sau khi format)

Moi conversation duoc format co:

- `id, type, groupName, groupAvatar`
- `unreadCount`
- `createdAt, updatedAt`
- `members` (co role, username, avatar, fullName, lastReadAt, lastMessageAt)
- `lastMessage` (tin nhan moi nhat hoac null)

## 6. Backend service: logic phan trang va unread

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
- Lay `lastReadAt` cua `me`.
- Goi `messageRepo.findUnreadMessages(conversationId, lastReadAt, userId)`.
- Quy doi unread:
  - 0 -> `"0"`
  - 1..5 -> `"1".."5"`
  - > 5 -> `"5+"`

## 7. Backend repository: du lieu duoc lay kem

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
  - `messages` (order by createdAt desc, take 1)
    - include `senderMember`
    - include `medias` (sortOrder asc)

Buoc 3 - reorder ket qua:

- Vi query conversation bang `in` khong dam bao thu tu, repo map lai theo thu tu memberships ban dau.

## 8. Du lieu kem theo khi load conversation

Khi frontend load danh sach conversation, moi item da co du lieu du de render sidebar ma khong can goi API phu:

- Metadata conversation:
  - id, type, groupName, groupAvatar, createdAt, updatedAt
- Thong tin member:
  - userId, role, username, avatar, fullName
  - lastReadAt, lastMessageAt
- Last message:
  - id, content/text, type, sender info, createdAt, medias
- Unread state:
  - unreadCount da tinh san tren backend
- Frontend derived state:
  - voi DIRECT chat, `groupName/groupAvatar` duoc map tu thanh vien con lai

## 9. Cac diem quan trong de tranh loi

1. Cursor format:

- Frontend dang replace `+` thanh `%2B` truoc khi gui query.
- Backend parse cursor bang `new Date(cursor)`.

2. Co che append:

- `getConversations.fulfilled` dang append du lieu moi vao state cu.
- Neu backend tra trung item giua cac trang, frontend hien tai khong dedupe trong nhanh nay.

3. Uu tien truong sap xep:

- Phan trang dua tren `conversationMember.lastMessageAt`, khong phai `conversation.updatedAt`.

4. Unread theo `lastReadAt`:

- UnreadCount duoc tinh theo moc thoi gian da doc cua tung user.

## 10. Cac file lien quan

Frontend:

- `frontend/src/components/ChatSidebar/index.tsx`
- `frontend/src/redux/slices/conversationSlice.ts`
- `frontend/src/redux/store.ts`

Backend:

- `backend/apps/chat/src/chat.controller.ts`
- `backend/apps/chat/src/chat.service.ts`
- `backend/apps/chat/src/repositories/conversation.repository.ts`
- `backend/apps/chat/src/repositories/conversation-member.repository.ts`

---

Neu can, co the bo sung them 1 so do sequence (Mermaid) vao tai lieu nay de team backend/frontend on-board nhanh hon.
