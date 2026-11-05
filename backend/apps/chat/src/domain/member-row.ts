import type { MemberProfile } from 'libs/constant/member-profile'
import { buildPeerFields } from './peer-fields'

export type MemberRole = 'OWNER' | 'ADMIN' | 'MEMBER'

/**
 * A new conversationMember row — the single way every path creates one
 * (creating a group, adding people to it, the friendship saga's direct chat):
 * the profile snapshot, read marks at the conversation's `seq` and, for a
 * DIRECT chat, the other person's fields. Three hand-written copies used to
 * drift apart.
 */
export function buildMemberRow(
  conversationId: string,
  profile: MemberProfile,
  {
    type,
    role = 'MEMBER',
    members,
    seq = 0,
  }: {
    type: 'DIRECT' | 'GROUP'
    role?: MemberRole
    /** Everyone in the conversation, for the DIRECT peer fields. */
    members: MemberProfile[]
    /**
     * The conversation's `lastSeq` when this person joins: they start having
     * read everything before it, so a newcomer's badge is 0, not the history.
     */
    seq?: number
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
    lastReadSeq: seq,
    latestSeq: seq,
    lastMessageAt: new Date(),
    ...buildPeerFields(type, profile.userId, members),
  }
}
