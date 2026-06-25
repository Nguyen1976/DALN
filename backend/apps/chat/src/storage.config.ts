import { registerAs } from '@nestjs/config'

export const storageConfig = registerAs('storage', () => ({
  accessKey: process.env.AWS_ACCESS_KEY_ID,
  secretKey: process.env.AWS_SECRET_ACCESS_KEY,
  bucket: process.env.S3_BUCKET,
  region: process.env.AWS_REGION || 'ap-southeast-1',
  cdnPublicUrl: process.env.CDN_PUBLIC_URL,
  endpoint: process.env.S3_ENDPOINT,
}))
