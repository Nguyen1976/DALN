export class ConversationMapper {
  // Add mapping methods here as needed

  private static mapMessage(message: any) {
    if (!message) return null

    return {
      ...message,
      text: message.content || '',
      type: message.type || 'TEXT',
      clientMessageId: message.clientMessageId || undefined,
      createdAt: message.createdAt.toString(),
      medias: (message.medias || []).map((media: any) => ({
        ...media,
        size: String(media.size),
      })),
    }
  }

  private static mapConversationLastMessage(conversation: any) {
    if (conversation?.messages?.length) {
      return this.mapMessage(conversation.messages[0])
    }

    if (
      conversation?.lastMessageText === undefined &&
      conversation?.lastMessageSenderName === undefined
    ) {
      return null
    }

    return {
      id: conversation?.lastMessageId || conversation?.id,
      conversationId: conversation?.id,
      senderId: conversation?.lastMessageSenderId || '',
      text: conversation?.lastMessageText || '',
      content: conversation?.lastMessageText || '',
      type: 'TEXT',
      createdAt: conversation?.lastMessageAt
        ? conversation.lastMessageAt.toString()
        : conversation?.updatedAt?.toString?.() || new Date().toISOString(),
      senderMember: conversation?.lastMessageSenderName
        ? {
            userId: conversation?.lastMessageSenderId || '',
            username: conversation?.lastMessageSenderName || '',
            avatar: conversation?.lastMessageSenderAvatar || '',
            fullName: conversation?.lastMessageSenderName || '',
          }
        : undefined,
    }
  }

  static toGetConversationByIdResponse(res: any): any {
    return this.formatConversationResponse(res)
  }

  static toGetConversationsResponse(
    conversations,
    unreadMap: Map<string, string>,
  ) {
    return {
      conversations: conversations.map((c) => ({
        id: c.id,
        type: c.type,
        groupName: c.groupName,
        groupAvatar: c.groupAvatar,
        unreadCount: unreadMap.get(c.id) ?? '0',
        createdAt: c.createdAt.toString(),
        updatedAt: c.updatedAt.toString(),
        members: c.members.map((m) => ({
          ...m,
          userId: m.userId,
          role: m.role,
          username: m.username,
          avatar: m.avatar,
          fullName: m.fullName,
          lastReadAt: m.lastReadAt ? m.lastReadAt.toString() : null,
          lastMessageAt: m.lastMessageAt.toString(),
        })),
        lastMessage: this.mapConversationLastMessage(c),
      })),
    }
  }
  static toGetConversationByFriendIdResponse(
    conversation,
    unreadMap: Map<string, string>,
  ) {
    return {
      conversation: {
        id: conversation.id,
        type: conversation.type,
        groupName: conversation.groupName,
        groupAvatar: conversation.groupAvatar,
        unreadCount: unreadMap.get(conversation.id) ?? '0',
        createdAt: conversation.createdAt.toString(),
        updatedAt: conversation.updatedAt.toString(),
        members: conversation.members.map((m) => ({
          userId: m.userId,
          role: m.role,
          username: m.username,
          avatar: m.avatar,
          fullName: m.fullName,
          lastReadAt: m.lastReadAt?.toString() ?? null,
          lastMessageAt: m.lastMessageAt.toString(),
        })),
        lastMessage: this.mapConversationLastMessage(conversation),
      },
    }
  }

  static toCreateConversationResponse(res: any) {
    return this.formatConversationResponse(res)
  }

  // Private helper methods
  static formatConversationResponse(res: any) {
    return {
      conversation: {
        id: res?.id,
        unreadCount: '0',
        type: res?.type,
        groupName: res?.groupName,
        groupAvatar: res?.groupAvatar,
        createdAt: res?.createdAt.toString(),
        updatedAt: res?.updatedAt.toString(),
        members: res?.members.map((m: any) => ({
          ...m,
          role: m.role,
          lastReadAt: m.lastReadAt ? m.lastReadAt.toString() : '',
        })),
        lastMessage: this.mapConversationLastMessage(res),
        messages: res?.messages?.map((msg: any) => this.mapMessage(msg)) || [],
      },
    }
  }
}
