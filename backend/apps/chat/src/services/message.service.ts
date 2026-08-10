import { Injectable, Logger } from '@nestjs/common'
import { RedisService } from '@app/redis'
import { DIRTY_CONVERSATIONS_KEY } from '../background-jobs/unread/unread.constants'
import type {
  MessageSendPayload,
  UpdateMessageReadPayload,
} from 'libs/constant/rmq/payload'
import {
  ConversationMemberRepository,
  MessageRepository,
} from '../repositories'
import { ChatErrors } from '../errors/chat.errors'
import { ChatEventsPublisher } from '../rmq/publishers/chat-events.publisher'
import { ConversationAssetKind } from '../http/chat-http.dto'
import { MessageMapper } from '../domain/message.mapper'
import { MessageMediaService } from './message-media.service'

export interface RevokeMessageRequest {
  conversationId: string
  messageId: string
  userId: string
}

export interface DeleteMessageForMeRequest {
  conversationId: string
  messageId: string
  userId: string
}

export interface ClearConversationHistoryRequest {
  conversationId: string
  userId: string
}

type ConversationSyncMember = {
  userId: string
  fullName?: string | null
  username?: string | null
  avatar?: string | null
}

type OutboundMessage = {
  id?: string
  createdAt: Date
  content?: string | null
  type?: string
  poll?: { question?: string } | null
  isRevoked?: boolean
  senderMember?: ConversationSyncMember
  [key: string]: unknown
}

@Injectable()
export class MessageService {
  private readonly logger = new Logger(MessageService.name)

  constructor(
    private readonly memberRepo: ConversationMemberRepository,
    private readonly messageRepo: MessageRepository,
    private readonly eventsPublisher: ChatEventsPublisher,
    private readonly messageMediaService: MessageMediaService,
    private readonly redisService: RedisService,
  ) {}

  async sendMessage(data: MessageSendPayload) {
    const conversationMembers = await this.memberRepo.findByConversationId(
      data.conversationId,
    )
    const memberIds = conversationMembers.map((cm) => cm.userId)

    if (!memberIds.includes(data.senderId)) {
      ChatErrors.senderNotMember()
    }

    const type = this.messageMediaService.normalizeMessageType(
      data.type || 'TEXT',
    )
    const content = data.text?.trim() || null
    const medias = data.medias || []

    if (type === 'TEXT' && !content) {
      ChatErrors.invalidMessagePayload()
    }

    if (type !== 'TEXT' && medias.length === 0) {
      ChatErrors.invalidMessagePayload()
    }

    if (type !== 'TEXT') {
      const normalizedMedias = medias.map((media) => {
        const fileName = String(media.objectKey || '').split('/').pop() || ''
        const resolvedMimeType = this.messageMediaService.resolveMimeType(
          fileName,
          media.mimeType,
        )

        return {
          ...media,
          mimeType: resolvedMimeType,
        }
      })

      await Promise.all(
        normalizedMedias.map(async (media) => {
          const fileName = String(media.objectKey || '').split('/').pop() || ''
          this.messageMediaService.validateMimeAndSize(
            type,
            media.mimeType,
            Number(media.size),
            fileName,
          )
          const exists =
            await this.messageMediaService.checkObjectExistsWithRetry(
              media.objectKey,
            )
          if (!exists) {
            ChatErrors.mediaNotUploaded()
          }
        }),
      )

      medias.splice(0, medias.length, ...normalizedMedias)
    }

    const message: OutboundMessage = await this.messageRepo.create({
      conversationId: data.conversationId,
      senderId: data.senderId,
      type,
      content,
      replyToMessageId: data.replyToMessageId,
      medias,
    })

    if (!message) {
      ChatErrors.invalidMessagePayload()
    }

    const senderMember = conversationMembers.find(
      (member) => member.userId === data.senderId,
    )
    message.senderMember = senderMember

    return this.notifyMessageCreated({
      conversationId: data.conversationId,
      senderId: data.senderId,
      message,
      senderMember: senderMember || { userId: data.senderId },
      memberIds: memberIds as string[],
      tempMessageId: data.tempMessageId,
    })
  }

  async createMessageUploadUrl(data: {
    conversationId: string
    userId: string
    type: unknown
    size: number | string
    mimeType?: string
    fileName: string
  }) {
    const member = await this.memberRepo.findByConversationIdAndUserId(
      data.conversationId,
      data.userId,
    )

    if (!member) {
      ChatErrors.userNotMember()
    }

    const size = Number(data.size)
    const resolvedMimeType = this.messageMediaService.resolveMimeType(
      data.fileName,
      data.mimeType,
    )

    const normalizedType = this.messageMediaService.normalizeMessageType(
      data.type,
    )

    this.messageMediaService.validateMimeAndSize(
      normalizedType,
      resolvedMimeType,
      size,
      data.fileName,
    )

    const upload = await this.messageMediaService.createPresignedUploadUrl({
      conversationId: data.conversationId,
      userId: data.userId,
      fileName: data.fileName,
      mimeType: resolvedMimeType,
    })

    return {
      uploadUrl: upload.uploadUrl,
      objectKey: upload.objectKey,
      publicUrl: upload.publicUrl,
      expiresInSeconds: String(upload.expiresInSeconds),
    }
  }

  async getMessagesByConversationId(
    conversationId: string,
    userId: string,
    params: { limit?: number | string; cursor?: string | null },
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

    const messages =
      await this.messageRepo.findByConversationIdPaginatedForUser(
        conversationId,
        userId,
        take,
        cursor,
      )

    return {
      messages: messages.map((m) => MessageMapper.toResponse(m)),
    }
  }

  async revokeMessage(data: RevokeMessageRequest) {
    const message = await this.messageRepo.findById(
      data.messageId,
      data.conversationId,
    )

    if (!message) {
      ChatErrors.messageNotFound()
    }

    if (String(message.senderId) !== String(data.userId)) {
      ChatErrors.notMessageOwner()
    }

    const updated = await this.messageRepo.revokeMessage(
      data.messageId,
      data.conversationId,
      data.userId,
    )

    if (!updated.count) {
      ChatErrors.messageNotFound()
    }

    const conversationMembers = await this.memberRepo.findByConversationId(
      data.conversationId,
    )

    const senderMember = conversationMembers.find(
      (member) => member.userId === String(message.senderId),
    )

    const revokedMessage = {
      ...message,
      senderMember: senderMember
        ? {
            userId: senderMember.userId,
            username: senderMember.username,
            fullName: senderMember.fullName,
            avatar: senderMember.avatar,
          }
        : undefined,
      isRevoked: true,
      content: '',
    }

    this.eventsPublisher.publishMessageRevoked(
      {
        conversationId: data.conversationId,
        messageId: data.messageId,
        message: revokedMessage,
      },
      conversationMembers.map((member) => member.userId),
    )

    return {
      message: MessageMapper.toResponse(revokedMessage),
    }
  }

  async deleteMessageForMe(data: DeleteMessageForMeRequest) {
    const member = await this.memberRepo.findByConversationIdAndUserId(
      data.conversationId,
      data.userId,
    )

    if (!member) {
      ChatErrors.userNotMember()
    }

    const message = await this.messageRepo.findById(
      data.messageId,
      data.conversationId,
    )

    if (!message) {
      ChatErrors.messageNotFound()
    }

    await this.messageRepo.createDeleteMessage(data.messageId, data.userId)

    return {
      messageId: data.messageId,
      conversationId: data.conversationId,
    }
  }

  async clearConversationHistory(data: ClearConversationHistoryRequest) {
    const member = await this.memberRepo.findByConversationIdAndUserId(
      data.conversationId,
      data.userId,
    )

    if (!member) {
      ChatErrors.userNotMember()
    }

    const clearedHistoryAt = new Date()

    await this.memberRepo.clearHistoryForMember(
      data.conversationId,
      data.userId,
      clearedHistoryAt,
    )

    return {
      conversationId: data.conversationId,
      clearedHistoryAt: clearedHistoryAt.toISOString(),
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
      messages: messages.map((message) => MessageMapper.toResponse(message)),
      nextCursor,
    }
  }

  async updateMessageRead(data: UpdateMessageReadPayload) {
    const { conversationId, userId, lastReadMessageId } = data

    if (!this.isObjectId(lastReadMessageId)) {
      return
    }

    await this.memberRepo.updateLastRead(
      conversationId,
      userId,
      lastReadMessageId,
    )
  }

  async createSystemMessageAndSync(
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

    const members = await this.memberRepo.findByConversationId(conversationId)
    const memberIds = members.map((member) => member.userId)

    this.enqueueConversationSyncJob({
      conversationId,
      senderId: actorUserId,
      message,
      senderMember: {
        userId: actorUserId,
        fullName: 'System',
        username: 'System',
        avatar: null,
      },
    })

    const normalized = MessageMapper.toResponse(message)

    this.safePublish(() =>
      this.eventsPublisher.publishSystemMessage(memberIds, normalized),
    )
    this.safePublish(() =>
      this.eventsPublisher.publishMessageSent(normalized, memberIds),
    )
  }

  notifyMessageCreated(params: {
    conversationId: string
    senderId: string
    message: OutboundMessage
    senderMember: ConversationSyncMember
    memberIds: string[]
    tempMessageId?: string
  }) {
    const { conversationId, senderId, message, senderMember, memberIds } =
      params

    this.enqueueConversationSyncJob({
      conversationId,
      senderId,
      message,
      senderMember,
    })

    const normalizedMessage = MessageMapper.toResponse({
      ...message,
      tempMessageId: params.tempMessageId,
    })

    this.eventsPublisher.publishMessageSent(
      {
        ...normalizedMessage,
        tempMessageId: params.tempMessageId,
      },
      memberIds,
    )

    return {
      message: normalizedMessage,
    }
  }

  private isObjectId(value: string): boolean {
    return /^[a-f\d]{24}$/i.test(value)
  }

  private safePublish(fn: () => void) {
    try {
      fn()
    } catch (error) {
      this.logger.error('[chat-service] publish event failed', error)
    }
  }

  /**
   * Tích luỹ số tin chưa đọc + tin nhắn cuối vào Redis; cron sẽ gom xuống Mongo.
   *
   * Trước đây bước này đi qua một job BullMQ, nhưng worker của nó cũng chỉ ghi
   * đúng ba lệnh Redis dưới đây — mà vòng đời một job BullMQ tốn khoảng 8–10
   * lệnh Redis cho việc sổ sách (wait list, hash job data, event stream,
   * BRPOPLPUSH, cập nhật trạng thái, removeOnComplete). Ở peak 1000 msg/s đó là
   * chi phí lớn hơn nhiều lần công việc thật.
   *
   * Hàng đợi cũng không mang lại độ bền ở đây: nó nằm trên CHÍNH Redis này, nên
   * Redis chết thì cả hai cùng chết. Ghi thẳng còn bền hơn — dữ liệu vào ngay
   * thay vì nằm chờ worker nhặt.
   */
  private enqueueConversationSyncJob(params: {
    conversationId: string
    senderId: string
    message: OutboundMessage
    senderMember: ConversationSyncMember
  }) {
    const { conversationId, senderId, message, senderMember } = params

    const lastMessage = JSON.stringify({
      senderId,
      lastMessageId: message.id,
      lastMessageAt: message.createdAt
        ? new Date(message.createdAt).toISOString()
        : undefined,
      lastMessageText: MessageMapper.previewText(message),
      lastMessageSenderId: senderId,
      lastMessageSenderName:
        senderMember.fullName || senderMember.username || senderId,
      lastMessageSenderAvatar: senderMember.avatar || null,
    })

    // Một round-trip cho cả ba lệnh. SADD đặt CUỐI để khi cron pop được id ra
    // thì dữ liệu đã nằm sẵn trong Redis.
    void this.redisService
      .pipeline([
        ['hincrby', `unread_count:${conversationId}`, senderId, 1],
        ['set', `last_message:${conversationId}`, lastMessage],
        ['sadd', DIRTY_CONVERSATIONS_KEY, conversationId],
      ])
      .catch((error) => {
        this.logger.error('[chat-service] unread pipeline failed', error)
      })
  }
}
