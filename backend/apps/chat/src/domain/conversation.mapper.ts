import { displayNameOf } from './display-name'
import type { conversation, conversationMember } from '../generated'

type Person = Pick<conversationMember, 'userId'> &
  Partial<Pick<conversationMember, 'username' | 'fullName' | 'avatar'>>

/** The viewer's own counters, off their membership row. */
type ViewerState = Pick<
  conversationMember,
  | 'unreadCount'
  | 'unreadMentionCount'
  | 'lastMentionMessageId'
  | 'lastReadSeq'
  | 'latestSeq'
>

/** What a member row brings to a conversation's detail. */
export type MemberView = ViewerState &
  Pick<
    conversationMember,
    | 'userId'
    | 'role'
    | 'username'
    | 'fullName'
    | 'avatar'
    | 'lastReadAt'
    | 'lastReadMessageId'
    | 'lastMessageAt'
  >

/** A row of the viewer's list: their membership flattened onto it. */
export type ConversationListRow = conversation &
  ViewerState &
  Pick<
    conversationMember,
    'peerUserId' | 'peerUsername' | 'peerFullName' | 'peerAvatar'
  >

/** A conversation with its active members (detail, events). */
export type ConversationWithMembers = conversation & { members: MemberView[] }

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
  static toSummary(
    conversation: ConversationListRow | ConversationWithMembers,
    viewerId: string,
  ) {
    const members = 'members' in conversation ? conversation.members : null
    // Someone just removed, or leaving, is no longer among the members.
    const mine: Partial<ViewerState> =
      'members' in conversation
        ? (conversation.members.find((m) => m.userId === viewerId) ?? {})
        : conversation
    const isDirect = conversation.type === 'DIRECT'
    const peer = isDirect ? peerOf(conversation, viewerId) : null

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
      // Tính, không cộng dồn: tin mới nhất đã lan tới dòng này trừ mốc đọc.
      unreadCount: unreadOf(mine),
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
              lastReadSeq: member.lastReadSeq ?? 0,
              lastMessageAt: member.lastMessageAt ?? null,
            })),
          }
        : {}),
      // Whoever reads a conversation this way is an active member of it;
      // the events for someone removed or leaving say otherwise (toDetail).
      membershipStatus: 'ACTIVE' as const,
      canSendMessage: true,
      lastMessageId: conversation.lastMessageId ?? null,
      // The conversation's own field, not a member's `latestSeq`: the list
      // only moves its "last message" forward by it.
      lastMessageSeq: conversation.lastMessageSeq ?? null,
      lastMessageAt: conversation.lastMessageAt ?? null,
      lastMessageText: conversation.lastMessageText ?? '',
      lastMessageSenderId: conversation.lastMessageSenderId ?? null,
      lastMessageSenderName: conversation.lastMessageSenderName ?? null,
      lastMessageSenderAvatar: conversation.lastMessageSenderAvatar ?? null,
    }
  }

  static toDetail(
    conversation: ConversationListRow | ConversationWithMembers,
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

/**
 * Unread messages for a viewer: the newest seq that has reached their row
 * minus how far they have read. Holes in the sequence (a deduplicated resend)
 * count once each — accepted, see docs/design/message-seq-design.md.
 */
function unreadOf(mine: Partial<ViewerState>): number {
  return Math.max(0, (mine.latestSeq ?? 0) - (mine.lastReadSeq ?? 0))
}

/** The other side of a direct conversation, from whichever shape it came. */
function peerOf(
  conversation: ConversationListRow | ConversationWithMembers,
  viewerId: string,
): Person | null {
  if ('members' in conversation) {
    return conversation.members.find((m) => m.userId !== viewerId) ?? null
  }
  if (!conversation.peerUserId) return null
  return {
    userId: conversation.peerUserId,
    username: conversation.peerUsername,
    fullName: conversation.peerFullName,
    avatar: conversation.peerAvatar,
  }
}
