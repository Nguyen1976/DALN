export interface S3StorageConfig {
  accessKey: string
  secretKey: string
  bucket: string
  region: string
  /** Public CDN base URL (CloudFront or S3), no trailing slash */
  cdnPublicUrl: string
  /** Custom S3 endpoint — only for S3-compatible providers */
  endpoint?: string
  /**
   * Endpoint the *browser* will hit for pre-signed uploads.
   *
   * Only differs from `endpoint` when the storage is reachable under two
   * names — a local MinIO is `minio:9000` inside the Docker network but
   * `localhost:9000` from the browser, and a URL signed for one host is
   * rejected at the other. Left empty against real S3, where both are equal.
   */
  publicEndpoint?: string
}

export const S3_STORAGE_CONFIG = 'S3_STORAGE_CONFIG'
