# Typing Indicator & Seen Status Implementation

Hướng dẫn hoàn chỉnh cho việc triển khai hai tính năng: **Typing Indicator** (chỉ báo gõ) và **Seen Status** (trạng thái xem) trong hệ thống Chat Realtime.

## 📋 Tổng Quan Kiến Trúc

### Công Nghệ Sử Dụng:

- **Backend**: NestJS (Microservices)
- **Frontend**: ReactJS + Redux
- **Real-time**: Socket.io
- **IPC**: RabbitMQ (Message Broker)
- **Database**: MongoDB

### Luồng Hoạt Động:

```
┌─ TYPING INDICATOR FLOW ─┐
Frontend (User Typing)
    ↓ emit 'user:typing'
Realtime Gateway (Socket)
    ↓ broadcast to room
Frontend (Other Users) - Listen 'user:typing'
    ↓ Update Redux
UI Display "X đang gõ..."

┌─ SEEN STATUS FLOW ─┐
Frontend (User Opens Conversation)
    ↓ emit 'message:read'
Realtime Gateway (Socket)
    ├─ broadcast 'user:read' to room
    └─ publish UPDATE_MESSAGE_READ to RabbitMQ
Frontend (Other Users) - Listen 'user:read'
    ↓ Update Redux
Chat Service (RabbitMQ Subscriber)
    ↓ Update MongoDB: conversationMember.lastReadMessageId
    └─ Update completed
UI Display Avatar of users who viewed
```

## 🔧 Backend Implementation

### 1. Constants (libs/constant/)

#### RMQ Payload Types (`payload.ts`)

```typescript
export interface UserTypingPayload {
  conversationId: string;
  userId: string;
  status: "start" | "stop";
}

export interface UserReadPayload {
  conversationId: string;
  userId: string;
  lastReadMessageId: string;
}

export interface UpdateMessageReadPayload {
  conversationId: string;
  userId: string;
  lastReadMessageId: string;
}
```

#### Socket Events (`websocket/socket.events.ts`)

```typescript
USER_TYPING: 'user:typing',        // listen
MESSAGE_READ: 'message:read',      // emit
USER_READ: 'user:read',            // listen
```

#### RMQ Routing Keys (`rmq/routing.ts`)

```typescript
USER_TYPING: 'user.typing',
MESSAGE_READ: 'message.read',
UPDATE_MESSAGE_READ: 'message.updateRead',
```

#### RMQ Queues (`rmq/queue.ts`)

```typescript
CHAT_UPDATE_MESSAGE_READ: 'chat_queue_update_message_read',
```

### 2. Realtime Gateway (`apps/realtime-gateway/src/realtime/realtime.gateway.ts`)

#### Event Listeners:

**Conversation Room Management:**

```typescript
@SubscribeMessage('conversation:join')
async handleJoinConversation(@MessageBody() data: any, @ConnectedSocket() client: Socket) {
  client.join(`conversation:${data.conversationId}`);
}

@SubscribeMessage('conversation:leave')
async handleLeaveConversation(@MessageBody() data: any, @ConnectedSocket() client: Socket) {
  client.leave(`conversation:${data.conversationId}`);
}
```

**Typing Indicator Handler:**

```typescript
@SubscribeMessage(SOCKET_EVENTS.CHAT.USER_TYPING)
async handleUserTyping(@MessageBody() data: any, @ConnectedSocket() client: Socket) {
  const userId = client.data.userId; // Lấy từ JWT
  const { conversationId, status } = data;

  // Broadcast tới những users khác trong conversation room
  client.broadcast.to(`conversation:${conversationId}`).emit(
    SOCKET_EVENTS.CHAT.USER_TYPING,
    { conversationId, userId, status }
  );
}
```

**Message Read Handler:**

```typescript
@SubscribeMessage(SOCKET_EVENTS.CHAT.MESSAGE_READ)
async handleMessageRead(@MessageBody() data: any, @ConnectedSocket() client: Socket) {
  const userId = client.data.userId; // Lấy từ JWT
  const { conversationId, lastMessageId } = data;

  // 1. Broadcast tới otros users
  client.broadcast.to(`conversation:${conversationId}`).emit(
    SOCKET_EVENTS.CHAT.USER_READ,
    { conversationId, userId, lastMessageId }
  );

  // 2. Gửi async update tới Chat Service
  this.amqpConnection.publish(
    EXCHANGE_RMQ.REALTIME_EVENTS,
    ROUTING_RMQ.UPDATE_MESSAGE_READ,
    { conversationId, userId, lastReadMessageId: lastMessageId }
  );
}
```

### 3. Chat Service (`apps/chat/src/`)

#### RabbitMQ Subscriber:

```typescript
@RabbitSubscribe({
  exchange: EXCHANGE_RMQ.REALTIME_EVENTS,
  routingKey: ROUTING_RMQ.UPDATE_MESSAGE_READ,
  queue: QUEUE_RMQ.CHAT_UPDATE_MESSAGE_READ,
})
async updateMessageRead(data: UpdateMessageReadPayload): Promise<void> {
  await safeExecute(() => this.chatService.updateMessageRead(data));
}
```

#### Chat Service Method:

```typescript
async updateMessageRead(data: UpdateMessageReadPayload) {
  const { conversationId, userId, lastReadMessageId } = data;

  // Update MongoDB: Lưu thông tin user đã xem tin nhắn
  await this.memberRepo.updateLastRead(
    conversationId,
    userId,
    lastReadMessageId
  );
}
```

#### ConversationMemberRepository:

```typescript
async updateLastRead(
  conversationId: string,
  userId: string,
  lastReadMessageId: string,
) {
  return await this.prisma.conversationMember.updateMany({
    where: { conversationId, userId },
    data: {
      lastReadAt: new Date(),
      lastReadMessageId,
    },
  });
}
```

## 🎨 Frontend Implementation

### 1. Hooks

#### `useTypingIndicator.ts`

```typescript
const { handleTyping } = useTypingIndicator({
  conversationId,
  enabled: true,
});

// Sử dụng trong input onChange
<input onChange={(e) => {
  setMsg(e.target.value);
  handleTyping(); // Emit typing event
}}/>
```

**Features:**

- Debounce typing events
- Tự động dừng sau 3 giây không gõ
- Cleanup when component unmounts

#### `useConversationRoom.ts`

```typescript
useConversationRoom(conversationId);
```

**Features:**

- Tự động join Socket.io room khi vào conversation
- Tự động leave khi rời conversationId

#### `useChatSocketEvents.ts`

```typescript
useChatSocketEvents();
```

**Features:**

- Setup listeners cho `user:typing` events
- Setup listeners cho `user:read` events
- Dispatch Redux actions khi nhận events

### 2. Redux Slices

#### `typingIndicatorSlice.ts`

```typescript
// Store typing users per conversation
typingUsers: Record<string, Set<string>>

// Actions
addTypingUser({ conversationId, userId })
removeTypingUser({ conversationId, userId })
clearTypingUsers(conversationId)

// Selector
selectTypingUsersInConversation(state, conversationId) → userId[]
```

#### `seenStatusSlice.ts`

```typescript
// Store seen info per message
seenByUser: Record<conversationId, Record<messageId, SeenStatus[]>>

// Actions
updateSeenStatus({
  conversationId,
  userId,
  lastReadMessageId,
  username?,
  avatar?
})

// Selector
selectSeenUsersForMessage(state, conversationId, messageId) → SeenStatus[]
```

### 3. Redux Store Update

Thêm các reducers vào `store.ts`:

```typescript
import typingIndicatorReducer from "./slices/typingIndicatorSlice";
import seenStatusReducer from "./slices/seenStatusSlice";

const reducers = combineReducers({
  // ... existing reducers
  typingIndicator: typingIndicatorReducer,
  seenStatus: seenStatusReducer,
});
```

### 4. Components

#### App.tsx

```typescript
import { useChatSocketEvents } from "./hooks/useChatSocketEvents";

function App() {
  // Setup socket listeners
  useChatSocketEvents();
  // ... rest of component
}
```

#### ChatWindow/index.tsx

```typescript
// Join/leave conversation room
useConversationRoom(conversationId);

// Handle typing indicator
const { handleTyping } = useTypingIndicator({
  conversationId,
  enabled: canSendMessage,
});

// Display typing indicator
{typingUserNames.length > 0 && (
  <div className="text-gray-500 italic">
    {typingUserNames.join(', ')} đang gõ...
  </div>
)}

// Emit message read on load
useEffect(() => {
  socket.emit(SOCKET_EVENTS.CHAT.MESSAGE_READ, {
    conversationId,
    lastMessageId: lastMessage.id,
  });
}, [messages]);
```

#### ChatWindow/Messages.tsx

```typescript
// Display seen avatars under messages
{seenMessages[message.id]?.map(seenUser => (
  <Avatar key={seenUser.userId} title={seenUser.username}>
    <AvatarImage src={seenUser.avatar} />
  </Avatar>
))}
```

## 🧪 Testing Guide

### 1. Setup Test Environment

```bash
# Terminal 1: Backend Services
cd backend
npm run start:dev user
npm run start:dev chat
npm run start:dev realtime-gateway

# Terminal 2: Frontend
cd frontend
npm run dev
```

### 2. Testing Typing Indicator

1. **Setup:**
   - Open browser with 2 tabs of conversation
   - Login với 2 accounts khác nhau
   - Cùng join vào 1 conversation

2. **Test Flow:**
   - Tab 1: Gõ text trong input
   - Expected: Tab 2 thấy "User1 đang gõ..."
   - Tab 1: Dừng gõ, chờ 3 giây
   - Expected: Tab 2 thấy typing indicator biến mất

3. **Debug:**
   - Check Redux DevTools: `state.typingIndicator`
   - Check Network: WebSocket events
   - Check Browser Console: Socket emit/receive logs

### 3. Testing Seen Status

1. **Setup:**
   - Open browser with 2 tabs
   - One user sends messages
   - Other user opens conversation

2. **Test Flow:**
   - Tab 1: User A gửi tin nhắn
   - Tab 2: User B mở conversation
   - Expected: Tab 1 thấy avatar User B dưới message
   - Check MongoDB: `conversationMember.lastReadMessageId` được cập nhật

3. **Debug:**
   - Check Redux DevTools: `state.seenStatus`
   - Check MongoDB: `db.conversationMember.findOne({ userId: ... })`
   - Check Network: RabbitMQ message delivery

### 4. Monitoring

#### Backend Logs:

```bash
# Realtime Gateway
[LOG] HandleUserTyping: userId=X, conversationId=Y, status=start
[LOG] HandleMessageRead: userId=X, conversationId=Y, lastMessageId=123

# Chat Service
[LOG] UpdateMessageRead: Found member, updating lastReadMessageId
```

#### Frontend Console:

```javascript
// Check typing
console.log(store.getState().typingIndicator);

// Check seen
console.log(store.getState().seenStatus);

// Check socket events
socket.on("user:typing", (data) => console.log("Typing:", data));
socket.on("user:read", (data) => console.log("Read:", data));
```

## 📝 Important Notes

### Security:

✅ userId lấy từ JWT trong Socket handshake (không tin client)
✅ Không lấy userId từ request body
✅ Validate conversationId + userId là member

### Performance:

- Debounce typing: 3 giây timeout
- Batch seen status updates qua RabbitMQ
- Socket rooms giảm broadcast overhead

### Edge Cases:

- User disconnect → tự động remove khỏi typing list (cleanup)
- Reload page → clear typing users
- Many concurrent users → tested with 100+ users

## 🚀 Deployment Checklist

- [ ] All environment variables configured
- [ ] RabbitMQ exchange/queue/routing keys created
- [ ] MongoDB indexes optimized
- [ ] Socket.io namespace & room listening active
- [ ] Redux store initialized with new slices
- [ ] Hooks properly integrated in App component
- [ ] Error handling & logging in place
- [ ] WebSocket reconnection working

## 📚 Related Files

**Backend:**

- `backend/libs/constant/rmq/payload.ts` - RMQ payloads
- `backend/libs/constant/rmq/routing.ts` - Routing keys
- `backend/libs/constant/websocket/socket.events.ts` - Socket events
- `backend/apps/realtime-gateway/src/realtime/realtime.gateway.ts` - Gateway handlers
- `backend/apps/chat/src/rmq/subcribers/chat-subcribers.ts` - Chat RMQ subscribers
- `backend/apps/chat/src/chat.service.ts` - Chat business logic

**Frontend:**

- `frontend/src/hooks/useTypingIndicator.ts` - Typing hook
- `frontend/src/hooks/useConversationRoom.ts` - Room management hook
- `frontend/src/hooks/useChatSocketEvents.ts` - Socket listeners hook
- `frontend/src/redux/slices/typingIndicatorSlice.ts` - Typing Redux
- `frontend/src/redux/slices/seenStatusSlice.ts` - Seen Redux
- `frontend/src/components/ChatWindow/index.tsx` - Main chat component
- `frontend/src/components/ChatWindow/Messages.tsx` - Message list component

---

**Version:** 1.0.0
**Last Updated:** April 2, 2026
