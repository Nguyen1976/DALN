import type { DefaultEventsMap, Socket } from 'socket.io'
import type { MessageSendPayload } from 'libs/constant/rmq/payload'

/** What a socket carries; `userId` is set once the handshake cookie checks out. */
export interface ClientData {
  userId?: string
  /**
   * Phiên mà socket này bắt tay bằng. Nhờ nó, "đăng xuất thiết bị này" ngắt
   * đúng socket của thiết bị đó chứ không đá luôn các thiết bị khác của cùng
   * người dùng.
   */
  sid?: string
}

export type ClientSocket = Socket<
  DefaultEventsMap,
  DefaultEventsMap,
  DefaultEventsMap,
  ClientData
>

// What clients send. None of it is trusted: every field is optional, and a
// handler checks each one it uses before relying on it.

export interface ConversationBody {
  conversationId?: string
}

export type CreateMessageBody = Partial<Omit<MessageSendPayload, 'senderId'>>

export interface TypingBody {
  conversationId?: string
  status?: string
}

export interface MessageReadBody {
  conversationId?: string
  lastMessageId?: string
}

/** Any `call.*` or `group_call.*` event; each reads the fields it needs. */
export interface CallBody {
  callId?: unknown
  conversationId?: unknown
  callType?: unknown
  offer?: unknown
  answer?: unknown
  candidate?: unknown
  reason?: unknown
  cameraEnabled?: unknown
  micEnabled?: unknown
}
