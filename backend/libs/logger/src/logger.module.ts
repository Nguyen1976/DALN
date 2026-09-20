// libs/logger/src/logger.module.ts
import { DynamicModule, Global, Module } from '@nestjs/common'
import { LoggerService } from './logger.service'
import { createLogger } from './logger.factory'

@Global()
@Module({})
export class LoggerModule {
  static forService(serviceName: string): DynamicModule {
    return {
      module: LoggerModule,
      providers: [
        {
          provide: 'WINSTON_LOGGER',
          useValue: createLogger(serviceName),
        },
        LoggerService,
      ],
      exports: [LoggerService],
    }
  }
}
