import { status } from '@grpc/grpc-js'
import { RpcException } from '@nestjs/microservices'

export class UserErrors {
  static alreadyFriends(): never {
    throw new RpcException({
      code: status.ALREADY_EXISTS,
      message: 'Users are already friends',
    })
  }

  static emailAlreadyExists(): never {
    throw new RpcException({
      code: status.ALREADY_EXISTS,
      message: 'Email đã được sử dụng',
    })
  }

  static invalidCredentials(): never {
    throw new RpcException({
      code: status.UNAUTHENTICATED,
      message: 'Email hoặc mật khẩu không chính xác',
    })
  }

  static accountNotActivated(): never {
    throw new RpcException({
      code: status.FAILED_PRECONDITION,
      message: 'Tài khoản chưa kích hoạt. Vui lòng xác thực OTP',
    })
  }

  static otpInvalidOrExpired(): never {
    throw new RpcException({
      code: status.INVALID_ARGUMENT,
      message: 'Mã OTP không hợp lệ hoặc đã hết hạn',
    })
  }

  static usernameAlreadyExists(): never {
    throw new RpcException({
      code: status.ALREADY_EXISTS,
      message: 'Username already exists',
    })
  }

  static userNotFound(): never {
    throw new RpcException({
      code: status.NOT_FOUND,
      message: 'User not found',
    })
  }

  static friendNotFound(): never {
    throw new RpcException({
      code: status.NOT_FOUND,
      message: 'Friend not found',
    })
  }

  static friendRequestNotFound(): never {
    throw new RpcException({
      code: status.NOT_FOUND,
      message: 'Friend request not found',
    })
  }

  static friendRequestAlreadyResponded(): never {
    throw new RpcException({
      code: status.FAILED_PRECONDITION,
      message: 'Friend request already responded',
    })
  }
}
