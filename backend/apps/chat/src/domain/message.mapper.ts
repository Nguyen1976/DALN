export class MessageMapper {
  static toResponse(message: any) {
    if (!message) return null

    const text = String(message.text ?? message.content ?? '').trim()
    const createdAt =
      message.createdAt instanceof Date
        ? message.createdAt.toISOString()
        : String(message.createdAt ?? new Date().toISOString())

    return {
      id: String(message.id),
      conversationId: String(message.conversationId),
      senderId: String(message.senderId),
      text: message.isRevoked ? '' : text,
      type: message.type || 'TEXT',
      clientMessageId: message.clientMessageId || message.tempMessageId || undefined,
      replyToMessageId: message.replyToMessageId || undefined,
      isRevoked: Boolean(message.isRevoked),
      isDeleted: Boolean(message.isDeleted),
      createdAt,
      senderMember: message.senderMember
        ? {
            userId: message.senderMember.userId,
            username: message.senderMember.username || '',
            fullName: message.senderMember.fullName || '',
            avatar: message.senderMember.avatar || '',
          }
        : undefined,
      medias: (message.medias || []).map((media: any) => ({
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
        sortOrder: media.sortOrder ?? undefined,
      })),
      poll: message.poll
        ? {
            id: message.poll.id,
            question: message.poll.question,
            isMultipleChoice: Boolean(message.poll.isMultipleChoice),
            isClosed: Boolean(message.poll.isClosed),
            closedAt: message.poll.closedAt
              ? message.poll.closedAt instanceof Date
                ? message.poll.closedAt.toISOString()
                : String(message.poll.closedAt)
              : null,
            options: (message.poll.options || []).map((option: any) => ({
              id: option.id,
              text: option.text,
              count: Number(option.count || 0),
            })),
          }
        : undefined,
    }
  }

  static previewText(message: {
    content?: string | null
    text?: string | null
    type?: string
    isRevoked?: boolean
    poll?: { question?: string } | null
  }) {
    if (message.isRevoked) return 'Tin nhắn đã bị thu hồi'

    const content = String(message.text ?? message.content ?? '').trim()
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
