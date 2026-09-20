import { displayNameOf } from '@app/util'
import type { message, messageMedia, poll } from '../generated'

/**
 * A poll as clients receive it — the same shape inside a message, in answer
 * to a vote or a close, and on the poll events. `myOptionIds` is the
 * viewer's own vote: present where the viewer is known (their thread, their
 * vote), absent on events that go to everyone.
 */
export interface PollDto {
  id: string
  question: string
  isMultipleChoice: boolean
  isClosed: boolean
  closedAt: string | null
  options: { id: string; text: string; count: number }[]
  totalVoters: number
  myOptionIds?: string[]
}

/** The poll counts that depend on who is asking (see PollDto). */
export interface PollState {
  totalVoters?: number
  myOptionIds?: string[]
}

export function toPollDto(
  poll: Pick<
    poll,
    'id' | 'question' | 'isMultipleChoice' | 'isClosed' | 'closedAt' | 'options'
  >,
  state: PollState = {},
): PollDto {
  return {
    id: poll.id,
    question: poll.question,
    isMultipleChoice: poll.isMultipleChoice,
    isClosed: poll.isClosed,
    closedAt: poll.closedAt?.toISOString() ?? null,
    options: poll.options.map(({ id, text, count }) => ({ id, text, count })),
    totalVoters: state.totalVoters ?? 0,
    ...(state.myOptionIds ? { myOptionIds: state.myOptionIds } : {}),
  }
}

type Person = {
  userId: string
  username?: string | null
  fullName?: string | null
  avatar?: string | null
}

/** A message another one quotes, as MessageRepository.findQuotedByIds reads it. */
type QuotedMessage = Pick<
  message,
  'id' | 'senderId' | 'content' | 'type' | 'isRevoked'
> & {
  senderMember?: Person | null
  medias?: Pick<
    messageMedia,
    'mediaType' | 'fileName' | 'url' | 'mimeType' | 'thumbnailUrl'
  >[]
}

/**
 * A message row, with whatever came along with it. Only the columns are
 * certain: a fresh text message has no relations loaded (it went through
 * the batch writer), a thread page has them all.
 */
export type MessageRow = Pick<
  message,
  'id' | 'conversationId' | 'senderId' | 'createdAt'
> &
  Partial<
    Pick<
      message,
      | 'content'
      | 'type'
      | 'mentionUserIds'
      | 'replyToMessageId'
      | 'isRevoked'
      | 'isSystem'
      | 'isDeleted'
    >
  > & {
    /** Stored as JSON, and passed on to clients as it was stored. */
    mentions?: unknown
    callInfo?: unknown
    senderMember?: Person | null
    replyTo?: QuotedMessage | null
    medias?: Omit<messageMedia, 'messageId' | 'createdAt'>[]
    poll?: Parameters<typeof toPollDto>[0] | null
    pollState?: PollState
    /** Only on the sender's own copy, to match it with the optimistic one. */
    clientMessageId?: string
  }

/**
 * What a reply bubble needs of the quoted message's first attachment. Kept
 * flat (rather than a nested object) so the fields that already shipped —
 * `attachmentName` — stay where clients look for them.
 */
function quotedAttachmentOf(
  media: NonNullable<QuotedMessage['medias']>[number] | undefined,
) {
  if (!media) return {}
  return {
    attachmentName: media.fileName || undefined,
    attachmentType: media.mediaType || undefined,
    attachmentUrl: media.url || undefined,
    attachmentMimeType: media.mimeType || undefined,
    attachmentThumbnailUrl: media.thumbnailUrl || undefined,
  }
}

export class MessageMapper {
  /**
   * The message as clients receive it. What is real work here: BigInt sizes
   * become strings (JSON has no BigInt), a revoked message loses its text,
   * and the quoted message is flattened to what a reply bubble shows.
   */
  static toResponse(message: MessageRow) {
    return {
      id: String(message.id),
      conversationId: String(message.conversationId),
      senderId: String(message.senderId),
      content: message.isRevoked ? '' : (message.content ?? '').trim(),
      type: message.type || 'TEXT',
      /** Resolved from the content by the server. */
      mentionUserIds: message.mentionUserIds ?? [],
      mentions: message.mentions ?? undefined,
      // Tin type=CALL: dữ liệu để client render thẻ cuộc gọi + nút gọi lại.
      callInfo: message.callInfo ?? undefined,
      /** Only on the sender's own copy, to match it with the optimistic one. */
      clientMessageId: message.clientMessageId,
      replyToMessageId: message.replyToMessageId || undefined,
      // Quoted message, flattened to exactly what a reply bubble needs. Sending
      // only the id would force the client to have the original already loaded,
      // which is not true once the thread has been scrolled.
      replyTo: message.replyTo
        ? {
            id: String(message.replyTo.id),
            senderId: String(message.replyTo.senderId),
            senderName: message.replyTo.senderMember
              ? displayNameOf(message.replyTo.senderMember)
              : '',
            content: message.replyTo.isRevoked
              ? ''
              : (message.replyTo.content ?? '').trim(),
            type: message.replyTo.type || 'TEXT',
            isRevoked: Boolean(message.replyTo.isRevoked),
            // The first attachment, flattened: a reply to a photo shows the
            // photo, not its file name, so the URL travels with the quote.
            // Revoked originals send nothing — there is no picture any more.
            ...(message.replyTo.isRevoked
              ? {}
              : quotedAttachmentOf(message.replyTo.medias?.[0])),
          }
        : undefined,
      isRevoked: Boolean(message.isRevoked),
      isSystem: Boolean(message.isSystem),
      isDeleted: Boolean(message.isDeleted),
      createdAt: new Date(message.createdAt).toISOString(),
      senderMember: message.senderMember
        ? toSender(message.senderMember)
        : undefined,
      medias: (message.medias ?? []).map((media) => ({
        id: media.id,
        mediaType: media.mediaType,
        objectKey: media.objectKey,
        url: media.url,
        mimeType: media.mimeType,
        size: String(media.size),
        width: media.width ?? undefined,
        height: media.height ?? undefined,
        duration: media.duration ?? undefined,
        thumbnailUrl: media.thumbnailUrl ?? undefined,
        fileName: media.fileName ?? undefined,
        sortOrder: media.sortOrder ?? undefined,
      })),
      poll: message.poll
        ? toPollDto(message.poll, message.pollState)
        : undefined,
    }
  }

  static previewText(message: {
    content?: string | null
    type?: string
    isRevoked?: boolean
    poll?: { question?: string } | null
  }) {
    if (message.isRevoked) return 'Tin nhắn đã bị thu hồi'

    const content = (message.content ?? '').trim()
    if (content) return content

    switch (message.type) {
      case 'IMAGE':
        return 'Hình ảnh'
      case 'VIDEO':
        return 'Video'
      case 'FILE':
        return 'Tệp đính kèm'
      case 'POLL':
        return `Bình chọn: ${message.poll?.question || 'Khảo sát'}`
      default:
        return ''
    }
  }
}

const toSender = (person: Person) => ({
  userId: person.userId,
  username: person.username ?? '',
  fullName: person.fullName ?? '',
  avatar: person.avatar ?? '',
})

/**
 * A message as clients receive it. Build it once, where the message is
 * produced, and pass it along as is: `toResponse` is not idempotent (a second
 * pass rebuilds `replyTo` from a `senderMember` the first pass dropped, which
 * blanked the quoted sender's name on every realtime event).
 */
export type MessageDto = ReturnType<typeof MessageMapper.toResponse>
