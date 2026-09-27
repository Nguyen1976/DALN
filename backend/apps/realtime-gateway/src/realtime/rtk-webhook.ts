import { Inject, Injectable, Logger, Optional } from '@nestjs/common'
import { createVerify } from 'crypto'
import { RTK_FETCH } from './realtimekit.service'

export const RTK_PUBLIC_KEY_URL =
  'https://api.realtime.cloudflare.com/.well-known/webhooks.json'
const KEY_TTL_MS = 60 * 60 * 1000
/** Tải lại khoá do chữ ký sai: tối đa một lần mỗi 5 phút (endpoint công khai). */
const FORCED_REFRESH_MIN_MS = 5 * 60 * 1000
const KEY_FETCH_TIMEOUT_MS = 8000

type FetchLike = (
  url: string,
  init?: RequestInit,
) => Promise<Pick<Response, 'ok' | 'status' | 'text'>>

/** RealtimeKit ký raw body bằng RSA-SHA256, chữ ký base64 ở header rtk-signature. */
export function verifyRtkSignature(
  rawBody: string,
  signature: string | undefined,
  publicKeyPem: string,
): boolean {
  if (!signature) return false
  try {
    const verifier = createVerify('RSA-SHA256')
    verifier.update(rawBody)
    verifier.end()
    return verifier.verify(publicKeyPem, signature, 'base64')
  } catch {
    return false
  }
}

/** Khoá có thể là PEM hoặc base64 trần của DER — chuẩn hoá về PEM. */
export function toPem(key: string): string {
  const trimmed = key.trim()
  if (trimmed.startsWith('-----BEGIN')) return key
  const lines = trimmed.replace(/\s+/g, '').match(/.{1,64}/g) ?? []
  return `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----\n`
}

export interface RtkWebhookEvent {
  event: string
  meetingId: string
  customParticipantId?: string
}

/** Rút đúng các trường gateway cần; payload lạ/hỏng -> null (bỏ qua). */
export function parseRtkEvent(raw: string): RtkWebhookEvent | null {
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return null
  }
  if (!body || typeof body !== 'object') return null
  const record = body as Record<string, unknown>
  const event = typeof record.event === 'string' ? record.event : ''
  const meeting = record.meeting as Record<string, unknown> | undefined
  const meetingId = typeof meeting?.id === 'string' ? meeting.id : ''
  if (!event || !meetingId) return null
  const participant = record.participant as Record<string, unknown> | undefined
  const customParticipantId =
    typeof participant?.customParticipantId === 'string'
      ? participant.customParticipantId
      : undefined
  return {
    event,
    meetingId,
    ...(customParticipantId ? { customParticipantId } : {}),
  }
}

/**
 * Giữ khoá công khai của RealtimeKit (cache 1 giờ). Chữ ký sai thì tải lại khoá
 * MỘT lần — phòng khi Cloudflare vừa xoay khoá — rồi mới kết luận là sai.
 */
@Injectable()
export class RtkWebhookVerifier {
  private readonly logger = new Logger(RtkWebhookVerifier.name)
  private cached: { pem: string; fetchedAt: number } | null = null
  private lastForcedAt = 0

  constructor(
    @Optional() @Inject(RTK_FETCH) private readonly fetchImpl?: FetchLike,
  ) {}

  async verify(rawBody: string, signature?: string): Promise<boolean> {
    const current = await this.publicKey(false)
    if (current && verifyRtkSignature(rawBody, signature, current)) return true
    // Ai cũng gửi được request tới endpoint này: không để chữ ký rác kéo theo một
    // lần tải khoá mỗi request.
    if (Date.now() - this.lastForcedAt < FORCED_REFRESH_MIN_MS) return false
    this.lastForcedAt = Date.now()
    const fresh = await this.publicKey(true)
    return Boolean(
      fresh &&
      fresh !== current &&
      verifyRtkSignature(rawBody, signature, fresh),
    )
  }

  private async publicKey(force: boolean): Promise<string | null> {
    if (
      !force &&
      this.cached &&
      Date.now() - this.cached.fetchedAt < KEY_TTL_MS
    ) {
      return this.cached.pem
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), KEY_FETCH_TIMEOUT_MS)
    try {
      const doFetch: FetchLike = this.fetchImpl ?? fetch
      const res = await doFetch(RTK_PUBLIC_KEY_URL, {
        signal: controller.signal,
      })
      const parsed = JSON.parse(await res.text()) as {
        data?: { publicKey?: string }
      }
      const key = parsed?.data?.publicKey
      if (!res.ok || !key) return this.cached?.pem ?? null
      this.cached = { pem: toPem(key), fetchedAt: Date.now() }
      return this.cached.pem
    } catch (error) {
      this.logger.warn('fetch RealtimeKit webhook key failed', error as Error)
      return this.cached?.pem ?? null
    } finally {
      clearTimeout(timer)
    }
  }
}
