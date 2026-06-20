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
  RevokeMessageDTO,
  DeleteMessageForMeDTO,
  ClearConversationHistoryDTO,
  CreatePollDTO,
  SubmitPollVoteDTO,
  ClosePollDTO,
} from './http/chat-http.dto'
import { ConversationMapper } from './domain/conversation.mapper'
import { MessageMapper } from './domain/message.mapper'

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

    return ConversationMapper.toCreateResponse(res, userInfo.userId)
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
      ConversationMapper.toSummary(conversation, userInfo.userId),
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
      conversation: ConversationMapper.toDetail(
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

  @Post('messages/revoke')
  @RequireLogin()
  async revokeMessage(
    @Body() body: RevokeMessageDTO,
    @UserInfo() userInfo: any,
  ) {
    const result = await this.chatService.revokeMessage({
      conversationId: body.conversationId,
      messageId: body.messageId,
      userId: userInfo.userId,
    })

    return {
      message: MessageMapper.toResponse(result.message),
    }
  }

  @Post('messages/delete-for-me')
  @RequireLogin()
  async deleteMessageForMe(
    @Body() body: DeleteMessageForMeDTO,
    @UserInfo() userInfo: any,
  ) {
    return await this.chatService.deleteMessageForMe({
      conversationId: body.conversationId,
      messageId: body.messageId,
      userId: userInfo.userId,
    })
  }

  @Post('conversations/clear-history')
  @RequireLogin()
  async clearConversationHistory(
    @Body() body: ClearConversationHistoryDTO,
    @UserInfo() userInfo: any,
  ) {
    return await this.chatService.clearConversationHistory({
      conversationId: body.conversationId,
      userId: userInfo.userId,
    })
  }

  @Post('polls')
  @RequireLogin()
  async createPoll(@Body() body: CreatePollDTO, @UserInfo() userInfo: any) {
    const result = await this.chatService.createPoll({
      conversationId: body.conversationId,
      question: body.question,
      options: body.options,
      isMultipleChoice: Boolean(body.isMultipleChoice),
      userId: userInfo.userId,
    })

    return {
      message: MessageMapper.toResponse(result.message),
      poll: result.poll,
    }
  }

  @Post('polls/vote')
  @RequireLogin()
  async submitPollVote(
    @Body() body: SubmitPollVoteDTO,
    @UserInfo() userInfo: any,
  ) {
    return await this.chatService.submitPollVote({
      pollId: body.pollId,
      optionIds: body.optionIds,
      userId: userInfo.userId,
    })
  }

  @Post('polls/close')
  @RequireLogin()
  async closePoll(@Body() body: ClosePollDTO, @UserInfo() userInfo: any) {
    return await this.chatService.closePoll({
      pollId: body.pollId,
      userId: userInfo.userId,
    })
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

    return res.map((conversation) =>
      ConversationMapper.toSummary(conversation, userInfo.userId),
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

    return {
      conversation: ConversationMapper.toDetail(res, userInfo.userId),
    }
  }
}
