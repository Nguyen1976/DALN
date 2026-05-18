import { Injectable, Logger } from '@nestjs/common'

/**
 * Calls embedding-service `/embed-and-save` so Mongo `profile_vector` + Qdrant `user_bios` stay in sync.
 * Base URL: `EMBEDDING_SERVICE_URL`, else origin of `PYTHON_RECOMMEND_URL` or `PYTHON_TOPK_URL`, else http://127.0.0.1:8000
 */
@Injectable()
export class EmbeddingNotifyService {
  private readonly logger = new Logger(EmbeddingNotifyService.name)

  embeddingBaseUrl(): string {
    const explicit = process.env.EMBEDDING_SERVICE_URL?.trim().replace(/\/+$/, '')
    if (explicit) return explicit
    for (const key of ['PYTHON_RECOMMEND_URL', 'PYTHON_TOPK_URL'] as const) {
      const raw = process.env[key]?.trim()
      if (raw) {
        try {
          return new URL(raw).origin
        } catch {
          /* ignore */
        }
      }
    }
    return 'http://127.0.0.1:8000'
  }

  async notifyBioEmbedded(userId: string, bio: string): Promise<{
    ok: boolean
    status?: number
    qdrantUpserted?: number
    detail?: string
  }> {
    const url = `${this.embeddingBaseUrl()}/embed-and-save`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 30_000)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          users: [{ id: userId, bio: bio || '', age: 0 }],
        }),
        signal: controller.signal,
      })
      const text = await res.text()
      let body: { status?: string; qdrant_upserted?: number } = {}
      try {
        body = text ? (JSON.parse(text) as typeof body) : {}
      } catch {
        body = {}
      }
      if (!res.ok) {
        this.logger.error(
          `[embedding] HTTP ${res.status} ${url} body=${text.slice(0, 400)}`,
        )
        return { ok: false, status: res.status, detail: text.slice(0, 200) }
      }
      if (body.status !== 'ok') {
        this.logger.error(`[embedding] bad payload from ${url}: ${text.slice(0, 400)}`)
        return { ok: false, status: res.status, detail: text.slice(0, 200) }
      }
      const q = body.qdrant_upserted ?? 0
      this.logger.log(
        `[embedding] embed-and-save ok userId=${userId} qdrant_upserted=${q}`,
      )
      return { ok: true, status: res.status, qdrantUpserted: q }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      this.logger.error(`[embedding] request failed ${url}: ${msg}`)
      return { ok: false, detail: msg }
    } finally {
      clearTimeout(timer)
    }
  }
}
