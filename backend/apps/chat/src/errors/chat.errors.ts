import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common'

export class ChatErrors {
  static conversationNotEnoughMembers(): never {
    throw new BadRequestException('A group conversation must have at least 3 members')
  }

  static userNoPermission(): never {
    throw new ForbiddenException('User has no permission to perform this action')
  }

  static senderNotMember(): never {
    throw new BadRequestException('Sender is not a member of the conversation')
  }

  static conversationNotFound(): never {
    throw new NotFoundException('Conversation not found')
  }

  static userNotMember(): never {
    throw new BadRequestException('User is not a member of the conversation')
  }

  static invalidMessagePayload(): never {
    throw new BadRequestException('Invalid message payload')
  }

  static invalidMediaType(): never {
    throw new BadRequestException('Invalid media type or mime type')
  }

  static fileSizeExceeded(): never {
    throw new BadRequestException('File size exceeded max limit')
  }

  static mediaNotUploaded(): never {
    throw new BadRequestException('Media file not found in storage')
  }

  static memberNotFoundInConversation(): never {
    throw new NotFoundException('Target user is not a member of this conversation')
  }

  static invalidMemberAction(message = 'Invalid member action'): never {
    throw new BadRequestException(message)
  }

  static adminCannotLeaveGroup(): never {
    throw new BadRequestException('Admin không thể rời nhóm. Hãy chuyển quyền admin trước.')
  }

  static messageNotFound(): never {
    throw new NotFoundException('Message not found')
  }

  static notMessageOwner(): never {
    throw new ForbiddenException('You can only perform this action on your own message')
  }

  static invalidPollPayload(message = 'Invalid poll payload'): never {
    throw new BadRequestException(message)
  }

  static pollNotAllowedInDirectChat(): never {
    throw new BadRequestException(
      'Polls are only allowed in group conversations',
    )
  }

  static pollNotFound(): never {
    throw new NotFoundException('Poll not found')
  }

  static pollAlreadyClosed(): never {
    throw new BadRequestException('Poll is already closed')
  }

  static pollCreatorOnly(): never {
    throw new ForbiddenException('Only the poll creator can close this poll')
  }
}
