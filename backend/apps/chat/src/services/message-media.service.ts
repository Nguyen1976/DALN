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
    IMAGE: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
    VIDEO: ['video/mp4', 'video/webm', 'video/quicktime'],
    FILE: [
      'application/pdf',
      'text/plain',
      'text/markdown',
      'text/csv',
      'application/json',
      'application/xml',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/zip',
      'application/octet-stream',
    ],
  }

  private readonly browserMimeAliases: Record<string, string> = {
    'application/x-sh': 'text/plain',
    'text/x-sh': 'text/plain',
    'text/x-shellscript': 'text/plain',
    'application/javascript': 'text/plain',
    'text/javascript': 'text/plain',
    'text/x-markdown': 'text/markdown',
  }

  private readonly genericBrowserMimeTypes = new Set([
    '',
    'application/octet-stream',
    'application/binary',
    'binary/octet-stream',
  ])

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
      txt: 'text/plain',
      csv: 'text/csv',
      json: 'application/json',
      xml: 'application/xml',
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

    return aliasedReported
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
    const resolvedMime = this.resolveMimeType(fileName, mimeType)
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
