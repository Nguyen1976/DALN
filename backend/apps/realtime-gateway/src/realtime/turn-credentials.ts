import { createHmac } from 'crypto'

/**
 * Cấp cấu hình ICE (STUN + TURN) cho trình duyệt.
 *
 * Trước đây `useWebRTC.ts` hardcode hai STUN của Google. STUN chỉ cho mỗi máy
 * biết địa chỉ công khai của mình; CGNAT của nhà mạng di động cấp một cửa khác
 * cho mỗi nơi nhận nên địa chỉ đó vô dụng với bên kia, còn tường lửa công ty
 * thường chặn UDP. Khi đó cần TURN — đường vòng qua coturn của mình.
 *
 * coturn chạy ở chế độ `use-auth-secret`: không có danh sách user, nó tự kiểm
 * mật khẩu bằng chính `TURN_SECRET`. Nhờ vậy gateway ký được mật khẩu ngắn hạn
 * mà không cần gọi coturn qua mạng, và secret không bao giờ xuống trình duyệt.
 */

export interface IceServer {
  urls: string | string[]
  username?: string
  credential?: string
}

export interface IceConfig {
  iceServers: IceServer[]
  /** Unix giây — lúc mật khẩu TURN hết hiệu lực. `null` khi chưa cấu hình TURN. */
  expiresAt: number | null
  /** Số giây mật khẩu còn dùng được; client xin lại trước khi hết hạn. */
  ttlSeconds: number
}

const DEFAULT_STUN_URLS = [
  'stun:stun.l.google.com:19302',
  'stun:stun1.l.google.com:19302',
]

const DEFAULT_TTL_SECONDS = 3600
const DEFAULT_TURN_PORT = '3478'
const DEFAULT_TURN_TLS_PORT = '5349'

function splitList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

/**
 * `TURN_URLS` là cách khai báo thẳng (ưu tiên). Nếu chỉ có host/domain thì dựng
 * bộ URL chuẩn: udp và tcp ở 3478, tls ở 5349 — `turn:` trỏ thẳng IP nên không
 * phụ thuộc DNS, `turns:` cần tên miền khớp chứng chỉ.
 */
function resolveTurnUrls(): string[] {
  const explicit = splitList(process.env.TURN_URLS)
  if (explicit.length) return explicit

  const urls: string[] = []

  const host = process.env.TURN_HOST?.trim()
  if (host) {
    const port = process.env.TURN_PORT?.trim() || DEFAULT_TURN_PORT
    urls.push(
      `turn:${host}:${port}?transport=udp`,
      `turn:${host}:${port}?transport=tcp`,
    )
  }

  const tlsHost = process.env.TURN_TLS_HOST?.trim()
  if (tlsHost) {
    const tlsPort = process.env.TURN_TLS_PORT?.trim() || DEFAULT_TURN_TLS_PORT
    urls.push(`turns:${tlsHost}:${tlsPort}?transport=tcp`)
  }

  return urls
}

function resolveStunUrls(): string[] {
  const configured = splitList(process.env.STUN_URLS)
  return configured.length ? configured : DEFAULT_STUN_URLS
}

function resolveTtlSeconds(): number {
  // Chấp nhận cả hai tên: `TURN_TTL` (env/.env.production.example, bản thiết kế)
  // và `TURN_CREDENTIAL_TTL_SECONDS`. Ưu tiên tên ngắn nếu có.
  const raw = Number(
    process.env.TURN_TTL ?? process.env.TURN_CREDENTIAL_TTL_SECONDS,
  )
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_TTL_SECONDS
}

/**
 * Giao thức REST của coturn: username là `<hạn unix>:<định danh>`, credential là
 * base64 của HMAC-SHA1(secret, username). coturn tính lại đúng công thức này để
 * kiểm, nên mật khẩu tự hết hạn mà không cần ai thu hồi.
 */
export function buildTurnCredential(secret: string, username: string): string {
  return createHmac('sha1', secret).update(username).digest('base64')
}

export function buildIceConfig(
  userId: string,
  nowMs: number = Date.now(),
): IceConfig {
  const stunServers: IceServer[] = resolveStunUrls().map((urls) => ({ urls }))
  const secret = process.env.TURN_SECRET?.trim()
  const turnUrls = resolveTurnUrls()

  // Chưa dựng coturn (máy dev, hoặc prod chưa cấu hình) thì vẫn trả STUN để
  // cuộc gọi cùng mạng chạy được như trước, thay vì hỏng hẳn.
  if (!secret || !turnUrls.length) {
    return { iceServers: stunServers, expiresAt: null, ttlSeconds: 0 }
  }

  const ttlSeconds = resolveTtlSeconds()
  const expiresAt = Math.floor(nowMs / 1000) + ttlSeconds
  const username = `${expiresAt}:${userId}`

  return {
    iceServers: [
      ...stunServers,
      {
        urls: turnUrls,
        username,
        credential: buildTurnCredential(secret, username),
      },
    ],
    expiresAt,
    ttlSeconds,
  }
}
