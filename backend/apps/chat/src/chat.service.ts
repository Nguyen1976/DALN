import { Inject, Injectable } from '@nestjs/common'
import type {
  MessageSendPayload,
  UserUpdatedPayload,
  UserUpdateStatusMakeFriendPayload,
  UpdateMessageReadPayload,
} from 'libs/constant/rmq/payload'
import {
  ConversationRepository,
  MessageRepository,
  ConversationMemberRepository,
} from './repositories'
import { ChatErrors } from './errors/chat.errors'
import { ChatEventsPublisher } from './rmq/publishers/chat-events.publisher'
import { StorageR2Service } from '@app/storage-r2/storage-r2.service'
import { ConversationAssetKind, Member } from './http/chat-http.dto'
import { conversationType } from './generated'
import { Queue } from 'bullmq'
import { InjectQueue } from '@nestjs/bullmq'

// Type definitions for service methods
interface CreateConversationData {
  members: Member[]
  type: conversationType
  createrId?: string
  groupName?: string
  groupAvatar?: Buffer
  groupAvatarFilename?: string
}

@Injectable()
export class ChatService {
  private readonly uploadLimitByType: Record<string, number> = {
    IMAGE: 10 * 1024 * 1024,
    VIDEO: 100 * 1024 * 1024,
    FILE: 50 * 1024 * 1024,
  }

  private readonly mimeAllowListByType: Record<string, string[]> = {
    IMAGE: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
    VIDEO: ['video/mp4', 'video/webm', 'video/quicktime'],
    FILE: [
      'application/pdf',
      'text/plain',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/zip',
    ],
  }

  private isObjectId(value: string): boolean {
    return /^[a-f\d]{24}$/i.test(value)
  }

  constructor(
    private readonly conversationRepo: ConversationRepository,
    private readonly memberRepo: ConversationMemberRepository,
    private readonly messageRepo: MessageRepository,
    private readonly eventsPublisher: ChatEventsPublisher,
    @Inject(StorageR2Service)
    private readonly storageR2Service: StorageR2Service,
    @InjectQueue('unreadQueue') private unreadQueue: Queue,
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
    //trường hợp tạo nhóm
    if (data.createrId && memberIds.length <= 1) {
      ChatErrors.conversationNotEnoughMembers()
    }

    let avatarUrl = ''
    if (data.groupAvatar && data.groupAvatarFilename) {
      const mime =
        this.getMimeType(data.groupAvatarFilename) || 'application/octet-stream'

      avatarUrl = await this.storageR2Service.upload({
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

    return res
  }

  async sendMessage(data: MessageSendPayload) {
    console.time('fetch-members')
    const conversationMembers = await this.memberRepo.findByConversationId(
      data.conversationId,
    )
    const memberIds = conversationMembers.map((cm) => cm.userId)

    if (!memberIds.includes(data.senderId)) {
      ChatErrors.senderNotMember()
    }
    console.timeEnd('fetch-members')

    const type = this.normalizeMessageType(data.type || 'TEXT')
    const content = data.text?.trim() || null
    const medias = data.medias || []

    if (type === 'TEXT' && !content) {
      ChatErrors.invalidMessagePayload()
    }

    if (type !== 'TEXT' && medias.length === 0) {
      ChatErrors.invalidMessagePayload()
    }

    if (type !== 'TEXT') {
      await Promise.all(
        medias.map(async (media) => {
          this.validateMimeAndSize(type, media.mimeType, Number(media.size))
          const exists = await this.checkObjectExistsWithRetry(media.objectKey)
          if (!exists) {
            ChatErrors.mediaNotUploaded()
          }
        }),
      )
    }

    console.time('save-message')
    const message: any = await this.messageRepo.create({
      conversationId: data.conversationId,
      senderId: data.senderId,
      type,
      content,
      replyToMessageId: data.replyToMessageId,
      medias,
    })
    console.timeEnd('save-message')

    if (!message) {
      ChatErrors.invalidMessagePayload()
    }

    const senderMember = conversationMembers.find(
      (member) => member.userId === data.senderId,
    )
    message.senderMember = senderMember

    this.unreadQueue.add(
      'increase-unread',
      {
        conversationId: data.conversationId,
        senderId: data.senderId,
        lastMessageAt: message.createdAt,
        lastMessageText: message.content || '',
        lastMessageSenderId: data.senderId,
        lastMessageSenderName:
          senderMember?.fullName || senderMember?.username || data.senderId,
        lastMessageSenderAvatar: senderMember?.avatar || null,
      },
      { removeOnComplete: true, removeOnFail: true },
    )

    const normalizedMessage = this.normalizeMessage(message)

    this.eventsPublisher.publishMessageSent(
      {
        ...normalizedMessage,
        tempMessageId: data.tempMessageId,
      },
      memberIds as string[],
    )

    return {
      message: normalizedMessage,
    }
  }

  async createMessageUploadUrl(data) {
    const member = await this.memberRepo.findByConversationIdAndUserId(
      data.conversationId,
      data.userId,
    )

    if (!member) {
      ChatErrors.userNotMember()
    }

    const type = data.type as unknown as 'IMAGE' | 'VIDEO' | 'FILE'
    const size = Number(data.size)
    const resolvedMimeType =
      (typeof data.mimeType === 'string' && data.mimeType.trim()) ||
      this.getMimeType(data.fileName)

    const normalizedType = this.normalizeMessageType(type)

    this.validateMimeAndSize(normalizedType, resolvedMimeType, size)

    const upload = await this.storageR2Service.createPresignedUploadUrl({
      folder: `chat-media/${data.conversationId}/${data.userId}`,
      fileName: data.fileName,
      mime: resolvedMimeType,
      expiresInSeconds: 300,
    })

    return {
      uploadUrl: upload.uploadUrl,
      objectKey: upload.objectKey,
      publicUrl: upload.publicUrl,
      expiresInSeconds: String(upload.expiresInSeconds),
    }
  }

  async addMemberToConversation(dto) {
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
    //check role
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
    await this.createSystemMessageAndSync(
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

    return {
      status: 'SUCCESS',
    }
  }

  async removeMemberFromConversation(dto) {
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

    //sẽ đổi thành call qua user service or cache
    // const actorProfile = await this.memberRepo.findUserProfileById(dto.userId)
    // const targetProfile = await this.memberRepo.findUserProfileById(
    //   dto.targetUserId,
    // )

    const actorDisplayName =
      actor.fullName ||
      actor.username ||
      // actorProfile?.fullName ||
      // actorProfile?.username ||
      actor.userId

    const targetDisplayName =
      target.fullName ||
      target.username ||
      // targetProfile?.fullName ||
      // targetProfile?.username ||
      dto.targetUserId

    await this.createSystemMessageAndSync(
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

    return {
      status: 'SUCCESS',
    }
  }

  async leaveConversation(dto) {
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

    await this.createSystemMessageAndSync(
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

    return {
      status: 'SUCCESS',
    }
  }

  async deleteConversation(dto) {
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

  async getConversations(userId: string, params: any) {
    const take = Number(params.limit) || 20
    const cursor = params.cursor ? new Date(params.cursor) : null
    const conversations = await this.conversationRepo.findByUserIdPaginated(
      userId,
      cursor,
      take,
    )
    return conversations
  }

  async getMessagesByConversationId(
    conversationId: string,
    userId: string,
    params: any,
  ) {
    const isMember = await this.memberRepo.findByConversationIdAndUserId(
      conversationId,
      userId,
    )

    if (!isMember) {
      ChatErrors.userNotMember()
    }

    const take = Number(params.limit) || 20
    const cursor = params.cursor ? new Date(params.cursor) : null

    const messages = await this.messageRepo.findByConversationIdPaginated(
      conversationId,
      take,
      cursor,
    )

    return {
      messages: messages.map((m) => ({
        ...this.normalizeMessage(m),
      })),
    }
  }

  async getConversationAssets(
    conversationId: string,
    userId: string,
    kind: ConversationAssetKind,
    params: {
      limit?: number | string
      cursor?: string | null
    },
  ) {
    const isMember = await this.memberRepo.findByConversationIdAndUserId(
      conversationId,
      userId,
    )

    if (!isMember) {
      ChatErrors.userNotMember()
    }

    const take = Number(params.limit) || 20
    const cursor = params.cursor ? new Date(params.cursor) : null

    const kindMap: Record<number, 'MEDIA' | 'LINK' | 'DOC'> = {
      [ConversationAssetKind.ASSET_MEDIA]: 'MEDIA',
      [ConversationAssetKind.ASSET_LINK]: 'LINK',
      [ConversationAssetKind.ASSET_DOC]: 'DOC',
    }

    const mappedKind = kindMap[kind] || 'MEDIA'

    const messages = await this.messageRepo.findConversationAssets(
      conversationId,
      mappedKind,
      take,
      cursor,
    )

    const nextCursor =
      messages.length === take
        ? messages[messages.length - 1]?.createdAt?.toISOString()
        : undefined

    return {
      messages: messages.map((message) => this.normalizeMessage(message)),
      nextCursor,
    }
  }

  async handleUserUpdated(data: UserUpdatedPayload) {
    await this.memberRepo.updateByUserId(data.userId, {
      avatar: data.avatar,
      fullName: data.fullName,
    })
  }

  /**
   * Cập nhật lastReadMessageId cho user trong conversation
   * Gọi từ Realtime Service qua RabbitMQ khi user đã xem tin nhắn
   */
  async updateMessageRead(data: UpdateMessageReadPayload) {
    const { conversationId, userId, lastReadMessageId } = data

    if (!this.isObjectId(lastReadMessageId)) {
      return
    }

    // Cập nhật thông tin user đã xem tin nhắn vào conversation member
    await this.memberRepo.updateLastRead(
      conversationId,
      userId,
      lastReadMessageId,
    )
  }

  async searchConversations(userId: string, keyword: string) {
    const safeKeyword = keyword?.trim()

    if (!safeKeyword) {
      return {
        conversations: [],
      }
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
      (conversation): conversation is any => conversation != null,
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

    return uniqueConversations
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

  private getMimeType(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase()
    const mimeTypes: Record<string, string> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      webp: 'image/webp',
      bmp: 'image/bmp',
      txt: 'text/plain',
      md: 'text/plain',
      csv: 'text/plain',
      json: 'application/json',
      xml: 'application/xml',
      yaml: 'text/plain',
      yml: 'text/plain',
      js: 'text/plain',
      jsx: 'text/plain',
      ts: 'text/plain',
      tsx: 'text/plain',
      java: 'text/plain',
      kt: 'text/plain',
      go: 'text/plain',
      py: 'text/plain',
      rb: 'text/plain',
      c: 'text/plain',
      cpp: 'text/plain',
      h: 'text/plain',
      hpp: 'text/plain',
      php: 'text/plain',
      sh: 'text/plain',
      sql: 'text/plain',
      log: 'text/plain',
    }
    return mimeTypes[ext || ''] || 'application/octet-stream'
  }

  private validateMimeAndSize(type: string, mimeType: string, size: number) {
    if (!this.uploadLimitByType[type] || !this.mimeAllowListByType[type]) {
      ChatErrors.invalidMediaType()
    }

    if (
      !Number.isFinite(size) ||
      size <= 0 ||
      size > this.uploadLimitByType[type]
    ) {
      ChatErrors.fileSizeExceeded()
    }

    if (!this.mimeAllowListByType[type].includes(mimeType)) {
      ChatErrors.invalidMediaType()
    }
  }

  private normalizeMessageType(type: any): 'TEXT' | 'IMAGE' | 'VIDEO' | 'FILE' {
    if (typeof type === 'number') {
      return ['TEXT', 'IMAGE', 'VIDEO', 'FILE'][type] as
        | 'TEXT'
        | 'IMAGE'
        | 'VIDEO'
        | 'FILE'
    }

    const normalized = String(type || 'TEXT').toUpperCase()

    if (normalized.includes('IMAGE')) return 'IMAGE'
    if (normalized.includes('VIDEO')) return 'VIDEO'
    if (normalized.includes('FILE')) return 'FILE'
    return 'TEXT'
  }

  private normalizeMessage(message: any) {
    return {
      ...message,
      type: message.type || 'TEXT',
      text: message.content || '',
      createdAt: message.createdAt.toString(),
      medias: (message.medias || []).map((media: any) => ({
        ...media,
        size: String(media.size),
      })),
    }
  }

  private async checkObjectExistsWithRetry(
    objectKey: string,
  ): Promise<boolean> {
    const maxAttempts = 4
    const delayMs = 300

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const exists = await this.storageR2Service.objectExists(objectKey)
      if (exists) return true

      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, delayMs))
      }
    }

    return false
  }

  private async createSystemMessageAndSync(
    conversationId: string,
    actorUserId: string,
    text: string,
  ) {
    const result = await this.messageRepo.create({
      conversationId,
      senderId: actorUserId,
      type: 'TEXT',
      content: text,
      replyToMessageId: undefined,
      medias: [],
    })

    const message = result
    if (!message) return

    await this.conversationRepo.updateUpdatedAt(conversationId, {
      lastMessageAt: message.createdAt,
      lastMessageText: text,
      lastMessageSenderId: actorUserId,
      lastMessageSenderName: 'System',
      lastMessageSenderAvatar: null,
    })

    await this.memberRepo.updateLastMessageAt(conversationId, message.createdAt)
    await this.memberRepo.increaseUnreadForOthers(conversationId, actorUserId)

    const normalized = this.normalizeMessage(message)
    const members = await this.memberRepo.findByConversationId(conversationId)
    const memberIds = members.map((member) => member.userId)

    this.safePublish(() =>
      this.eventsPublisher.publishSystemMessage(memberIds, normalized),
    )
    this.safePublish(() =>
      this.eventsPublisher.publishMessageSent(normalized, memberIds),
    )
  }

  private safePublish(fn: () => void) {
    try {
      fn()
    } catch (error) {
      console.error('[chat-service] publish event failed', error)
    }
  }
}
