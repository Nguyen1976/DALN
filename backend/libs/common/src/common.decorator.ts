import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common'
import { Request } from 'express'

export const RequireLogin = () => SetMetadata('without-login', false)

export const WithoutLogin = () => SetMetadata('without-login', true)

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