/**
 * Hỏi chat service danh sách thành viên hội thoại nhóm để phân quyền gọi nhóm.
 *
 * Song song với `chat-call-peer.client.ts` (1-1) nhưng cho GROUP: gateway không
 * giữ dữ liệu hội thoại nên quyền gọi phải duyệt ở phía sở hữu dữ liệu. Lời gọi
 * liên dịch vụ này không có phiên JWT người dùng nên xác thực bằng `x-internal-token`.
 */

export interface CallMember {
  id: string
  username: string
}

export type CallMembersResult =
  | { ok: true; members: CallMember[]; type?: string }
  /** Chat service từ chối: không phải thành viên ACTIVE, id sai. */
  | { ok: false; code: 'FORBIDDEN' }
  /** Chat service lỗi/không với tới được — lỗi hạ tầng, client thử lại được. */
  | { ok: false; code: 'LOOKUP_FAILED' }

const REQUEST_TIMEOUT_MS = 5000

function chatServiceBaseUrl(): string {
  // Gateway luôn chạy trong docker (cả dev lẫn prod), nên mặc định là tên
  // service trong compose; `CHAT_SERVICE_URL` để ghi đè khi chạy ngoài.
  return (
    process.env.CHAT_SERVICE_URL?.trim().replace(/\/+$/, '') ||
    'http://chat:3003'
  )
}

function internalToken(): string {
  return process.env.INTERNAL_API_TOKEN ?? ''
}

function normalizeMembers(raw: unknown): CallMember[] {
  if (!Array.isArray(raw)) return []

  return raw
    .map((item) => {
      const member = (item ?? {}) as Record<string, unknown>
      const id = member.id ?? member._id ?? member.userId
      return {
        id: id == null ? '' : String(id),
        username: member.username == null ? '' : String(member.username),
      }
    })
    .filter((member) => member.id !== '')
}

/**
 * Trả danh sách thành viên khi `userId` là thành viên ACTIVE, ngược lại FORBIDDEN.
 * `type` đi kèm nếu chat trả (để chốt NOT_GROUP); vắng thì để frontend quyết.
 */
export async function fetchCallMembers(
  conversationId: string,
  userId: string,
): Promise<CallMembersResult> {
  const url = `${chatServiceBaseUrl()}/chat/internal/call-members?conversationId=${encodeURIComponent(
    conversationId,
  )}&userId=${encodeURIComponent(userId)}`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const res = await fetch(url, {
      headers: { 'x-internal-token': internalToken() },
      signal: controller.signal,
    })

    if (!res.ok) {
      // 4xx là quyết định nghiệp vụ ("không được gọi"), 5xx là sự cố hạ tầng.
      return {
        ok: false,
        code: res.status < 500 ? 'FORBIDDEN' : 'LOOKUP_FAILED',
      }
    }

    // ResponseInterceptor của NestJS bọc body trong `data`; đọc cả hai dạng.
    const body = (await res.json()) as {
      data?: { members?: unknown; type?: unknown }
      members?: unknown
      type?: unknown
    } | null
    const payload = body?.data ?? body ?? {}

    const members = normalizeMembers(payload.members)
    if (members.length === 0) return { ok: false, code: 'LOOKUP_FAILED' }

    const type = typeof payload.type === 'string' ? payload.type : undefined

    return { ok: true, members, type }
  } catch {
    return { ok: false, code: 'LOOKUP_FAILED' }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Ghi 1 tin hệ thống tổng kết cuộc gọi nhóm vào dòng trò chuyện.
 *
 * Gọi thẳng HTTP (không qua RMQ) vì webhook LiveKit vốn đã là một request HTTP
 * ngoài luồng — giữ nó đồng bộ, đơn giản, và trả về được true/false để log.
 */
export async function postGroupCallLog(input: {
  conversationId: string
  participantCount: number
  durationSeconds: number
}): Promise<boolean> {
  const url = `${chatServiceBaseUrl()}/chat/internal/group-call-log`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-token': internalToken(),
      },
      body: JSON.stringify(input),
      signal: controller.signal,
    })

    return res.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}
