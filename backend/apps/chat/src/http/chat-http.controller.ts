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
  ConversationAssetKind,
  CreateConversationDTO,
  CreateMessageUploadUrlDTO,
  DeleteConversationDTO,
  LeaveConversationDTO,
  MessageType,
  RemoveMemberFromConversationDTO,
} from './chat-http.dto'
import { RequireLogin, UserInfo } from '@app/common/common.decorator'
import { ConversationMapper } from '../domain/conversation.mapper'

@Controller('chat')
export class ChatHttpController {
  constructor(private readonly chatService: ChatService) {}

 
}
