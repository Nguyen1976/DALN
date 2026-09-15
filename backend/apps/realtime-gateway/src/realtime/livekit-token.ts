import { AccessToken } from 'livekit-server-sdk'

/**
 * Ký token vào phòng gọi nhóm LiveKit.
 *
 * SFU (LiveKit) là bên quyết định ai được publish/subscribe track nào, và nó chỉ
 * tin một JWT do gateway ký bằng `LIVEKIT_API_SECRET`. Secret không bao giờ xuống
 * trình duyệt — hệt như mật khẩu TURN ở `turn-credentials.ts`: client chỉ nhận
 * JWT ngắn hạn, còn khoá ký nằm lại server.
 *
 * Chỉ AUDIO đợt này: grant cho publish/subscribe nhưng chặn `canPublishData` để
 * không mở kênh dữ liệu ngoài luồng.
 */

/** TTL token ~10 phút: đủ để join, hết hạn thì client xin lại qua accept. */
const TOKEN_TTL_SECONDS = 10 * 60

export interface GroupCallTokenInput {
  userId: string
  username: string
  roomName: string
}

/** `url` client dùng để `room.connect(url, token)`; `null` khi chưa cấu hình. */
export function getLivekitUrl(): string | null {
  const url = process.env.LIVEKIT_URL?.trim()
  return url ? url : null
}

/**
 * Cả ba biến phải có thì mới ký được token hợp lệ. Thiếu bất kỳ cái nào -> coi
 * như LiveKit chưa dựng, handler trả code `LIVEKIT_UNCONFIGURED` thay vì ném lỗi.
 */
function getCredentials(): { apiKey: string; apiSecret: string } | null {
  const apiKey = process.env.LIVEKIT_API_KEY?.trim()
  const apiSecret = process.env.LIVEKIT_API_SECRET?.trim()

  if (!apiKey || !apiSecret || !getLivekitUrl()) return null

  return { apiKey, apiSecret }
}

export function isLivekitConfigured(): boolean {
  return getCredentials() !== null
}

/**
 * Trả JWT string, hoặc `null` khi LIVEKIT_URL/API_KEY/API_SECRET chưa đủ.
 *
 * `identity = userId` để webhook `participant_*` khớp lại đúng người; `name` là
 * tên hiển thị mà LiveKit gắn vào `Participant.name` cho các peer khác thấy.
 */
export async function buildGroupCallToken({
  userId,
  username,
  roomName,
}: GroupCallTokenInput): Promise<string | null> {
  const creds = getCredentials()
  if (!creds) return null

  const token = new AccessToken(creds.apiKey, creds.apiSecret, {
    identity: userId,
    name: username,
    ttl: TOKEN_TTL_SECONDS,
  })

  token.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: false,
  })

  return token.toJwt()
}
