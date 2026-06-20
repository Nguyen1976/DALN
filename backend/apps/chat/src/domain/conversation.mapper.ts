import { MessageMapper } from './message.mapper'

export class ConversationMapper {
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

    const peer = (conversation?.members || []).find(
      (member: any) => member.userId !== userId,
    )

    return {
      displayName:
        peer?.username ||
        peer?.fullName ||
        conversation?.groupName ||
        'Trò chuyện trực tiếp',
      displayAvatar: peer?.avatar || conversation?.groupAvatar || '',
    }
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
      unreadCount: this.resolveUnreadCount(conversation, userId),
      createdAt: this.toIso(conversation.createdAt)!,
      updatedAt: this.toIso(conversation.updatedAt)!,
      members: (conversation.members || []).map((member: any) =>
        this.mapMember(member),
      ),
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
