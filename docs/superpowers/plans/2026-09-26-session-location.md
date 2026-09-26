# Vị trí và thời gian của phiên đăng nhập — Kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trang "Phiên đăng nhập" cho biết mỗi thiết bị đăng nhập lúc nào và ở đâu, gần nhất hoạt động lúc nào và ở đâu (IP kèm vị trí ước tính), có bản đồ mini và link Google Maps.

**Architecture:** `SessionStore` thêm field `lastIp` vào hash `sess:<sid>`. Field này được ghi trong script Lua rotate ở mỗi lần refresh; `ip` giữ nguyên là IP lúc đăng nhập. `GeoIpService` chỉ nằm trong app `user`: nó mở file MaxMind GeoLite2 `.mmdb` lúc khởi động và tra vị trí **lúc đọc** trong `listOwnSessions`; thiếu file thì trả `null`, không bao giờ ném lỗi. Frontend thêm `SessionRow` (bấm để mở chi tiết) và `SessionMiniMap`, bản đồ tự ghép từ tile OSM tĩnh với vòng tròn theo `accuracy_radius`, không thêm dependency nào.

**Tech Stack:** NestJS 11 · ioredis + Redis 7 (Lua) · `maxmind` 5 (đọc `.mmdb`, JS thuần) · Jest 30 + ts-jest · React 19 + Vite + Tailwind 4 · tile OpenStreetMap · puppeteer-core (QC)

**Spec:** [`docs/superpowers/specs/2026-09-26-session-location-design.md`](../specs/2026-09-26-session-location-design.md)

## Global Constraints

- Giao diện bằng tiếng Việt. Tên địa danh lấy nguyên bản tiếng Anh của GeoLite2 ("London, United Kingdom").
- `ip` là IP lúc đăng nhập và **không bao giờ bị ghi lại**. `lastIp` được ghi ở `create()` (bằng `ip`), và ở nhánh `rotated`/`grace` của Lua khi IP khác rỗng. Nhánh `replayed` **không** ghi.
- Khi đọc: `lastIp || ip || null`. Không cần migrate.
- `GET /user/sessions` chỉ **thêm** field (`lastIp`, `location`, `lastLocation`), không xoá hay đổi tên field nào.
- `GeoIpService` không bao giờ ném lỗi. Thiếu hoặc hỏng file thì cảnh báo **một lần**, sau đó mọi lần tra trả `null`.
- File dữ liệu: `GEOIP_DB_PATH`, mặc định `path.join(process.cwd(), 'geoip', 'GeoLite2-City.mmdb')`.
- Last Active đo theo refresh (lệch tối đa 15 phút). **Không đụng `AuthGuard`.**
- Bản đồ:
  - khung 320×160;
  - zoom = `clamp(floor(log2(156543.03392·cos(lat)·48 / (radiusKm·1000))), 2, 13)`;
  - bán kính vòng tròn bị kẹp trong `[8, 76]` px;
  - tile: `https://tile.openstreetmap.org/{z}/{x}/{y}.png`;
  - link: `https://www.google.com/maps/@?api=1&map_action=map&center={lat},{lon}&zoom={z}`, không cắm pin.
- Dòng ghi công: "Dữ liệu vị trí: GeoLite2 (MaxMind) · Bản đồ © OpenStreetMap".
- `formatLastActive`: dưới 60 giây `vừa xong`, dưới 1 giờ `N phút trước`, dưới 24 giờ `N giờ trước`, dưới 7 ngày `N ngày trước`, từ 7 ngày trở đi `dd/mm/yyyy`. `formatSignInDate` trả dạng `15/09/2026 lúc 08:12`. **Không sửa `formatRelativeTime`.**
- Frontend không thêm dependency. Backend thêm đúng một: `maxmind`.
- Cổng kiểm:
  - backend (chạy trong `backend/`): `npm run typecheck`, `npm test`, `npm run lint:check`;
  - frontend (chạy trong `frontend/`): `npm run lint`, `npm run build`.
  - Frontend không có test runner. Hàm thuần được kiểm bằng một script Node chạy thẳng file `.ts` (Node 24 tự bỏ type; `tsconfig.app.json` đã bật `erasableSyntaxOnly`). Giao diện được kiểm bằng QC Puppeteer.
- Commit:
  - Conventional Commits bằng tiếng Anh, mỗi task một commit;
  - `git add` đúng từng đường dẫn;
  - **không** thêm trailer `Co-Authored-By`;
  - không bao giờ stage `.claude/`, `backend/.env*`, `backend/geoip/`.

## Review Focus

Năm loại đầu vào mà spec ngầm yêu cầu nhưng test của task không tự phủ tới. Xếp theo khả năng gây lỗi cho người dùng, cao nhất trước. Mỗi dòng đã có test ở task sở hữu phần code đó.

1. **Frontend mới gặp API cũ trong lúc deploy.** `lastIp`, `location`, `lastLocation` là `undefined`, không phải `null`. Trang không được vỡ: dòng thu gọn hiện IP như cũ, panel ghi "Không xác định được vị trí". Test: Task 5 mục QC 10.
2. **Không tải được tile** (mất mạng, adblock, proxy chặn `tile.openstreetmap.org`). Khối bản đồ biến mất, nhưng nhãn bán kính, link Maps và hai mốc thời gian vẫn còn. Test: Task 5 mục QC 9.
3. **Bán kính cực trị.** 0 km thì vòng tròn không được biến mất; 3000 km thì vòng tròn không được tràn khỏi khung 160px. Test: Task 4 script, `circleRadiusPx` ∈ [8, 76].
4. **Kinh độ gần ±180, vĩ độ gần cực.** Cột tile phải quấn modulo `2^z`, hàng tile bị kẹp; URL tile không bao giờ chứa số âm hoặc ≥ `2^z`. Test: Task 4 script.
5. **Đồng hồ lệch.** `lastSeenAt` lớn hơn `Date.now()` của trình duyệt vài giây thì phải hiện "vừa xong", không phải "-1 phút trước". Test: Task 4 script.

---

## Cấu trúc tệp

**Backend — tạo mới**

| Tệp | Trách nhiệm |
|---|---|
| `backend/apps/user/src/geoip/geoip.service.ts` | Mở file `.mmdb`, tra IP → `GeoLocation \| null`, không bao giờ ném |
| `backend/apps/user/src/geoip/geoip.service.spec.ts` | Test trên file `.mmdb` thật |
| `backend/apps/user/src/geoip/__fixtures__/GeoIP2-City-Test.mmdb` | DB kiểm thử công khai của MaxMind (22 KB, Apache-2.0/MIT) |

**Backend — sửa**

| Tệp | Thay đổi |
|---|---|
| `backend/libs/common/src/auth/session.store.ts` | `lastIp` ở `create`, `ARGV[6]` trong Lua, `consume(…, meta)`, `SessionSummary.lastIp` |
| `backend/libs/common/src/auth/session.store.spec.ts` | Test mock cho các thay đổi trên |
| `backend/libs/common/src/auth/session.store.redis.spec.ts` | Ma trận `lastIp` trên Redis thật |
| `backend/apps/user/src/domain/user.domain.ts` | Kiểu `GeoLocation`; thêm 3 field vào `SessionListItem` |
| `backend/apps/user/src/user.service.ts` | Nhận `GeoIpService`; `refreshSession(cookie, meta)`; `listOwnSessions` tra vị trí |
| `backend/apps/user/src/http/user-http.controller.ts` | `refresh` lấy `@Ip()` |
| `backend/apps/user/src/user.module.ts` | Đăng ký `GeoIpService` |
| `backend/apps/user/src/user.service.session.spec.ts` | Test vị trí + truyền IP; constructor thêm tham số thứ 12 |
| `backend/apps/user/src/user.service.{password-reset,change-password,make-friend}.spec.ts` | Constructor thêm tham số thứ 12 (5 chỗ) |
| `backend/package.json`, `backend/package-lock.json` | `maxmind` |
| `backend/docker-compose.prod.yml` | Volume `./geoip:/app/geoip:ro` cho `user` |
| `backend/.gitignore` | `/geoip/` |
| `deploy/README.md` | Mục GeoIP |

**Frontend**

| Tệp | Thay đổi |
|---|---|
| `frontend/src/apis/user.ts` | Kiểu `GeoLocation`; thêm field vào `UserSession` |
| `frontend/src/utils/formatDateTime.ts` | `formatLastActive`, `formatSignInDate` |
| `frontend/src/utils/geo.ts` | **Mới.** Toán bản đồ, URL Maps, `formatPlace` |
| `frontend/src/pages/Settings/SessionMiniMap.tsx` | **Mới.** Bản đồ tile tĩnh + vòng tròn |
| `frontend/src/pages/Settings/SessionRow.tsx` | **Mới.** Dòng bấm-để-mở + panel chi tiết |
| `frontend/src/pages/Settings/Account.tsx` | Dùng `SessionRow` cho mọi dòng thiết bị |

**QC**

| Tệp | Thay đổi |
|---|---|
| `qc/session-location-browser.mjs` | **Mới.** 12 nhóm kiểm trên Chrome thật |
| `qc/README.md` | Chuẩn bị + lệnh chạy + dòng trong bảng |

---

## Task 1: `SessionStore` ghi `lastIp`

**Files:**
- Modify: `backend/libs/common/src/auth/session.store.ts`
- Test: `backend/libs/common/src/auth/session.store.spec.ts`
- Test: `backend/libs/common/src/auth/session.store.redis.spec.ts`

**Interfaces:**
- Produces:
  - `SessionSummary.lastIp: string | null`
  - `SessionStore.consume(cookieValue?: string | null, meta?: Pick<SessionMeta, 'ip'>): Promise<RefreshOutcome>`
  - hash field `lastIp`
  - Lua `ARGV[6]` = IP (`''` khi không biết)

- [ ] **Step 1: Viết test mock (đỏ)**

Trong `session.store.spec.ts`, thêm vào **cuối** `describe('SessionStore.create', …)`:

```ts
  it('lastIp bắt đầu bằng đúng IP lúc đăng nhập', async () => {
    const { redis, store } = makeRedis()

    await store.create('u1', { userAgent: 'Chrome/1', ip: '10.0.0.9' })
    const hset = commandAsHash(pipelineArgs(redis.pipeline!)[0])

    expect(hset.lastIp).toBe('10.0.0.9')
  })
```

Thêm vào **cuối** `describe('SessionStore.consume', …)`:

```ts
  it('truyền IP của request refresh vào script làm ARGV[6]', async () => {
    const { redis, store } = makeRedis({
      eval: jest.fn().mockResolvedValue('rotated|u1'),
    })

    await store.consume('sid1.old-verifier', { ip: '81.2.69.142' })

    expect(evalArgs(redis.eval!)[5]).toBe('81.2.69.142')
  })

  it('không biết IP -> ARGV[6] rỗng để script KHÔNG đè IP cũ', async () => {
    const { redis, store } = makeRedis({
      eval: jest.fn().mockResolvedValue('rotated|u1'),
    })

    await store.consume('sid1.old-verifier')

    expect(evalArgs(redis.eval!)[5]).toBe('')
  })
```

Trong `describe('SessionStore.listSessions', …)`, test `'trả phiên còn sống và tự dọn sid đã chết khỏi chỉ mục'` dùng hash **không có** field `lastIp`, tức đúng ca phiên tạo trước lúc deploy. Sửa object mong đợi của test đó:

```ts
    expect(sessions).toEqual([
      {
        sid: 'alive',
        createdAt: 1000,
        lastSeenAt: 2000,
        userAgent: 'Chrome',
        ip: '10.0.0.1',
        // Hash này chưa có lastIp (phiên tạo trước tính năng): nơi gần nhất
        // mà ta biết chính là nơi đăng nhập.
        lastIp: '10.0.0.1',
      },
    ])
```

Rồi thêm test mới vào cuối `describe` đó:

```ts
  it('trả lastIp riêng khi phiên đã refresh từ nơi khác', async () => {
    const { store } = makeRedis({
      smembers: jest.fn().mockResolvedValue(['s1']),
      pipeline: jest.fn().mockResolvedValue([
        [
          null,
          [
            'uid',
            'u1',
            'createdAt',
            '1000',
            'lastSeenAt',
            '2000',
            'ua',
            'Chrome',
            'ip',
            '81.2.69.142',
            'lastIp',
            '89.160.20.112',
          ],
        ],
      ]),
    })

    const [session] = await store.listSessions('u1')

    expect(session).toMatchObject({
      ip: '81.2.69.142',
      lastIp: '89.160.20.112',
    })
  })
```

- [ ] **Step 2: Viết test trên Redis thật (đỏ)**

Trong `session.store.redis.spec.ts`, thêm vào cuối khối `describeRedis(…)`, trước dấu `})` cuối cùng:

```ts
  it('lastIp: create ghi bằng ip; rotate và ân hạn cập nhật lastIp, ip giữ nguyên', async () => {
    const { sid, refreshToken } = await store.create('u1', {
      ip: '81.2.69.142',
    })
    expect(await client.hmget(sessionKey(sid), 'ip', 'lastIp')).toEqual([
      '81.2.69.142',
      '81.2.69.142',
    ])

    const rotated = await store.consume(refreshToken, { ip: '89.160.20.112' })
    expect(rotated.status).toBe('rotated')
    expect(await client.hmget(sessionKey(sid), 'ip', 'lastIp')).toEqual([
      '81.2.69.142',
      '89.160.20.112',
    ])

    // Cùng token cũ, trong cửa sổ ân hạn: vẫn là thiết bị thật, vẫn ghi.
    const grace = await store.consume(refreshToken, { ip: '175.16.199.0' })
    expect(grace.status).toBe('grace')
    expect(await client.hmget(sessionKey(sid), 'ip', 'lastIp')).toEqual([
      '81.2.69.142',
      '175.16.199.0',
    ])
  })

  it('refresh không biết IP -> lastIp cũ KHÔNG bị xoá', async () => {
    const { sid, refreshToken } = await store.create('u1', {
      ip: '81.2.69.142',
    })

    await store.consume(refreshToken)

    expect(await client.hget(sessionKey(sid), 'lastIp')).toBe('81.2.69.142')
  })

  it('replayed KHÔNG ghi IP của bên đang trình token bị đánh cắp', async () => {
    const { sid, refreshToken } = await store.create('u1', {
      ip: '81.2.69.142',
    })
    await store.consume(refreshToken, { ip: '89.160.20.112' })
    await client.hset(sessionKey(sid), 'prevUntil', String(Date.now() - 1))

    const outcome = await store.consume(refreshToken, { ip: '67.43.156.0' })

    expect(outcome.status).toBe('replayed')
    expect(await client.hget(sessionKey(sid), 'lastIp')).toBe('89.160.20.112')
  })

  it('listSessions trả lastIp; hash cũ chưa có lastIp thì lấy ip', async () => {
    const moved = await store.create('u1', { ip: '81.2.69.142' })
    await store.consume(moved.refreshToken, { ip: '89.160.20.112' })
    const legacy = await store.create('u1', { ip: '175.16.199.0' })
    await client.hdel(sessionKey(legacy.sid), 'lastIp')

    const sessions = await store.listSessions('u1')
    const bySid = Object.fromEntries(sessions.map((s) => [s.sid, s]))

    expect(bySid[moved.sid]).toMatchObject({
      ip: '81.2.69.142',
      lastIp: '89.160.20.112',
    })
    expect(bySid[legacy.sid]).toMatchObject({
      ip: '175.16.199.0',
      lastIp: '175.16.199.0',
    })
  })
```

- [ ] **Step 3: Chạy, xác nhận đỏ**

Redis dev phải đang chạy (`docker ps | grep daln-redis`; nếu chưa: `cd backend && docker compose up -d redis`).

```bash
cd backend
npx jest libs/common/src/auth/session.store.spec.ts
TEST_REDIS_PORT=6380 npx jest libs/common/src/auth/session.store.redis.spec.ts
```

Mong đợi: **FAIL** — `hset.lastIp` là `undefined`, `ARGV[6]` là `undefined`, `toEqual` của `listSessions` thiếu `lastIp`, `hmget` trả `[…, null]`. Suite Redis phải **chạy thật**: nếu Jest in `skipped` thì Redis chưa lên.

- [ ] **Step 4: Cài đặt**

Trong `session.store.ts`, thay **toàn bộ** comment đứng trước và hằng `ROTATE_SCRIPT` bằng:

```ts
/**
 * Đối chiếu + rotate trong MỘT lệnh nguyên tử.
 *
 * Phải là Lua chứ không phải đọc-rồi-ghi từ Node: hai request song song cùng mang
 * token cũ sẽ cùng đọc thấy "khớp" rồi cùng rotate, và mỗi bên nghĩ cookie của
 * mình là bản sống. Trong script, đúng một bên thắng nhánh rotate; bên kia rơi
 * xuống nhánh ân hạn vì `prevHash` lúc đó đã chính là token nó đang cầm.
 *
 * KEYS[1] = sess:<sid>
 * ARGV    = [hash(đang trình), hash(cấp mới), now(ms), graceMs, idleTtlSeconds, ip]
 *
 * `ip` là IP của request refresh, '' khi không biết. Chỉ hai nhánh còn sống được
 * ghi nó vào `lastIp`: nhánh replayed là token bị đánh cắp, và IP của bên đó
 * không được đè lên nơi thiết bị thật đang ở. '' không bao giờ xoá IP đã biết.
 */
const ROTATE_SCRIPT = `
local now = tonumber(ARGV[3])
local ip = ARGV[6] or ''
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
  if ip ~= '' then redis.call('HSET', KEYS[1], 'lastIp', ip) end
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[5]))
  return 'rotated|' .. uid
end

if prevHash and prevHash == ARGV[1] and tonumber(prevUntil or '0') > now then
  redis.call('HSET', KEYS[1], 'lastSeenAt', now)
  if ip ~= '' then redis.call('HSET', KEYS[1], 'lastIp', ip) end
  return 'grace|' .. uid
end

return 'replayed|' .. uid
`
```

Thay interface `SessionSummary`:

```ts
/** Một phiên như trang "Thiết bị đang đăng nhập" cần. */
export interface SessionSummary {
  sid: string
  createdAt: number
  lastSeenAt: number
  userAgent: string | null
  /** IP lúc đăng nhập — không bao giờ bị ghi lại. */
  ip: string | null
  /**
   * IP của lần refresh gần nhất. Phiên tạo trước khi có field này thì bằng
   * `ip`: nơi gần nhất mà ta biết chính là nơi đăng nhập.
   */
  lastIp: string | null
}
```

Trong `create()`, ngay sau cặp `'ip', meta.ip ?? '',` của lệnh `hset`, thêm:

```ts
          'lastIp',
          meta.ip ?? '',
```

Thay chữ ký và mảng ARGV của `consume()`:

```ts
  async consume(
    cookieValue?: string | null,
    meta: Pick<SessionMeta, 'ip'> = {},
  ): Promise<RefreshOutcome> {
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
          meta.ip ?? '',
        ],
      ),
    )
```

Phần còn lại của `consume()` (từ `const [status, userId] = …`) giữ nguyên.

Trong `listSessions()`, thay khối `alive.push({…})`:

```ts
      alive.push({
        sid,
        createdAt: Number(fields.createdAt ?? 0),
        lastSeenAt: Number(fields.lastSeenAt ?? 0),
        userAgent: fields.ua || null,
        ip: fields.ip || null,
        lastIp: fields.lastIp || fields.ip || null,
      })
```

- [ ] **Step 5: Chạy, xác nhận xanh**

```bash
cd backend
npx jest libs/common/src/auth/session.store.spec.ts
TEST_REDIS_PORT=6380 npx jest libs/common/src/auth/session.store.redis.spec.ts
npm run typecheck
```

Mong đợi: PASS cả hai suite. Suite Redis báo đủ 4 test mới là `passed`, không phải `skipped`. `typecheck` sạch.

- [ ] **Step 6: Commit**

```bash
cd /Users/nguyenn/Documents/Source/project/DALN
git add backend/libs/common/src/auth/session.store.ts backend/libs/common/src/auth/session.store.spec.ts backend/libs/common/src/auth/session.store.redis.spec.ts
git commit -m "feat(auth): record the latest IP of a session on every refresh"
```

---

## Task 2: `GeoIpService` và file dữ liệu GeoLite2

**Files:**
- Create: `backend/apps/user/src/geoip/geoip.service.ts`
- Create: `backend/apps/user/src/geoip/geoip.service.spec.ts`
- Create: `backend/apps/user/src/geoip/__fixtures__/GeoIP2-City-Test.mmdb`
- Modify: `backend/apps/user/src/domain/user.domain.ts` (chỉ thêm kiểu `GeoLocation`)
- Modify: `backend/package.json`, `backend/package-lock.json`
- Modify: `backend/docker-compose.prod.yml`, `backend/.gitignore`, `deploy/README.md`

**Interfaces:**
- Produces:
  - `interface GeoLocation { city: string | null; country: string | null; latitude: number; longitude: number; accuracyRadiusKm: number }` trong `apps/user/src/domain/user.domain.ts`
  - `geoIpDbPath(): string`
  - `class GeoIpService { load(dbPath: string): Promise<void>; lookup(ip: string | null | undefined): GeoLocation | null }` — `onModuleInit` gọi `load(geoIpDbPath())`

- [ ] **Step 1: Thêm dependency và fixture**

```bash
cd backend
npm install maxmind@^5.0.7
mkdir -p apps/user/src/geoip/__fixtures__
curl -sSfL -o apps/user/src/geoip/__fixtures__/GeoIP2-City-Test.mmdb \
  https://raw.githubusercontent.com/maxmind/MaxMind-DB/000a8df991543651637fd9c16b7a7f8480370514/test-data/GeoIP2-City-Test.mmdb
shasum -a 256 apps/user/src/geoip/__fixtures__/GeoIP2-City-Test.mmdb
```

Mong đợi: hash `ed972738e4e03a3e56e12041a6af4d91592249d110f7e4a647e5f2fa0e639c09`. URL đã ghim theo commit nên hash không đổi.

- [ ] **Step 2: Thêm kiểu `GeoLocation`**

Trong `apps/user/src/domain/user.domain.ts`, thêm ngay **trước** comment `/** Một thiết bị đang đăng nhập, …` của `SessionListItem`:

```ts
/**
 * Vị trí ước tính từ IP (GeoLite2). Chỉ là ước tính: `accuracyRadiusKm` là
 * bán kính bất định, và giao diện vẽ đúng vùng đó chứ không cắm một điểm.
 */
export interface GeoLocation {
  /** null khi dữ liệu chỉ biết tới quốc gia. */
  city: string | null
  country: string | null
  latitude: number
  longitude: number
  accuracyRadiusKm: number
}

```

- [ ] **Step 3: Viết test (đỏ)**

Tạo `apps/user/src/geoip/geoip.service.spec.ts`:

```ts
import path from 'node:path'
import { GeoIpService, geoIpDbPath } from './geoip.service'

/**
 * Chạy trên file .mmdb THẬT: DB kiểm thử công khai của MaxMind
 * (github.com/maxmind/MaxMind-DB, Apache-2.0/MIT), cùng định dạng với
 * GeoLite2-City. Mock reader ở đây nghĩa là test lại chính cái mock.
 */
const FIXTURE = path.join(__dirname, '__fixtures__', 'GeoIP2-City-Test.mmdb')

function makeService() {
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  return { service: new GeoIpService(logger as never), logger }
}

describe('GeoIpService — có file dữ liệu', () => {
  const { service, logger } = makeService()

  beforeAll(async () => {
    await service.load(FIXTURE)
  })

  it('nạp được file và không cảnh báo gì', () => {
    expect(logger.warn).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledTimes(1)
  })

  it.each([
    [
      '81.2.69.142',
      {
        city: 'London',
        country: 'United Kingdom',
        latitude: 51.5142,
        longitude: -0.0931,
        accuracyRadiusKm: 10,
      },
    ],
    [
      '89.160.20.112',
      {
        city: 'Linköping',
        country: 'Sweden',
        latitude: 58.4167,
        longitude: 15.6167,
        accuracyRadiusKm: 76,
      },
    ],
    [
      '175.16.199.0',
      {
        city: 'Changchun',
        country: 'China',
        latitude: 43.88,
        longitude: 125.3228,
        accuracyRadiusKm: 100,
      },
    ],
    // Chỉ biết tới quốc gia: city null, bán kính lớn — giao diện dựa vào
    // đây để lùi zoom thay vì cắm một điểm trông chính xác.
    [
      '67.43.156.0',
      {
        city: null,
        country: 'Bhutan',
        latitude: 27.5,
        longitude: 90.5,
        accuracyRadiusKm: 534,
      },
    ],
    [
      '2001:218::1',
      {
        city: null,
        country: 'Japan',
        latitude: 35.68536,
        longitude: 139.75309,
        accuracyRadiusKm: 100,
      },
    ],
  ])('%s -> đúng vị trí', (ip, expected) => {
    expect(service.lookup(ip)).toEqual(expected)
  })

  // Express trả dạng này khi socket là IPv6 còn client là IPv4.
  it('IPv4-mapped (::ffff:) cho cùng kết quả như IPv4', () => {
    expect(service.lookup('::ffff:81.2.69.142')).toEqual(
      service.lookup('81.2.69.142'),
    )
  })

  it.each([
    ['loopback', '127.0.0.1'],
    ['mạng docker', '172.22.0.1'],
    ['loopback IPv6', '::1'],
    ['dải tài liệu IPv6', '2001:db8::1'],
    ['chuỗi rác', 'not-an-ip'],
    ['chuỗi rỗng', ''],
    ['null', null],
    ['undefined', undefined],
  ])('%s -> null, không ném', (_label, ip) => {
    expect(service.lookup(ip)).toBeNull()
  })
})

describe('GeoIpService — không dùng được file dữ liệu', () => {
  it('thiếu file -> lookup luôn null, không ném, cảnh báo đúng một lần', async () => {
    const { service, logger } = makeService()

    await service.load('/khong/ton/tai/GeoLite2-City.mmdb')

    expect(service.lookup('81.2.69.142')).toBeNull()
    expect(service.lookup('89.160.20.112')).toBeNull()
    expect(logger.warn).toHaveBeenCalledTimes(1)
  })

  it('file hỏng -> lookup null, không ném', async () => {
    const { service, logger } = makeService()

    await service.load(__filename) // một file .ts, không phải .mmdb

    expect(service.lookup('81.2.69.142')).toBeNull()
    expect(logger.warn).toHaveBeenCalledTimes(1)
  })

  it('chưa nạp gì -> null', () => {
    const { service } = makeService()
    expect(service.lookup('81.2.69.142')).toBeNull()
  })
})

describe('geoIpDbPath', () => {
  const original = process.env.GEOIP_DB_PATH

  afterEach(() => {
    if (original === undefined) delete process.env.GEOIP_DB_PATH
    else process.env.GEOIP_DB_PATH = original
  })

  it('mặc định nằm cạnh cwd — /app/geoip trong container', () => {
    delete process.env.GEOIP_DB_PATH
    expect(geoIpDbPath()).toBe(
      path.join(process.cwd(), 'geoip', 'GeoLite2-City.mmdb'),
    )
  })

  it('GEOIP_DB_PATH ghi đè được', () => {
    process.env.GEOIP_DB_PATH = '/data/khac.mmdb'
    expect(geoIpDbPath()).toBe('/data/khac.mmdb')
  })
})
```

- [ ] **Step 4: Chạy, xác nhận đỏ**

```bash
cd backend && npx jest apps/user/src/geoip
```

Mong đợi: **FAIL** — `Cannot find module './geoip.service'`.

- [ ] **Step 5: Cài đặt**

Tạo `apps/user/src/geoip/geoip.service.ts`:

```ts
import path from 'node:path'
import { Injectable, OnModuleInit } from '@nestjs/common'
import { open, type CityResponse, type Reader } from 'maxmind'
import { LoggerService } from '@app/logger'
import type { GeoLocation } from '../domain/user.domain'

/**
 * Nơi đặt file GeoLite2-City. Mặc định nằm cạnh cwd như `gb.json` của
 * recommendation: trong container prod là /app/geoip (bind mount chỉ đọc từ
 * backend/geoip trên server), ở dev là backend/geoip. File không nằm trong
 * git: điều khoản GeoLite2 không cho phân phối lại, và file nặng ~60MB.
 */
export function geoIpDbPath(): string {
  return (
    process.env.GEOIP_DB_PATH?.trim() ||
    path.join(process.cwd(), 'geoip', 'GeoLite2-City.mmdb')
  )
}

/**
 * Tra vị trí ước tính của một IP từ file MaxMind đặt ngay trên server.
 *
 * Tra tại chỗ chứ không gọi API ngoài, nên IP của người dùng không rời hệ
 * thống — đúng tinh thần của một trang bảo mật.
 *
 * KHÔNG BAO GIỜ ném. Thiếu file (dev chưa tải, server chưa đặt) hay file hỏng
 * thì mọi lần tra trả `null`: trang "Thiết bị đang đăng nhập" mất bản đồ chứ
 * không được mất cả danh sách vì một tính năng phụ.
 */
@Injectable()
export class GeoIpService implements OnModuleInit {
  private reader: Reader<CityResponse> | null = null

  constructor(private readonly logger: LoggerService) {}

  async onModuleInit(): Promise<void> {
    await this.load(geoIpDbPath())
  }

  async load(dbPath: string): Promise<void> {
    try {
      this.reader = await open<CityResponse>(dbPath)
      this.logger.info('[geoip] đã nạp dữ liệu vị trí', { path: dbPath })
    } catch (error) {
      this.reader = null
      this.logger.warn('[geoip] không mở được file dữ liệu, vị trí sẽ để trống', {
        path: dbPath,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  lookup(ip: string | null | undefined): GeoLocation | null {
    if (!ip || !this.reader) return null

    let record: CityResponse | null
    try {
      record = this.reader.get(ip)
    } catch {
      return null
    }

    const location = record?.location
    if (!record || !location) return null

    return {
      city: record.city?.names.en ?? null,
      country:
        record.country?.names.en ?? record.registered_country?.names.en ?? null,
      latitude: location.latitude,
      longitude: location.longitude,
      accuracyRadiusKm: location.accuracy_radius,
    }
  }
}
```

- [ ] **Step 6: Chạy, xác nhận xanh**

```bash
cd backend
npx jest apps/user/src/geoip
npm run typecheck
```

Mong đợi: PASS. `typecheck` sạch; đây là chỗ xác nhận import có tên từ `maxmind` biên dịch được dưới `module: nodenext`.

- [ ] **Step 7: Nối file dữ liệu vào deploy**

Trong `backend/docker-compose.prod.yml`, service `user`, thêm khối `volumes` ngay sau dòng `REFRESH_COOKIE_PATH: ${REFRESH_COOKIE_PATH:-/user}`, cùng mức thụt lề với `environment:`:

```yaml
    # File GeoLite2-City cho trang "Thiết bị đang đăng nhập". Đặt tay trên
    # server (deploy/README.md, mục GeoIP). Thiếu file thì service vẫn chạy,
    # chỉ không có vị trí.
    volumes:
      - ./geoip:/app/geoip:ro
```

Thêm vào cuối `backend/.gitignore`:

```
# GeoLite2 — tải từ MaxMind, không được phân phối lại (deploy/README.md, mục GeoIP)
/geoip/
```

Trong `deploy/README.md`, thêm mục sau ngay **trước** dòng `## Env`:

````markdown
## GeoIP — vị trí trên trang "Thiết bị đang đăng nhập"

Service `user` tra vị trí ước tính của IP từ file MaxMind **GeoLite2-City** đặt
ngay trên server, không gọi API ngoài. File không nằm trong git. Thiếu file thì
mọi thứ vẫn chạy; trang chỉ không có vị trí và bản đồ.

```bash
# 1. Máy local: đăng ký tài khoản miễn phí ở maxmind.com → GeoLite → Download
#    Databases → "GeoLite2 City" (GZIP). Giải nén lấy GeoLite2-City.mmdb.
tar -xzf GeoLite2-City_*.tar.gz
ssh root@<SERVER> mkdir -p /root/workspace/DALN/backend/geoip
scp GeoLite2-City_*/GeoLite2-City.mmdb root@<SERVER>:/root/workspace/DALN/backend/geoip/

# 2. Server (alias dc ở mục Vận hành): service chỉ đọc file lúc khởi động.
#    Restart cả kong vì Kong giữ IP upstream cũ trong cache, restart riêng
#    user sẽ nhận 502.
dc restart user kong
dc logs user | grep geoip     # mong thấy "[geoip] đã nạp dữ liệu vị trí"
```

- Đặt file **trước** lần deploy đầu tiên có tính năng này thì bỏ qua bước 2,
  vì deploy đó tạo lại container `user`.
- Cập nhật: MaxMind ra bản mới hằng tuần và điều khoản GeoLite2 yêu cầu dùng
  bản mới. Hiện làm tay bằng cách lặp lại hai bước trên; cron `geoipupdate` là
  việc để sau.
- Dòng ghi công MaxMind và OpenStreetMap đã có sẵn trong panel chi tiết thiết bị.

````

- [ ] **Step 8: Commit**

```bash
cd /Users/nguyenn/Documents/Source/project/DALN
git status --short   # backend/geoip/ KHÔNG được xuất hiện
git add backend/apps/user/src/geoip backend/apps/user/src/domain/user.domain.ts backend/package.json backend/package-lock.json backend/docker-compose.prod.yml backend/.gitignore deploy/README.md
git commit -m "feat(user): look up IP locations from a local GeoLite2 file"
```

---

## Task 3: Nối vào refresh và `GET /user/sessions`

**Files:**
- Modify: `backend/apps/user/src/domain/user.domain.ts`
- Modify: `backend/apps/user/src/user.service.ts`
- Modify: `backend/apps/user/src/http/user-http.controller.ts`
- Modify: `backend/apps/user/src/user.module.ts`
- Modify: `backend/apps/user/src/user.service.password-reset.spec.ts`
- Modify: `backend/apps/user/src/user.service.change-password.spec.ts`
- Modify: `backend/apps/user/src/user.service.make-friend.spec.ts`
- Test: `backend/apps/user/src/user.service.session.spec.ts`

**Interfaces:**
- Consumes:
  - Task 1: `SessionStore.consume(cookie, { ip })`, `SessionSummary.lastIp`
  - Task 2: `GeoIpService.lookup(ip)`, `GeoLocation`
- Produces:
  - `SessionListItem` = `{ sid, createdAt, lastSeenAt, userAgent, ip, lastIp, location, lastLocation, current }` — đây là hình dạng JSON của `GET /user/sessions`
  - `UserService.refreshSession(refreshCookie?: string | null, meta?: Pick<SessionMeta, 'ip'>)`
  - `UserService` constructor có tham số thứ 12: `geoIp: GeoIpService`

- [ ] **Step 1: Viết test (đỏ)**

Trong `user.service.session.spec.ts`, hàm `setup()`:

- thêm dòng sau ngay sau `const logger = …`:
  ```ts
  const geoIp = { lookup: jest.fn().mockReturnValue(null) }
  ```
- thêm tham số cuối vào `new UserService(…)`, ngay sau `sessions as never,`:
  ```ts
    geoIp as never,
  ```
- thêm `geoIp,` vào object được `return`.

Thêm vào cuối `describe('UserService.refreshSession', …)`:

```ts
  it('truyền IP của request xuống tầng phiên để ghi lastIp', async () => {
    const consume = jest.fn().mockResolvedValue({ status: 'invalid' })
    const { service } = setup({ consume })

    await service.refreshSession('s1.cu', { ip: '89.160.20.112' })

    expect(consume).toHaveBeenCalledWith('s1.cu', { ip: '89.160.20.112' })
  })
```

Thêm vào cuối `describe('UserService — danh sách thiết bị', …)`:

```ts
  const london = {
    city: 'London',
    country: 'United Kingdom',
    latitude: 51.5142,
    longitude: -0.0931,
    accuracyRadiusKm: 10,
  }
  const linkoping = {
    city: 'Linköping',
    country: 'Sweden',
    latitude: 58.4167,
    longitude: 15.6167,
    accuracyRadiusKm: 76,
  }

  it('gắn vị trí cho IP lúc đăng nhập và cho IP gần nhất, mỗi cái một vị trí', async () => {
    const { service, sessions, geoIp } = setup()
    sessions.listSessions.mockResolvedValue([
      {
        sid: 'a',
        createdAt: 1,
        lastSeenAt: 2,
        userAgent: 'Chrome',
        ip: '81.2.69.142',
        lastIp: '89.160.20.112',
      },
    ])
    geoIp.lookup.mockImplementation((ip: string | null) =>
      ip === '81.2.69.142' ? london : ip === '89.160.20.112' ? linkoping : null,
    )

    const [item] = await service.listOwnSessions('u1', 'a')

    expect(item).toEqual({
      sid: 'a',
      createdAt: 1,
      lastSeenAt: 2,
      userAgent: 'Chrome',
      ip: '81.2.69.142',
      lastIp: '89.160.20.112',
      location: london,
      lastLocation: linkoping,
      current: true,
    })
  })

  it('không tra được vị trí -> location null, các field khác vẫn đủ', async () => {
    const { service, sessions } = setup()
    sessions.listSessions.mockResolvedValue([
      {
        sid: 'a',
        createdAt: 1,
        lastSeenAt: 2,
        userAgent: null,
        ip: '172.22.0.1',
        lastIp: '172.22.0.1',
      },
    ])

    const [item] = await service.listOwnSessions('u1', 'khac')

    expect(item).toMatchObject({
      sid: 'a',
      ip: '172.22.0.1',
      lastIp: '172.22.0.1',
      location: null,
      lastLocation: null,
      current: false,
    })
  })
```

- [ ] **Step 2: Chạy, xác nhận đỏ**

```bash
cd backend && npx jest apps/user/src/user.service.session.spec.ts
```

Mong đợi: **FAIL** — ts-jest báo `TS2554: Expected 11 arguments, but got 12`.

- [ ] **Step 3: Cài đặt**

`apps/user/src/domain/user.domain.ts` — thay interface `SessionListItem`:

```ts
/** Một thiết bị đang đăng nhập, như trang "Phiên đăng nhập" cần hiển thị. */
export interface SessionListItem {
  /** Định danh phiên — không phải bí mật, nó chỉ là phần tra key của cookie. */
  sid: string
  /** Lúc đăng nhập (ms). */
  createdAt: number
  /** Lần refresh gần nhất (ms) — lệch tối đa 15 phút so với request thật. */
  lastSeenAt: number
  userAgent: string | null
  /** IP lúc đăng nhập — không bao giờ bị ghi lại. */
  ip: string | null
  /** IP của lần refresh gần nhất. */
  lastIp: string | null
  /** Vị trí ước tính của `ip`; null khi không tra được. */
  location: GeoLocation | null
  /** Vị trí ước tính của `lastIp` — thiết bị đang ở đâu. */
  lastLocation: GeoLocation | null
  /** Đúng thiết bị đang xem trang này. */
  current: boolean
}
```

`apps/user/src/user.service.ts`:

- thêm import cạnh các import local:
  ```ts
  import { GeoIpService } from './geoip/geoip.service'
  ```
- constructor: thêm tham số cuối, ngay sau `private readonly sessions: SessionStore,`:
  ```ts
    private readonly geoIp: GeoIpService,
  ```
- thay chữ ký và dòng đầu của `refreshSession`:
  ```ts
  async refreshSession(
    refreshCookie?: string | null,
    meta: Pick<SessionMeta, 'ip'> = {},
  ): Promise<RefreshResult> {
    const outcome = await this.sessions.consume(refreshCookie, meta)
  ```
- thay thân `listOwnSessions`:
  ```ts
    const sessions = await this.sessions.listSessions(userId)
    // Tra lúc đọc chứ không lúc ghi: đường refresh không phải làm thêm gì, và
    // phiên có từ trước tính năng này cũng có vị trí ngay.
    return sessions
      .map((session) => ({
        ...session,
        location: this.geoIp.lookup(session.ip),
        lastLocation: this.geoIp.lookup(session.lastIp),
        current: session.sid === currentSid,
      }))
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
  ```

`apps/user/src/http/user-http.controller.ts`, handler `refresh`: thêm tham số và truyền IP xuống (`Ip` đã được import sẵn):

```ts
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Ip() ip: string,
  ) {
    // IP gần nhất của phiên đi theo đúng lần refresh này: trang Thiết bị cần
    // biết thiết bị đang ở đâu, không chỉ nơi nó đăng nhập.
    const result: RefreshResult = await this.withStoreErrors(() =>
      this.userService.refreshSession(this.readRefreshCookie(request), { ip }),
    )
```

Phần còn lại của handler giữ nguyên.

`apps/user/src/user.module.ts`:
- thêm `import { GeoIpService } from './geoip/geoip.service'`;
- thêm `GeoIpService,` vào `providers`, ngay sau `UserService,`.

Thêm tham số thứ 12 vào **5** chỗ `new UserService(` còn lại, ngay sau dòng tham số `sessions`:

- `user.service.password-reset.spec.ts` (1 chỗ) và `user.service.change-password.spec.ts` (1 chỗ): sau `sessions as never,` thêm
  ```ts
    {} as never, // geoIp
  ```
- `user.service.make-friend.spec.ts` (3 chỗ): sau `{} as never, // sessions` thêm
  ```ts
    {} as never, // geoIp
  ```

- [ ] **Step 4: Chạy, xác nhận xanh — toàn bộ cổng backend**

```bash
cd backend
npx jest apps/user
npm run typecheck
npm test
npm run lint:check
```

Mong đợi: tất cả PASS. Ba suite spec vừa sửa constructor phải xanh mà không cần sửa gì khác.

- [ ] **Step 5: Commit**

```bash
cd /Users/nguyenn/Documents/Source/project/DALN
git add backend/apps/user/src/domain/user.domain.ts backend/apps/user/src/user.service.ts backend/apps/user/src/http/user-http.controller.ts backend/apps/user/src/user.module.ts backend/apps/user/src/user.service.session.spec.ts backend/apps/user/src/user.service.password-reset.spec.ts backend/apps/user/src/user.service.change-password.spec.ts backend/apps/user/src/user.service.make-friend.spec.ts
git commit -m "feat(user): return first and latest IP with locations from GET /user/sessions"
```

---

## Task 4: Frontend — kiểu dữ liệu, định dạng thời gian, toán bản đồ

**Files:**
- Modify: `frontend/src/apis/user.ts`
- Modify: `frontend/src/utils/formatDateTime.ts`
- Create: `frontend/src/utils/geo.ts`
- Check (script tạm, **không** commit): `/private/tmp/claude-501/-Users-nguyenn-Documents-Source-project-DALN/37f75a75-6084-46b5-87ae-8f5047d91ba4/scratchpad/check-fe-helpers.mjs`

**Interfaces:**
- Consumes: hình dạng JSON `SessionListItem` từ Task 3.
- Produces:
  - `@/apis/user`: `interface GeoLocation`; `UserSession` thêm `lastIp: string | null; location: GeoLocation | null; lastLocation: GeoLocation | null`
  - `@/utils/formatDateTime`: `formatLastActive(ms: number): string`, `formatSignInDate(ms: number): string`
  - `@/utils/geo`:
    - `TILE_SIZE = 256`
    - `zoomForRadius(lat: number, radiusKm: number): number`
    - `circleRadiusPx(lat: number, radiusKm: number, zoom: number): number`
    - `project(lat: number, lon: number, zoom: number): { x: number; y: number }`
    - `interface MapTile { key: string; url: string; left: number; top: number }`
    - `tilesAround(center: { x: number; y: number }, zoom: number, width: number, height: number): MapTile[]`
    - `googleMapsUrl(lat: number, lon: number, zoom: number): string`
    - `formatPlace(location: GeoLocation | null | undefined): string | null`

- [ ] **Step 1: Viết script kiểm (đỏ)**

Tạo `/private/tmp/claude-501/-Users-nguyenn-Documents-Source-project-DALN/37f75a75-6084-46b5-87ae-8f5047d91ba4/scratchpad/check-fe-helpers.mjs` (thư mục scratchpad của phiên làm việc; script này không commit).

```js
// Chạy: TZ=Asia/Ho_Chi_Minh node /private/tmp/claude-501/-Users-nguyenn-Documents-Source-project-DALN/37f75a75-6084-46b5-87ae-8f5047d91ba4/scratchpad/check-fe-helpers.mjs
// Node 24 chạy thẳng file .ts bằng cách bỏ type; tsconfig frontend đã
// erasableSyntaxOnly nên hai file dưới không có cú pháp nào cần biên dịch.
import assert from 'node:assert/strict'

const FE = '/Users/nguyenn/Documents/Source/project/DALN/frontend/src'
const geo = await import(`${FE}/utils/geo.ts`)
const fmt = await import(`${FE}/utils/formatDateTime.ts`)

// Zoom và vòng tròn — số đo tay ở spec §7.3
assert.equal(geo.zoomForRadius(51.5142, 10), 8)
assert.equal(geo.zoomForRadius(58.4167, 76), 5)
assert.equal(geo.zoomForRadius(27.5, 534), 3)
assert.equal(geo.zoomForRadius(16, 1000), 2)
assert.equal(geo.zoomForRadius(21, 0), 13)
assert.ok(Math.abs(geo.circleRadiusPx(51.5142, 10, 8) - 26.3) < 0.1)

// Review Focus 3 — bán kính cực trị vẫn nằm trong [8, 76] px
assert.equal(geo.circleRadiusPx(21, 0, geo.zoomForRadius(21, 0)), 8)
assert.equal(geo.circleRadiusPx(16, 3000, geo.zoomForRadius(16, 3000)), 76)

// Chiếu và tile
assert.deepEqual(geo.project(0, 0, 0), { x: 128, y: 128 })
const london = geo.project(51.5142, -0.0931, 8)
assert.equal(Math.floor(london.x / 256), 127)
assert.equal(Math.floor(london.y / 256), 85)
const tiles = geo.tilesAround(london, 8, 320, 160)
assert.ok(tiles.some((t) => t.url === 'https://tile.openstreetmap.org/8/127/85.png'))
assert.ok(tiles.length >= 2 && tiles.length <= 6, `số tile ${tiles.length}`)
assert.ok(
  tiles.some((t) => t.left <= 0 && t.left + 256 > 0 && t.top <= 0 && t.top + 256 > 0),
  'phải có đúng tile chứa tâm khung',
)

// Review Focus 4 — kinh độ ±180 và vĩ độ gần cực: mọi URL nằm trong lưới
for (const [lat, lon, z] of [[0, 179.99, 3], [0, -179.99, 3], [84.9, 10, 4], [-84.9, 10, 4], [89.9, 0, 2]]) {
  for (const t of geo.tilesAround(geo.project(lat, lon, z), z, 320, 160)) {
    const [, zz, x, y] = t.url.match(/\/(\d+)\/(-?\d+)\/(-?\d+)\.png$/).map(Number)
    assert.ok(x >= 0 && x < 2 ** zz && y >= 0 && y < 2 ** zz, `${t.url} nằm ngoài lưới`)
  }
}

assert.equal(
  geo.googleMapsUrl(51.5142, -0.0931, 8),
  'https://www.google.com/maps/@?api=1&map_action=map&center=51.5142,-0.0931&zoom=8',
)
const at = { latitude: 0, longitude: 0, accuracyRadiusKm: 1 }
assert.equal(geo.formatPlace({ ...at, city: 'London', country: 'United Kingdom' }), 'London, United Kingdom')
assert.equal(geo.formatPlace({ ...at, city: null, country: 'Bhutan' }), 'Bhutan')
assert.equal(geo.formatPlace({ ...at, city: null, country: null }), null)
assert.equal(geo.formatPlace(null), null)
assert.equal(geo.formatPlace(undefined), null)

// Thời gian
const now = Date.now()
assert.equal(fmt.formatLastActive(now), 'vừa xong')
assert.equal(fmt.formatLastActive(now + 5000), 'vừa xong') // Review Focus 5 — đồng hồ lệch
assert.equal(fmt.formatLastActive(now - 5 * 60e3), '5 phút trước')
assert.equal(fmt.formatLastActive(now - 3 * 3600e3), '3 giờ trước')
assert.equal(fmt.formatLastActive(now - 2 * 86400e3), '2 ngày trước')
assert.equal(fmt.formatLastActive(Date.parse('2026-09-10T09:00:00+07:00')), '10/09/2026')
assert.equal(fmt.formatSignInDate(Date.parse('2026-09-15T08:12:00+07:00')), '15/09/2026 lúc 08:12')

console.log('OK — mọi kiểm tra hàm thuần đều qua')
```

- [ ] **Step 2: Chạy, xác nhận đỏ**

```bash
TZ=Asia/Ho_Chi_Minh node /private/tmp/claude-501/-Users-nguyenn-Documents-Source-project-DALN/37f75a75-6084-46b5-87ae-8f5047d91ba4/scratchpad/check-fe-helpers.mjs
```

Mong đợi: **FAIL** — `Cannot find module …/utils/geo.ts`.

- [ ] **Step 3: Cài đặt**

`frontend/src/apis/user.ts` — thay interface `UserSession` bằng hai interface:

```ts
/**
 * Vị trí ước tính từ IP (GeoLite2). Chỉ là ước tính: `accuracyRadiusKm` là
 * bán kính bất định, và bản đồ vẽ đúng vùng đó chứ không cắm một điểm.
 */
export interface GeoLocation {
  /** null khi dữ liệu chỉ biết tới quốc gia. */
  city: string | null;
  country: string | null;
  latitude: number;
  longitude: number;
  accuracyRadiusKm: number;
}

/** Một thiết bị đang đăng nhập, như trang "Phiên đăng nhập" hiển thị. */
export interface UserSession {
  /** Định danh phiên — không phải bí mật, chỉ là phần tra key của cookie. */
  sid: string;
  /** Lúc đăng nhập (ms) — "Đăng nhập lần đầu". */
  createdAt: number;
  /** Lần refresh gần nhất (ms) — "Hoạt động gần nhất", lệch tối đa 15 phút. */
  lastSeenAt: number;
  userAgent: string | null;
  /** IP lúc đăng nhập. */
  ip: string | null;
  /** IP của lần refresh gần nhất. */
  lastIp: string | null;
  /** Vị trí ước tính của `ip`. */
  location: GeoLocation | null;
  /** Vị trí ước tính của `lastIp` — thiết bị đang ở đâu. */
  lastLocation: GeoLocation | null;
  /** Đúng thiết bị đang xem trang này. */
  current: boolean;
}
```

`frontend/src/utils/formatDateTime.ts` — thêm ngay **sau** hàm `formatRelativeTime`:

```ts
/**
 * "Hoạt động gần nhất" của một phiên đăng nhập. Tương đối trong một tuần, sau
 * đó là ngày đủ năm: "20/09" của `formatRelativeTime` không cho biết năm nào,
 * mà phiên sống được tới 30 ngày.
 *
 * Chữ thường để đứng giữa câu ("hoạt động vừa xong"); đầu dòng thì nơi gọi tự
 * viết hoa.
 */
export const formatLastActive = (ms: number) => {
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "";

  // Đồng hồ máy khách chậm hơn server vài giây thì `seconds` âm — vẫn là "vừa xong".
  const seconds = Math.round((Date.now() - ms) / 1000);
  if (seconds < 60) return "vừa xong";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} phút trước`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} giờ trước`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)} ngày trước`;

  return date.toLocaleDateString(VI, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
};

/** "15/09/2026 lúc 08:12" — lúc một phiên đăng nhập bắt đầu. */
export const formatSignInDate = (ms: number) => {
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "";

  const day = date.toLocaleDateString(VI, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const time = date.toLocaleTimeString(VI, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${day} lúc ${time}`;
};
```

Tạo `frontend/src/utils/geo.ts`:

```ts
import type { GeoLocation } from "@/apis/user";

/**
 * Toán cho bản đồ mini ở trang "Thiết bị đang đăng nhập": Web Mercator và
 * lưới tile 256px của OpenStreetMap. Hàm thuần, không thư viện — cả bản đồ
 * chỉ là vài ảnh tile ghép lại cộng một vòng tròn.
 */

export const TILE_SIZE = 256;

/** Mét trên một pixel ở xích đạo, zoom 0. */
const EQUATOR_METERS_PER_PIXEL = 156543.03392;
/** Zoom được chọn để vòng tròn rơi vào khoảng 24–48px. */
const TARGET_RADIUS_PX = 48;
const MIN_ZOOM = 2;
const MAX_ZOOM = 13;
/** Vòng không biến mất khi bán kính ~0, và không tràn khỏi khung cao 160px. */
const MIN_CIRCLE_PX = 8;
const MAX_CIRCLE_PX = 76;
/** Web Mercator không vẽ được tới cực. */
const MAX_LATITUDE = 85.05112878;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const metersPerPixel = (lat: number, zoom: number) =>
  (EQUATOR_METERS_PER_PIXEL * Math.cos(toRadians(lat))) / 2 ** zoom;

/**
 * Zoom sao cho vùng bất định vừa khung: bán kính 10km ra zoom 8, bán kính
 * 534km (chỉ biết tới quốc gia) lùi ra zoom 3. Chính việc lùi zoom này giữ
 * cho bản đồ không trông chắc chắn hơn dữ liệu.
 */
export function zoomForRadius(lat: number, radiusKm: number): number {
  const radiusMeters = Math.max(radiusKm, 0.1) * 1000;
  const zoom = Math.floor(
    Math.log2((metersPerPixel(lat, 0) * TARGET_RADIUS_PX) / radiusMeters),
  );
  return clamp(zoom, MIN_ZOOM, MAX_ZOOM);
}

/** Bán kính vòng tròn trên màn hình (px) ở `zoom` đã chọn. */
export function circleRadiusPx(
  lat: number,
  radiusKm: number,
  zoom: number,
): number {
  return clamp(
    (radiusKm * 1000) / metersPerPixel(lat, zoom),
    MIN_CIRCLE_PX,
    MAX_CIRCLE_PX,
  );
}

/** Toạ độ pixel toàn cầu của một điểm ở `zoom`. */
export function project(
  lat: number,
  lon: number,
  zoom: number,
): { x: number; y: number } {
  const size = TILE_SIZE * 2 ** zoom;
  const sin = Math.sin(toRadians(clamp(lat, -MAX_LATITUDE, MAX_LATITUDE)));
  return {
    x: ((lon + 180) / 360) * size,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size,
  };
}

export interface MapTile {
  key: string;
  url: string;
  /** Góc trên-trái của tile, tính từ TÂM khung. */
  left: number;
  top: number;
}

/**
 * Các tile phủ một khung `width`×`height` có tâm là `center`. Cột quấn quanh
 * kinh tuyến 180 (modulo 2^zoom); hàng bị kẹp vì trên cực không có tile.
 */
export function tilesAround(
  center: { x: number; y: number },
  zoom: number,
  width: number,
  height: number,
): MapTile[] {
  const count = 2 ** zoom;
  const firstCol = Math.floor((center.x - width / 2) / TILE_SIZE);
  const lastCol = Math.floor((center.x + width / 2) / TILE_SIZE);
  const firstRow = Math.max(0, Math.floor((center.y - height / 2) / TILE_SIZE));
  const lastRow = Math.min(
    count - 1,
    Math.floor((center.y + height / 2) / TILE_SIZE),
  );

  const tiles: MapTile[] = [];
  for (let row = firstRow; row <= lastRow; row++) {
    for (let col = firstCol; col <= lastCol; col++) {
      const wrapped = ((col % count) + count) % count;
      tiles.push({
        key: `${zoom}/${col}/${row}`,
        url: `https://tile.openstreetmap.org/${zoom}/${wrapped}/${row}.png`,
        left: col * TILE_SIZE - center.x,
        top: row * TILE_SIZE - center.y,
      });
    }
  }
  return tiles;
}

/** Mở Google Maps ở đúng vùng và mức zoom của bản đồ mini — cố ý không cắm pin. */
export function googleMapsUrl(lat: number, lon: number, zoom: number): string {
  return `https://www.google.com/maps/@?api=1&map_action=map&center=${lat},${lon}&zoom=${zoom}`;
}

/** "London, United Kingdom", "Bhutan", hoặc null khi không có gì để nói. */
export function formatPlace(
  location: GeoLocation | null | undefined,
): string | null {
  if (!location) return null;
  const parts = [location.city, location.country].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}
```

- [ ] **Step 4: Chạy, xác nhận xanh**

```bash
TZ=Asia/Ho_Chi_Minh node /private/tmp/claude-501/-Users-nguyenn-Documents-Source-project-DALN/37f75a75-6084-46b5-87ae-8f5047d91ba4/scratchpad/check-fe-helpers.mjs
cd frontend && npm run lint && npm run typecheck
```

Mong đợi: script in `OK — mọi kiểm tra hàm thuần đều qua`; `lint` và `typecheck` sạch.

- [ ] **Step 5: Commit**

```bash
cd /Users/nguyenn/Documents/Source/project/DALN
git add frontend/src/apis/user.ts frontend/src/utils/formatDateTime.ts frontend/src/utils/geo.ts
git commit -m "feat(web): session location types, time formats and static map math"
```

---

## Task 5: Môi trường dev và suite QC (đỏ trước khi có giao diện)

Suite QC là "test" của phần giao diện. Viết và chạy nó **trước** Task 6 để chứng minh nó bắt được việc thiếu giao diện; một phép đo xanh ngay trên giao diện cũ thì không đo được gì.

**Files:**
- Create: `qc/session-location-browser.mjs`
- Modify: `qc/README.md`

**Interfaces:**
- Consumes: API từ Task 3; hàm từ Task 4.
- Produces — **hợp đồng DOM mà Task 6 phải đáp ứng:**
  - Mỗi dòng thiết bị có đúng một `button[aria-expanded]`; `innerText` của nút chứa tên thiết bị và dòng thu gọn.
  - `aria-controls` của nút trỏ tới `id` của panel chi tiết; panel **chỉ có trong DOM khi đang mở**.
  - Trong panel:
    - bản đồ là `[role="img"]`, chứa các `img[src*="tile.openstreetmap.org"]`;
    - vòng tròn là `[data-accuracy-circle]`;
    - lớp tile là `[data-map-tiles]`;
    - link là `a[href^="https://www.google.com/maps/"]` với `target="_blank"`;
    - có các chữ "Đăng nhập lần đầu", "Hoạt động gần nhất", "Ước tính từ IP · bán kính ~N km", "Không xác định được vị trí", "GeoLite2", "OpenStreetMap".

- [ ] **Step 1: Đưa `maxmind` và fixture vào backend dev**

Container dev giữ `node_modules` trong một anonymous volume, và `docker compose up` **giữ lại** volume đó khi tạo lại container. Vì vậy phải có `-V`, nếu không container mới vẫn dùng `node_modules` cũ và không có `maxmind`.

```bash
cd /Users/nguyenn/Documents/Source/project/DALN/backend
mkdir -p geoip
cp apps/user/src/geoip/__fixtures__/GeoIP2-City-Test.mmdb geoip/GeoLite2-City.mmdb
docker compose build user
docker compose up -d -V user
docker restart daln-kong
docker exec daln-user node -e "require.resolve('maxmind'); console.log('maxmind ok')"
docker logs daln-user 2>&1 | grep -m1 geoip
git -C .. status --short | grep geoip || echo "geoip/ đã được gitignore"
```

Mong đợi: `maxmind ok`; log có `[geoip] đã nạp dữ liệu vị trí` kèm path `/app/geoip/GeoLite2-City.mmdb`; `git status` không hiện `backend/geoip/`. Nếu log chưa có dòng geoip thì đợi thêm vài giây (entrypoint dev còn chạy `prisma generate` rồi mới start) và chạy lại lệnh `docker logs`.

- [ ] **Step 2: Chạy frontend dev**

```bash
cd /Users/nguyenn/Documents/Source/project/DALN/frontend && npm run dev
```

Chạy nền. Đọc cổng Vite in ra (thường là `5174`). Nếu khác `5174` thì khi chạy QC thêm `APP=http://localhost:<cổng>`. Cổng đó phải là cổng Kong cho phép (5173/5174).

- [ ] **Step 3: Viết suite QC**

Tạo `qc/session-location-browser.mjs`:

```js
/**
 * QC trên trình duyệt thật cho vị trí và thời gian của phiên đăng nhập.
 *
 *   node qc/session-location-browser.mjs
 *
 * Cần: backend đang chạy và đã nạp DB kiểm thử của MaxMind ở backend/geoip
 * (README, mục "Chuẩn bị"), frontend dev server ở origin Kong cho phép
 * (5173/5174), Chrome, và mạng tới tile.openstreetmap.org.
 *
 * "Thiết bị khác" đăng nhập bằng curl qua Kong kèm X-Forwarded-For: service đặt
 * `trust proxy 2`, nên IP trong header chính là IP được ghi vào phiên. Mọi IP
 * dùng ở đây đều có trong DB kiểm thử, nên không cần tài khoản MaxMind.
 * Ghi đè bằng biến môi trường: APP, API, CHROME_PATH, REDIS_CONTAINER.
 */
import puppeteer from 'puppeteer-core'
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'

const APP = process.env.APP ?? 'http://localhost:5174'
const API = process.env.API ?? 'http://localhost:8080'
const REDIS_CONTAINER = process.env.REDIS_CONTAINER ?? 'daln-redis'
const CHROME =
  process.env.CHROME_PATH ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const R = (cmd) =>
  execSync(`docker exec ${REDIS_CONTAINER} redis-cli ${cmd}`).toString().trim()
const sh = (cmd) => execSync(cmd, { shell: '/bin/bash' }).toString()

let pass = 0,
  fail = 0
const ok = (m) => {
  console.log(`  ✅ ${m}`)
  pass++
}
const bad = (m) => {
  console.log(`  ❌ ${m}`)
  fail++
}
const is = (actual, expected, label) =>
  String(actual) === String(expected)
    ? ok(`${label} (${actual})`)
    : bad(`${label} — mong ${expected}, nhận ${actual}`)
const has = (text, needle, label) =>
  String(text ?? '').includes(needle)
    ? ok(label)
    : bad(
        `${label} — không thấy "${needle}" trong: ${String(text ?? '')
          .replace(/\s+/g, ' ')
          .slice(0, 160)}`,
      )
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

mkdirSync('shots', { recursive: true })

async function until(fn, ms = 8000, step = 250) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await fn()) return true
    await sleep(step)
  }
  return false
}

const bodyText = (page) => page.evaluate(() => document.body.innerText)

/** Bấm bằng chuột thật — lý do xem ở change-password-browser.mjs. */
async function realClickByText(page, selector, pattern) {
  const box = await page.evaluate(
    (sel, src) => {
      const re = new RegExp(src)
      const el = [...document.querySelectorAll(sel)].find((n) =>
        re.test(n.textContent ?? ''),
      )
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    },
    selector,
    pattern.source,
  )
  if (!box) return false
  await page.mouse.click(box.x, box.y)
  return true
}

async function skipOnboarding(page) {
  if (!page.url().includes('/onboarding')) return
  await page.evaluate(() =>
    [...document.querySelectorAll('button')]
      .find((b) => /Bỏ qua/.test(b.textContent ?? ''))
      ?.click(),
  )
  await sleep(2000)
}

const resetLimits = () =>
  execSync(
    `docker exec ${REDIS_CONTAINER} sh -c "redis-cli --scan --pattern 'rl:*' | xargs -r redis-cli del"`,
  )

// --- tài khoản QC ---
const stamp = Date.now()
const email = `qcloc${stamp}@example.test`
const username = `qcloc${stamp}`
const password = 'MatKhau123'
resetLimits()
sh(
  `curl -s -o /dev/null -X POST ${API}/user/register -H 'Content-Type: application/json' -d '${JSON.stringify({ email, username, password, fullName: 'QC Location' })}'`,
)
R(
  `set "otp:reg:${email}" ${createHash('sha256').update('135790').digest('hex')} EX 300`,
)
sh(
  `curl -s -o /dev/null -X POST ${API}/user/verify-otp -H 'Content-Type: application/json' -d '${JSON.stringify({ email, otp: '135790' })}'`,
)
console.log(`Tài khoản QC: ${email}`)

const UA = {
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  firefoxWin:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0',
  chromeLinux:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
  edgeWin:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 Edg/140.0',
}

/** Một "thiết bị khác": đăng nhập bằng curl, trả sid của phiên vừa tạo. */
function loginDevice(jar, ua, xff) {
  rmSync(jar, { force: true })
  const forwarded = xff ? `-H 'X-Forwarded-For: ${xff}'` : ''
  const code = sh(
    `curl -s -o /dev/null -w '%{http_code}' -c ${jar} -X POST ${API}/user/login -H 'Content-Type: application/json' -H 'User-Agent: ${ua}' ${forwarded} -d '${JSON.stringify({ email, password })}'`,
  ).trim()
  const cookie = sh(`awk '$6 == "refreshToken" { print $7 }' ${jar}`).trim()
  return { code, sid: cookie.split('.')[0], jar }
}

const today = new Date().toLocaleDateString('vi-VN', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

console.log('\n== 1. Server ghi IP lúc đăng nhập và IP gần nhất ==')
const B = loginDevice('jarLocB.txt', UA.iphone, '81.2.69.142')
const C = loginDevice('jarLocC.txt', UA.firefoxWin, '67.43.156.0')
const D = loginDevice('jarLocD.txt', UA.chromeLinux, null)
const E = loginDevice('jarLocE.txt', UA.edgeWin, '175.16.199.0')
is(
  [B, C, D, E].map((d) => d.code).join(','),
  '201,201,201,201',
  'bốn thiết bị khác đăng nhập được',
)
is(R(`hget sess:${B.sid} ip`), '81.2.69.142', 'X-Forwarded-For tới được service')
is(R(`hget sess:${B.sid} lastIp`), '81.2.69.142', 'lastIp bắt đầu bằng IP lúc đăng nhập')
const ipD = R(`hget sess:${D.sid} ip`)
is(
  /^(10|172\.(1[6-9]|2\d|3[01])|192\.168)\./.test(ipD),
  true,
  `D không có XFF -> IP mạng nội bộ (${ipD})`,
)
// Giả một phiên tạo trước khi có field lastIp.
R(`hdel sess:${E.sid} lastIp`)
is(R(`hexists sess:${E.sid} lastIp`), '0', 'E giờ là phiên "cũ", không có lastIp')

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--window-size=1400,900'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1400, height: 900 })

const consoleErrors = []
const pageErrors = []
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text())
})
page.on('pageerror', (e) => pageErrors.push(String(e)))

/** innerText của nút toggle chứa `title`, tức dòng thu gọn của thiết bị đó. */
const rowText = (title) =>
  page.evaluate(
    (t) =>
      [...document.querySelectorAll('button[aria-expanded]')].find((b) =>
        b.innerText.includes(t),
      )?.innerText ?? null,
    title,
  )

/** Những gì panel chi tiết của `title` đang hiện; null khi chưa mở. */
const panelInfo = (title) =>
  page.evaluate((t) => {
    const button = [...document.querySelectorAll('button[aria-expanded]')].find(
      (b) => b.innerText.includes(t),
    )
    const panel =
      button && document.getElementById(button.getAttribute('aria-controls') ?? '')
    if (!panel) return null
    const map = panel.querySelector('[role="img"]')
    const tiles = [...panel.querySelectorAll('img[src*="tile.openstreetmap.org"]')]
    const circle = panel.querySelector('[data-accuracy-circle]')
    const link = panel.querySelector('a[href^="https://www.google.com/maps/"]')
    let circleOffset = null
    if (circle && map) {
      const c = circle.getBoundingClientRect()
      const m = map.getBoundingClientRect()
      circleOffset = Math.round(
        Math.hypot(
          c.x + c.width / 2 - (m.x + m.width / 2),
          c.y + c.height / 2 - (m.y + m.height / 2),
        ),
      )
    }
    return {
      expanded: button.getAttribute('aria-expanded'),
      text: panel.innerText,
      hasMap: Boolean(map),
      tileSrcs: tiles.map((i) => i.getAttribute('src')),
      tilesLoaded: tiles.filter((i) => i.complete && i.naturalWidth > 0).length,
      circleDiameter: circle ? Math.round(circle.getBoundingClientRect().width) : 0,
      circleOffset,
      mapsHref: link?.getAttribute('href') ?? null,
      mapsTarget: link?.getAttribute('target') ?? null,
    }
  }, title)

/** Bấm mở panel của `title`, đợi panel và (nếu có bản đồ) tile tải xong. */
async function openPanel(title) {
  const clicked = await realClickByText(page, 'button[aria-expanded]', new RegExp(title))
  if (!clicked) return null
  await until(async () => Boolean(await panelInfo(title)), 4000)
  await until(async () => {
    const info = await panelInfo(title)
    return !info?.hasMap || info.tilesLoaded > 0
  }, 10000)
  return panelInfo(title)
}

async function openSettings() {
  await page.goto(`${APP}/settings/account`, { waitUntil: 'networkidle2' })
  await until(async () => (await bodyText(page)).includes('Safari trên iOS'), 15000)
}

console.log('\n== 2. Dòng thu gọn: thành phố thay cho IP trần ==')
resetLimits()
await page.goto(`${APP}/auth`, { waitUntil: 'networkidle2' })
await page.waitForSelector('input[name="email"]', { timeout: 15000 })
await page.type('input[name="email"]', email)
await page.type('input[name="password"]', password)
await page.click('button[type="submit"]')
await until(async () => !page.url().includes('/auth'), 20000)
await skipOnboarding(page)
await openSettings()
has(await rowText('Safari trên iOS'), 'London, United Kingdom · hoạt động vừa xong', 'B: thành phố + "vừa xong"')
has(await rowText('Firefox trên Windows'), 'Bhutan · hoạt động', 'C: chỉ biết quốc gia')
has(await rowText('Chrome trên Linux'), `${ipD} · hoạt động`, 'D: không tra được vị trí -> hiện IP')
has(await rowText('Edge trên Windows'), 'Changchun, China', 'E (phiên cũ): lấy vị trí của IP lúc đăng nhập')
await page.screenshot({ path: 'shots/loc-02-list.png' })

console.log('\n== 3. Chi tiết của B: bản đồ, link, hai mốc thời gian ==')
const london = await openPanel('Safari trên iOS')
is(london?.expanded, 'true', 'nút toggle báo aria-expanded=true')
has(london?.text, 'Đăng nhập lần đầu', 'có mốc đăng nhập lần đầu')
has(london?.text, `${today} lúc`, 'ngày đăng nhập là hôm nay, kèm giờ')
has(london?.text, 'London, United Kingdom · IP 81.2.69.142', 'nơi và IP lúc đăng nhập')
has(london?.text, 'Vừa xong', 'hoạt động gần nhất, viết hoa đầu dòng')
has(london?.text, 'Ước tính từ IP · bán kính ~10 km', 'nói rõ là ước tính, kèm bán kính')
is(
  london?.tileSrcs?.includes('https://tile.openstreetmap.org/8/127/85.png'),
  true,
  'có tile chứa London ở zoom 8',
)
is((london?.tilesLoaded ?? 0) > 0, true, `tile tải được (${london?.tilesLoaded})`)
is(
  london?.circleDiameter >= 48 && london?.circleDiameter <= 96,
  true,
  `vòng tròn 48–96px (${london?.circleDiameter})`,
)
is(
  london?.circleOffset != null && london.circleOffset <= 1,
  true,
  `vòng tròn nằm giữa khung (lệch ${london?.circleOffset}px)`,
)
is(
  london?.mapsHref,
  'https://www.google.com/maps/@?api=1&map_action=map&center=51.5142,-0.0931&zoom=8',
  'link Google Maps đúng vùng và zoom',
)
is(london?.mapsTarget, '_blank', 'link mở tab mới')
has(london?.text, 'GeoLite2', 'ghi công MaxMind')
has(london?.text, 'OpenStreetMap', 'ghi công OpenStreetMap')
await page.screenshot({ path: 'shots/loc-03-london.png' })

console.log('\n== 4. B refresh từ nơi khác: IP gần nhất đổi, IP lúc đăng nhập giữ ==')
resetLimits()
const refreshed = sh(
  `curl -s -o /dev/null -w '%{http_code}' -b ${B.jar} -c ${B.jar} -X POST ${API}/user/refresh -H 'User-Agent: ${UA.iphone}' -H 'X-Forwarded-For: 89.160.20.112'`,
).trim()
is(refreshed, '204', 'B refresh thành công')
is(R(`hget sess:${B.sid} lastIp`), '89.160.20.112', 'lastIp = IP của lần refresh')
is(R(`hget sess:${B.sid} ip`), '81.2.69.142', 'ip lúc đăng nhập KHÔNG đổi')
await openSettings()
has(await rowText('Safari trên iOS'), 'Linköping, Sweden · hoạt động vừa xong', 'dòng thu gọn theo nơi gần nhất')
const moved = await openPanel('Safari trên iOS')
has(moved?.text, 'London, United Kingdom · IP 81.2.69.142', 'đăng nhập lần đầu vẫn là London')
has(moved?.text, 'Linköping, Sweden · IP 89.160.20.112', 'hoạt động gần nhất là Linköping')
is(
  moved?.mapsHref,
  'https://www.google.com/maps/@?api=1&map_action=map&center=58.4167,15.6167&zoom=5',
  'bản đồ và link theo nơi gần nhất',
)
is(
  moved?.tileSrcs?.includes('https://tile.openstreetmap.org/5/17/9.png'),
  true,
  'tile Linköping ở zoom 5',
)
await page.screenshot({ path: 'shots/loc-04-moved.png' })

console.log('\n== 5. Chỉ biết quốc gia: vòng tròn lớn, zoom lùi ra ==')
const bhutan = await openPanel('Firefox trên Windows')
has(bhutan?.text, 'Bhutan · IP 67.43.156.0', 'chỉ ghi quốc gia')
has(bhutan?.text, 'bán kính ~534 km', 'bán kính lớn được nói ra')
is(
  bhutan?.tileSrcs?.includes('https://tile.openstreetmap.org/3/6/3.png'),
  true,
  'zoom 3 — thấy cả vùng quốc gia',
)
is(bhutan?.mapsHref?.endsWith('&zoom=3'), true, 'link Maps cùng zoom 3')
is(
  bhutan?.circleDiameter >= 48 && bhutan?.circleDiameter <= 96,
  true,
  `vòng tròn vẫn vừa khung (${bhutan?.circleDiameter})`,
)
await page.screenshot({ path: 'shots/loc-05-bhutan.png' })

console.log('\n== 6. Không tra được vị trí ==')
const unknown = await openPanel('Chrome trên Linux')
has(unknown?.text, 'Không xác định được vị trí', 'nói rõ không có vị trí')
is(unknown?.hasMap, false, 'không vẽ bản đồ')
is(unknown?.mapsHref, null, 'không có link Maps')
has(unknown?.text, `IP ${ipD}`, 'IP vẫn hiện')
has(unknown?.text, 'Đăng nhập lần đầu', 'mốc thời gian vẫn hiện')

console.log('\n== 7. Phiên cũ chưa có lastIp ==')
const legacy = await openPanel('Edge trên Windows')
has(
  legacy?.text?.split('Hoạt động gần nhất')[1],
  'Changchun, China · IP 175.16.199.0',
  'hoạt động gần nhất lấy IP lúc đăng nhập',
)

console.log('\n== 8. Thiết bị này ==')
const mine = await openPanel('Thiết bị này')
has(mine?.text, 'Đăng nhập lần đầu', 'thiết bị này cũng mở được chi tiết')
has(mine?.text, `${today} lúc`, 'ngày đăng nhập của thiết bị này')
await page.screenshot({ path: 'shots/loc-08-all-open.png', fullPage: true })

console.log('\n== 9. Không tải được tile: mất hình, không mất chữ ==')
const blockTiles = (req) =>
  req.url().includes('tile.openstreetmap.org') ? req.abort() : req.continue()
await page.setRequestInterception(true)
page.on('request', blockTiles)
await openSettings()
await realClickByText(page, 'button[aria-expanded]', /Safari trên iOS/)
await until(async () => (await panelInfo('Safari trên iOS'))?.hasMap === false, 6000)
const blocked = await panelInfo('Safari trên iOS')
is(blocked?.hasMap, false, 'khối bản đồ biến mất khi tile lỗi')
has(blocked?.text, 'Ước tính từ IP', 'nhãn bán kính vẫn còn')
is(Boolean(blocked?.mapsHref), true, 'link Google Maps vẫn còn')
has(blocked?.text, 'Hoạt động gần nhất', 'hai mốc thời gian vẫn còn')
page.off('request', blockTiles)
await page.setRequestInterception(false)

console.log('\n== 10. API cũ trong lúc deploy (chưa có lastIp/location) ==')
const origin = new URL(APP).origin
const realBody = await page.evaluate(
  (api) =>
    fetch(`${api}/user/sessions`, { credentials: 'include' }).then((r) => r.text()),
  API,
)
const oldBody = JSON.stringify(
  JSON.parse(realBody, (key, value) =>
    ['lastIp', 'location', 'lastLocation'].includes(key) ? undefined : value,
  ),
)
const serveOldApi = (req) =>
  req.method() === 'GET' && new URL(req.url()).pathname.endsWith('/user/sessions')
    ? req.respond({
        status: 200,
        contentType: 'application/json',
        headers: {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Credentials': 'true',
        },
        body: oldBody,
      })
    : req.continue()
await page.setRequestInterception(true)
page.on('request', serveOldApi)
pageErrors.length = 0
await openSettings()
has(await rowText('Safari trên iOS'), '81.2.69.142 · hoạt động', 'dòng thu gọn quay về IP như cũ')
const oldApi = await openPanel('Safari trên iOS')
has(oldApi?.text, 'Không xác định được vị trí', 'panel báo không có vị trí thay vì vỡ')
is(pageErrors.length, 0, `không có lỗi JS${pageErrors.length ? `: ${pageErrors[0]}` : ''}`)
page.off('request', serveOldApi)
await page.setRequestInterception(false)

console.log('\n== 11. Điện thoại 375px và dark mode ==')
await page.setViewport({ width: 375, height: 812 })
await openSettings()
await openPanel('Safari trên iOS')
const overflow = await page.evaluate(
  () => document.documentElement.scrollWidth - window.innerWidth,
)
is(overflow <= 0, true, `không cuộn ngang ở 375px (thừa ${overflow}px)`)
await page.screenshot({ path: 'shots/loc-11-mobile.png', fullPage: true })
await page.evaluate(() => document.documentElement.classList.add('dark'))
await sleep(300)
const tileFilter = await page.evaluate(() => {
  const el = document.querySelector('[data-map-tiles]')
  return el ? getComputedStyle(el).filter : null
})
is(/brightness/.test(tileFilter ?? ''), true, `dark mode làm dịu tile (${tileFilter})`)
await page.screenshot({ path: 'shots/loc-11-mobile-dark.png', fullPage: true })

console.log('\n== 12. Console sạch ==')
const realErrors = consoleErrors.filter(
  (e) => !/401|favicon|Failed to load resource|ERR_FAILED/.test(e),
)
is(
  realErrors.length,
  0,
  `không có lỗi console lạ${realErrors.length ? `: ${realErrors[0]}` : ''}`,
)

await browser.close()
console.log(`\nTỔNG CUỐI: ${pass} pass / ${fail} fail`)
process.exit(fail === 0 ? 0 : 1)
```

- [ ] **Step 4: Cập nhật `qc/README.md`**

Trong khối lệnh ở mục `## Chuẩn bị`, thêm dòng cuối:

```bash
cp backend/apps/user/src/geoip/__fixtures__/GeoIP2-City-Test.mmdb backend/geoip/GeoLite2-City.mmdb  # cho session-location (tạo backend/geoip trước), rồi docker restart daln-user daln-kong
```

Trong khối lệnh ở mục `## Chạy`, thêm dòng cuối:

```bash
node session-location-browser.mjs # 12 nhóm: IP, vị trí, bản đồ mini, hai mốc thời gian
```

Trong bảng ở mục `## Những gì bộ QC phủ`, thêm dòng cuối:

```markdown
| Vị trí phiên | IP lúc đăng nhập và IP gần nhất, vị trí GeoIP (DB kiểm thử của MaxMind), bản đồ mini + link Maps, tile lỗi, API cũ trong lúc deploy, 375px + dark mode |
```

- [ ] **Step 5: Chạy, xác nhận đỏ đúng chỗ**

```bash
cd /Users/nguyenn/Documents/Source/project/DALN/qc && node session-location-browser.mjs
```

Mong đợi: exit code 1.
- **Xanh:** cả 5 kiểm ở mục 1, và 3 kiểm curl/Redis đầu mục 4. Vài kiểm không phụ thuộc giao diện mới (cuộn ngang ở mục 11, console ở mục 12) cũng có thể xanh.
- **Đỏ:** mọi kiểm giao diện ở mục 2–10, vì giao diện cũ không có `button[aria-expanded]`.
- **Dừng lại nếu** mục 1 đỏ. Đó là lỗi backend hoặc môi trường (XFF, `maxmind`, fixture), phải sửa trước khi sang Task 6.

- [ ] **Step 6: Commit**

```bash
cd /Users/nguyenn/Documents/Source/project/DALN
git add qc/session-location-browser.mjs qc/README.md
git commit -m "test(qc): browser QC for session locations and sign-in times"
```

---

## Task 6: Giao diện — `SessionMiniMap`, `SessionRow`, trang Account

**Files:**
- Create: `frontend/src/pages/Settings/SessionMiniMap.tsx`
- Create: `frontend/src/pages/Settings/SessionRow.tsx`
- Modify: `frontend/src/pages/Settings/Account.tsx`

**Interfaces:**
- Consumes: `UserSession`, `GeoLocation` (Task 4); `formatLastActive`, `formatSignInDate`, `formatFullDateTime`; mọi hàm trong `@/utils/geo`; hợp đồng DOM ở Task 5.
- Produces:
  - `SessionMiniMap({ location }: { location: GeoLocation })`
  - `SessionRow({ icon, title, summary, session, children }: { icon: AppIcon; title: string; summary: ReactNode; session: UserSession | null; children?: ReactNode })`

- [ ] **Step 1: `SessionMiniMap.tsx`**

```tsx
import { useState } from "react";

import type { GeoLocation } from "@/apis/user";
import {
  circleRadiusPx,
  project,
  TILE_SIZE,
  tilesAround,
  zoomForRadius,
} from "@/utils/geo";

/** Khung cố định: số tile cần tải là hàm thuần của toạ độ, không phải đo DOM. */
const WIDTH = 320;
const HEIGHT = 160;

/**
 * Bản đồ tĩnh ghép từ tile OpenStreetMap. Vòng tròn đỏ là VÙNG BẤT ĐỊNH của vị
 * trí ước tính từ IP chứ không phải một điểm: IP chỉ biết tới quốc gia sẽ hiện
 * thành một vòng phủ cả nước, không phải một pin trông chính xác.
 *
 * Tile nào lỗi (mất mạng, bị chặn) thì bỏ cả khối. Nhãn và link Maps nằm ngoài
 * component này nên vẫn còn — người dùng chỉ mất hình, không mất thông tin.
 */
export function SessionMiniMap({ location }: { location: GeoLocation }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;

  const zoom = zoomForRadius(location.latitude, location.accuracyRadiusKm);
  const center = project(location.latitude, location.longitude, zoom);
  const radius = circleRadiusPx(
    location.latitude,
    location.accuracyRadiusKm,
    zoom,
  );

  return (
    <div
      role="img"
      aria-label={`Bản đồ vùng ước tính, bán kính khoảng ${Math.round(location.accuracyRadiusKm)} km`}
      className="relative h-40 w-80 max-w-full overflow-hidden rounded-lg border border-border bg-muted"
    >
      <div
        data-map-tiles
        className="absolute top-1/2 left-1/2 dark:brightness-75 dark:contrast-125"
      >
        {tilesAround(center, zoom, WIDTH, HEIGHT).map((tile) => (
          <img
            key={tile.key}
            src={tile.url}
            alt=""
            width={TILE_SIZE}
            height={TILE_SIZE}
            draggable={false}
            onError={() => setFailed(true)}
            className="absolute max-w-none select-none"
            style={{ left: tile.left, top: tile.top }}
          />
        ))}
      </div>
      <span
        data-accuracy-circle
        aria-hidden="true"
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-destructive bg-destructive/15"
        style={{ width: radius * 2, height: radius * 2 }}
      />
      <span
        aria-hidden="true"
        className="absolute top-1/2 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-destructive ring-2 ring-background"
      />
    </div>
  );
}
```

- [ ] **Step 2: `SessionRow.tsx`**

```tsx
import { useId, useState, type ReactNode } from "react";

import type { UserSession } from "@/apis/user";
import { ChevronDown, ExternalLink, type AppIcon } from "@/components/icons";
import { cn } from "@/lib/utils";
import {
  formatFullDateTime,
  formatLastActive,
  formatSignInDate,
} from "@/utils/formatDateTime";
import { formatPlace, googleMapsUrl, zoomForRadius } from "@/utils/geo";
import { SessionMiniMap } from "./SessionMiniMap";

/** Nối các phần có giá trị bằng " · ". */
const joinParts = (...parts: (string | null | undefined | false)[]) =>
  parts.filter(Boolean).join(" · ");

const capitalize = (text: string) =>
  text.charAt(0).toUpperCase() + text.slice(1);

const fullTime = (ms: number) => formatFullDateTime(new Date(ms).toISOString());

/**
 * Một thiết bị trong "Phiên đăng nhập": dòng thu gọn để quét nhanh, bấm vào để
 * xem nó đăng nhập ở đâu, lúc nào, và gần nhất đang ở đâu.
 *
 * Nút toggle chỉ bọc icon và chữ. `children` (nút Đăng xuất) nằm cạnh nó vì
 * HTML không cho lồng button.
 */
export function SessionRow({
  icon: Icon,
  title,
  summary,
  session,
  children,
}: {
  icon: AppIcon;
  title: string;
  summary: ReactNode;
  /** Chưa có (danh sách còn đang tải) thì hàng vẫn hiện nhưng chưa mở được. */
  session: UserSession | null;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  const head = (
    <>
      <span
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
      >
        <Icon className="size-4.5" />
      </span>
      <span className="min-w-0 flex-1 space-y-0.5">
        <span className="block text-sm font-medium text-foreground">
          {title}
        </span>
        <span className="block text-sm break-words text-muted-foreground">
          {summary}
        </span>
      </span>
    </>
  );

  return (
    <div>
      <div className="flex items-center gap-3.5 px-4 py-4 sm:px-5">
        {session ? (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((value) => !value)}
            className="-m-1.5 flex min-w-0 flex-1 items-center gap-3.5 rounded-lg p-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {head}
            <ChevronDown
              className={cn(
                "size-4 shrink-0 text-muted-foreground transition-transform",
                open && "rotate-180",
              )}
            />
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-3.5">{head}</div>
        )}
        {children && (
          <div className="flex shrink-0 items-center gap-2">{children}</div>
        )}
      </div>
      {session && open && <SessionDetails id={panelId} session={session} />}
    </div>
  );
}

function SessionDetails({ id, session }: { id: string; session: UserSession }) {
  // Bản đồ, bán kính và link cùng một nguồn: thiết bị đang ở đâu.
  const shown = session.lastLocation ?? session.location;
  // `?? session.ip`: API cũ trong lúc deploy chưa có lastIp.
  const lastIp = session.lastIp ?? session.ip;

  return (
    <div id={id} className="space-y-3 px-4 pb-4 sm:px-5 sm:pl-[4.375rem]">
      {shown ? (
        <>
          <SessionMiniMap location={shown} />
          <p className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>
              Ước tính từ IP · bán kính ~{Math.round(shown.accuracyRadiusKm)} km
            </span>
            <a
              href={googleMapsUrl(
                shown.latitude,
                shown.longitude,
                zoomForRadius(shown.latitude, shown.accuracyRadiusKm),
              )}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
            >
              Mở trên Google Maps
              <ExternalLink className="size-3.5" />
            </a>
          </p>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          Không xác định được vị trí.
        </p>
      )}

      <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr] sm:gap-y-2">
        <dt className="text-muted-foreground">Đăng nhập lần đầu</dt>
        <dd
          className="break-words text-foreground"
          title={fullTime(session.createdAt)}
        >
          {joinParts(
            formatSignInDate(session.createdAt),
            formatPlace(session.location),
            session.ip && `IP ${session.ip}`,
          )}
        </dd>
        <dt className="text-muted-foreground">Hoạt động gần nhất</dt>
        <dd
          className="break-words text-foreground"
          title={fullTime(session.lastSeenAt)}
        >
          {joinParts(
            capitalize(formatLastActive(session.lastSeenAt)),
            formatPlace(session.lastLocation),
            lastIp && `IP ${lastIp}`,
          )}
        </dd>
      </dl>

      {shown && (
        <p className="text-xs text-muted-foreground">
          Dữ liệu vị trí: GeoLite2 (
          <a
            href="https://www.maxmind.com"
            target="_blank"
            rel="noopener noreferrer"
            className="underline-offset-2 hover:underline"
          >
            MaxMind
          </a>
          ) · Bản đồ ©{" "}
          <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noopener noreferrer"
            className="underline-offset-2 hover:underline"
          >
            OpenStreetMap
          </a>
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 3: `Account.tsx`**

Imports:
- **xoá** dòng `import { formatRelativeTime } from "@/utils/formatDateTime";`;
- thêm:
  ```tsx
  import { formatLastActive } from "@/utils/formatDateTime";
  import { formatPlace } from "@/utils/geo";
  import { SessionRow } from "./SessionRow";
  ```

Ngay sau dòng `const otherDevices = …`, thêm:

```tsx
  const currentSession =
    (sessions ?? []).find((session) => session.current) ?? null;
```

Thay hàng "thiết bị này", tức khối `<SettingRow icon={device.mobile ? Smartphone : Monitor} title={device.name} …>…</SettingRow>` đầu tiên trong `SettingsSection` "Phiên đăng nhập", bằng:

```tsx
          <SessionRow
            icon={device.mobile ? Smartphone : Monitor}
            title={device.name}
            session={currentSession}
            summary={
              <span className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="size-1.5 rounded-full bg-success"
                />
                Thiết bị này · Đang hoạt động
              </span>
            }
          >
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmLogout(true)}
              className="hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive-text"
            >
              <LogOut aria-hidden="true" />
              Đăng xuất
            </Button>
          </SessionRow>
```

Thay toàn bộ khối `{otherDevices.map((session) => { … })}` bằng:

```tsx
          {otherDevices.map((session) => {
            const other = describeThisDevice(session.userAgent ?? "");
            // Thiết bị đang ở đâu: vị trí của IP gần nhất, không tra được thì
            // chính IP đó. `?? session.ip` giữ trang chạy được với API cũ
            // trong lúc deploy, khi chưa có lastIp.
            const where =
              formatPlace(session.lastLocation) ??
              session.lastIp ??
              session.ip ??
              "IP không rõ";
            return (
              <SessionRow
                key={session.sid}
                icon={other.mobile ? Smartphone : Monitor}
                title={other.name}
                session={session}
                summary={`${where} · hoạt động ${formatLastActive(session.lastSeenAt)}`}
              >
                <Button
                  variant="outline"
                  size="sm"
                  disabled={revokingSid === session.sid}
                  onClick={() => void revokeOne(session)}
                  className="hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive-text"
                >
                  <LogOut aria-hidden="true" />
                  Đăng xuất
                </Button>
              </SessionRow>
            );
          })}
```

- [ ] **Step 4: Cổng frontend**

```bash
cd /Users/nguyenn/Documents/Source/project/DALN/frontend
npm run lint
npm run build
```

Mong đợi: cả hai sạch.

- [ ] **Step 5: QC phải xanh**

Dev server từ Task 5 vẫn chạy (Vite tự nạp lại):

```bash
cd /Users/nguyenn/Documents/Source/project/DALN/qc && node session-location-browser.mjs
```

Mong đợi: `TỔNG CUỐI: 54 pass / 0 fail`, exit code 0. Mở và **tự nhìn** các ảnh `shots/loc-02-list.png`, `loc-03-london.png`, `loc-05-bhutan.png`, `loc-08-all-open.png`, `loc-11-mobile.png`, `loc-11-mobile-dark.png`. Vòng tròn phải nằm giữa khung, tile phải ghép liền không hở, chữ không bị tràn.

- [ ] **Step 6: Commit**

```bash
cd /Users/nguyenn/Documents/Source/project/DALN
git add frontend/src/pages/Settings/SessionMiniMap.tsx frontend/src/pages/Settings/SessionRow.tsx frontend/src/pages/Settings/Account.tsx
git commit -m "feat(web): expandable device rows with location, mini map and sign-in times"
```

---

## Task 7: Kiểm hồi quy và bàn giao

**Files:** không đổi file code nào.

- [ ] **Step 1: Toàn bộ cổng CI, chạy lại từ đầu**

```bash
cd /Users/nguyenn/Documents/Source/project/DALN/backend
npm run typecheck && npm test && npm run lint:check
TEST_REDIS_PORT=6380 npx jest libs/common/src/auth/session.store.redis.spec.ts
cd ../frontend && npm run lint && npm run build
```

Mong đợi: tất cả sạch; suite Redis `passed`, không `skipped`.

- [ ] **Step 2: Suite QC cũ vẫn xanh**

Luồng refresh, cấu trúc dòng thiết bị và nút Đăng xuất đều đã đổi, nên chạy lại cả ba suite:

```bash
cd /Users/nguyenn/Documents/Source/project/DALN/qc
./auth-api.sh
node auth-browser.mjs
node change-password-browser.mjs
```

Mong đợi: cả ba `0 fail`. Mục 8 của `auth-browser.mjs` tìm dòng thiết bị bằng cách leo từ nút Đăng xuất lên tối đa 5 thẻ cha tới thẻ có chữ "hoạt động" hoặc "Thiết bị này". Trong `SessionRow`, thẻ `div` của dòng cách nút đúng 2 cấp và chứa chữ đó. Nếu mục này đỏ, sửa suite QC chứ không sửa giao diện.

- [ ] **Step 3: Ghi lại việc để sau**

Cập nhật memory `project-deferred-work.md` với hai việc:
- cron `geoipupdate`, vì điều khoản GeoLite2 yêu cầu dùng bản mới;
- file `GeoLite2-City.mmdb` trên server prod do người dùng đặt, theo `deploy/README.md` mục GeoIP.

- [ ] **Step 4: Bàn giao**

Dùng skill `superpowers:finishing-a-development-branch`: push `develop`, mở PR `develop → main`, đợi CI xanh. Theo quy ước commit: không có dòng "Generated with Claude Code" trong PR. Trước khi merge (merge là deploy prod), nhắc người dùng đặt file GeoLite2 lên server theo `deploy/README.md` mục GeoIP. Không có file thì prod vẫn chạy, chỉ chưa có vị trí và bản đồ.
