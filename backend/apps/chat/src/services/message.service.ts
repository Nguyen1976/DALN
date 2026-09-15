import { Injectable, Logger } from '@nestjs/common'
import { RedisService } from '@app/redis'
import {
  DIRTY_CONVERSATIONS_KEY,
  SET_NEWEST_ID_SCRIPT,
  lastMessageKey,
  unreadCountKey,
  unreadLastKey,
} from '../background-jobs/unread/unread.constants'
import type {
  CallEndedPayload,
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
import { buildKeysetCursor, parseKeysetCursor } from '@app/util'

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

export interface GroupCallLogRequest {
  conversationId: string
  participantCount: number
  durationSeconds: number
  callId?: string
  callType?: 'audio' | 'video'
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

    const content = data.text?.trim() || null
    const medias = data.medias || []

    // A message needs to carry something: text, attachments, or both. It used
    // to be one or the other — a caption alongside files was impossible, and so
    // was attaching an image and a document in the same message, because every
    // attachment was validated against a single message-level type.
    if (!content && medias.length === 0) {
      ChatErrors.invalidMessagePayload()
    }

    let type = this.messageMediaService.normalizeMessageType(
      data.type || 'TEXT',
    )

    if (medias.length) {
      const normalizedMedias = medias.map((media) => {
        const fileName = String(media.objectKey || '').split('/').pop() || ''
        const resolvedMimeType = this.messageMediaService.resolveMimeType(
          fileName,
          media.mimeType,
        )
        // The kind is derived from the resolved mime, never taken from the
        // client: `mediaType` arrives over the socket and must not be able to
        // talk an image past the document rules.
        const resolvedKind =
          this.messageMediaService.inferMediaKind(resolvedMimeType)

        return {
          ...media,
          mimeType: resolvedMimeType,
          mediaType: resolvedKind,
        }
      })

      await Promise.all(
        normalizedMedias.map(async (media) => {
          const fileName = String(media.objectKey || '').split('/').pop() || ''
          // 'TEXT' makes the validator infer the kind per attachment, so a
          // mixed batch is checked against the right allow-list and size cap
          // for each file rather than for whatever the message as a whole is.
          this.messageMediaService.validateMimeAndSize(
            'TEXT',
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

      // Stored kind: the common one when every attachment agrees, otherwise
      // FILE as the umbrella. Rendering keys off each media anyway.
      const kinds = new Set(normalizedMedias.map((m) => m.mediaType))
      type = (kinds.size === 1 ? [...kinds][0] : 'FILE') as typeof type
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

    // Replies are rare next to plain messages, so the quoted message is fetched
    // here instead of through an `include` that would run for every send.
    if (data.replyToMessageId) {
      const [quoted] = await this.messageRepo.findQuotedByIds([
        data.replyToMessageId,
      ])
      // Only quote something from this same conversation: the id arrives from
      // the client and must not become a way to read another thread.
      if (quoted && String(quoted.conversationId) === String(data.conversationId)) {
        ;(message as any).replyTo = quoted
      }
    }

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
    const cursor = parseKeysetCursor(params.cursor)

    const messages =
      await this.messageRepo.findByConversationIdPaginatedForUser(
        conversationId,
        userId,
        take,
        cursor,
      )

    await this.attachQuotedMessages(messages)

    return {
      messages: messages.map((m) => MessageMapper.toResponse(m)),
    }
  }

  /**
   * Fill in `replyTo` for a page of messages with one extra query.
   *
   * Without this a reply rendered as a bare id: the client cannot show the
   * quote unless the original happens to be on screen, which stops being true
   * as soon as the thread is scrolled.
   */
  private async attachQuotedMessages(messages: any[]) {
    const ids = messages
      .map((m) => m.replyToMessageId)
      .filter((id): id is string => Boolean(id))

    if (!ids.length) return

    const quoted = await this.messageRepo.findQuotedByIds(ids)
    const byId = new Map(quoted.map((q) => [String(q.id), q]))

    for (const message of messages) {
      if (!message.replyToMessageId) continue
      const original = byId.get(String(message.replyToMessageId))
      if (original && String(original.conversationId) === String(message.conversationId)) {
        message.replyTo = original
      }
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
    const cursor = parseKeysetCursor(params.cursor)

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

    const last = messages[messages.length - 1]
    const nextCursor =
      messages.length === take && last?.createdAt
        ? buildKeysetCursor(last.createdAt, last.id)
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

  /**
   * Write a finished call into the conversation.
   *
   * Calls used to leave no trace: no record of who called whom, when, whether
   * it was answered, or how long it lasted — so a missed call was invisible
   * the moment the ringing screen closed.
   */
  async recordCallOutcome(data: CallEndedPayload) {
    const { conversationId, callerId, calleeId, outcome } = data
    if (!conversationId || !callerId) return

    const members = await this.memberRepo.findByConversationId(conversationId)
    const isMember = (id: string) => members.some((m) => m.userId === id)
    // The ids arrive over a socket; refuse to write into a thread the parties
    // are not part of.
    if (!isMember(callerId) || (calleeId && !isMember(calleeId))) return

    const seconds = Math.max(0, Math.floor(Number(data.durationSeconds) || 0))
    const text = this.describeCallOutcome(outcome, seconds, data.callType ?? 'audio')

    await this.createSystemMessageAndSync(conversationId, callerId, text)
  }

  /**
   * Ghi một tin hệ thống tổng kết cuộc gọi nhóm khi phòng LiveKit đóng
   * (webhook room_finished do gateway chuyển tiếp).
   *
   * Không tự ném 500: id hỏng -> 400; hội thoại đã biến mất / không còn thành
   * viên -> `{ ok: false }` để webhook LiveKit không phải retry vô ích.
   */
  async logGroupCall(data: GroupCallLogRequest): Promise<{ ok: boolean }> {
    const conversationId = data?.conversationId?.trim()

    if (!conversationId || !this.isObjectId(conversationId)) {
      ChatErrors.invalidGroupCallLog()
    }

    // Không có ConversationRepository ở service này; danh sách thành viên ACTIVE
    // rỗng đồng nghĩa không còn hội thoại để ghi vào (hoặc chưa từng có), nên
    // trả ok:false thay vì cố tạo tin mồ côi.
    const members = await this.memberRepo.findByConversationId(conversationId)
    if (!members.length) {
      return { ok: false }
    }

    // Chốt idempotency: webhook LiveKit có thể gửi lại cùng một callId. Ai giành
    // được key trước mới ghi tin; lần trùng thấy claimOnce trả false thì coi như
    // đã ghi rồi và trả ok:true mà không tạo tin thứ hai. Bỏ trống callId ->
    // giữ nguyên hành vi cũ (payload cũ vẫn chạy).
    if (data.callId) {
      const won = await this.redisService.claimOnce(
        'chat:groupcalllog:' + data.callId,
        86400,
      )
      if (!won) {
        return { ok: true }
      }
    }

    const durationSeconds = Math.max(
      0,
      Math.floor(Number(data.durationSeconds) || 0),
    )
    const participantCount = Math.max(
      0,
      Math.floor(Number(data.participantCount) || 0),
    )
    const text = this.describeGroupCall(
      participantCount,
      durationSeconds,
      data.callType ?? 'audio',
    )

    // Tin hệ thống hiển thị dưới tên "System" (createSystemMessageAndSync gán
    // sẵn), nên actor chỉ cần là một thành viên hợp lệ để bản ghi có senderId
    // thuộc hội thoại — lấy người đầu danh sách.
    const actorUserId = members[0].userId
    await this.createSystemMessageAndSync(conversationId, actorUserId, text)

    return { ok: true }
  }

  private describeGroupCall(
    participantCount: number,
    seconds: number,
    callType: 'audio' | 'video' = 'audio',
  ): string {
    const minutes = Math.floor(seconds / 60)
    const rest = seconds % 60
    const duration =
      minutes > 0 ? `${minutes} phút ${rest} giây` : `${rest} giây`
    const label = callType === 'video' ? 'Cuộc gọi video nhóm' : 'Cuộc gọi nhóm'
    return `${label} — ${participantCount} người · ${duration}`
  }

  private describeCallOutcome(
    outcome: string,
    seconds: number,
    callType: 'audio' | 'video' = 'audio',
  ): string {
    // Audio giữ nguyên "Cuộc gọi thoại"; video đổi thành "Cuộc gọi video".
    const label = callType === 'video' ? 'Cuộc gọi video' : 'Cuộc gọi thoại'

    if (outcome === 'REJECTED') return `${label} bị từ chối`
    if (outcome === 'MISSED') return `${label} nhỡ`
    if (outcome === 'UNREACHABLE') return `${label} không kết nối được`

    if (seconds <= 0) return `${label} đã kết thúc`

    const minutes = Math.floor(seconds / 60)
    const rest = seconds % 60
    const duration =
      minutes > 0 ? `${minutes} phút ${rest} giây` : `${rest} giây`
    return `${label} đã kết thúc — ${duration}`
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
      isSystem: true,
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

    const commands: (string | number)[][] = []

    // Id tin mới nhất theo người gửi: cron dùng nó để KHÔNG cộng unread cho
    // người đã đọc tới tin này. "Chỉ ghi khi lớn hơn" (Lua) để lệnh tới trễ
    // không kéo lùi. Đặt TRƯỚC HINCRBY: nếu lượt claim của cron lỡ chen vào
    // giữa pipeline (hiếm — Redis thường chạy liền cả gói), thà đếm dư một tin
    // (lần đọc sau tự lành) còn hơn đếm thiếu (người nhận mất badge).
    const messageId = String(message.id ?? '').toLowerCase()
    if (this.isObjectId(messageId)) {
      commands.push([
        'eval',
        SET_NEWEST_ID_SCRIPT,
        1,
        unreadLastKey(conversationId),
        senderId,
        messageId,
      ])
    }

    // Một round-trip cho cả gói. SADD đặt CUỐI để khi cron pop được id ra thì
    // dữ liệu đã nằm sẵn trong Redis.
    commands.push(
      ['hincrby', unreadCountKey(conversationId), senderId, 1],
      ['set', lastMessageKey(conversationId), lastMessage],
      ['sadd', DIRTY_CONVERSATIONS_KEY, conversationId],
    )

    void this.redisService
      .pipeline(commands)
      .then((results) => {
        // Pipeline không reject khi MỘT lệnh lỗi (vd. script hỏng): lỗi nằm
        // trong từng phần tử kết quả, phải tự soi.
        const failed = (results ?? []).find(([error]) => error)
        if (failed) {
          this.logger.error(
            '[chat-service] unread pipeline command failed',
            failed[0],
          )
        }
      })
      .catch((error) => {
        this.logger.error('[chat-service] unread pipeline failed', error)
      })
  }
}
