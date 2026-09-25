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

/**
 * Token đi ở dạng THÔ trong payload; chỉ bản băm nằm lại trong Redis.
 *
 * URL do notification-service ghép chứ không phải user-service: `FRONTEND_URL`
 * chỉ được đọc trong `MailerService`, và user-service không import
 * `MailerModule`. Đây cũng đúng khuôn mẫu sẵn có — `sendRegistrationOtp` nhận
 * `email` rồi tự ghép `verifyUrl`.
 */
export interface UserPasswordResetPayload {
  email: string
  username: string
  token: string
  expiresInMinutes: number
}

/**
 * Mã xác nhận đổi mật khẩu.
 *
 * Cùng hình dạng với `UserRegisterOtpPayload` nhưng là một sự kiện riêng: hai
 * lá thư nói hai việc khác nhau, và gộp chúng lại nghĩa là thư đổi mật khẩu
 * sẽ mời người dùng bấm nút "kích hoạt tài khoản".
 */
export interface UserChangePasswordOtpPayload {
  email: string
  username: string
  otp: string
}

export interface UserPasswordChangedPayload {
  email: string
  username: string
  /** ISO 8601 */
  changedAt: string
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
  data: unknown
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

/**
 * Phiên đăng nhập vừa bị thu hồi.
 *
 * Guard chỉ chặn được HTTP; socket đã bắt tay xong thì sống tới khi có ai đó
 * ngắt nó. Event này là kênh duy nhất để việc thu hồi có hiệu lực với realtime.
 */
export interface SessionRevokedPayload {
  userId: string
  /**
   * Các phiên bị thu hồi. Gateway chỉ ngắt socket thuộc những sid này, nên
   * đăng xuất một thiết bị không đá luôn các thiết bị khác của cùng người.
   */
  sids: string[]
  reason: 'logout' | 'logout-all' | 'password-changed' | 'token-reuse'
  /** Thời điểm thu hồi, ISO. */
  revokedAt?: string
  /**
   * Người nhận cảnh báo — chỉ đi kèm khi lý do là `token-reuse`.
   *
   * Gửi sẵn thay vì để notification tự tra: đây là đường cảnh báo bảo mật, nó
   * không nên phụ thuộc vào một lời gọi HTTP nội bộ có thể đang lỗi.
   */
  recipient?: { email: string; username: string }
}
