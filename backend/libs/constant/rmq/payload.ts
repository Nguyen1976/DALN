export interface UserCreatedPayload {
  id: string
  email: string
  username: string
}

export interface UserMakeFriendPayload {
  inviterId: string
  inviterName: string

  inviteeEmail: string
  inviteeName: string
  inviteeId: string
  friendRequestId: string
}

export interface UserUpdateStatusMakeFriendPayload {
  inviterId: string //ngươi nhận thông báo
  inviteeId: string
  inviteeName: string
  status: string
  members: {
    userId: string
    username: string
    avatar: string
    fullName: string
  }[]
}

export interface SendMessagePayload {
  conversationId: string
  senderId: string
  message: string
  replyToMessageId?: string
  tempMessageId: string
}

export interface UserUpdatedPayload {
  userId: string
  avatar?: string
  fullName?: string
}

export interface EmitToUserPayload {
  userIds: string[]
  event: string
  data: any
}

export interface MessageSendPayload {
  conversationId: string
  senderId: string
  text?: string
  type?: 'TEXT' | 'IMAGE' | 'VIDEO' | 'FILE'
  clientMessageId?: string
  medias?: MessageMediaInput[]
  replyToMessageId?: string
  tempMessageId: string
}

export interface MessageMediaInput {
  mediaType: 'IMAGE' | 'VIDEO' | 'FILE'
  objectKey: string
  url: string
  mimeType: string
  size: string
  width?: number
  height?: number
  duration?: number
  thumbnailUrl?: string
  sortOrder?: number
}

export interface MessageAckPayload {
  status: 'SUCCESS'
  clientMessageId: string
  serverMessageId: string
  conversationId: string
  duplicated: boolean
  createdAt: string
  message: any
}

export interface MessageErrorPayload {
  clientMessageId?: string
  code: string
  message: string
  retryable: boolean
}

export interface UserTypingPayload {
  conversationId: string
  userId: string
  status: 'start' | 'stop'
}

export interface UserReadPayload {
  conversationId: string
  userId: string
  lastReadMessageId: string
}

export interface UpdateMessageReadPayload {
  conversationId: string
  userId: string
  lastReadMessageId: string
}
