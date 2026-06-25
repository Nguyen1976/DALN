import {
  HttpException,
  InternalServerErrorException,
} from '@nestjs/common'

export async function safeExecute<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof HttpException) {
      throw err
    }

    console.error('🔥 Service error:', err)

    throw new InternalServerErrorException('Service temporarily unavailable')
  }
}
