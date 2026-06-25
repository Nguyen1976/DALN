import { Test, TestingModule } from '@nestjs/testing'
import { S3_STORAGE_CONFIG } from './s3-storage.constants'
import { S3StorageService } from './s3-storage.service'

describe('S3StorageService', () => {
  let service: S3StorageService

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        S3StorageService,
        {
          provide: S3_STORAGE_CONFIG,
          useValue: {
            accessKey: 'test',
            secretKey: 'test',
            bucket: 'test-bucket',
            region: 'ap-southeast-1',
            cdnPublicUrl: 'https://cdn.example.com',
          },
        },
      ],
    }).compile()

    service = module.get<S3StorageService>(S3StorageService)
  })

  it('should be defined', () => {
    expect(service).toBeDefined()
  })
})
