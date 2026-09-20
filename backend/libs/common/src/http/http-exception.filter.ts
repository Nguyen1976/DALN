import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common'
import type { Response } from 'express'

@Catch()
export class AppHttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    // Filter toàn cục cũng chạy cho handler RabbitMQ (golevelup dựng handler qua
    // context của Nest, type 'rmq'). Ở đó không có HTTP response: ném lại NGUYÊN
    // lỗi để retryThenDeadLetter thấy đúng lỗi (NonRetryableError -> dead-letter
    // ngay), thay vì TypeError "response.status is not a function" che mất nó.
    if (host.getType() !== 'http') throw exception

    const ctx = host.switchToHttp()
    const response = ctx.getResponse<Response>()

    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus()
      return response.status(statusCode).json(exception.getResponse())
    }

    console.error('Unhandled error:', exception)

    return response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
    })
  }
}
