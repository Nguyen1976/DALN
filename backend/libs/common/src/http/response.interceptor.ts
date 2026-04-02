import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common'
import type { Response } from 'express'
import { map, Observable } from 'rxjs'

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<
  T,
  {
    statusCode: number
    status: 'success'
    message: string
    timestamp: string
    data: T
  }
> {
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<{
    statusCode: number
    status: 'success'
    message: string
    timestamp: string
    data: T
  }> {
    const response = context.switchToHttp().getResponse<Response>()
    const request = context.switchToHttp().getRequest()
    const statusCode = response.statusCode
    if (request.url === '/metrics') {
      return next.handle()
      // Trả về dữ liệu gốc (chuỗi văn bản) mà không bọc JSON
    }
    return next.handle().pipe(
      map((data) => ({
        statusCode,
        status: 'success',
        message: 'Request Success',
        timestamp: new Date().toISOString(),
        data,
      })),
    )
  }
}
