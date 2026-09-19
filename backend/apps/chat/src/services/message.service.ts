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
  PollRepository,
  type MemberRow,
} from '../repositories'
import { ChatErrors } from '../errors/chat.errors'
import { ChatEventsPublisher } from '../rmq/publishers/chat-events.publisher'
import type { AssetKind, UploadType } from '../http/chat-http.dto'
import { resolveMentions } from '../domain/mention.resolver'
import { MessageMapper } from '../domain/message.mapper'
import { MessageMediaService } from './message-media.service'
import {
  buildKeysetCursor,
  displayNameOf,
  isObjectId,
  parseKeysetCursor,
  toPage,
} from '@app/util'

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
  participantCount?: number
  durationSeconds?: number
  callId?: string
  callType?: 'audio' | 'video'
  /** Người mở phòng — senderId của tin log để căn phải/trái như tin nhắn. */
  startedBy?: string
}

/** Call timings arrive as floats (LiveKit) and are shown in whole units. */
const wholeNonNegative = (value: number | undefined) =>
  Number.isFinite(value) ? Math.max(0, Math.floor(value!)) : 0

/** Who a message is shown as coming from. */
type Sender = Pick<MemberRow, 'userId'> &
  Partial<Pick<MemberRow, 'username' | 'fullName' | 'avatar'>>

/** System messages carry a placeholder sender for the conversation list. */
const systemSender = (userId: string): Sender => ({
  userId,
  fullName: 'System',
  username: 'System',
  avatar: null,
})

type OutboundMessage = {
  id?: string
  createdAt: Date
  content?: string | null
  type?: string
  poll?: { question?: string } | null
  isRevoked?: boolean
  senderMember?: Sender
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
    private readonly pollRepo: PollRepository,
  ) {}

  async clearMentions(conversationId: string, userId: string) {
    const member = await this.memberRepo.findByConversationIdAndUserId(
      conversationId,
      userId,
    )
    if (!member) ChatErrors.userNotMember()
    await this.memberRepo.clearMentions(conversationId, userId)
  }

  async sendMessage(data: MessageSendPayload) {
    const conversationMembers = await this.memberRepo.findByConversationId(
      data.conversationId,
    )
    const memberIds = conversationMembers.map((cm) => cm.userId)
    const senderMember = conversationMembers.find(
      (member) => member.userId === data.senderId,
    )
    if (!senderMember) {
      ChatErrors.senderNotMember()
    }

    const content = data.content?.trim() || null
    let medias = data.medias || []
    // Nguồn sự thật là NỘI DUNG tin, KHÔNG phải id client gửi lên: xoá chữ
    // "@Alice" khỏi ô soạn thì Alice không còn bị nhắc, gõ tay "@alice" vẫn
    // tính, tên có dấu/có khoảng trắng đều khớp, và `@all` nhắc cả nhóm.
    const { userIds: mentionUserIds, mentions } = resolveMentions(
      content,
      conversationMembers,
      data.senderId,
    )

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

      medias = normalizedMedias

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
      mentionUserIds,
      mentions,
    })

    if (!message) {
      ChatErrors.invalidMessagePayload()
    }

    message.senderMember = senderMember
    if (mentionUserIds.length) {
      await this.memberRepo.markMention(
        data.conversationId,
        mentionUserIds,
        String(message.id),
      )
      // Thông báo cho người bị nhắc (badge trong chat chỉ thấy khi đang mở app).
      this.eventsPublisher.publishMentioned({
        conversationId: data.conversationId,
        messageId: String(message.id),
        senderId: data.senderId,
        senderName: displayNameOf(senderMember),
        userIds: mentionUserIds,
        preview: (content || '').slice(0, 120),
      })
    }

    // Replies are rare next to plain messages, so the quoted message is fetched
    // here instead of through an `include` that would run for every send.
    if (data.replyToMessageId) {
      const [quoted] = await this.messageRepo.findQuotedByIds([
        data.replyToMessageId,
      ])
      // Only quote something from this same conversation: the id arrives from
      // the client and must not become a way to read another thread.
      if (quoted && String(quoted.conversationId) === String(data.conversationId)) {
        message.replyTo = quoted
      }
    }

    return this.notifyMessageCreated({
      conversationId: data.conversationId,
      senderId: data.senderId,
      message,
      senderMember,
      memberIds,
      clientMessageId: data.clientMessageId,
    })
  }

  async createMessageUploadUrl(data: {
    conversationId: string
    userId: string
    type: UploadType
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

    return this.messageMediaService.createPresignedUploadUrl({
      conversationId: data.conversationId,
      userId: data.userId,
      fileName: data.fileName,
      mimeType: resolvedMimeType,
    })
  }

  async getMessagesByConversationId(
    conversationId: string,
    userId: string,
    page: { limit: number; cursor?: string },
  ) {
    const member = await this.memberRepo.findByConversationIdAndUserId(
      conversationId,
      userId,
    )
    if (!member) {
      ChatErrors.userNotMember()
    }

    const rows = await this.messageRepo.findByConversationIdPaginatedForUser(
      conversationId,
      userId,
      page.limit + 1,
      parseKeysetCursor(page.cursor),
      member.clearedHistoryAt,
    )
    const { items, nextCursor } = toPage(rows, page.limit, (m) =>
      buildKeysetCursor(m.createdAt, m.id),
    )
    await this.attachQuotedMessages(items)
    const withPolls = await this.withPollState(items, userId)

    return {
      items: withPolls.map((m) => MessageMapper.toResponse(m)),
      nextCursor,
    }
  }

  /**
   * Fill in `replyTo` for a page of messages with one extra query.
   *
   * Without this a reply rendered as a bare id: the client cannot show the
   * quote unless the original happens to be on screen, which stops being true
   * as soon as the thread is scrolled.
   */
  private async attachQuotedMessages(
    messages: { replyToMessageId: string | null; conversationId: string; replyTo?: unknown }[],
  ) {
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

  /** Each poll's voter count and the viewer's own vote, for one page. */
  private async withPollState<T extends { poll: { id: string } | null }>(
    messages: T[],
    viewerId: string,
  ) {
    const pollIds = messages.flatMap((m) => (m.poll ? [m.poll.id] : []))
    if (!pollIds.length) return messages
    const [voters, mine] = await Promise.all([
      this.pollRepo.countVotesByPoll(pollIds),
      this.pollRepo.findVotesOf(viewerId, pollIds),
    ])
    return messages.map((m) =>
      m.poll
        ? {
            ...m,
            pollState: {
              totalVoters: voters.get(m.poll.id) ?? 0,
              myOptionIds: mine.get(m.poll.id) ?? [],
            },
          }
        : m,
    )
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

    const dto = MessageMapper.toResponse(revokedMessage)
    this.eventsPublisher.publishMessageRevoked(
      {
        conversationId: data.conversationId,
        messageId: data.messageId,
        message: dto,
      },
      conversationMembers.map((member) => member.userId),
    )

    return dto
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
  }

  async clearConversationHistory(data: ClearConversationHistoryRequest) {
    const member = await this.memberRepo.findByConversationIdAndUserId(
      data.conversationId,
      data.userId,
    )

    if (!member) {
      ChatErrors.userNotMember()
    }

    await this.memberRepo.clearHistoryForMember(
      data.conversationId,
      data.userId,
      new Date(),
    )
  }

  async getConversationAssets(
    conversationId: string,
    userId: string,
    kind: AssetKind,
    page: { limit: number; cursor?: string },
  ) {
    const isMember = await this.memberRepo.findByConversationIdAndUserId(
      conversationId,
      userId,
    )

    if (!isMember) {
      ChatErrors.userNotMember()
    }

    const rows = await this.messageRepo.findConversationAssets(
      conversationId,
      kind,
      page.limit + 1,
      parseKeysetCursor(page.cursor),
    )
    const { items, nextCursor } = toPage(rows, page.limit, (m) =>
      buildKeysetCursor(m.createdAt, m.id),
    )
    return {
      items: items.map((message) => MessageMapper.toResponse(message)),
      nextCursor,
    }
  }

  async updateMessageRead(data: UpdateMessageReadPayload) {
    const { conversationId, userId, lastReadMessageId } = data

    if (!isObjectId(lastReadMessageId)) {
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

    const seconds = wholeNonNegative(data.durationSeconds)
    const callType = data.callType ?? 'audio'
    const text = this.describeCallOutcome(outcome, seconds, callType)

    await this.createCallLogAndSync(conversationId, callerId, text, {
      scope: 'direct',
      callType,
      outcome, // COMPLETED | MISSED | REJECTED | UNREACHABLE | ...
      durationSeconds: seconds,
      startedBy: callerId,
    })
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

    if (!isObjectId(conversationId)) {
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

    const durationSeconds = wholeNonNegative(data.durationSeconds)
    const participantCount = wholeNonNegative(data.participantCount)
    const callType = data.callType ?? 'audio'
    const text = this.describeGroupCall(
      participantCount,
      durationSeconds,
      callType,
    )

    // senderId = người mở phòng (nếu còn là thành viên) để client căn thẻ về phía
    // người gọi như một tin nhắn; nếu thiếu/không còn thì lấy người đầu danh sách.
    const starter = data.startedBy
    const actorUserId =
      starter && members.some((m) => m.userId === starter)
        ? starter
        : members[0].userId
    await this.createCallLogAndSync(conversationId, actorUserId, text, {
      scope: 'group',
      callType,
      outcome: 'ENDED',
      durationSeconds,
      participantCount,
      startedBy: actorUserId,
    })

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

  /** A line like "X đã thêm Y" written into the thread and announced. */
  async createSystemMessageAndSync(
    conversationId: string,
    actorUserId: string,
    text: string,
  ) {
    const message = await this.messageRepo.create({
      conversationId,
      senderId: actorUserId,
      type: 'TEXT',
      content: text,
      medias: [],
      isSystem: true,
    })
    await this.announceSystemMessage(conversationId, actorUserId, message)
  }

  /**
   * Ghi tin type=CALL kèm `callInfo` rồi đồng bộ/phát như tin hệ thống. Client
   * dùng `callInfo` để render thẻ cuộc gọi + nút Gọi lại/Tham gia lại; `content`
   * là văn bản dự phòng cho client cũ.
   */
  async createCallLogAndSync(
    conversationId: string,
    actorUserId: string,
    content: string,
    callInfo: Record<string, unknown>,
  ) {
    const message = await this.messageRepo.createCallLog({
      conversationId,
      senderId: actorUserId,
      content,
      callInfo,
    })
    await this.announceSystemMessage(conversationId, actorUserId, message)
  }

  private async announceSystemMessage(
    conversationId: string,
    actorUserId: string,
    message: OutboundMessage | null,
  ) {
    if (!message) return

    const members = await this.memberRepo.findByConversationId(conversationId)
    const memberIds = members.map((member) => member.userId)

    this.enqueueConversationSyncJob({
      conversationId,
      senderId: actorUserId,
      message,
      senderMember: systemSender(actorUserId),
    })

    const dto = MessageMapper.toResponse(message)
    this.eventsPublisher.publishSystemMessage(memberIds, dto)
    this.eventsPublisher.publishMessageSent(dto, memberIds)
  }

  notifyMessageCreated(params: {
    conversationId: string
    senderId: string
    message: OutboundMessage
    senderMember: Sender
    memberIds: string[]
    /** The sender's id for its optimistic copy, echoed on the ack. */
    clientMessageId?: string
  }) {
    const { conversationId, senderId, message, senderMember, memberIds } =
      params

    this.enqueueConversationSyncJob({
      conversationId,
      senderId,
      message,
      senderMember,
    })

    const dto = MessageMapper.toResponse({
      ...message,
      clientMessageId: params.clientMessageId,
    })
    this.eventsPublisher.publishMessageSent(dto, memberIds)
    return dto
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
    senderMember: Sender
  }) {
    const { conversationId, senderId, message, senderMember } = params

    const lastMessage = JSON.stringify({
      senderId,
      lastMessageId: message.id,
      lastMessageAt: message.createdAt
        ? new Date(message.createdAt).toISOString()
        : undefined,
      lastMessageText: MessageMapper.previewText(message),
      lastMessageSenderName: displayNameOf(senderMember) || senderId,
      lastMessageSenderAvatar: senderMember.avatar || null,
    })

    const commands: (string | number)[][] = []

    // Id tin mới nhất theo người gửi: cron dùng nó để KHÔNG cộng unread cho
    // người đã đọc tới tin này. "Chỉ ghi khi lớn hơn" (Lua) để lệnh tới trễ
    // không kéo lùi. Đặt TRƯỚC HINCRBY: nếu lượt claim của cron lỡ chen vào
    // giữa pipeline (hiếm — Redis thường chạy liền cả gói), thà đếm dư một tin
    // (lần đọc sau tự lành) còn hơn đếm thiếu (người nhận mất badge).
    const messageId = String(message.id ?? '').toLowerCase()
    if (isObjectId(messageId)) {
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
