import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator'
import { Transform } from 'class-transformer'
import { PageQueryDto } from '@app/common/http/page-query.dto'

export const ASSET_KINDS = ['MEDIA', 'LINK', 'DOC'] as const
export type AssetKind = (typeof ASSET_KINDS)[number]

export const UPLOAD_TYPES = ['IMAGE', 'VIDEO', 'FILE'] as const
export type UploadType = (typeof UPLOAD_TYPES)[number]

export class AssetsQueryDTO extends PageQueryDto {
  @IsMongoId()
  conversationId: string

  @IsIn(ASSET_KINDS)
  kind: AssetKind
}

/** Multipart forms send one id as a string and several as an array. */
const toIdList = ({ value }: { value: unknown }) =>
  Array.isArray(value) ? value : value === undefined ? value : [value]

export class CreateConversationDTO {
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  groupName: string

  /** Everyone besides the creator; names come from the user service. */
  @Transform(toIdList)
  @IsArray()
  @ArrayMaxSize(200)
  @IsMongoId({ each: true })
  memberIds: string[]
}

export class AddMemberToConversationDTO {
  @IsMongoId()
  conversationId: string

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsMongoId({ each: true })
  memberIds: string[]
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

  @IsIn(UPLOAD_TYPES)
  type: UploadType

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
  @IsIn(['audio', 'video'])
  callType?: 'audio' | 'video'

  @IsOptional()
  @IsString()
  startedBy?: string
}
