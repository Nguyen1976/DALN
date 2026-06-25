import { DynamicModule, Module } from '@nestjs/common'
import { S3StorageService } from './s3-storage.service'
import {
  S3_STORAGE_CONFIG,
  type S3StorageConfig,
} from './s3-storage.constants'

export { S3_STORAGE_CONFIG, type S3StorageConfig } from './s3-storage.constants'

@Module({})
export class S3StorageModule {
  static forRoot(config: S3StorageConfig): DynamicModule {
    return {
      module: S3StorageModule,
      providers: [
        {
          provide: S3_STORAGE_CONFIG,
          useValue: config,
        },
        S3StorageService,
      ],
      exports: [S3StorageService],
    }
  }
}
