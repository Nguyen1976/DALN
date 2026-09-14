/**
 * Hỏi chat service xem ai là người nhận hợp lệ của một cuộc gọi 1-1.
 *
 * Gateway không có dữ liệu hội thoại, mà quyền gọi thì phải duyệt ở phía sở hữu
 * dữ liệu. Lời gọi liên dịch vụ này không có phiên JWT của người dùng nên xác
 * thực bằng `x-internal-token` — đúng cách user service đang gọi recommendation.
 */

export type CallPeerResult =
  | { ok: true; peerId: string }
  /** Chat service từ chối: không phải DIRECT, không phải thành viên, id sai. */
  | { ok: false; code: 'CALL_FORBIDDEN' }
  /** Chat service lỗi/không với tới được — lỗi hạ tầng, client thử lại được. */
  | { ok: false; code: 'CALL_LOOKUP_FAILED' }

const REQUEST_TIMEOUT_MS = 5000

function chatServiceBaseUrl(): string {
  // Gateway luôn chạy trong docker (cả dev lẫn prod), nên mặc định là tên
  // service trong compose; `CHAT_SERVICE_URL` để ghi đè khi chạy ngoài.
  return (
    process.env.CHAT_SERVICE_URL?.trim().replace(/\/+$/, '') ||
    'http://chat:3003'
  )
}

export async function fetchCallPeer(
  conversationId: string,
  userId: string,
): Promise<CallPeerResult> {
  const url = `${chatServiceBaseUrl()}/chat/internal/call-peer?conversationId=${encodeURIComponent(
    conversationId,
  )}&userId=${encodeURIComponent(userId)}`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const res = await fetch(url, {
      headers: { 'x-internal-token': process.env.INTERNAL_API_TOKEN ?? '' },
      signal: controller.signal,
    })

    if (!res.ok) {
      // 4xx là quyết định nghiệp vụ ("không được gọi"), 5xx là sự cố hạ tầng.
      return {
        ok: false,
        code: res.status < 500 ? 'CALL_FORBIDDEN' : 'CALL_LOOKUP_FAILED',
      }
    }

    // ResponseInterceptor của NestJS bọc body trong `data`; đọc cả hai dạng để
    // không phụ thuộc vào việc lớp bọc đó còn hay mất.
    const body = (await res.json()) as {
      data?: { peerId?: string }
      peerId?: string
    } | null
    const peerId = body?.data?.peerId ?? body?.peerId

    if (!peerId) return { ok: false, code: 'CALL_LOOKUP_FAILED' }

    return { ok: true, peerId }
  } catch {
    return { ok: false, code: 'CALL_LOOKUP_FAILED' }
  } finally {
    clearTimeout(timer)
  }
}
