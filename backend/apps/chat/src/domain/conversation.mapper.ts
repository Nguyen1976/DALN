import { displayNameOf } from '@app/util'

type Person = {
  userId: string
  username?: string | null
  fullName?: string | null
  avatar?: string | null
}

/**
 * A conversation as one viewer sees it. It comes in two shapes:
 *
 * - a row of the viewer's list: their membership flattened onto the
 *   conversation, the direct peer included (`peer*`), no `members`;
 * - a conversation with its active `members` (detail, events), where the
 *   viewer's own row and the peer are found among them.
 *
 * Everything else is stored ready to show (migrations/chat/0005 filled in
 * the rows that predate it).
 */
export class ConversationMapper {
  static toSummary(conversation: any, viewerId: string) {
    const members: any[] | undefined = conversation.members
    const mine = members?.find((m) => m.userId === viewerId) ?? conversation
    const isDirect = conversation.type === 'DIRECT'
    const peer: Person | null = !isDirect
      ? null
      : members
        ? (members.find((m) => m.userId !== viewerId) ?? null)
        : conversation.peerUserId
          ? {
              userId: conversation.peerUserId,
              username: conversation.peerUsername,
              fullName: conversation.peerFullName,
              avatar: conversation.peerAvatar,
            }
          : null

    return {
      id: conversation.id,
      type: conversation.type,
      groupName: conversation.groupName ?? null,
      groupAvatar: conversation.groupAvatar ?? null,
      displayName: isDirect
        ? (peer && displayNameOf(peer)) || 'Trò chuyện trực tiếp'
        : conversation.groupName || 'Nhóm chat',
      displayAvatar: (isDirect ? peer?.avatar : conversation.groupAvatar) || '',
      memberCount: conversation.memberCount,
      peerUserId: peer?.userId ?? null,
      unreadCount: Math.max(0, mine.unreadCount ?? 0),
      unreadMentionCount: mine.unreadMentionCount ?? 0,
      lastMentionMessageId: mine.lastMentionMessageId ?? null,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      // Only when they were loaded: a list row has none, and an empty array
      // would read as "nobody is in it".
      ...(members
        ? {
            members: members.map((member) => ({
              userId: member.userId,
              role: member.role,
              username: member.username,
              avatar: member.avatar,
              fullName: member.fullName,
              lastReadAt: member.lastReadAt ?? null,
              lastReadMessageId: member.lastReadMessageId ?? null,
              lastMessageAt: member.lastMessageAt ?? null,
            })),
          }
        : {}),
      // Whoever reads a conversation this way is an active member of it;
      // the events for someone removed or leaving say otherwise (toDetail).
      membershipStatus: 'ACTIVE' as const,
      canSendMessage: true,
      lastMessageId: conversation.lastMessageId ?? null,
      lastMessageAt: conversation.lastMessageAt ?? null,
      lastMessageText: conversation.lastMessageText ?? '',
      lastMessageSenderId: conversation.lastMessageSenderId ?? null,
      lastMessageSenderName: conversation.lastMessageSenderName ?? null,
      lastMessageSenderAvatar: conversation.lastMessageSenderAvatar ?? null,
    }
  }

  static toDetail(
    conversation: any,
    viewerId: string,
    options?: {
      membershipStatus?: 'ACTIVE' | 'REMOVED' | 'LEFT'
      canSendMessage?: boolean
    },
  ) {
    return {
      ...this.toSummary(conversation, viewerId),
      membershipStatus: options?.membershipStatus ?? 'ACTIVE',
      canSendMessage: options?.canSendMessage ?? true,
    }
  }
}
