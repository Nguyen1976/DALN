import { UserDirectoryClient } from '../clients/user-directory.client'
import { Injectable } from '@nestjs/common'
import { displayNameOf } from '@app/util'
import {
  ConversationRepository,
  ConversationMemberRepository,
} from '../repositories'
import { ChatErrors } from '../errors/chat.errors'
import { ChatEventsPublisher } from '../rmq/publishers/chat-events.publisher'
import { conversationType } from '../generated'
import { MessageService } from './message.service'
import { isGroupManager, requireGroupManager } from './group-access'

export interface AddMemberToConversationRequest {
  conversationId: string
  userId: string
  /** People to add; their names and avatars come from the user service. */
  memberIds: string[]
}

export interface RemoveMemberFromConversationRequest {
  conversationId: string
  userId: string
  targetUserId: string
}

export interface PromoteMemberRequest {
  conversationId: string
  userId: string
  targetUserId: string
}

export interface LeaveConversationRequest {
  conversationId: string
  userId: string
}

@Injectable()
export class ConversationMemberService {
  constructor(
    private readonly conversationRepo: ConversationRepository,
    private readonly memberRepo: ConversationMemberRepository,
    private readonly eventsPublisher: ChatEventsPublisher,
    private readonly messageService: MessageService,
    private readonly userDirectory: UserDirectoryClient,
  ) {}

  async addMemberToConversation(dto: AddMemberToConversationRequest) {
    const { conversation, members, actor } = await requireGroupManager(
      this.conversationRepo,
      this.memberRepo,
      dto.conversationId,
      dto.userId,
    )

    // Active members only: someone who left or was removed can be added back.
    const activeIds = new Set(members.map((m) => m.userId))
    const newMemberIds = [...new Set(dto.memberIds)].filter(
      (id) => !activeIds.has(id),
    )
    if (newMemberIds.length === 0) {
      return
    }

    // The member row keeps a copy of the profile, taken from its owner.
    const newMembers = await this.userDirectory.getProfiles(newMemberIds)
    if (newMembers.length !== newMemberIds.length) {
      ChatErrors.invalidMemberAction('Có người dùng không tồn tại')
    }

    const addedMemberCount = await this.memberRepo.addMembers(
      dto.conversationId,
      newMembers,
    )

    if (addedMemberCount > 0) {
      await this.conversationRepo.incrementMemberCount(
        dto.conversationId,
        addedMemberCount,
      )
    }

    await this.messageService.createSystemMessageAndSync(
      dto.conversationId,
      dto.userId,
      `${displayNameOf(actor)} đã thêm ${newMemberIds.length} thành viên vào nhóm`,
    )

    const res = await this.conversationRepo.findByIdWithMembers(conversation.id)
    this.eventsPublisher.publishMemberAddedToConversation({
      ...res,
      actorId: dto.userId,
      newMemberIds,
    })
    for (const m of newMembers) {
      this.eventsPublisher.publishUserJoinedGroup({
        userId: m.userId,
        conversationId: dto.conversationId,
        groupName: conversation.groupName ?? undefined,
        createdAt: new Date().toISOString(),
      })
    }
  }

  async removeMemberFromConversation(dto: RemoveMemberFromConversationRequest) {
    if (dto.userId === dto.targetUserId) {
      ChatErrors.invalidMemberAction(
        'Use leave-group API to leave conversation',
      )
    }

    const { members, actor } = await requireGroupManager(
      this.conversationRepo,
      this.memberRepo,
      dto.conversationId,
      dto.userId,
    )

    const target = members.find((member) => member.userId === dto.targetUserId)
    if (!target) {
      ChatErrors.memberNotFoundInConversation()
    }

    await this.messageService.createSystemMessageAndSync(
      dto.conversationId,
      dto.userId,
      `${displayNameOf(actor)} đã xóa ${displayNameOf(target)} khỏi nhóm`,
    )

    const removed = await this.memberRepo.removeMember(
      dto.conversationId,
      dto.targetUserId,
    )

    if (removed) {
      await this.conversationRepo.incrementMemberCount(dto.conversationId, -1)
    }

    const conversationAfterRemove =
      await this.conversationRepo.findByIdWithMembers(dto.conversationId)

    if (!conversationAfterRemove) {
      ChatErrors.conversationNotFound()
    }

    this.eventsPublisher.publishConversationMemberRemoved({
      conversation: conversationAfterRemove,
      actorId: dto.userId,
      targetUserId: dto.targetUserId,
      remainingMemberIds: members
        .filter((member) => member.userId !== dto.targetUserId)
        .map((member) => member.userId),
    })
    this.eventsPublisher.publishUserLeftGroup({
      userId: dto.targetUserId,
      conversationId: dto.conversationId,
      leftAt: new Date().toISOString(),
    })
  }

  async promoteMember(dto: PromoteMemberRequest) {
    const { members } = await requireGroupManager(
      this.conversationRepo,
      this.memberRepo,
      dto.conversationId,
      dto.userId,
    )

    const target = members.find((member) => member.userId === dto.targetUserId)
    if (!target) ChatErrors.memberNotFoundInConversation()
    if (target.userId === dto.userId) {
      ChatErrors.invalidMemberAction('Bạn đã là quản trị viên của nhóm')
    }
    if (isGroupManager(target)) {
      return
    }

    await this.memberRepo.promoteToAdmin(dto.conversationId, dto.targetUserId)
    await this.messageService.createSystemMessageAndSync(
      dto.conversationId,
      dto.userId,
      `${displayNameOf(target)} đã trở thành phó nhóm`,
    )

    const updated = await this.conversationRepo.findByIdWithMembers(
      dto.conversationId,
    )
    if (!updated) ChatErrors.conversationNotFound()

    this.eventsPublisher.publishConversationUpdated(updated)
  }

  async leaveConversation(dto: LeaveConversationRequest) {
    const conversation = await this.conversationRepo.findById(
      dto.conversationId,
    )

    if (!conversation) {
      ChatErrors.conversationNotFound()
    }

    if (conversation.type === conversationType.DIRECT) {
      ChatErrors.userNoPermission()
    }

    const existingMembers = await this.memberRepo.findByConversationId(
      dto.conversationId,
    )

    const actor = existingMembers.find((member) => member.userId === dto.userId)
    if (!actor) {
      return
    }

    const remaining = existingMembers.filter(
      (member) => member.userId !== dto.userId,
    )
    const isManager = isGroupManager(actor)

    // Nobody left to hand the group to: deleting it is the right action.
    if (isManager && remaining.length === 0) {
      ChatErrors.invalidMemberAction(
        'Bạn là thành viên cuối cùng. Hãy xoá nhóm thay vì rời nhóm.',
      )
    }

    // Management transfers on exit rather than blocking it. The old rule
    // ("admin không thể rời nhóm") left whoever created a group permanently
    // stuck inside it, with no way to hand it over.
    const managersLeft = remaining.some(isGroupManager)
    const successor = isManager && !managersLeft ? remaining[0] : null
    if (successor) {
      if (actor.role === 'OWNER') {
        await this.memberRepo.promoteToOwner(
          dto.conversationId,
          successor.userId,
        )
      } else {
        await this.memberRepo.promoteToAdmin(
          dto.conversationId,
          successor.userId,
        )
      }
    }

    await this.messageService.createSystemMessageAndSync(
      dto.conversationId,
      dto.userId,
      `${displayNameOf(actor)} đã rời khỏi nhóm`,
    )

    const removed = await this.memberRepo.removeMember(
      dto.conversationId,
      dto.userId,
    )

    if (removed) {
      await this.conversationRepo.incrementMemberCount(dto.conversationId, -1)
    }

    if (successor) {
      await this.messageService.createSystemMessageAndSync(
        dto.conversationId,
        dto.userId,
        `${displayNameOf(successor)} trở thành người quản lý nhóm`,
      )
    }

    const conversationAfterLeave =
      await this.conversationRepo.findByIdWithMembers(dto.conversationId)

    if (!conversationAfterLeave) {
      ChatErrors.conversationNotFound()
    }

    this.eventsPublisher.publishConversationMemberLeft({
      conversation: conversationAfterLeave,
      actorId: dto.userId,
      remainingMemberIds: remaining.map((member) => member.userId),
      promotedUserId: successor?.userId,
    })
    this.eventsPublisher.publishUserLeftGroup({
      userId: dto.userId,
      conversationId: dto.conversationId,
      leftAt: new Date().toISOString(),
    })
  }
}
