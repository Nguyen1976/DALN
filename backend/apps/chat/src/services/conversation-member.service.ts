import { Injectable } from '@nestjs/common'
import {
  ConversationRepository,
  ConversationMemberRepository,
} from '../repositories'
import { ChatErrors } from '../errors/chat.errors'
import { ChatEventsPublisher } from '../rmq/publishers/chat-events.publisher'
import { Member } from '../http/chat-http.dto'
import { conversationType } from '../generated'
import { MessageService } from './message.service'

export interface AddMemberToConversationRequest {
  conversationId: string
  userId: string
  members: Member[]
}

export interface RemoveMemberFromConversationRequest {
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
  ) {}

  async addMemberToConversation(dto: AddMemberToConversationRequest) {
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

    const actor = existingMembers.find(
      (m) =>
        m.userId === dto.userId && (m.role === 'ADMIN' || m.role === 'OWNER'),
    )
    if (!actor) {
      ChatErrors.userNoPermission()
    }

    const memberIds = dto.members.map((member) => member.userId)

    const existingMemberIds = existingMembers.map((m) => m.userId)
    const newMemberIds = memberIds.filter(
      (id) => !existingMemberIds.includes(id),
    )

    const newMembers = dto.members.filter((member) =>
      newMemberIds.includes(member.userId),
    )

    if (newMemberIds.length === 0) {
      return {
        status: 'SUCCESS',
      }
    }

    const addedMemberCount = await this.memberRepo.addMembers(
      dto.conversationId,
      newMembers.map((member) => ({
        userId: member.userId,
        username: member.username,
        fullName: member.fullName,
        avatar: member.avatar,
      })),
    )

    if (addedMemberCount > 0) {
      await this.conversationRepo.incrementMemberCount(
        dto.conversationId,
        addedMemberCount,
      )
    }

    const actorDisplayName = actor.fullName || actor.username || actor.userId
    await this.messageService.createSystemMessageAndSync(
      dto.conversationId,
      dto.userId,
      `${actorDisplayName} đã thêm ${newMemberIds.length} thành viên vào nhóm`,
    )

    const res = await this.conversationRepo.findByIdWithMembers(conversation.id)

    this.safePublish(() =>
      this.eventsPublisher.publishMemberAddedToConversation({
        ...res,
        actorId: dto.userId,
        newMemberIds,
      }),
    )

    try {
      for (const m of newMembers) {
        this.eventsPublisher.publishUserJoinedGroup({
          userId: m.userId,
          groupId: dto.conversationId,
          conversationId: dto.conversationId,
          groupName: conversation.groupName ?? undefined,
          createdAt: new Date().toISOString(),
        })
      }
    } catch (e) {
      console.warn('[chat-service] publishUserJoinedGroup failed', e)
    }

    return {
      status: 'SUCCESS',
    }
  }

  async removeMemberFromConversation(dto: RemoveMemberFromConversationRequest) {
    const conversation = await this.conversationRepo.findById(
      dto.conversationId,
    )

    if (!conversation) {
      ChatErrors.conversationNotFound()
    }

    if (conversation.type === conversationType.DIRECT) {
      ChatErrors.userNoPermission()
    }

    if (dto.userId === dto.targetUserId) {
      ChatErrors.invalidMemberAction(
        'Use leave-group API to leave conversation',
      )
    }

    const existingMembers = await this.memberRepo.findByConversationId(
      dto.conversationId,
    )

    const actor = existingMembers.find(
      (member) => member.userId === dto.userId && member.role === 'ADMIN',
    )
    if (!actor) {
      ChatErrors.userNoPermission()
    }

    const target = existingMembers.find(
      (member) => member.userId === dto.targetUserId,
    )
    if (!target) {
      ChatErrors.memberNotFoundInConversation()
    }

    const actorDisplayName =
      actor.fullName || actor.username || actor.userId

    const targetDisplayName =
      target.fullName || target.username || dto.targetUserId

    await this.messageService.createSystemMessageAndSync(
      dto.conversationId,
      dto.userId,
      `${actorDisplayName} đã xóa ${targetDisplayName} khỏi nhóm`,
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

    this.safePublish(() =>
      this.eventsPublisher.publishConversationMemberRemoved({
        conversation: conversationAfterRemove,
        actorId: dto.userId,
        targetUserId: dto.targetUserId,
        remainingMemberIds: (conversationAfterRemove?.members || []).map(
          (member) => member.userId,
        ),
      }),
    )

    try {
      this.eventsPublisher.publishUserLeftGroup({
        userId: dto.targetUserId,
        groupId: dto.conversationId,
        conversationId: dto.conversationId,
        leftAt: new Date().toISOString(),
      })
    } catch (e) {
      console.warn('[chat-service] publishUserLeftGroup failed', e)
    }

    return {
      status: 'SUCCESS',
    }
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
      return {
        status: 'SUCCESS',
      }
    }

    if (actor.role === 'ADMIN' || actor.role === 'OWNER') {
      ChatErrors.adminCannotLeaveGroup()
    }

    const actorDisplayName = actor.fullName || actor.username || actor.userId
    const leaveText = `${actorDisplayName} đã rời khỏi nhóm`

    await this.messageService.createSystemMessageAndSync(
      dto.conversationId,
      dto.userId,
      leaveText,
    )

    const removed = await this.memberRepo.removeMember(
      dto.conversationId,
      dto.userId,
    )

    if (removed) {
      await this.conversationRepo.incrementMemberCount(dto.conversationId, -1)
    }

    const conversationAfterLeave =
      await this.conversationRepo.findByIdWithMembers(dto.conversationId)

    if (!conversationAfterLeave) {
      ChatErrors.conversationNotFound()
    }

    this.safePublish(() =>
      this.eventsPublisher.publishConversationMemberLeft({
        conversation: conversationAfterLeave,
        actorId: dto.userId,
        remainingMemberIds: (conversationAfterLeave?.members || []).map(
          (member) => member.userId,
        ),
      }),
    )

    try {
      this.eventsPublisher.publishUserLeftGroup({
        userId: dto.userId,
        groupId: dto.conversationId,
        conversationId: dto.conversationId,
        leftAt: new Date().toISOString(),
      })
    } catch (e) {
      console.warn('[chat-service] publishUserLeftGroup failed', e)
    }

    return {
      status: 'SUCCESS',
    }
  }

  private safePublish(fn: () => void) {
    try {
      fn()
    } catch (error) {
      console.error('[chat-service] publish event failed', error)
    }
  }
}
