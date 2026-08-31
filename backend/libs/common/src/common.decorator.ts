import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common'
import { Request } from 'express'

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

export const UserInfo = createParamDecorator(
  (data: string, ctx: ExecutionContext) => {
    const request = ctx
      .switchToHttp()
      .getRequest<Request & { user?: Record<string, any> }>()
    if (!request.user) return null
    return data ? request.user[data] : request.user
  },
)

export const IS_TRANSFORM_KEY = 'isTransform';
export const NoTransform = () => SetMetadata(IS_TRANSFORM_KEY, true);