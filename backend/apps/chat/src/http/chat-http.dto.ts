import { IsNotEmpty } from 'class-validator'

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

export class ReadMessageDto {
  @IsNotEmpty()
  conversationId: string

  @IsNotEmpty()
  lastReadMessageId: string
}
