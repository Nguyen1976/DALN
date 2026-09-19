import type { GeoPoint } from '@app/util'
export interface UserCreatedPayload {
  userId: string
  email: string
  username: string
  /** Optional profile fields so recommendation can hydrate snapshot + Qdrant on signup */
  fullName?: string
  avatar?: string
  bio?: string
  /** GeoJSON Point, exactly as the user service stores it. */
  location?: GeoPoint
}

/** Same pair as the accepted request that created the friendship. */
export interface UserFriendshipRevertedPayload {
  inviterId: string
  inviteeId: string
}

export interface UserRegisterOtpPayload {
  email: string
  username: string
  otp: string
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
}

export interface UserUpdatedPayload {
  userId: string
  avatar?: string
  fullName?: string
  bio?: string
}

export interface UserInterestsUpdatedPayload {
  userId: string
  interests: string[]
}

export interface UserJoinGroupPayload {
  userId: string
  conversationId: string
  groupName?: string
  createdAt: string
}

export interface UserLeftGroupPayload {
  userId: string
  conversationId: string
  leftAt: string
}

export interface EmitToUserPayload {
  userIds: string[]
  event: string
  data: any
}

/**
 * A message the client sent over the socket. Who is mentioned is worked out
 * from `content` by the chat service, never taken from the client.
 */
export interface MessageSendPayload {
  conversationId: string
  senderId: string
  content?: string | null
  type?: 'TEXT' | 'IMAGE' | 'VIDEO' | 'FILE'
  /** The client's id for its optimistic copy; comes back on the ack. */
  clientMessageId: string
  medias?: MessageMediaInput[]
  replyToMessageId?: string
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
  fileName?: string
  sortOrder?: number
}

export interface MessageRevokedPayload {
  conversationId: string
  messageId: string
  /** The revoked message, already mapped for clients. */
  message: unknown
}

/** A poll changed (a vote, or closing): the same shape either way. */
export interface PollEventPayload {
  conversationId: string
  messageId: string
  poll: {
    id: string
    question: string
    isMultipleChoice: boolean
    isClosed: boolean
    closedAt: string | null
    options: Array<{ id: string; text: string; count: number }>
    totalVoters: number
  }
}

export interface UpdateMessageReadPayload {
  conversationId: string
  userId: string
  lastReadMessageId: string
}

/** Kết cục của một cuộc gọi thoại, để ghi lại trong dòng trò chuyện. */
export interface CallEndedPayload {
  conversationId: string
  callerId: string
  calleeId: string
  /** Ai là người kết thúc/từ chối; bỏ trống nếu do hết thời gian chờ. */
  actorId?: string
  outcome: 'COMPLETED' | 'REJECTED' | 'MISSED' | 'UNREACHABLE'
  /** Thời lượng tính bằng giây, chỉ có với cuộc gọi đã kết nối. */
  durationSeconds?: number
  /** Loại cuộc gọi; bỏ trống thì coi như 'audio'. */
  callType?: 'audio' | 'video'
}

/** Một tin nhắn vừa nhắc (@) tới một số thành viên. */
export interface ChatMentionPayload {
  conversationId: string
  messageId: string
  senderId: string
  senderName: string
  /** Những người bị nhắc (đã loại người gửi). */
  userIds: string[]
  /** Trích đoạn nội dung để hiện trong thông báo. */
  preview: string
}
