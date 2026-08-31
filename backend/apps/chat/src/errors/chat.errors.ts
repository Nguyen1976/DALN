import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common'

export class ChatErrors {
  static conversationNotEnoughMembers(): never {
    throw new BadRequestException('Nhóm phải có ít nhất 3 thành viên')
  }

  static userNoPermission(): never {
    throw new ForbiddenException('Bạn không có quyền thực hiện thao tác này')
  }

  static senderNotMember(): never {
    throw new BadRequestException('Bạn không còn là thành viên của cuộc trò chuyện này')
  }

  static conversationNotFound(): never {
    throw new NotFoundException('Không tìm thấy cuộc trò chuyện')
  }

  static userNotMember(): never {
    throw new BadRequestException('Bạn không phải thành viên của cuộc trò chuyện này')
  }

  static invalidMessagePayload(): never {
    throw new BadRequestException('Nội dung tin nhắn không hợp lệ')
  }

  static invalidMediaType(): never {
    throw new BadRequestException('Định dạng tệp không được hỗ trợ')
  }

  static fileSizeExceeded(): never {
    throw new BadRequestException('Tệp vượt quá dung lượng tối đa cho phép')
  }

  static mediaNotUploaded(): never {
    throw new BadRequestException('Không tìm thấy tệp trên kho lưu trữ')
  }

  static memberNotFoundInConversation(): never {
    throw new NotFoundException('Người này không phải thành viên của cuộc trò chuyện')
  }

  static invalidMemberAction(message = 'Thao tác với thành viên không hợp lệ'): never {
    throw new BadRequestException(message)
  }

  static adminCannotLeaveGroup(): never {
    throw new BadRequestException('Admin không thể rời nhóm. Hãy chuyển quyền admin trước.')
  }

  static messageNotFound(): never {
    throw new NotFoundException('Không tìm thấy tin nhắn')
  }

  static notMessageOwner(): never {
    throw new ForbiddenException('Bạn chỉ có thể thao tác trên tin nhắn của chính mình')
  }

  static invalidPollPayload(message = 'Nội dung bình chọn không hợp lệ'): never {
    throw new BadRequestException(message)
  }

  static pollNotAllowedInDirectChat(): never {
    throw new BadRequestException(
      'Chỉ tạo được bình chọn trong nhóm trò chuyện',
    )
  }

  static pollNotFound(): never {
    throw new NotFoundException('Không tìm thấy bình chọn')
  }

  static pollAlreadyClosed(): never {
    throw new BadRequestException('Bình chọn này đã đóng')
  }

  static pollCreatorOnly(): never {
    throw new ForbiddenException('Chỉ người tạo bình chọn mới đóng được bình chọn')
  }
}
