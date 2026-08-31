import { Inject, Injectable } from '@nestjs/common'
import { S3StorageService } from '@app/storage-s3/s3-storage.service'
import { ChatErrors } from '../errors/chat.errors'

export type NormalizedMessageType = 'TEXT' | 'IMAGE' | 'VIDEO' | 'FILE' | 'POLL'

@Injectable()
export class MessageMediaService {
  private readonly uploadLimitByType: Record<string, number> = {
    IMAGE: 10 * 1024 * 1024,
    VIDEO: 100 * 1024 * 1024,
    FILE: 50 * 1024 * 1024,
  }

  private readonly mimeAllowListByType: Record<string, string[]> = {
    IMAGE: [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
      'image/bmp',
      'image/svg+xml',
      'image/heic',
      'image/heif',
      'image/x-icon',
    ],
    VIDEO: ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo'],
    FILE: [
      'application/pdf',
      'text/plain',
      'text/markdown',
      'text/csv',
      'text/html',
      'text/calendar',
      'application/json',
      'application/xml',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/epub+zip',
      'application/zip',
      'application/x-zip-compressed',
      'application/vnd.rar',
      'application/x-rar-compressed',
      'application/x-7z-compressed',
      'application/x-tar',
      'application/gzip',
      'application/x-pem-file',
      'application/x-x509-ca-cert',
      'application/x-x509-user-cert',
      'application/pkix-cert',
      'application/pkcs8',
      'application/x-pkcs12',
      'application/pkcs12',
      'audio/mpeg',
      'audio/wav',
      'audio/ogg',
      // 'application/octet-stream' deliberately absent. Every unrecognised
      // extension resolves to it, so allowing it turned this allow-list into
      // an allow-everything: a .exe picked in the browser sailed through.
    ],
  }

  private readonly browserMimeAliases: Record<string, string> = {
    'application/x-sh': 'text/plain',
    'text/x-sh': 'text/plain',
    'text/x-shellscript': 'text/plain',
    'application/javascript': 'text/plain',
    'text/javascript': 'text/plain',
    'text/x-markdown': 'text/markdown',
    'application/x-pem-file': 'text/plain',
    'application/x-x509-ca-cert': 'text/plain',
    'application/x-x509-user-cert': 'text/plain',
    'application/pkix-cert': 'text/plain',
    'application/pkcs8': 'text/plain',
    'application/x-pkcs12': 'application/pkcs12',
    'application/x-zip-compressed': 'application/zip',
    'application/x-rar-compressed': 'application/vnd.rar',
  }

  private readonly genericBrowserMimeTypes = new Set([
    '',
    'application/octet-stream',
    'application/binary',
    'binary/octet-stream',
  ])

  private get allowedMimeTypes(): Set<string> {
    return new Set(
      Object.values(this.mimeAllowListByType).flatMap((items) => items),
    )
  }

  constructor(
    @Inject(S3StorageService)
    private readonly s3StorageService: S3StorageService,
  ) {}

  normalizeMessageType(type: unknown): NormalizedMessageType {
    if (typeof type === 'number') {
      return ['TEXT', 'IMAGE', 'VIDEO', 'FILE', 'POLL'][type] as NormalizedMessageType
    }

    const normalized = String(type || 'TEXT').toUpperCase()

    if (normalized.includes('IMAGE')) return 'IMAGE'
    if (normalized.includes('VIDEO')) return 'VIDEO'
    if (normalized.includes('FILE')) return 'FILE'
    if (normalized.includes('POLL')) return 'POLL'
    return 'TEXT'
  }

  getMimeType(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase()
    const mimeTypes: Record<string, string> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      webp: 'image/webp',
      bmp: 'image/bmp',
      svg: 'image/svg+xml',
      heic: 'image/heic',
      heif: 'image/heif',
      ico: 'image/x-icon',
      mp4: 'video/mp4',
      webm: 'video/webm',
      mov: 'video/quicktime',
      avi: 'video/x-msvideo',
      pdf: 'application/pdf',
      epub: 'application/epub+zip',
      zip: 'application/zip',
      rar: 'application/vnd.rar',
      '7z': 'application/x-7z-compressed',
      tar: 'application/x-tar',
      gz: 'application/gzip',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xls: 'application/vnd.ms-excel',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ppt: 'application/vnd.ms-powerpoint',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      pem: 'text/plain',
      key: 'text/plain',
      crt: 'text/plain',
      cer: 'text/plain',
      p12: 'application/pkcs12',
      pfx: 'application/pkcs12',
      mp3: 'audio/mpeg',
      wav: 'audio/wav',
      ogg: 'audio/ogg',
      txt: 'text/plain',
      csv: 'text/csv',
      json: 'application/json',
      xml: 'application/xml',
      html: 'text/html',
      htm: 'text/html',
      ics: 'text/calendar',
      yaml: 'text/plain',
      yml: 'text/plain',
      js: 'text/plain',
      jsx: 'text/plain',
      ts: 'text/plain',
      tsx: 'text/plain',
      java: 'text/plain',
      kt: 'text/plain',
      go: 'text/plain',
      py: 'text/plain',
      rb: 'text/plain',
      c: 'text/plain',
      cpp: 'text/plain',
      h: 'text/plain',
      hpp: 'text/plain',
      php: 'text/plain',
      sh: 'text/plain',
      bash: 'text/plain',
      zsh: 'text/plain',
      sql: 'text/plain',
      log: 'text/plain',
      md: 'text/markdown',
      markdown: 'text/markdown',
      env: 'text/plain',
    }
    return mimeTypes[ext || ''] || 'application/octet-stream'
  }

  resolveMimeType(fileName: string, reportedMime?: string): string {
    const extensionMime = this.getMimeType(fileName)
    const normalizedReported = String(reportedMime || '')
      .trim()
      .toLowerCase()
    const aliasedReported =
      this.browserMimeAliases[normalizedReported] || normalizedReported

    if (aliasedReported.startsWith('image/') || aliasedReported.startsWith('video/')) {
      return aliasedReported
    }

    if (
      !aliasedReported ||
      this.genericBrowserMimeTypes.has(aliasedReported)
    ) {
      return extensionMime
    }

    if (this.allowedMimeTypes.has(aliasedReported)) {
      return aliasedReported
    }

    if (
      extensionMime !== 'application/octet-stream' &&
      this.allowedMimeTypes.has(extensionMime)
    ) {
      return extensionMime
    }

    return extensionMime !== 'application/octet-stream'
      ? extensionMime
      : aliasedReported
  }

  /** Kind of a single attachment, derived from its resolved mime type. */
  inferMediaKind(mimeType: string): 'IMAGE' | 'VIDEO' | 'FILE' {
    if (mimeType.startsWith('image/')) return 'IMAGE'
    if (mimeType.startsWith('video/')) return 'VIDEO'
    return 'FILE'
  }

  private inferMessageTypeFromMime(mimeType: string, fileName: string): string {
    if (mimeType.startsWith('image/')) return 'IMAGE'
    if (mimeType.startsWith('video/')) return 'VIDEO'

    const extensionMime = this.getMimeType(fileName)
    if (extensionMime.startsWith('image/')) return 'IMAGE'
    if (extensionMime.startsWith('video/')) return 'VIDEO'

    return 'FILE'
  }

  validateMimeAndSize(
    type: string,
    mimeType: string,
    size: number,
    fileName = '',
  ): void {
    const normalizedType = this.normalizeMessageType(type)
    let resolvedMime = this.resolveMimeType(fileName, mimeType)
    const effectiveType =
      normalizedType === 'TEXT'
        ? this.inferMessageTypeFromMime(resolvedMime, fileName)
        : normalizedType

    if (!this.uploadLimitByType[effectiveType] || !this.mimeAllowListByType[effectiveType]) {
      ChatErrors.invalidMediaType()
    }

    if (
      !Number.isFinite(size) ||
      size <= 0 ||
      size > this.uploadLimitByType[effectiveType]
    ) {
      ChatErrors.fileSizeExceeded()
    }

    const extensionMime = this.getMimeType(fileName)
    if (
      !this.mimeAllowListByType[effectiveType].includes(resolvedMime) &&
      this.mimeAllowListByType[effectiveType].includes(extensionMime)
    ) {
      resolvedMime = extensionMime
    }

    if (!this.mimeAllowListByType[effectiveType].includes(resolvedMime)) {
      ChatErrors.invalidMediaType()
    }
  }

  async checkObjectExistsWithRetry(objectKey: string): Promise<boolean> {
    const maxAttempts = 4
    const delayMs = 300

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const exists = await this.s3StorageService.objectExists(objectKey)
      if (exists) return true

      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, delayMs))
      }
    }

    return false
  }

  async createPresignedUploadUrl(params: {
    conversationId: string
    userId: string
    fileName: string
    mimeType: string
  }) {
    return this.s3StorageService.createPresignedUploadUrl({
      folder: `chat-media/${params.conversationId}/${params.userId}`,
      fileName: params.fileName,
      mime: params.mimeType,
      expiresInSeconds: 300,
    })
  }
}
