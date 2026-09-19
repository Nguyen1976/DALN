import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common'
import { Request } from 'express'
import type { JwtPayload } from './auth/resolve-tokens'

export const RequireLogin = () => SetMetadata('without-login', false)

export const WithoutLogin = () => SetMetadata('without-login', true)

/**
 * Chỉ cho phép gọi từ bên trong hệ thống (service-to-service hoặc thao tác
 * vận hành), xác thực bằng header `x-internal-token` khớp `INTERNAL_API_TOKEN`.
 * Dùng cho các endpoint không thuộc về người dùng cuối nên không có phiên JWT:
 * huấn luyện mô hình, sinh embedding, tác vụ quản trị.
 * Fail-closed: chưa cấu hình INTERNAL_API_TOKEN thì từ chối tất cả.
 */
export const InternalOnly = () => SetMetadata('internal-only', true)

/**
 * The signed-in user from the session token (`JwtPayload`), or one of its
 * fields: `@UserInfo('userId') userId: string`.
 */
export const UserInfo = createParamDecorator(
  (key: keyof JwtPayload | undefined, ctx: ExecutionContext) => {
    const request = ctx
      .switchToHttp()
      .getRequest<Request & { user?: JwtPayload }>()
    if (!request.user) return null
    return key ? request.user[key] : request.user
  },
)
