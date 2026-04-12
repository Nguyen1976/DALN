import { status } from '@grpc/grpc-js'
import { RpcException } from '@nestjs/microservices'

export class ChatErrors {
  static conversationNotEnoughMembers(): never {
    throw new RpcException({
      code: status.FAILED_PRECONDITION,
      message: 'A group conversation must have at least 3 members',
    })
  }

  static userNoPermission(): never {
    throw new RpcException({
      code: status.PERMISSION_DENIED,
      message: 'User has no permission to perform this action',
    })
  }

  static senderNotMember(): never {
    throw new RpcException({
      code: status.FAILED_PRECONDITION,
      message: 'Sender is not a member of the conversation',
    })
  }

  static conversationNotFound(): never {
    throw new RpcException({
      code: status.NOT_FOUND,
      message: 'Conversation not found',
    })
  }

  static userNotMember(): never {
    throw new RpcException({
      code: status.FAILED_PRECONDITION,
      message: 'User is not a member of the conversation',
    })
  }

  static invalidMessagePayload(): never {
    throw new RpcException({
      code: status.INVALID_ARGUMENT,
      message: 'Invalid message payload',
    })
  }

  static invalidMediaType(): never {
    throw new RpcException({
      code: status.INVALID_ARGUMENT,
      message: 'Invalid media type or mime type',
    })
  }

  static fileSizeExceeded(): never {
    throw new RpcException({
      code: status.INVALID_ARGUMENT,
      message: 'File size exceeded max limit',
    })
  }

  static mediaNotUploaded(): never {
    throw new RpcException({
      code: status.FAILED_PRECONDITION,
      message: 'Media file not found in storage',
    })
  }

  static memberNotFoundInConversation(): never {
    throw new RpcException({
      code: status.NOT_FOUND,
      message: 'Target user is not a member of this conversation',
    })
  }

  static invalidMemberAction(message = 'Invalid member action'): never {
    throw new RpcException({
      code: status.INVALID_ARGUMENT,
      message,
    })
  }

  static adminCannotLeaveGroup(): never {
    throw new RpcException({
      code: status.FAILED_PRECONDITION,
      message: 'Admin không thể rời nhóm. Hãy chuyển quyền admin trước.',
    })
  }

  static messageNotFound(): never {
    throw new RpcException({
      code: status.NOT_FOUND,
      message: 'Message not found',
    })
  }

  static notMessageOwner(): never {
    throw new RpcException({
      code: status.PERMISSION_DENIED,
      message: 'You can only perform this action on your own message',
    })
  }

  static invalidPollPayload(message = 'Invalid poll payload'): never {
    throw new RpcException({
      code: status.INVALID_ARGUMENT,
      message,
    })
  }

  static pollNotFound(): never {
    throw new RpcException({
      code: status.NOT_FOUND,
      message: 'Poll not found',
    })
  }

  static pollAlreadyClosed(): never {
    throw new RpcException({
      code: status.FAILED_PRECONDITION,
      message: 'Poll is already closed',
    })
  }

  static pollCreatorOnly(): never {
    throw new RpcException({
      code: status.PERMISSION_DENIED,
      message: 'Only the poll creator can close this poll',
    })
  }
}
