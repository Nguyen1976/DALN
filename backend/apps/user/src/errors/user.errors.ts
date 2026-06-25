import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common'

export class UserErrors {
  static alreadyFriends(): never {
    throw new ConflictException('Users are already friends')
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

  static otpInvalidOrExpired(): never {
    throw new BadRequestException('Mã OTP không hợp lệ hoặc đã hết hạn')
  }

  static usernameAlreadyExists(): never {
    throw new ConflictException('Username already exists')
  }

  static userNotFound(): never {
    throw new NotFoundException('User not found')
  }

  static friendNotFound(): never {
    throw new NotFoundException('Friend not found')
  }

  static friendRequestNotFound(): never {
    throw new NotFoundException('Friend request not found')
  }

  static friendRequestAlreadyResponded(): never {
    throw new BadRequestException('Friend request already responded')
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
