export interface S3StorageConfig {
  accessKey: string
  secretKey: string
  bucket: string
  region: string
  /** Public CDN base URL (CloudFront or S3), no trailing slash */
  cdnPublicUrl: string
  /** Custom S3 endpoint — only for S3-compatible providers */
  endpoint?: string
}

export const S3_STORAGE_CONFIG = 'S3_STORAGE_CONFIG'
