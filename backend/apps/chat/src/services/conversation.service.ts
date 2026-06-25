import { Inject, Injectable } from '@nestjs/common'
import type {
  UserUpdatedPayload,
  UserUpdateStatusMakeFriendPayload,
} from 'libs/constant/rmq/payload'
import { S3StorageService } from '@app/storage-s3/s3-storage.service'
import {
  ConversationRepository,
  ConversationMemberRepository,
  MessageRepository,
} from '../repositories'
import { ChatErrors } from '../errors/chat.errors'
import { ChatEventsPublisher } from '../rmq/publishers/chat-events.publisher'
import { Member } from '../http/chat-http.dto'
import { conversationType } from '../generated'
import { MessageMapper } from '../domain/message.mapper'
import { MessageMediaService } from './message-media.service'

export interface CreateConversationData {
  members: Member[]
  type: conversationType
  createrId?: string
  groupName?: string
  groupAvatar?: Buffer
  groupAvatarFilename?: string
}

export interface DeleteConversationRequest {
  conversationId: string
  userId: string
}

@Injectable()
export class ConversationService {
  constructor(
    private readonly conversationRepo: ConversationRepository,
    private readonly memberRepo: ConversationMemberRepository,
    private readonly messageRepo: MessageRepository,
    private readonly eventsPublisher: ChatEventsPublisher,
    private readonly messageMediaService: MessageMediaService,
    @Inject(S3StorageService)
    private readonly s3StorageService: S3StorageService,
  ) {}

  async createConversationWhenAcceptFriend(
    data: UserUpdateStatusMakeFriendPayload,
  ) {
    if (!(data.status === 'ACCEPTED')) return
    await this.createConversation({
      type: conversationType.DIRECT,
      members: data.members,
    })
  }

  async createConversation(data: CreateConversationData) {
    const memberIds = data.members
      .map((m) => m.userId)
      .filter((id) => id !== data.createrId)

    if (data.createrId && memberIds.length <= 1) {
      ChatErrors.conversationNotEnoughMembers()
    }

    let avatarUrl = ''
    if (data.groupAvatar && data.groupAvatarFilename) {
      const mime =
        this.messageMediaService.getMimeType(data.groupAvatarFilename) ||
        'application/octet-stream'

      avatarUrl = await this.s3StorageService.upload({
        buffer: data.groupAvatar as Buffer,
        mime,
        folder: 'avatars',
        ext: data.groupAvatarFilename?.split('.').pop() || 'bin',
      })
    }

    const uniqueMembers = Array.from(
      new Map(data.members.map((m) => [m.userId, m])).values(),
    )

    const conversation = await this.conversationRepo.create({
      type: data.type as conversationType,
      groupName: data.groupName,
      groupAvatar: avatarUrl,
      memberCount: uniqueMembers.length,
    })

    await this.memberRepo.createMany(
      conversation.id,
      uniqueMembers,
      data.createrId as string,
      data.type as conversationType,
    )

    const res = await this.conversationRepo.findByIdWithMembers(conversation.id)

    this.eventsPublisher.publishConversationCreated({
      ...res,
      memberIds,
    })

    try {
      const membersToPublish = uniqueMembers || []
      for (const m of membersToPublish) {
        this.eventsPublisher.publishUserJoinedGroup({
          userId: m.userId,
          groupId: conversation.id,
          conversationId: conversation.id,
          groupName: conversation.groupName ?? undefined,
          createdAt: new Date().toISOString(),
        })
      }
    } catch (e) {
      console.warn(
        '[chat-service] publishUserJoinedGroup (createConversation) failed',
        e,
      )
    }

    return res
  }

  async deleteConversation(dto: DeleteConversationRequest) {
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
      (member) =>
        member.userId === dto.userId &&
        (member.role === 'ADMIN' || member.role === 'OWNER'),
    )

    if (!actor) {
      ChatErrors.userNoPermission()
    }

    await this.conversationRepo.deleteConversationById(dto.conversationId)

    return {
      status: 'SUCCESS',
    }
  }

  async getConversations(
    userId: string,
    params: { limit?: number | string; cursor?: string | null },
  ) {
    const take = Number(params.limit) || 20
    const cursor = params.cursor ? new Date(params.cursor) : null
    const conversations = await this.conversationRepo.findByUserIdPaginated(
      userId,
      cursor,
      take,
    )
    return this.enrichConversationsLastMessage(conversations)
  }

  async searchConversations(userId: string, keyword: string) {
    const safeKeyword = keyword?.trim()

    if (!safeKeyword) {
      return []
    }

    console.time('search-conversations')
    const conversations = await this.conversationRepo.searchByKeyword(
      userId,
      safeKeyword,
    )
    console.timeEnd('search-conversations')

    console.time('search-conversations-friend')
    const converOfFriend =
      await this.conversationRepo.findDirectConversationOfFriend(
        userId,
        safeKeyword,
      )
    console.timeEnd('search-conversations-friend')

    console.time('merge-conversations')
    const mergedConversations = [...conversations, ...converOfFriend].filter(
      (conversation): conversation is NonNullable<typeof conversation> =>
        conversation != null,
    )
    console.timeEnd('merge-conversations')

    console.time('deduplicate-sort-conversations')
    const uniqueConversations = Array.from(
      new Map(
        mergedConversations.map((conversation) => [
          conversation.id,
          conversation,
        ]),
      ).values(),
    ).sort((a, b) => {
      const bTime = new Date(b.updatedAt ?? b.createdAt).getTime()
      const aTime = new Date(a.updatedAt ?? a.createdAt).getTime()
      return bTime - aTime
    })
    console.timeEnd('deduplicate-sort-conversations')

    return this.enrichConversationsLastMessage(uniqueConversations)
  }

  async getConversationByFriendId(friendId: string, userId: string) {
    const conversation: any =
      await this.conversationRepo.findConversationByFriendId(friendId, userId)

    if (!conversation) {
      ChatErrors.conversationNotFound()
    }

    const isMember = conversation.members.find((m) => m.userId === userId)
    if (!isMember) {
      ChatErrors.userNotMember()
    }

    return conversation
  }

  async getConversationById(conversationId: string, userId: string) {
    const conversation: any =
      await this.conversationRepo.findByIdWithMembers(conversationId)

    if (!conversation) {
      ChatErrors.conversationNotFound()
    }

    const isMember = conversation.members.find((m) => m.userId === userId)
    if (!isMember) {
      ChatErrors.userNotMember()
    }

    return {
      conversation,
    }
  }

  async handleUserUpdated(data: UserUpdatedPayload) {
    await this.memberRepo.updateByUserId(data.userId, {
      avatar: data.avatar,
      fullName: data.fullName,
    })
  }

  private async enrichConversationsLastMessage(conversations: any[]) {
    const missing = conversations.filter(
      (conversation) =>
        !conversation?.lastMessageText && !conversation?.lastMessageId,
    )

    if (!missing.length) return conversations

    const latestMessages = await this.messageRepo.findLatestByConversationIds(
      missing.map((conversation) => conversation.id),
    )

    const latestByConversationId = new Map(
      latestMessages
        .filter((message): message is NonNullable<typeof message> =>
          Boolean(message),
        )
        .map((message) => [message.conversationId, message]),
    )

    return conversations.map((conversation) => {
      if (conversation.lastMessageText || conversation.lastMessageId) {
        return conversation
      }

      const latestMessage = latestByConversationId.get(conversation.id)
      if (!latestMessage) return conversation

      const sender = latestMessage.senderMember

      return {
        ...conversation,
        lastMessageId: latestMessage.id,
        lastMessageAt: latestMessage.createdAt,
        lastMessageText: MessageMapper.previewText(latestMessage),
        lastMessageSenderId: latestMessage.senderId,
        lastMessageSenderName:
          sender?.fullName || sender?.username || latestMessage.senderId,
        lastMessageSenderAvatar: sender?.avatar || null,
      }
    })
  }
}
