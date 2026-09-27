import { Inject, Injectable, Logger, Optional } from '@nestjs/common'
import type Redis from 'ioredis'
import {
  newCustomParticipantId,
  RtkGrant,
  RtkPreset,
} from './realtimekit.types'

/** Token DI để test thay `fetch`; production dùng `fetch` toàn cục. */
export const RTK_FETCH = 'RTK_FETCH'

type FetchLike = (
  url: string,
  init: RequestInit,
) => Promise<Pick<Response, 'ok' | 'status' | 'text'>>

/** API RealtimeKit không dùng được: chưa cấu hình, lỗi mạng, timeout, 5xx, 401/403. */
export class RealtimeKitUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RealtimeKitUnavailableError'
  }
}

const REQUEST_TIMEOUT_MS = 8000

export const meetingKey = (conversationId: string) =>
  `rtk:meeting:${conversationId}`
export const conversationKey = (meetingId: string) => `rtk:conv:${meetingId}`

/**
 * Cầu nối gateway ↔ REST API Cloudflare RealtimeKit.
 *
 * Mỗi hội thoại một phòng dùng lại mãi: RealtimeKit không cho xoá phòng, và mỗi
 * phòng chỉ có một phiên sống — khớp luật "một hội thoại một cuộc gọi". Ánh xạ
 * nằm ở Redis, không TTL; mất thì tạo phòng mới, không hỏng gì.
 */
@Injectable()
export class RealtimeKitService {
  private readonly logger = new Logger(RealtimeKitService.name)

  constructor(
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    @Optional() @Inject(RTK_FETCH) private readonly fetchImpl?: FetchLike,
  ) {}

  private env() {
    return {
      account: process.env.REALTIMEKIT_ACCOUNT_ID?.trim() ?? '',
      app: process.env.REALTIMEKIT_APP_ID?.trim() ?? '',
      token: process.env.REALTIMEKIT_API_TOKEN?.trim() ?? '',
      base: process.env.REALTIMEKIT_API_BASE?.trim() ?? '',
    }
  }

  isConfigured(): boolean {
    const { account, app, token } = this.env()
    return Boolean(account && app && token)
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'DELETE' | 'PATCH',
    path: string,
    body?: unknown,
  ): Promise<{ status: number; data: T | null }> {
    if (!this.isConfigured()) {
      throw new RealtimeKitUnavailableError('RealtimeKit is not configured')
    }
    const { account, app, token, base } = this.env()
    const root = (
      base ||
      `https://api.cloudflare.com/client/v4/accounts/${account}/realtime/kit/${app}`
    ).replace(/\/+$/, '')

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const doFetch: FetchLike = this.fetchImpl ?? fetch
      const res = await doFetch(`${root}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      })
      if (res.status >= 500 || res.status === 401 || res.status === 403) {
        throw new RealtimeKitUnavailableError(
          `${method} ${path} -> ${res.status}`,
        )
      }
      const text = await res.text()
      let parsed: unknown = null
      try {
        parsed = text ? JSON.parse(text) : null
      } catch {
        parsed = null
      }
      const data =
        parsed && typeof parsed === 'object' && 'data' in parsed
          ? ((parsed as { data: T }).data ?? null)
          : null
      return { status: res.status, data }
    } catch (error) {
      if (error instanceof RealtimeKitUnavailableError) throw error
      throw new RealtimeKitUnavailableError(
        `${method} ${path}: ${(error as Error)?.message ?? String(error)}`,
      )
    } finally {
      clearTimeout(timer)
    }
  }

  async ensureMeeting(conversationId: string): Promise<string> {
    const existing = await this.redis.get(meetingKey(conversationId))
    if (existing) return existing
    return this.createMeeting(conversationId)
  }

  private async createMeeting(conversationId: string): Promise<string> {
    const { status, data } = await this.request<{ id?: string }>(
      'POST',
      '/meetings',
      { title: `conv_${conversationId}` },
    )
    if (status >= 300 || !data?.id) {
      throw new RealtimeKitUnavailableError(`create meeting -> ${status}`)
    }

    // Hai người mở phòng cùng lúc: SET NX chọn đúng một phòng. Phòng của bên thua
    // bị bỏ lại (không có API xoá) — hiếm và vô hại vì không ai được cấp vào đó.
    const won = await this.redis.set(meetingKey(conversationId), data.id, 'NX')
    if (won) {
      await this.redis.set(conversationKey(data.id), conversationId)
      return data.id
    }
    const winner = await this.redis.get(meetingKey(conversationId))
    if (winner) return winner

    await this.redis.set(meetingKey(conversationId), data.id)
    await this.redis.set(conversationKey(data.id), conversationId)
    return data.id
  }

  conversationOfMeeting(meetingId: string): Promise<string | null> {
    return this.redis.get(conversationKey(meetingId))
  }

  async addParticipant(
    conversationId: string,
    input: { userId: string; name: string; preset: RtkPreset },
  ): Promise<RtkGrant & { authToken: string }> {
    let meetingId = await this.ensureMeeting(conversationId)
    let result = await this.postParticipant(meetingId, input)

    // Phòng đã mất phía Cloudflare (bị vô hiệu hoá/xoá): tạo lại một lần.
    if (result.status === 404) {
      await this.redis.del(meetingKey(conversationId))
      meetingId = await this.createMeeting(conversationId)
      result = await this.postParticipant(meetingId, input)
    }

    const { status, data, customParticipantId } = result
    if (status >= 300 || !data?.id || !data?.token) {
      throw new RealtimeKitUnavailableError(`add participant -> ${status}`)
    }
    return {
      meetingId,
      participantId: data.id,
      customParticipantId,
      authToken: data.token,
    }
  }

  private async postParticipant(
    meetingId: string,
    input: { userId: string; name: string; preset: RtkPreset },
  ) {
    const customParticipantId = newCustomParticipantId(input.userId)
    const { status, data } = await this.request<{
      id?: string
      token?: string
    }>('POST', `/meetings/${meetingId}/participants`, {
      custom_participant_id: customParticipantId,
      name: input.name,
      preset_name: input.preset,
    })
    return { status, data, customParticipantId }
  }

  /**
   * Thu hồi quyền vào phòng khi cuộc gọi kết thúc: kick CÓ CHỌN LỌC (không
   * kick-all — tránh đá nhầm người của cuộc gọi kế tiếp trên cùng phòng) rồi xoá
   * từng người tham gia để token của họ hết hiệu lực. Không bao giờ ném lỗi.
   */
  async revoke(grants: RtkGrant[]): Promise<void> {
    const byMeeting = new Map<string, RtkGrant[]>()
    for (const grant of grants) {
      const list = byMeeting.get(grant.meetingId) ?? []
      list.push(grant)
      byMeeting.set(grant.meetingId, list)
    }

    for (const [meetingId, list] of byMeeting) {
      try {
        await this.request(
          'POST',
          `/meetings/${meetingId}/active-session/kick`,
          {
            custom_participant_ids: list.map((g) => g.customParticipantId),
          },
        )
      } catch (error) {
        this.logger.warn(`kick ${meetingId} failed`, error as Error)
      }
      for (const grant of list) {
        try {
          await this.request(
            'DELETE',
            `/meetings/${meetingId}/participants/${grant.participantId}`,
          )
        } catch (error) {
          this.logger.warn(
            `delete participant ${grant.participantId} failed`,
            error as Error,
          )
        }
      }
    }
  }
}
