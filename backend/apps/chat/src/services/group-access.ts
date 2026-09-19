import { ChatErrors } from '../errors/chat.errors'
import { conversationType } from '../generated'
import type {
  ConversationMemberRepository,
  ConversationRepository,
  MemberRow,
} from '../repositories'

export const isGroupManager = (member: Pick<MemberRow, 'role'>) =>
  member.role === 'ADMIN' || member.role === 'OWNER'

/**
 * A group, its active members and the caller's own row, provided the caller
 * runs it (admin or owner). A direct conversation, or a group the caller does
 * not manage, is refused the same way.
 */
export async function requireGroupManager(
  conversationRepo: ConversationRepository,
  memberRepo: ConversationMemberRepository,
  conversationId: string,
  userId: string,
) {
  const conversation = await conversationRepo.findById(conversationId)
  if (!conversation) {
    ChatErrors.conversationNotFound()
  }
  if (conversation.type === conversationType.DIRECT) {
    ChatErrors.userNoPermission()
  }

  const members = await memberRepo.findByConversationId(conversationId)
  const actor = members.find(
    (member) => member.userId === userId && isGroupManager(member),
  )
  if (!actor) {
    ChatErrors.userNoPermission()
  }

  return { conversation, members, actor }
}
