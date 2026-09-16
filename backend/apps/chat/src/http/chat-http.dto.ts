import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator'

export enum ConversationAssetKind {
  ASSET_MEDIA = 0,
  ASSET_LINK = 1,
  ASSET_DOC = 2,
  UNRECOGNIZED = -1,
}

export enum MessageType {
  TEXT = 0,
  IMAGE = 1,
  VIDEO = 2,
  FILE = 3,
  UNRECOGNIZED = -1,
}

export interface Member {
  username: string
  avatar?: string | undefined
  userId: string
  lastReadAt?: string | undefined
  fullName?: string | undefined
}

export class CreateConversationDTO {
  @IsNotEmpty()
  members: Member[]

  @IsNotEmpty()
  groupName: string
}

export class AddMemberToConversationDTO {
  @IsNotEmpty({
    message: 'conversationId is required',
  })
  conversationId: string

  @IsNotEmpty({
    message: 'memberIds is required',
  })
  memberIds: string[]

  // ValidationPipe bật whitelist; thiếu decorator khiến toàn bộ profile
  // snapshot bị loại khỏi body và controller chỉ còn memberIds.
  @IsOptional()
  @IsArray()
  members?: Member[]
}

export class RemoveMemberFromConversationDTO {
  @IsNotEmpty({
    message: 'conversationId is required',
  })
  conversationId: string

  @IsNotEmpty({
    message: 'targetUserId is required',
  })
  targetUserId: string
}

export class PromoteMemberDTO {
  @IsNotEmpty()
  @IsString()
  conversationId: string

  @IsNotEmpty()
  @IsString()
  targetUserId: string
}

export class LeaveConversationDTO {
  @IsNotEmpty({
    message: 'conversationId is required',
  })
  conversationId: string
}

export class DeleteConversationDTO {
  @IsNotEmpty({
    message: 'conversationId is required',
  })
  conversationId: string
}

export class CreateMessageUploadUrlDTO {
  @IsNotEmpty()
  conversationId: string

  @IsNotEmpty()
  type: 'IMAGE' | 'VIDEO' | 'FILE'

  @IsNotEmpty()
  mimeType: string

  @IsNotEmpty()
  fileName: string

  @IsNotEmpty()
  size: string
}

export class RevokeMessageDTO {
  @IsNotEmpty()
  conversationId: string

  @IsNotEmpty()
  messageId: string
}

export class DeleteMessageForMeDTO {
  @IsNotEmpty()
  conversationId: string

  @IsNotEmpty()
  messageId: string
}

export class ClearConversationHistoryDTO {
  @IsNotEmpty()
  conversationId: string
}

export class ClearMentionsDTO {
  @IsNotEmpty()
  @IsString()
  conversationId: string
}

export class CreatePollDTO {
  @IsNotEmpty()
  @IsString()
  conversationId: string

  @IsNotEmpty()
  @IsString()
  @MaxLength(200)
  question: string

  @IsArray()
  @ArrayMinSize(2)
  options: string[]

  @IsOptional()
  @IsBoolean()
  isMultipleChoice?: boolean
}

export class SubmitPollVoteDTO {
  @IsNotEmpty()
  @IsString()
  pollId: string

  @IsArray()
  optionIds: string[]
}

export class ClosePollDTO {
  @IsNotEmpty()
  @IsString()
  pollId: string
}

export class GroupCallLogDTO {
  @IsNotEmpty()
  @IsString()
  conversationId: string

  // Không @IsNotEmpty: participantCount/durationSeconds có thể là 0 hợp lệ. Cần
  // @IsNumber để whitelist:true không loại bỏ field khỏi body.
  @IsOptional()
  @IsNumber()
  participantCount?: number

  @IsOptional()
  @IsNumber()
  durationSeconds?: number

  @IsOptional()
  @IsString()
  callId?: string

  @IsOptional()
  @IsString()
  callType?: string

  @IsOptional()
  @IsString()
  startedBy?: string
}
