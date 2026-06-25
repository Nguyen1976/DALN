import type { S3StorageConfig } from './s3-storage.constants'

/** Reads AWS S3 storage settings from environment variables. */
export function getS3StorageConfigFromEnv(): S3StorageConfig {
  const accessKey = process.env.AWS_ACCESS_KEY_ID || ''
  const secretKey = process.env.AWS_SECRET_ACCESS_KEY || ''
  const bucket = process.env.S3_BUCKET || ''
  const region = process.env.AWS_REGION || 'ap-southeast-1'
  const endpoint = process.env.S3_ENDPOINT || undefined

  const cdnPublicUrl = (
    process.env.CDN_PUBLIC_URL ||
    (bucket && !endpoint ? buildS3PublicBaseUrl(bucket, region) : '')
  ).replace(/\/+$/, '')

  return {
    accessKey,
    secretKey,
    bucket,
    region,
    cdnPublicUrl,
    endpoint,
  }
}

function buildS3PublicBaseUrl(bucket: string, region: string): string {
  if (region === 'us-east-1') {
    return `https://${bucket}.s3.amazonaws.com`
  }
  return `https://${bucket}.s3.${region}.amazonaws.com`
}
