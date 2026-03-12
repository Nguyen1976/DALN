import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common'
import { RpcException } from '@nestjs/microservices'
import { status as grpcStatus } from '@grpc/grpc-js'

@Catch()
export class GrpcToHttpExceptionFilter implements ExceptionFilter {
  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp()
    const response = ctx.getResponse()

    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus()
      return response.status(statusCode).json(exception.getResponse())
    }

    let code = exception?.code
    let message =
      exception?.details || exception?.message || 'Internal server error'

    if (exception instanceof RpcException) {
      const rpcError = exception.getError() as
        | string
        | { code?: number | string; message?: string; details?: string }
      if (typeof rpcError === 'string') {
        message = rpcError
      } else {
        code = rpcError?.code ?? code
        message = rpcError?.details || rpcError?.message || message
      }
    }

    const statusCode = this.mapGrpcCodeToHttpStatus(code)

    return response.status(statusCode).json({
      statusCode,
      message,
    })
  }

  private mapGrpcCodeToHttpStatus(code: number | string | undefined): number {
    switch (Number(code)) {
      case grpcStatus.NOT_FOUND:
        return HttpStatus.NOT_FOUND
      case grpcStatus.INVALID_ARGUMENT:
        return HttpStatus.BAD_REQUEST
      case grpcStatus.ALREADY_EXISTS:
        return HttpStatus.CONFLICT
      case grpcStatus.UNAVAILABLE:
        return HttpStatus.SERVICE_UNAVAILABLE
      case grpcStatus.DEADLINE_EXCEEDED:
        return HttpStatus.GATEWAY_TIMEOUT
      case grpcStatus.PERMISSION_DENIED:
        return HttpStatus.FORBIDDEN
      case grpcStatus.UNAUTHENTICATED:
        return HttpStatus.UNAUTHORIZED
      case grpcStatus.FAILED_PRECONDITION:
        return HttpStatus.BAD_REQUEST
      default:
        return HttpStatus.INTERNAL_SERVER_ERROR
    }
  }
}
