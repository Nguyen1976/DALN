import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common'

export class UserErrors {
  static cannotFriendSelf(): never {
    throw new BadRequestException('Bạn không thể tự gửi lời mời kết bạn cho chính mình')
  }

  static friendRequestAlreadyPending(): never {
    throw new ConflictException('Bạn đã gửi lời mời cho người này và đang chờ phản hồi')
  }

  static friendRequestAwaitingYourResponse(): never {
    throw new ConflictException(
      'Người này đã gửi lời mời cho bạn trước đó. Hãy vào mục Lời mời kết bạn để chấp nhận',
    )
  }

  static alreadyFriends(): never {
    throw new ConflictException('Hai người đã là bạn bè')
  }

  static emailAlreadyExists(): never {
    throw new ConflictException('Email đã được sử dụng')
  }

  static invalidCredentials(): never {
    throw new UnauthorizedException('Email hoặc mật khẩu không chính xác')
  }

  static accountNotActivated(): never {
    throw new BadRequestException('Tài khoản chưa kích hoạt. Vui lòng xác thực OTP')
  }

  static otpResendTooSoon(retryAfterSeconds: number): never {
    throw new HttpException(
      {
        message: `Vui lòng chờ ${retryAfterSeconds} giây trước khi yêu cầu mã mới`,
        error: 'Too Many Requests',
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        retryAfterSeconds,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    )
  }

  static otpInvalidOrExpired(): never {
    throw new BadRequestException('Mã OTP không hợp lệ hoặc đã hết hạn')
  }

  static usernameAlreadyExists(): never {
    throw new ConflictException('Tên người dùng đã được sử dụng')
  }

  static userNotFound(): never {
    throw new NotFoundException('Không tìm thấy người dùng')
  }

  static friendNotFound(): never {
    throw new NotFoundException('Không tìm thấy người bạn này')
  }

  static friendRequestNotFound(): never {
    throw new NotFoundException('Không tìm thấy lời mời kết bạn')
  }

  static friendRequestAlreadyResponded(): never {
    throw new BadRequestException('Lời mời kết bạn này đã được phản hồi')
  }

  static interestOnboardingAlreadyCompleted(): never {
    throw new ConflictException('Bạn đã hoàn tất bước chọn sở thích')
  }

  static invalidInterestSelection(): never {
    throw new BadRequestException(
      'Danh sách sở thích không hợp lệ. Vui lòng chọn từ danh mục có sẵn',
    )
  }

  static recommendationCatalogUnavailable(): never {
    throw new ServiceUnavailableException(
      'Không tải được danh mục sở thích, vui lòng thử lại sau',
    )
  }
}
