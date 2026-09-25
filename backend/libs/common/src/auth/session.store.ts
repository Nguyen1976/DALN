import { createHash, randomBytes } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import { RedisService } from '@app/redis/redis.service'
import {
  ABSOLUTE_SESSION_MAX_AGE_MS,
  REFRESH_TOKEN_TTL_SECONDS,
  ROTATION_GRACE_MS,
  SESSION_INDEX_TTL_SECONDS,
} from './session.constants'

/**
 * Nơi giữ state của phiên đăng nhập — thứ mà thiết kế cũ hoàn toàn không có.
 *
 * Access token vẫn là JWT tự chứa, nhưng refresh token thì KHÔNG còn là JWT: nó
 * là một chuỗi opaque `<sid>.<verifier>` mà server chỉ giữ `sha256(verifier)`.
 * Nhờ vậy xoá một key là thu hồi được phiên — điều không thể làm với token tự
 * chứa, và là lý do logout cũ chỉ xoá được cookie ở máy người tử tế.
 *
 * `sid` nằm sẵn trong cookie vì tới lúc gọi /user/refresh thì cookie access đã
 * bị trình duyệt xoá (maxAge đúng bằng TTL), nên request chỉ còn mang đúng một
 * cookie: refresh. Không có locator trong đó thì server không biết tra key nào.
 */

/**
 * Trần thời gian cho một lệnh Redis của tầng phiên.
 *
 * Vì sao cần: client Redis dùng `maxRetriesPerRequest: null` + retryStrategy
 * không giới hạn, nên khi Redis chết lệnh KHÔNG lỗi — nó xếp hàng vô hạn. Đo
 * thực tế lúc `docker stop redis`: request treo tới khi client tự timeout và
 * curl trả 000, thay vì 503 như thiết kế. Nhánh fail-closed chỉ chạy được nếu
 * lệnh chịu thất bại, nên biên này chính là thứ làm nó chạy.
 *
 * 1 giây là ~1000 lần thời gian một lệnh bình thường; Redis chậm hơn thế thì
 * trả 503 vẫn đúng hơn là bắt người dùng chờ.
 */
export const SESSION_STORE_TIMEOUT_MS = 1000

/** Tầng phiên không trả lời được — caller phải trả 503, KHÔNG phải 401. */
export class SessionStoreUnavailableError extends Error {
  constructor(operation: string, cause?: unknown) {
    super(`session store không phản hồi: ${operation}`)
    this.name = 'SessionStoreUnavailableError'
    this.cause = cause
  }
}

export const sessionKey = (sid: string) => `sess:${sid}`
export const sessionIndexKey = (userId: string) => `sess:idx:${userId}`

/** Kết quả của một lần trình refresh token. */
export type RefreshOutcome =
  /** Token đúng bản hiện tại: cấp token mới, bản cũ vào cửa sổ ân hạn. */
  | { status: 'rotated'; userId: string; sid: string; refreshToken: string }
  /** Token vừa bị thay nhưng còn trong 30s: cấp access mới, KHÔNG rotate nữa. */
  | { status: 'grace'; userId: string; sid: string }
  /** Token đã tiêu và hết ân hạn: có hai bên cùng giữ token -> giết cả phiên. */
  | { status: 'replayed'; userId: string; sid: string }
  /** Cookie méo, phiên không tồn tại, hoặc đã quá trần tuyệt đối. */
  | { status: 'invalid' }

/** Một phiên như trang "Thiết bị đang đăng nhập" cần. */
export interface SessionSummary {
  sid: string
  createdAt: number
  lastSeenAt: number
  userAgent: string | null
  ip: string | null
}

export interface SessionMeta {
  userAgent?: string | null
  ip?: string | null
}

const hashVerifier = (verifier: string): string =>
  createHash('sha256').update(verifier).digest('hex')

/**
 * Tách `<sid>.<verifier>`.
 *
 * base64url không chứa dấu chấm nên đúng một dấu chấm là ranh giới. Trả null
 * cho mọi thứ méo mó để caller không phải gọi Redis bằng một sid rác.
 */
export function parseRefreshCookie(
  value?: string | null,
): { sid: string; verifier: string } | null {
  if (!value) return null
  const at = value.indexOf('.')
  if (at <= 0 || at === value.length - 1) return null
  const sid = value.slice(0, at)
  const verifier = value.slice(at + 1)
  if (verifier.includes('.')) return null
  return { sid, verifier }
}

/**
 * Đối chiếu + rotate trong MỘT lệnh nguyên tử.
 *
 * Phải là Lua chứ không phải đọc-rồi-ghi từ Node: hai request song song cùng mang
 * token cũ sẽ cùng đọc thấy "khớp" rồi cùng rotate, và mỗi bên nghĩ cookie của
 * mình là bản sống. Trong script, đúng một bên thắng nhánh rotate; bên kia rơi
 * xuống nhánh ân hạn vì `prevHash` lúc đó đã chính là token nó đang cầm.
 *
 * KEYS[1] = sess:<sid>
 * ARGV    = [hash(đang trình), hash(cấp mới), now(ms), graceMs, idleTtlSeconds]
 */
const ROTATE_SCRIPT = `
local now = tonumber(ARGV[3])
local data = redis.call('HMGET', KEYS[1], 'uid', 'rtHash', 'prevHash', 'prevUntil', 'absExp')
local uid, rtHash, prevHash, prevUntil, absExp = data[1], data[2], data[3], data[4], data[5]

if not uid then return 'invalid' end

if absExp and tonumber(absExp) <= now then
  redis.call('DEL', KEYS[1])
  return 'invalid'
end

if rtHash == ARGV[1] then
  redis.call('HSET', KEYS[1],
    'rtHash', ARGV[2],
    'prevHash', rtHash,
    'prevUntil', now + tonumber(ARGV[4]),
    'lastSeenAt', now)
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[5]))
  return 'rotated|' .. uid
end

if prevHash and prevHash == ARGV[1] and tonumber(prevUntil or '0') > now then
  redis.call('HSET', KEYS[1], 'lastSeenAt', now)
  return 'grace|' .. uid
end

return 'replayed|' .. uid
`

@Injectable()
export class SessionStore {
  constructor(private readonly redis: RedisService) {}

  /** Tạo phiên mới lúc đăng nhập. Trả về sid để ký vào access token. */
  async create(
    userId: string,
    meta: SessionMeta = {},
  ): Promise<{ sid: string; refreshToken: string }> {
    const sid = randomBytes(16).toString('base64url')
    const verifier = randomBytes(32).toString('base64url')
    const now = Date.now()

    await this.bounded(
      'create',
      this.redis.pipeline([
        [
          'hset',
          sessionKey(sid),
          'uid',
          userId,
          'rtHash',
          hashVerifier(verifier),
          'absExp',
          String(now + ABSOLUTE_SESSION_MAX_AGE_MS),
          'createdAt',
          String(now),
          'lastSeenAt',
          String(now),
          'ua',
          meta.userAgent ?? '',
          'ip',
          meta.ip ?? '',
        ],
        ['expire', sessionKey(sid), REFRESH_TOKEN_TTL_SECONDS],
        ['sadd', sessionIndexKey(userId), sid],
        ['expire', sessionIndexKey(userId), SESSION_INDEX_TTL_SECONDS],
      ]),
    )

    return { sid, refreshToken: `${sid}.${verifier}` }
  }

  /**
   * Phiên của access token này còn sống không.
   *
   * Ném `SessionStoreUnavailableError` khi không trả lời kịp — guard phân biệt
   * nó với "phiên đã bị thu hồi" để trả 503 thay vì 401.
   */
  async isAlive(sid: string): Promise<boolean> {
    return await this.bounded('isAlive', this.redis.exists(sessionKey(sid)))
  }

  /** Chặn trên thời gian chờ để một lệnh treo không treo luôn cả request. */
  private async bounded<T>(operation: string, call: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined
    try {
      return await Promise.race([
        call,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new SessionStoreUnavailableError(operation)),
            SESSION_STORE_TIMEOUT_MS,
          )
        }),
      ])
    } catch (error) {
      if (error instanceof SessionStoreUnavailableError) throw error
      throw new SessionStoreUnavailableError(operation, error)
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  /**
   * Trình refresh token: rotate nếu đúng, ân hạn nếu vừa bị thay, còn lại là
   * dấu hiệu token bị đánh cắp.
   */
  async consume(cookieValue?: string | null): Promise<RefreshOutcome> {
    const parsed = parseRefreshCookie(cookieValue)
    if (!parsed) return { status: 'invalid' }

    const nextVerifier = randomBytes(32).toString('base64url')
    const raw = await this.bounded(
      'consume',
      this.redis.eval(
        ROTATE_SCRIPT,
        [sessionKey(parsed.sid)],
        [
          hashVerifier(parsed.verifier),
          hashVerifier(nextVerifier),
          String(Date.now()),
          String(ROTATION_GRACE_MS),
          String(REFRESH_TOKEN_TTL_SECONDS),
        ],
      ),
    )

    const [status, userId] = String(raw).split('|')

    if (status === 'rotated' && userId) {
      return {
        status: 'rotated',
        userId,
        sid: parsed.sid,
        refreshToken: `${parsed.sid}.${nextVerifier}`,
      }
    }
    if (status === 'grace' && userId) {
      return { status: 'grace', userId, sid: parsed.sid }
    }
    if (status === 'replayed' && userId) {
      return { status: 'replayed', userId, sid: parsed.sid }
    }
    return { status: 'invalid' }
  }

  /**
   * Thu hồi đúng một phiên — đăng xuất một thiết bị.
   *
   * Trả `false` khi sid KHÔNG thuộc user này, và không xoá gì.
   *
   * Thứ tự quan trọng: `SREM` chạy TRƯỚC và chính nó là bước kiểm chủ sở hữu
   * (chỉ trả 1 khi sid nằm trong chỉ mục của user này). Làm ngược lại — `DEL`
   * trước rồi mới kiểm — nghĩa là trang "Thiết bị đang đăng nhập" nhận sid từ
   * client sẽ xoá được phiên của NGƯỜI KHÁC chỉ bằng cách đổi một tham số.
   */
  async revokeSession(userId: string, sid: string): Promise<boolean> {
    const removed = await this.bounded(
      'revokeSession.own',
      this.redis.srem(sessionIndexKey(userId), sid),
    )
    if (removed < 1) return false

    await this.bounded('revokeSession.del', this.redis.del(sessionKey(sid)))
    return true
  }

  /**
   * Thu hồi mọi phiên của một user — đăng xuất mọi nơi, đổi/đặt lại mật khẩu,
   * hoặc phát hiện token bị dùng lại. Trả về các sid đã giết để gửi đi ngắt socket.
   */
  async revokeAllForUser(userId: string): Promise<string[]> {
    const sids = await this.bounded(
      'revokeAllForUser.read',
      this.redis.smembers(sessionIndexKey(userId)),
    )
    if (sids.length) {
      await this.bounded(
        'revokeAllForUser.del',
        this.redis.delMany(sids.map(sessionKey)),
      )
    }
    await this.bounded(
      'revokeAllForUser.index',
      this.redis.del(sessionIndexKey(userId)),
    )
    return sids
  }

  /**
   * Thu hồi mọi phiên của user TRỪ một phiên — "đăng xuất các thiết bị khác".
   *
   * Khác `revokeAllForUser` ở chỗ chỉ mục phải sống sót: nó còn giữ phiên hiện
   * tại. Nên ở đây là `SREM` đúng những sid vừa giết, không phải `DEL` cả key —
   * xoá cả chỉ mục sẽ làm phiên đang dùng biến mất khỏi trang "Thiết bị đang
   * đăng nhập" dù nó vẫn sống, và `revokeSession` sau đó không còn kiểm được
   * quyền sở hữu vì phép kiểm ấy dựa vào chính chỉ mục này.
   */
  async revokeAllExcept(userId: string, keepSid: string): Promise<string[]> {
    const sids = await this.bounded(
      'revokeAllExcept.read',
      this.redis.smembers(sessionIndexKey(userId)),
    )
    const doomed = sids.filter((sid) => sid !== keepSid)
    if (!doomed.length) return []

    await this.bounded(
      'revokeAllExcept.del',
      this.redis.delMany(doomed.map(sessionKey)),
    )
    await this.bounded(
      'revokeAllExcept.index',
      this.redis.srem(sessionIndexKey(userId), ...doomed),
    )
    return doomed
  }

  /**
   * Các phiên còn sống của một user.
   *
   * Chỉ mục có thể còn sid đã hết TTL (phiên chết già, không ai xoá khỏi set),
   * nên đường đọc tự dọn — đúng cách `isOnline` đang làm với `user:<id>:sockets`.
   */
  async listSessions(userId: string): Promise<SessionSummary[]> {
    const sids = await this.bounded(
      'listSessions.index',
      this.redis.smembers(sessionIndexKey(userId)),
    )
    if (!sids.length) return []

    const rows = await this.bounded(
      'listSessions.read',
      this.redis.pipeline(sids.map((sid) => ['hgetall', sessionKey(sid)])),
    )

    const alive: SessionSummary[] = []
    const stale: string[] = []

    sids.forEach((sid, i) => {
      const [, value] = rows[i] ?? []
      const fields = toHash(value)
      if (!fields.uid) {
        stale.push(sid)
        return
      }
      alive.push({
        sid,
        createdAt: Number(fields.createdAt ?? 0),
        lastSeenAt: Number(fields.lastSeenAt ?? 0),
        userAgent: fields.ua || null,
        ip: fields.ip || null,
      })
    })

    if (stale.length) {
      await this.redis.srem(sessionIndexKey(userId), ...stale)
    }
    return alive
  }
}

/** HGETALL của ioredis trả mảng phẳng [field, value, field, value, ...]. */
function toHash(value: unknown): Record<string, string> {
  if (!Array.isArray(value)) {
    return value && typeof value === 'object'
      ? (value as Record<string, string>)
      : {}
  }
  const out: Record<string, string> = {}
  for (let i = 0; i < value.length - 1; i += 2) {
    out[String(value[i])] = String(value[i + 1])
  }
  return out
}
