import type { MemberProfile } from 'libs/constant/member-profile'
import { buildPeerFields } from './peer-fields'

export type MemberRole = 'OWNER' | 'ADMIN' | 'MEMBER'

/**
 * A new conversationMember row — the single way every path creates one
 * (creating a group, adding people to it, the friendship saga's direct chat):
 * the profile snapshot, zeroed counters and, for a DIRECT chat, the other
 * person's fields. Three hand-written copies used to drift apart; one of them
 * left `lastReadMessageId` unset instead of null.
 */
export function buildMemberRow(
  conversationId: string,
  profile: MemberProfile,
  {
    type,
    role = 'MEMBER',
    members,
  }: {
    type: 'DIRECT' | 'GROUP'
    role?: MemberRole
    /** Everyone in the conversation, for the DIRECT peer fields. */
    members: MemberProfile[]
  },
) {
  return {
    conversationId,
    userId: profile.userId,
    username: profile.username || null,
    fullName: profile.fullName || null,
    avatar: profile.avatar || null,
    role,
    isActive: true,
    unreadCount: 0,
    lastReadMessageId: null,
    lastMessageAt: new Date(),
    ...buildPeerFields(type, profile.userId, members),
  }
}
