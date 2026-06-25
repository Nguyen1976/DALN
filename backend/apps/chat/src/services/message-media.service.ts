import { Inject, Injectable } from '@nestjs/common'
import { StorageR2Service } from '@app/storage-r2/storage-r2.service'
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
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/zip',
    ],
  }

  constructor(
    @Inject(StorageR2Service)
    private readonly storageR2Service: StorageR2Service,
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
      md: 'text/plain',
      csv: 'text/plain',
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
      sql: 'text/plain',
      log: 'text/plain',
    }
    return mimeTypes[ext || ''] || 'application/octet-stream'
  }

  validateMimeAndSize(type: string, mimeType: string, size: number): void {
    if (!this.uploadLimitByType[type] || !this.mimeAllowListByType[type]) {
      ChatErrors.invalidMediaType()
    }

    if (
      !Number.isFinite(size) ||
      size <= 0 ||
      size > this.uploadLimitByType[type]
    ) {
      ChatErrors.fileSizeExceeded()
    }

    if (!this.mimeAllowListByType[type].includes(mimeType)) {
      ChatErrors.invalidMediaType()
    }
  }

  async checkObjectExistsWithRetry(objectKey: string): Promise<boolean> {
    const maxAttempts = 4
    const delayMs = 300

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const exists = await this.storageR2Service.objectExists(objectKey)
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
    return this.storageR2Service.createPresignedUploadUrl({
      folder: `chat-media/${params.conversationId}/${params.userId}`,
      fileName: params.fileName,
      mime: params.mimeType,
      expiresInSeconds: 300,
    })
  }
}
