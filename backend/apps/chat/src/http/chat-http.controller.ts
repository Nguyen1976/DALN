import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import type { Multer } from 'multer'
import { ChatService } from '../chat.service'
import {
  AddMemberToConversationDTO,
  CreateConversationDTO,
  CreateMessageUploadUrlDTO,
  DeleteConversationDTO,
  LeaveConversationDTO,
  ReadMessageDto,
  RemoveMemberFromConversationDTO,
} from './chat-http.dto'
import { RequireLogin, UserInfo } from '@app/common/common.decorator'
import { ConversationMapper } from '../domain/conversation.mapper'
import { ConversationAssetKind, MessageType } from 'interfaces/chat.grpc'

@Controller('chat')
export class ChatHttpController {
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
    @UploadedFile() groupAvatar?: Multer.File,
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

    return ConversationMapper.toCreateConversationResponse(res)
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

    return ConversationMapper.toGetConversationsResponse(
      result.conversations,
      result.unreadMap,
    )
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

  @Post('read_message')
  @RequireLogin()
  async readMessage(@Body() data: ReadMessageDto, @UserInfo() userInfo: any) {
    return await this.chatService.readMessage({
      ...data,
      userId: userInfo.userId,
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

    return ConversationMapper.toGetConversationsResponse(
      res.conversations,
      res.unreadMap,
    )
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

    return ConversationMapper.toGetConversationByFriendIdResponse(
      res.conversation,
      res.unreadMap,
    )
  }
}
