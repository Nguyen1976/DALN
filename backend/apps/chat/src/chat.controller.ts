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
import { FileInterceptor } from '@nestjs/platform-express/multer/interceptors/file.interceptor'
import {
  InternalOnly,
  RequireLogin,
  UserInfo,
} from '@app/common/common.decorator'
import {
  AddMemberToConversationDTO,
  AssetsQueryDTO,
  ClearConversationHistoryDTO,
  ClearMentionsDTO,
  ClosePollDTO,
  CreateConversationDTO,
  CreateMessageUploadUrlDTO,
  CreatePollDTO,
  DeleteConversationDTO,
  DeleteMessageForMeDTO,
  GroupCallLogDTO,
  LeaveConversationDTO,
  PromoteMemberDTO,
  RemoveMemberFromConversationDTO,
  RevokeMessageDTO,
  SubmitPollVoteDTO,
} from './http/chat-http.dto'
import { ConversationMapper } from './domain/conversation.mapper'
import { PageQueryDto } from '@app/common/http/page-query.dto'
import type { MultipartFile } from '@app/common/http/multipart-file'
import {
  ConversationMemberService,
  ConversationService,
  MessageService,
  PollService,
} from './services'

/**
 * HTTP entry points. Each handler validates through its DTO, takes the
 * caller's id from the session, and hands off to the service that owns the
 * work — no reshaping of input here.
 */
@Controller('chat')
export class ChatController {
  constructor(
    private readonly conversations: ConversationService,
    private readonly members: ConversationMemberService,
    private readonly messages: MessageService,
    private readonly polls: PollService,
  ) {}

  @Post('mentions/clear')
  @RequireLogin()
  clearMentions(
    @Body() dto: ClearMentionsDTO,
    @UserInfo('userId') userId: string,
  ) {
    return this.messages.clearMentions(dto.conversationId, userId)
  }

  @Post('create')
  @UseInterceptors(
    FileInterceptor('groupAvatar', { limits: { fileSize: 2 * 1024 * 1024 } }),
  )
  @RequireLogin()
  async createConversation(
    @Body() dto: CreateConversationDTO,
    @UserInfo('userId') userId: string,
    @UploadedFile() groupAvatar?: MultipartFile,
  ) {
    const conversation = await this.conversations.createGroup(userId, {
      groupName: dto.groupName,
      memberIds: dto.memberIds,
      avatar: groupAvatar
        ? { buffer: groupAvatar.buffer, filename: groupAvatar.originalname }
        : undefined,
    })
    return ConversationMapper.toDetail(conversation, userId)
  }

  @Post('add-member')
  @RequireLogin()
  addMemberToConversation(
    @Body() dto: AddMemberToConversationDTO,
    @UserInfo('userId') userId: string,
  ) {
    return this.members.addMemberToConversation({ ...dto, userId })
  }

  @Post('remove-member')
  @RequireLogin()
  removeMemberFromConversation(
    @Body() dto: RemoveMemberFromConversationDTO,
    @UserInfo('userId') userId: string,
  ) {
    return this.members.removeMemberFromConversation({ ...dto, userId })
  }

  @Post('promote-member')
  @RequireLogin()
  promoteMember(
    @Body() dto: PromoteMemberDTO,
    @UserInfo('userId') userId: string,
  ) {
    return this.members.promoteMember({ ...dto, userId })
  }

  @Post('leave-group')
  @RequireLogin()
  leaveConversation(
    @Body() dto: LeaveConversationDTO,
    @UserInfo('userId') userId: string,
  ) {
    return this.members.leaveConversation({ ...dto, userId })
  }

  @Post('delete-conversation')
  @RequireLogin()
  deleteConversation(
    @Body() dto: DeleteConversationDTO,
    @UserInfo('userId') userId: string,
  ) {
    return this.conversations.deleteConversation({ ...dto, userId })
  }

  @Get('conversations')
  @RequireLogin()
  async getConversations(
    @UserInfo('userId') userId: string,
    @Query() page: PageQueryDto,
  ) {
    const { items, nextCursor } = await this.conversations.getConversations(
      userId,
      page,
    )
    return {
      items: items.map((conversation) =>
        ConversationMapper.toSummary(conversation, userId),
      ),
      nextCursor,
    }
  }

  @Get('conversations/:conversationId')
  @RequireLogin()
  async getConversationById(
    @Param('conversationId') conversationId: string,
    @UserInfo('userId') userId: string,
  ) {
    const conversation = await this.conversations.getConversationById(
      conversationId,
      userId,
    )
    return ConversationMapper.toDetail(conversation, userId)
  }

  @Get('messages/:conversationId')
  @RequireLogin()
  getMessagesByConversationId(
    @Param('conversationId') conversationId: string,
    @UserInfo('userId') userId: string,
    @Query() page: PageQueryDto,
  ) {
    return this.messages.getMessagesByConversationId(
      conversationId,
      userId,
      page,
    )
  }

  @Post('messages/revoke')
  @RequireLogin()
  revokeMessage(
    @Body() dto: RevokeMessageDTO,
    @UserInfo('userId') userId: string,
  ) {
    return this.messages.revokeMessage({ ...dto, userId })
  }

  @Post('messages/delete-for-me')
  @RequireLogin()
  deleteMessageForMe(
    @Body() dto: DeleteMessageForMeDTO,
    @UserInfo('userId') userId: string,
  ) {
    return this.messages.deleteMessageForMe({ ...dto, userId })
  }

  @Post('conversations/clear-history')
  @RequireLogin()
  clearConversationHistory(
    @Body() dto: ClearConversationHistoryDTO,
    @UserInfo('userId') userId: string,
  ) {
    return this.messages.clearConversationHistory({ ...dto, userId })
  }

  @Post('polls')
  @RequireLogin()
  createPoll(@Body() dto: CreatePollDTO, @UserInfo('userId') userId: string) {
    return this.polls.createPoll({
      ...dto,
      isMultipleChoice: Boolean(dto.isMultipleChoice),
      userId,
    })
  }

  @Post('polls/vote')
  @RequireLogin()
  submitPollVote(
    @Body() dto: SubmitPollVoteDTO,
    @UserInfo('userId') userId: string,
  ) {
    return this.polls.submitPollVote({ ...dto, userId })
  }

  @Post('polls/close')
  @RequireLogin()
  closePoll(@Body() dto: ClosePollDTO, @UserInfo('userId') userId: string) {
    return this.polls.closePoll({ ...dto, userId })
  }

  @Get('assets')
  @RequireLogin()
  getConversationAssets(
    @Query() query: AssetsQueryDTO,
    @UserInfo('userId') userId: string,
  ) {
    return this.messages.getConversationAssets(
      query.conversationId,
      userId,
      query.kind,
      query,
    )
  }

  @Post('media/presign')
  @RequireLogin()
  createMessageUploadUrl(
    @Body() dto: CreateMessageUploadUrlDTO,
    @UserInfo('userId') userId: string,
  ) {
    return this.messages.createMessageUploadUrl({ ...dto, userId })
  }

  @Get('search')
  @RequireLogin()
  async searchConversations(
    @Query('keyword') keyword: string,
    @UserInfo('userId') userId: string,
  ) {
    const result = await this.conversations.searchConversations(userId, keyword)
    return result.map((conversation) =>
      ConversationMapper.toSummary(conversation, userId),
    )
  }

  @Get('conversation-by-friend')
  @RequireLogin()
  async getConversationByFriendId(
    @Query('friendId') friendId: string,
    @UserInfo('userId') userId: string,
  ) {
    const conversation = await this.conversations.getConversationByFriendId(
      friendId,
      userId,
    )
    return ConversationMapper.toDetail(conversation, userId)
  }

  // Gateway realtime gọi liên dịch vụ để duyệt quyền gọi thoại 1-1: lời gọi
  // không có phiên JWT của người dùng nên xác thực bằng shared secret
  // `x-internal-token` (@InternalOnly), không mở ra ngoài qua Kong.
  @Get('internal/call-peer')
  @InternalOnly()
  getCallPeer(
    @Query('conversationId') conversationId: string,
    @Query('userId') userId: string,
  ) {
    return this.conversations.getCallPeer({ conversationId, userId })
  }

  // Gateway realtime duyệt quyền gọi NHÓM: trả danh sách thành viên ACTIVE để
  // gateway phát chuông và ký token LiveKit.
  @Get('internal/call-members')
  @InternalOnly()
  getCallMembers(
    @Query('conversationId') conversationId: string,
    @Query('userId') userId: string,
  ) {
    return this.conversations.getCallMembers({ conversationId, userId })
  }

  // Webhook LiveKit (qua gateway) báo phòng đóng: ghi tin hệ thống tổng kết
  // cuộc gọi nhóm vào hội thoại.
  @Post('internal/group-call-log')
  @InternalOnly()
  logGroupCall(@Body() dto: GroupCallLogDTO) {
    return this.messages.logGroupCall(dto)
  }
}
