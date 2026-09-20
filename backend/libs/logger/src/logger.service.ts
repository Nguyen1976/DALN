// libs/logger/src/logger.service.ts
import { Inject, Injectable } from '@nestjs/common'
import type { Logger } from 'winston'

@Injectable()
export class LoggerService {
  constructor(
    @Inject('WINSTON_LOGGER')
    private readonly logger: Logger,
  ) {}

  info(msg: string, meta?: Record<string, unknown>) {
    this.logger.info(msg, meta)
  }

  error(msg: string, trace?: string) {
    this.logger.error(msg + (trace ? ` | ${trace}` : ''))
  }
}
