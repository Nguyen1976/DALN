import {
  HttpException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common'
import * as bcrypt from 'bcryptjs'
import { v5 as uuidv5 } from 'uuid'

@Injectable()
export class UtilService {
  async hashPassword(password: string): Promise<string> {
    const hash = await bcrypt.hash(password, 10)
    return hash
  }

  async comparePassword(password: string, hash: string): Promise<boolean> {
    const isMatch = await bcrypt.compare(password, hash)
    return isMatch
  }

  dateToTimestamp = (date: Date) => ({
    seconds: Math.floor(date.getTime() / 1000),
    nanos: (date.getTime() % 1000) * 1e6,
  })

  safeExecute = async <T>(fn: () => Promise<T>): Promise<T> => {
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

  mongoIdToUuid(mongoId: string) {
    const MY_NAMESPACE = '1b671a64-40d5-491e-99b0-da01ff1f3341'
    return uuidv5(mongoId, MY_NAMESPACE)
  }
}
