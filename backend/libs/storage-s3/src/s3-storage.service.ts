import { Inject, Injectable } from '@nestjs/common'
import {
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { S3_STORAGE_CONFIG, type S3StorageConfig } from './s3-storage.constants'

@Injectable()
export class S3StorageService {
  private readonly s3: S3Client
  /** Signs browser-facing URLs; identical to `s3` unless the storage is
   *  reachable under a different name from outside the network. */
  private readonly s3ForSigning: S3Client
  private readonly bucket: string
  private readonly cdnPublicUrl: string

  constructor(
    @Inject(S3_STORAGE_CONFIG) private readonly config: S3StorageConfig,
  ) {
    this.bucket = this.config.bucket
    this.cdnPublicUrl = this.config.cdnPublicUrl.replace(/\/+$/, '')

    this.s3 = new S3Client({
      region: this.config.region,
      ...(this.config.endpoint
        ? { endpoint: this.config.endpoint, forcePathStyle: true }
        : {}),
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      credentials: {
        accessKeyId: this.config.accessKey,
        secretAccessKey: this.config.secretKey,
      },
    })

    this.s3ForSigning = this.config.publicEndpoint
      ? new S3Client({
          region: this.config.region,
          endpoint: this.config.publicEndpoint,
          forcePathStyle: true,
          requestChecksumCalculation: 'WHEN_REQUIRED',
          responseChecksumValidation: 'WHEN_REQUIRED',
          credentials: {
            accessKeyId: this.config.accessKey,
            secretAccessKey: this.config.secretKey,
          },
        })
      : this.s3
  }

  buildPublicUrl(objectKey: string): string {
    const key = objectKey.replace(/^\/+/, '')
    return `${this.cdnPublicUrl}/${key}`
  }

  async upload({
    buffer,
    mime,
    folder = 'chat',
    ext = 'png',
  }: {
    buffer: Buffer
    mime: string
    folder?: string
    ext?: string
  }) {
    const key = `${folder}/${crypto.randomUUID()}.${ext}`
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: mime,
      }),
    )

    return this.buildPublicUrl(key)
  }

  async createPresignedUploadUrl({
    folder = 'chat-media',
    fileName,
    mime,
    expiresInSeconds = 300,
  }: {
    folder?: string
    fileName: string
    mime: string
    expiresInSeconds?: number
  }) {
    const ext = fileName.split('.').pop() || 'bin'
    const key = `${folder}/${Date.now()}-${crypto.randomUUID()}.${ext}`

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: mime,
    })

    const uploadUrl = await getSignedUrl(this.s3ForSigning, command, {
      expiresIn: expiresInSeconds,
    })

    return {
      uploadUrl,
      objectKey: key,
      publicUrl: this.buildPublicUrl(key),
      expiresInSeconds,
    }
  }

  async objectExists(objectKey: string): Promise<boolean> {
    try {
      await this.s3.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: objectKey,
        }),
      )
      return true
    } catch (error: any) {
      if (
        error instanceof NotFound ||
        error?.name === 'NotFound' ||
        error?.$metadata?.httpStatusCode === 404
      ) {
        return false
      }

      return true
    }
  }
}
