/**
 * What the gateway asks the chat service. The gateway holds no conversation
 * data, so who may call whom is decided where that data lives. These calls
 * carry no user session; the chat endpoints are `@InternalOnly()`.
 */
import {
  InternalCallError,
  internalFetch,
  serviceUrl,
} from '@app/common/http/internal-fetch'
import type { GroupCallMember } from './group-call.store'

export type CallPeerResult =
  | { ok: true; peerId: string }
  /** Chat service từ chối: không phải DIRECT, không phải thành viên, id sai. */
  | { ok: false; code: 'CALL_FORBIDDEN' }
  /** Chat service lỗi/không với tới được — lỗi hạ tầng, client thử lại được. */
  | { ok: false; code: 'CALL_LOOKUP_FAILED' }

export type CallMembersResult =
  | { ok: true; members: GroupCallMember[]; type: string }
  /** Chat service từ chối: không phải thành viên ACTIVE, id sai. */
  | { ok: false; code: 'FORBIDDEN' }
  /** Chat service lỗi/không với tới được — lỗi hạ tầng, client thử lại được. */
  | { ok: false; code: 'LOOKUP_FAILED' }

// Gateway luôn chạy trong docker (cả dev lẫn prod), nên mặc định là tên
// service trong compose; `CHAT_SERVICE_URL` để ghi đè khi chạy ngoài.
const chatUrl = (path: string, query?: Record<string, string>) =>
  `${serviceUrl('CHAT_SERVICE_URL', 'http://chat:3003')}/chat/internal/${path}${
    query ? `?${new URLSearchParams(query)}` : ''
  }`

/** 4xx is chat saying no; anything else is it failing to answer. */
const isRefusal = (error: unknown) =>
  error instanceof InternalCallError &&
  error.status !== null &&
  error.status < 500

export async function fetchCallPeer(
  conversationId: string,
  userId: string,
): Promise<CallPeerResult> {
  try {
    const { peerId } = await internalFetch<{ peerId: string }>(
      chatUrl('call-peer', { conversationId, userId }),
    )
    return { ok: true, peerId }
  } catch (error) {
    return {
      ok: false,
      code: isRefusal(error) ? 'CALL_FORBIDDEN' : 'CALL_LOOKUP_FAILED',
    }
  }
}

/** The members, when `userId` is an ACTIVE one; FORBIDDEN otherwise. */
export async function fetchCallMembers(
  conversationId: string,
  userId: string,
): Promise<CallMembersResult> {
  try {
    const { members, type } = await internalFetch<{
      members: GroupCallMember[]
      type: string
    }>(chatUrl('call-members', { conversationId, userId }))
    if (!members.length) return { ok: false, code: 'LOOKUP_FAILED' }
    return { ok: true, members, type }
  } catch (error) {
    return {
      ok: false,
      code: isRefusal(error) ? 'FORBIDDEN' : 'LOOKUP_FAILED',
    }
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
  /** callId để chat khử trùng khi webhook room_finished tới lặp/đảo thứ tự. */
  callId?: string
  /** Loại cuộc gọi để chat chọn văn bản "nhóm" vs "video nhóm". */
  callType?: 'audio' | 'video'
  /** Người mở phòng — để tin log gán senderId đúng (căn phải/trái như tin nhắn). */
  startedBy?: string
}): Promise<boolean> {
  try {
    await internalFetch(chatUrl('group-call-log'), {
      method: 'POST',
      body: input,
    })
    return true
  } catch {
    return false
  }
}
