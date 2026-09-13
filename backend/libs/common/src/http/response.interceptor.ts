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
    // Interceptor toàn cục cũng bọc handler RabbitMQ (golevelup, type 'rmq'). Chỉ
    // bọc response HTTP; ngoài HTTP trả nguyên giá trị — golevelup đọc giá trị trả
    // về (vd `new Nack()`) để quyết định ack/nack, bọc lại thì thành ack.
    if (context.getType() !== 'http') return next.handle()

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
