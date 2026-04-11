import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Param,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common'
import { ChatService } from './chat.service'
import { FileInterceptor } from '@nestjs/platform-express/multer/interceptors/file.interceptor'
import { RequireLogin, UserInfo } from '@app/common/common.decorator'
import {
  CreateConversationDTO,
  AddMemberToConversationDTO,
  RemoveMemberFromConversationDTO,
  LeaveConversationDTO,
  DeleteConversationDTO,
  CreateMessageUploadUrlDTO,
  ConversationAssetKind,
  MessageType,
} from './http/chat-http.dto'

// Reusable response formatters
const formatMessage = (message: any) => {
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

const formatConversationLastMessage = (c: any) => {
  if (c?.messages?.length) {
    return formatMessage(c.messages[0])
  }

  if (
    c?.lastMessageText === undefined &&
    c?.lastMessageSenderName === undefined
  ) {
    return null
  }

  return {
    id: c?.lastMessageId || c?.id,
    conversationId: c?.id,
    senderId: c?.lastMessageSenderId || '',
    text: c?.lastMessageText || '',
    content: c?.lastMessageText || '',
    type: 'TEXT',
    createdAt: c?.lastMessageAt
      ? c.lastMessageAt.toString()
      : c?.updatedAt?.toString?.() || new Date().toISOString(),
    senderMember:
      c?.lastMessageSenderName || c?.lastMessageSenderAvatar
        ? {
            userId: c?.lastMessageSenderId || '',
            username: c?.lastMessageSenderName || '',
            avatar: c?.lastMessageSenderAvatar || '',
            fullName: c?.lastMessageSenderName || '',
          }
        : undefined,
  }
}

const formatConversationSummary = (c: any, userId?: string) => ({
  id: c.id,
  type: c.type,
  groupName: c.groupName,
  groupAvatar: c.groupAvatar,
  memberCount: c.memberCount ?? c.members?.length ?? 0,
  unreadCount: resolveUnreadCount(c, userId),
  createdAt: c.createdAt.toString(),
  updatedAt: c.updatedAt.toString(),
  lastMessageAt: c.lastMessageAt ? c.lastMessageAt.toString() : null,
  lastMessageText: c.lastMessageText || '',
  lastMessageSenderId: c.lastMessageSenderId || null,
  lastMessageSenderName: c.lastMessageSenderName || null,
  lastMessageSenderAvatar: c.lastMessageSenderAvatar || null,
})

const resolveUnreadCount = (conversation: any, userId?: string) => {
  if (
    conversation?.unreadCount !== undefined &&
    conversation?.unreadCount !== null
  ) {
    const unread = Number(conversation.unreadCount)
    if (!Number.isFinite(unread) || unread <= 0) return '0'
    return unread > 5 ? '5+' : String(unread)
  }

  if (userId && Array.isArray(conversation?.members)) {
    const me = conversation.members.find((m: any) => m.userId === userId)
    const unread = Number(me?.unreadCount || 0)
    if (!Number.isFinite(unread) || unread <= 0) return '0'
    return unread > 5 ? '5+' : String(unread)
  }

  return '0'
}

const formatConversationDetail = (c: any, userId?: string) => ({
  id: c.id,
  type: c.type,
  groupName: c.groupName,
  groupAvatar: c.groupAvatar,
  memberCount: c.memberCount ?? c.members?.length ?? 0,
  unreadCount: resolveUnreadCount(c, userId),
  createdAt: c.createdAt.toString(),
  updatedAt: c.updatedAt.toString(),
  members: c.members.map((m: any) => ({
    ...m,
    userId: m.userId,
    role: m.role,
    username: m.username,
    avatar: m.avatar,
    fullName: m.fullName,
    lastReadAt: m.lastReadAt ? m.lastReadAt.toString() : null,
    lastMessageAt: m.lastMessageAt ? m.lastMessageAt.toString() : null,
  })),
  lastMessage: formatConversationLastMessage(c),
})

@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}
  @Post('create')
  @UseInterceptors(
    FileInterceptor('groupAvatar', {
      limits: {
        fileSize: 2 * 1024 * 1024,
      },
    }),
  )
  @RequireLogin()
  async createConversation(
    @Body() dto: CreateConversationDTO,
    @UserInfo() userInfo: any,
    @UploadedFile() groupAvatar?,
  ) {
    const parsedMembers =
      typeof dto.members === 'string'
        ? JSON.parse(dto.members || '[]')
        : dto.members || []

    const res = await this.chatService.createConversation({
      ...dto,
      type: 'GROUP',
      members: [
        ...(parsedMembers as any[]),
        {
          userId: userInfo.userId,
          username: userInfo.username,
          fullName: userInfo.fullName,
        },
      ],
      createrId: userInfo.userId,
      groupAvatar: groupAvatar?.buffer,
      groupAvatarFilename: groupAvatar?.originalname,
    })

    return {
      conversation: {
        id: res?.id,
        unreadCount: '0',
        type: res?.type,
        groupName: res?.groupName,
        groupAvatar: res?.groupAvatar,
        memberCount: res?.memberCount ?? res?.members?.length ?? 0,
        createdAt: res?.createdAt.toString(),
        updatedAt: res?.updatedAt.toString(),
        members: res?.members.map((m: any) => ({
          ...m,
          role: m.role,
          lastReadAt: m.lastReadAt ? m.lastReadAt.toString() : '',
        })),
        messages: res?.messages?.map((msg: any) => formatMessage(msg)) || [],
      },
    }
  }

  @Post('add-member')
  @RequireLogin()
  async addMemberToConversation(
    @Body() body: AddMemberToConversationDTO,
    @UserInfo() userInfo: any,
  ) {
    const providedMembers = body.members || []

    const normalizedMembers: Array<{
      userId: string
      username: string
      fullName?: string
      avatar?: string
    }> =
      providedMembers.length > 0
        ? providedMembers.map((member) => ({
            userId: member.userId,
            username: member.username || '',
            fullName: member.fullName,
            avatar: member.avatar,
          }))
        : (body.memberIds || []).map((memberId) => ({
            username: '',
            userId: memberId,
          }))

    return await this.chatService.addMemberToConversation({
      conversationId: body.conversationId,
      members: normalizedMembers,
      userId: userInfo.userId,
    })
  }

  @Post('remove-member')
  @RequireLogin()
  async removeMemberFromConversation(
    @Body() body: RemoveMemberFromConversationDTO,
    @UserInfo() userInfo: any,
  ) {
    return await this.chatService.removeMemberFromConversation({
      conversationId: body.conversationId,
      targetUserId: body.targetUserId,
      userId: userInfo.userId,
    })
  }

  @Post('leave-group')
  @RequireLogin()
  async leaveConversation(
    @Body() body: LeaveConversationDTO,
    @UserInfo() userInfo: any,
  ) {
    return await this.chatService.leaveConversation({
      conversationId: body.conversationId,
      userId: userInfo.userId,
    })
  }

  @Post('delete-conversation')
  @RequireLogin()
  async deleteConversation(
    @Body() body: DeleteConversationDTO,
    @UserInfo() userInfo: any,
  ) {
    return await this.chatService.deleteConversation({
      conversationId: body.conversationId,
      userId: userInfo.userId,
    })
  }

  @Get('conversations')
  @RequireLogin()
  async getConversations(
    @UserInfo() userInfo: any,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const result = await this.chatService.getConversations(userInfo.userId, {
      limit: limit ? parseInt(limit, 10) : 20,
      cursor: cursor || null,
    })
    return result.map((conversation) =>
      formatConversationSummary(conversation, userInfo.userId),
    )
  }

  @Get('conversations/:conversationId')
  @RequireLogin()
  async getConversationById(
    @Param('conversationId') conversationId: string,
    @UserInfo() userInfo: any,
  ) {
    const result = await this.chatService.getConversationById(
      conversationId,
      userInfo.userId,
    )

    return {
      conversation: formatConversationDetail(
        result.conversation,
        userInfo.userId,
      ),
    }
  }

  @Get('messages/:conversationId')
  @RequireLogin()
  async getMessagesByConversationId(
    @Param('conversationId') conversationId: string,
    @UserInfo() userInfo: any,
    @Query('limit') limit?: string,
    @Query('page') page?: string,
    @Query('cursor') cursor?: string,
  ) {
    return await this.chatService.getMessagesByConversationId(
      conversationId,
      userInfo.userId,
      {
        limit: limit ? parseInt(limit, 10) : 20,
        page: page ? parseInt(page, 10) : 1,
        cursor: cursor || null,
      },
    )
  }

  @Get('assets')
  @RequireLogin()
  async getConversationAssets(
    @Query('conversationId') conversationId: string,
    @Query('kind') kind: 'MEDIA' | 'LINK' | 'DOC',
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
    @UserInfo() userInfo?: any,
  ) {
    const kindMap: Record<'MEDIA' | 'LINK' | 'DOC', ConversationAssetKind> = {
      MEDIA: ConversationAssetKind.ASSET_MEDIA,
      LINK: ConversationAssetKind.ASSET_LINK,
      DOC: ConversationAssetKind.ASSET_DOC,
    }

    const assetKind = ['MEDIA', 'LINK', 'DOC'].includes(kind)
      ? kindMap[kind]
      : ConversationAssetKind.ASSET_MEDIA

    return await this.chatService.getConversationAssets(
      conversationId,
      userInfo.userId,
      assetKind,
      {
        limit: limit ? parseInt(limit, 10) : 20,
        cursor: cursor || null,
      },
    )
  }

  @Post('media/presign')
  @RequireLogin()
  async createMessageUploadUrl(
    @Body() data: CreateMessageUploadUrlDTO,
    @UserInfo() userInfo: any,
  ) {
    const mapMessageType = (type: 'IMAGE' | 'VIDEO' | 'FILE') => {
      if (type === 'IMAGE') return MessageType.IMAGE
      if (type === 'VIDEO') return MessageType.VIDEO
      return MessageType.FILE
    }

    return await this.chatService.createMessageUploadUrl({
      ...data,
      userId: userInfo.userId,
      type: mapMessageType(data.type),
    })
  }

  @Get('search')
  @RequireLogin()
  async searchConversations(
    @Query('keyword') keyword: string,
    @UserInfo() userInfo: any,
  ) {
    const res = await this.chatService.searchConversations(
      userInfo.userId,
      keyword,
    )

    return {
      conversations: res.conversations.map((c) =>
        formatConversationSummary(c, userInfo.userId),
      ),
    }
  }

  @Get('conversation-by-friend')
  @RequireLogin()
  async getConversationByFriendId(
    @Query('friendId') friendId: string,
    @UserInfo() userInfo: any,
  ) {
    const res = await this.chatService.getConversationByFriendId(
      friendId,
      userInfo.userId,
    )

    return {
      conversation: formatConversationDetail(res.conversation, userInfo.userId),
    }
  }
}
