import { Injectable, Logger } from '@nestjs/common'
import { EmbeddingService } from './embedding.service'

/** In-process bio embedding -> Qdrant `user_bios`. */
@Injectable()
export class EmbeddingNotifyService {
  private readonly logger = new Logger(EmbeddingNotifyService.name)

  constructor(private readonly embeddingService: EmbeddingService) {}

  async notifyBioEmbedded(userId: string, bio: string): Promise<{
    ok: boolean
    status?: number
    qdrantUpserted?: number
    detail?: string
  }> {
    try {
      const result = await this.embeddingService.embedAndSave([
        { id: userId, bio: bio || '', age: 0 },
      ])

      if (result.status !== 'ok') {
        this.logger.error(
          `[embedding] embed-and-save bad status userId=${userId} status=${result.status} detail=${result.message ?? ''}`,
        )
        return { ok: false, detail: result.message ?? result.status }
      }

      const q = result.qdrant_upserted ?? 0
      this.logger.log(
        `[embedding] embed-and-save ok userId=${userId} qdrant_upserted=${q}`,
      )
      return { ok: true, status: 200, qdrantUpserted: q }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      this.logger.error(`[embedding] request failed userId=${userId}: ${msg}`)
      return { ok: false, detail: msg }
    }
  }
}
