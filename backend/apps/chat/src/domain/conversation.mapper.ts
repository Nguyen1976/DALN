import { Logger } from '@nestjs/common'
import { MessageMapper } from './message.mapper'

export class ConversationMapper {
  private static readonly logger = new Logger(ConversationMapper.name)

  static resolveUnreadCount(conversation: any, userId?: string): string {
    if (
      conversation?.unreadCount !== undefined &&
      conversation?.unreadCount !== null
    ) {
      const unread = Number(conversation.unreadCount)
      if (!Number.isFinite(unread) || unread <= 0) return '0'
      return unread > 5 ? '5+' : String(unread)
    }

    if (userId && Array.isArray(conversation?.members)) {
      const me = conversation.members.find((m: any) => m.userId === userId)
      const unread = Number(me?.unreadCount || 0)
      if (!Number.isFinite(unread) || unread <= 0) return '0'
      return unread > 5 ? '5+' : String(unread)
    }

    return '0'
  }

  static resolveDisplay(conversation: any, userId?: string) {
    if (conversation?.type !== 'DIRECT') {
      return {
        displayName: conversation?.groupName || 'Nhóm chat',
        displayAvatar: conversation?.groupAvatar || '',
      }
    }

    // Ưu tiên trường phi chuẩn hoá trên dòng membership: danh sách hội thoại
    // không còn kéo `members` nữa (include đó đắt tuyến tính theo số thành
    // viên). `members` chỉ còn là đường dự phòng cho các payload vẫn mang nó
    // — chi tiết hội thoại, sự kiện realtime.
    const peer = (conversation?.members || []).find(
      (member: any) => member.userId !== userId,
    )

    const displayName =
      conversation?.peerUsername ||
      conversation?.peerFullName ||
      peer?.username ||
      peer?.fullName ||
      conversation?.groupName ||
      null

    if (!displayName) {
      // Không rơi im lặng về chuỗi mặc định nữa. Trước đây payload realtime
      // thiếu `members` khiến hội thoại vừa tạo hiện "Trò chuyện trực tiếp"
      // và bug sống sót rất lâu vì chẳng ai kêu.
      ConversationMapper.warnMissingPeer(conversation, userId)
    }

    return {
      displayName: displayName || 'Trò chuyện trực tiếp',
      displayAvatar:
        conversation?.peerAvatar ||
        peer?.avatar ||
        conversation?.groupAvatar ||
        '',
    }
  }

  /** Cảnh báo có tiết chế — DIRECT mà không xác định được đối phương là lỗi dữ liệu. */
  private static warnedConversations = new Set<string>()
  private static warnMissingPeer(conversation: any, userId?: string) {
    const id = String(conversation?.id ?? 'unknown')
    if (ConversationMapper.warnedConversations.has(id)) return
    ConversationMapper.warnedConversations.add(id)
    if (ConversationMapper.warnedConversations.size > 500) {
      ConversationMapper.warnedConversations.clear()
    }
    ConversationMapper.logger.warn(
      `DIRECT ${id}: không xác định được đối phương cho viewer ${userId ?? '?'} ` +
        `(peerUsername=${conversation?.peerUsername ?? 'null'}, ` +
        `members=${conversation?.members?.length ?? 0}) -> hiển thị tên mặc định`,
    )
  }

  private static toIso(value: any): string | null {
    if (!value) return null
    if (value instanceof Date) return value.toISOString()
    return String(value)
  }

  private static mapMember(member: any) {
    return {
      userId: member.userId,
      role: member.role,
      username: member.username,
      avatar: member.avatar,
      fullName: member.fullName,
      lastReadAt: this.toIso(member.lastReadAt),
      lastReadMessageId: member.lastReadMessageId
        ? String(member.lastReadMessageId)
        : null,
      lastMessageAt: this.toIso(member.lastMessageAt),
    }
  }

  private static resolveLastMessageFields(conversation: any) {
    const latestMessage = conversation?.messages?.[0]
    const lastMessageId =
      conversation?.lastMessageId ||
      latestMessage?.id ||
      null

    const lastMessageAt = this.toIso(
      conversation?.lastMessageAt || latestMessage?.createdAt,
    )

    const lastMessageText =
      conversation?.lastMessageText !== undefined &&
      conversation?.lastMessageText !== null
        ? String(conversation.lastMessageText)
        : latestMessage
          ? MessageMapper.previewText(latestMessage)
          : ''

    const sender = latestMessage?.senderMember
    const lastMessageSenderId =
      conversation?.lastMessageSenderId ||
      latestMessage?.senderId ||
      null
    const lastMessageSenderName =
      conversation?.lastMessageSenderName ||
      sender?.fullName ||
      sender?.username ||
      null
    const lastMessageSenderAvatar =
      conversation?.lastMessageSenderAvatar ?? sender?.avatar ?? null

    return {
      lastMessageId,
      lastMessageAt,
      lastMessageText,
      lastMessageSenderId,
      lastMessageSenderName,
      lastMessageSenderAvatar,
    }
  }

  static toSummary(conversation: any, userId?: string) {
    const display = this.resolveDisplay(conversation, userId)
    const lastMessage = this.resolveLastMessageFields(conversation)

    return {
      id: conversation.id,
      type: conversation.type,
      groupName: conversation.groupName ?? null,
      groupAvatar: conversation.groupAvatar ?? null,
      displayName: display.displayName,
      displayAvatar: display.displayAvatar,
      memberCount: conversation.memberCount ?? conversation.members?.length ?? 0,
      // Danh sách hội thoại không còn kèm `members`, nên client lấy id đối
      // phương từ đây (dùng cho chấm trạng thái online ở sidebar).
      peerUserId:
        conversation.peerUserId ??
        (conversation.type === 'DIRECT'
          ? ((conversation.members || []).find(
              (m: any) => m.userId !== userId,
            )?.userId ?? null)
          : null),
      unreadCount: this.resolveUnreadCount(conversation, userId),
      createdAt: this.toIso(conversation.createdAt)!,
      updatedAt: this.toIso(conversation.updatedAt)!,
      members: (conversation.members || []).map((member: any) =>
        this.mapMember(member),
      ),
      // The list only ever returns conversations the caller is an active
      // member of, so these are known here. Leaving them out meant the client
      // saw `membershipStatus: undefined` for every conversation opened from
      // the sidebar — which kept the "Rời nhóm" button permanently disabled,
      // because the detail endpoint that would have filled them in is only
      // fetched when the members are missing.
      membershipStatus: 'ACTIVE' as const,
      canSendMessage: true,
      ...lastMessage,
    }
  }

  static toDetail(
    conversation: any,
    userId?: string,
    options?: {
      membershipStatus?: 'ACTIVE' | 'REMOVED' | 'LEFT'
      canSendMessage?: boolean
    },
  ) {
    const summary = this.toSummary(conversation, userId)
    const latestMessage = conversation?.messages?.[0]

    return {
      ...summary,
      lastMessage: latestMessage
        ? MessageMapper.toResponse(latestMessage)
        : null,
      membershipStatus: options?.membershipStatus ?? 'ACTIVE',
      canSendMessage: options?.canSendMessage ?? true,
    }
  }

  static toCreateResponse(conversation: any, userId: string) {
    return {
      conversation: this.toDetail(conversation, userId, {
        membershipStatus: 'ACTIVE',
        canSendMessage: true,
      }),
    }
  }
}
