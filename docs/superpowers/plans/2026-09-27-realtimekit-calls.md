# Chuyển cuộc gọi sang Cloudflare RealtimeKit — Kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gọi 1-1 và gọi nhóm chạy hoàn toàn trên Cloudflare RealtimeKit. Coturn và LiveKit không còn được code sử dụng. Mọi chức năng trong spec §7 vẫn chạy như trước, và QC trình duyệt chứng minh điều đó trên dev và prod.

**Architecture:**

- **realtime-gateway giữ toàn bộ nghiệp vụ:** chuông, bận, claim, quyền, nhật ký cuộc gọi. Chỉ phần media đổi:
  - gateway gọi REST API của RealtimeKit qua `RealtimeKitService`: mỗi hội thoại một phòng dùng lại, cấp `authToken` cho từng người, thu hồi khi cuộc gọi kết thúc;
  - danh sách người đang có mặt trong cuộc gọi nhóm lấy từ webhook `POST /realtime/rtk-webhook` đã xác thực chữ ký RSA.
- **Frontend:** thay hai hook media bằng `useDirectCall` và `useGroupCall`, cả hai dựng trên `useRtkRoom` (bọc Core SDK `@cloudflare/realtimekit`, lazy load). Các màn hình gọi giữ nguyên, chỉ sửa ở chỗ nối dây.

**Tech Stack:** NestJS 11 · ioredis · Jest 30 + ts-jest · Node `crypto` (RSA-SHA256) · React 19 + Vite · `@cloudflare/realtimekit` 2.0.2 (Core SDK) · Cloudflare RealtimeKit REST API · `cloudflare/cloudflared` (tunnel webhook cho dev) · puppeteer-core (QC)

**Spec:** [`docs/superpowers/specs/2026-09-27-realtimekit-calls-design.md`](../specs/2026-09-27-realtimekit-calls-design.md)

## Global Constraints

- **Logic nghiệp vụ không đổi.** Quyền (1-1: `fetchCallPeer`; nhóm: loại hội thoại `GROUP` và kiểm tra lại thành viên khi accept), khoá bận, claim nhiều tab, latch `end()` / `finish()`, bộ đếm 35 giây, cách tính thời lượng ở server, nhật ký cuộc gọi (RMQ `call.ended`, HTTP `group-call-log`): **giữ nguyên hành vi**.
- **Payload client:**
  - Payload client mới luôn có `v: 2`.
  - Thiếu `v === 2`, hoặc có `offer`/`answer`: trả ack `{ ok:false, code:'CLIENT_OUTDATED' }`.
  - Áp dụng cho `call.incoming_call`, `call.accepted`, `group_call.start`, `group_call.accept`.
- **Mã lỗi mới:**

  | Mã | Khi nào |
  |---|---|
  | `MEDIA_UNAVAILABLE` | API RealtimeKit lỗi, timeout 8 giây, 5xx, 401/403 |
  | `MEDIA_UNCONFIGURED` | Thiếu `REALTIMEKIT_*`. Thay cho `LIVEKIT_UNCONFIGURED` |
  | `CLIENT_OUTDATED` | Payload của client cũ (xem ở trên) |

- **Env:** `REALTIMEKIT_ACCOUNT_ID`, `REALTIMEKIT_APP_ID`, `REALTIMEKIT_API_TOKEN` (bắt buộc); `REALTIMEKIT_API_BASE` (tuỳ chọn, chỉ dùng cho test).
- **REST API:**
  - Base: `https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/realtime/kit/{APP}`.
  - Header `Authorization: Bearer {TOKEN}`.
  - Dữ liệu trả về nằm trong `data`.
- **Redis key mới:**

  | Key | Giá trị |
  |---|---|
  | `rtk:meeting:<conversationId>` | meetingId (không TTL) |
  | `rtk:conv:<meetingId>` | conversationId (không TTL) |
  | `groupcall:<conv>:rtk` | HASH `customParticipantId` → JSON `RtkGrant`, TTL 12 giờ |
  | `rtk:webhook:<rtk-uuid>` | chống xử lý lặp, `EX 86400` |

- **`custom_participant_id`** = `<userId>.<8 ký tự hex ngẫu nhiên>`, luôn duy nhất. userId lấy bằng `split('.')[0]`.
- **Không lưu `authToken` vào Redis.** Token chỉ đi trong ack.
- **Preset:**

  | Tên | Dùng cho |
  |---|---|
  | `daln_direct_audio`, `daln_direct_video` | 1-1 |
  | `daln_group_audio`, `daln_group_video` | nhóm |

  - Preset chọn theo `callType` **của cuộc gọi**, không theo lựa chọn camera của từng người.
  - Không dùng kiểu phòng Voice.
- **Webhook:**
  - Route `POST /realtime/rtk-webhook`, nhận raw body giới hạn 256 KB.
  - Chữ ký trong header `rtk-signature` (RSA-SHA256, base64).
  - Khoá công khai từ `https://api.realtime.cloudflare.com/.well-known/webhooks.json` (`data.publicKey`), cache 1 giờ; xác thực sai thì tải lại khoá một lần.
  - Mã trả về: sai chữ ký → 401; lỗi xử lý → 500 (và xoá key chống lặp); còn lại → 200.
- **Thời gian:**
  - phòng nhóm trống: chờ **15 giây** trước khi `finishGroupCall`;
  - không ai tham gia: **35 giây** (như cũ);
  - watchdog 1-1: **15 giây** sau khi nhận cuộc gọi;
  - chờ ack gọi/nhận ở client: **12 giây**.
- **Frontend:**
  - Ghim đúng `@cloudflare/realtimekit@2.0.2` (`--save-exact`). Bỏ `livekit-client`.
  - SDK được `import()` động bên trong `useRtkRoom`.
  - Chữ hiển thị giữ nguyên tiếng Việt như hiện tại. Thông báo mới:
    - `CLIENT_OUTDATED`: "Ứng dụng vừa được cập nhật, vui lòng tải lại trang."
    - `MEDIA_UNAVAILABLE`: "Không thể bắt đầu cuộc gọi, thử lại sau."
    - `MEDIA_UNCONFIGURED`: "Tính năng gọi chưa sẵn sàng. Vui lòng thử lại sau."
- **Không đụng tới trong PR này:** coturn, container LiveKit, các biến `TURN_*` / `LIVEKIT_*` trong file env, nginx `location /livekit/`. Để dành PR 2, và PR 2 phải hỏi người dùng trước.
- **Commit:** message tiếng Anh; `git add` từng đường dẫn cụ thể; **không** thêm `Co-Authored-By` hay dòng "Generated with". Không stage `.claude/`, `backend/.env*`, `qc/.env*`, `docs/cloudflare-realtimekit-setup.docx`.

## Review Focus

1. **Tab crash hoặc mất mạng giữa cuộc gọi nhóm (không có `group_call.leave`).** Webhook `participantLeft` phải kích hoạt bộ đếm phòng trống 15 giây. Phòng không được treo dấu "Đang gọi…" mãi. Pin bằng test "participantLeft cuối cùng → 15 giây sau finish" ở Task 7.
2. **Cloudflare gửi lại cùng một webhook** (retry sau lỗi 5xx, hoặc gửi trùng). Không được ghi nhật ký cuộc gọi nhóm hai lần, không phát `ended` hai lần. Pin bằng test chống lặp `rtk-uuid` (Task 7) cộng latch `finish()` với 2 đường vào (Task 7).
3. **API Cloudflare lỗi đúng lúc bấm gọi hoặc nhận.** Người dùng không được kẹt khoá bận 4 giờ. Pin bằng test `MEDIA_UNAVAILABLE` nhả khoá ở `incoming_call`, `accepted`, `group_call.accept` (Task 6, 7).
4. **Người đã bị xoá khỏi nhóm, hoặc người lạ, gửi webhook giả hay dùng token cũ.** Chữ ký sai phải bị từ chối. `customParticipantId` không thuộc `members` phải bị bỏ qua. Token phải bị thu hồi ở mọi đường kết thúc (ended, rejected, finish, huỷ sau 35 giây). Pin bằng test ở Task 3 và Task 7, và QC mục 30 ở Task 12.
5. **Hai người cùng lúc mở phòng mới cho cùng một hội thoại** (lần đầu gọi). Chỉ một phòng RealtimeKit được ánh xạ; cả hai phải vào đúng phòng đó. Pin bằng test "tạo đồng thời" ở Task 2.

---

## Cấu trúc file

| File | Trách nhiệm |
|---|---|
| `backend/apps/realtime-gateway/src/realtime/realtimekit.types.ts` (mới) | `RtkGrant`, `RtkPreset`, `presetFor`, `newCustomParticipantId`, `userIdFromCustomId` |
| `backend/apps/realtime-gateway/src/realtime/realtimekit.service.ts` (mới) | REST RealtimeKit: `isConfigured`, `ensureMeeting`, `conversationOfMeeting`, `addParticipant`, `revoke` |
| `backend/apps/realtime-gateway/src/realtime/rtk-webhook.ts` (mới) | `verifyRtkSignature`, `toPem`, `parseRtkEvent`, `RtkWebhookVerifier` (cache khoá công khai) |
| `backend/apps/realtime-gateway/src/realtime/call-session.store.ts` | Thêm `rtkGrants?` vào `CallSession`; thêm `releaseAccept()` |
| `backend/apps/realtime-gateway/src/realtime/group-call.store.ts` | Thêm `rtkGrants` vào phiên; thêm `addGrant()`; `finish` / `delete` xoá key `:rtk` |
| `backend/apps/realtime-gateway/src/realtime/realtime.gateway.ts` | Giao thức v2, RealtimeKit thay cho LiveKit/TURN, `applyRtkWebhook`, `finishGroupCall`, bộ đếm phòng trống |
| `backend/apps/realtime-gateway/src/realtime-gateway.controller.ts` | Route webhook RealtimeKit thay route LiveKit |
| `backend/apps/realtime-gateway/src/main.ts`, `realtime-gateway.module.ts` | Raw body cho route mới; provider mới |
| `backend/libs/constant/websocket/socket.events.ts`, `frontend/src/lib/socket.events.ts` | Bỏ `ICE_CONFIG`, `ICE_CANDIDATE`, `MEDIA_STATE` |
| `backend/scripts/realtimekit-setup.ts` (mới), `backend/scripts/realtimekit-dev-tunnel.sh` (mới), `backend/docker-compose.yml` | Tạo preset + webhook; tunnel webhook cho dev |
| `frontend/src/hooks/useRtkRoom.ts` (mới) | Bọc Core SDK: vào/rời phòng, danh sách người, phát âm thanh, điều khiển |
| `frontend/src/hooks/useDirectCall.ts` (mới, thay `useWebRTC.ts`) | Trạng thái cuộc gọi 1-1 trên `useRtkRoom` |
| `frontend/src/hooks/useGroupCall.ts` (viết lại) | Cùng giao diện hook, dựng trên `useRtkRoom` |
| `frontend/src/utils/callErrors.ts` (mới) | Các lớp lỗi và hàm `describe*` chuyển từ `useWebRTC.ts`, thêm mã mới |
| `frontend/src/components/VoiceCallModal/index.tsx`, `GroupCallModal/index.tsx`, `IncomingCallManager/index.tsx`, `contexts/CallProvider.tsx`, `utils/groupCallError.ts` | Nối dây: `authToken`, `v: 2`, bỏ SDP/ICE/`media_state` |
| `qc/calls-browser.mjs` (mới), `qc/calls-fixtures.mjs` (mới) | QC trình duyệt §7 trên dev/prod; dựng tài khoản, kết bạn, nhóm |
| `deploy/README.md`, `backend/.env.production.example` | Tài liệu RealtimeKit, biến env |

---

### Task 1: Probe API RealtimeKit trên app `daln-dev`

Kiểm chứng các giả định ở spec §11 phần API trước khi viết code phụ thuộc vào chúng. Các mục về client (§11.3, 5, 6) được kiểm ở Task 12 bằng trình duyệt thật.

**Files:**
- Create (không commit): `$SCRATCH/rtk-probe.mjs`, với `$SCRATCH` là thư mục scratchpad của phiên.
- Modify: `docs/superpowers/specs/2026-09-27-realtimekit-calls-design.md` (thêm §11.1 "Kết quả probe").

**Interfaces:**
- Consumes: `backend/.env` (`REALTIMEKIT_*` của app `daln-dev`).
- Produces: bảng kết quả trong spec §11.1. Task 2–4 đọc bảng này và xác nhận các giả định: `data.id`, `data.token`, 404 cho phòng lạ, định dạng `publicKey`, `ui` có bắt buộc không, đường dẫn kick.

- [ ] **Step 1: Viết script probe**

```js
// $SCRATCH/rtk-probe.mjs — chạy: node rtk-probe.mjs /Users/nguyenn/Documents/Source/project/DALN/backend/.env
import { readFileSync } from 'node:fs'
const env = Object.fromEntries(
  readFileSync(process.argv[2], 'utf8').split('\n')
    .filter((l) => l.startsWith('REALTIMEKIT_'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')] }),
)
const base = `https://api.cloudflare.com/client/v4/accounts/${env.REALTIMEKIT_ACCOUNT_ID}/realtime/kit/${env.REALTIMEKIT_APP_ID}`
const call = async (method, path, body) => {
  const res = await fetch(base + path, {
    method,
    headers: { Authorization: `Bearer ${env.REALTIMEKIT_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let json = null; try { json = JSON.parse(text) } catch {}
  return { status: res.status, json, text: text.slice(0, 400) }
}
const show = (label, r) => console.log(`\n## ${label}\nstatus=${r.status}\n${JSON.stringify(r.json ?? r.text, null, 1).slice(0, 700)}`)

const meeting = await call('POST', '/meetings', { title: 'probe_conv' }); show('create meeting', meeting)
const mid = meeting.json?.data?.id
const p1 = await call('POST', `/meetings/${mid}/participants`, { custom_participant_id: 'u1.aaaa0001', name: 'Probe', preset_name: 'group_call_participant' }); show('add participant', p1)
const p1b = await call('POST', `/meetings/${mid}/participants`, { custom_participant_id: 'u1.aaaa0001', name: 'Probe', preset_name: 'group_call_participant' }); show('add same custom id again', p1b)
show('add to unknown meeting', await call('POST', `/meetings/00000000-0000-0000-0000-000000000000/participants`, { custom_participant_id: 'x.1', name: 'x', preset_name: 'group_call_participant' }))
show('kick (no live session)', await call('POST', `/meetings/${mid}/active-session/kick`, { custom_participant_ids: ['u1.aaaa0001'] }))
show('delete participant', await call('DELETE', `/meetings/${mid}/participants/${p1.json?.data?.id}`))
show('deactivate meeting', await call('PATCH', `/meetings/${mid}`, { status: 'INACTIVE' }))
show('add to INACTIVE meeting', await call('POST', `/meetings/${mid}/participants`, { custom_participant_id: 'u2.bbbb0002', name: 'P2', preset_name: 'group_call_participant' }))
show('list presets', await call('GET', '/presets'))
show('create preset without ui', await call('POST', '/presets', { name: 'daln_probe', config: { view_type: 'GROUP_CALL', max_video_streams: { desktop: 1, mobile: 1 }, max_screenshare_count: 0, media: { video: { quality: 'vga', frame_rate: 24 }, screenshare: { quality: 'vga', frame_rate: 5 } } }, permissions: { media: { audio: { can_produce: 'ALLOWED' }, video: { can_produce: 'ALLOWED' }, screenshare: { can_produce: 'NOT_ALLOWED' } }, waiting_room_type: 'SKIP' } }))
show('list webhooks', await call('GET', '/webhooks'))
const pk = await fetch('https://api.realtime.cloudflare.com/.well-known/webhooks.json'); show('webhook public key', { status: pk.status, json: await pk.json() })
```

- [ ] **Step 2: Chạy và đọc toàn bộ kết quả**

Chạy: `node $SCRATCH/rtk-probe.mjs /Users/nguyenn/Documents/Source/project/DALN/backend/.env`

Kỳ vọng (theo hướng này thì code ở các task sau dùng được nguyên):
- `create meeting`: 2xx, có `data.id`.
- `add participant`: 2xx, có `data.id` và `data.token`.
- `add to unknown meeting`: 404.
- `add to INACTIVE meeting`: 4xx; ghi lại mã cụ thể.
- `webhook public key`: `data.publicKey` là PEM hoặc base64.
- `create preset without ui`: 2xx, hoặc 4xx nêu thiếu `ui`.

Nếu preset `daln_probe` được tạo thì xoá nó: `DELETE /presets/<id>`. Script có in id của preset.

- [ ] **Step 3: Ghi kết quả vào spec §11.1 và commit**

Thêm vào cuối spec:

```markdown
### 11.1 Kết quả probe (2026-09-27, app daln-dev)

| Giả định | Kết quả thật | Hệ quả cho code |
|---|---|---|
| Thêm participant trả `data.id`, `data.token` | <điền> | <điền> |
| Trùng `custom_participant_id` | <điền> | Không phụ thuộc: id luôn có hậu tố ngẫu nhiên |
| Phòng lạ → 404 | <điền> | `addParticipant` thử lại khi gặp 404 |
| Phòng INACTIVE → mã gì | <điền> | Nếu không phải 404 thì thêm mã đó vào nhánh thử lại |
| Kick khi không có phiên | <điền> | `revoke` bỏ qua lỗi |
| `ui` bắt buộc khi tạo preset | <điền> | `rtk:setup` luôn gửi `ui` |
| Định dạng `publicKey` | <điền> | `toPem()` xử lý cả PEM lẫn base64 |
```

Điền `<điền>` bằng số liệu thật từ Step 2. Kết quả khác kỳ vọng thì ghi `Ruling:` vào ledger và chỉnh các task liên quan trước khi làm tiếp. Nếu giả định cốt lõi sai (không có `data.token`, không tạo được phòng) thì **dừng lại, báo người dùng**.

```bash
git add docs/superpowers/specs/2026-09-27-realtimekit-calls-design.md
git commit -m "docs(spec): record the RealtimeKit API probe results"
```

---

### Task 2: `RealtimeKitService` và các kiểu dữ liệu

**Files:**
- Create: `backend/apps/realtime-gateway/src/realtime/realtimekit.types.ts`
- Create: `backend/apps/realtime-gateway/src/realtime/realtimekit.service.ts`
- Test: `backend/apps/realtime-gateway/src/realtime/realtimekit.service.spec.ts`

**Interfaces:**
- Consumes: Redis client (token `'REDIS_CLIENT'`), kết quả probe ở Task 1.
- Produces:
  - `type RtkGrant = { meetingId: string; participantId: string; customParticipantId: string }`
  - `type RtkPreset = 'daln_direct_audio' | 'daln_direct_video' | 'daln_group_audio' | 'daln_group_video'`
  - `presetFor(scope: 'direct' | 'group', callType: 'audio' | 'video'): RtkPreset`
  - `newCustomParticipantId(userId: string): string`, `userIdFromCustomId(id?: string | null): string`
  - `class RealtimeKitUnavailableError extends Error`
  - `const RTK_FETCH = 'RTK_FETCH'` (token DI, chỉ để test thay `fetch`)
  - `class RealtimeKitService`:
    - `isConfigured(): boolean`
    - `ensureMeeting(conversationId): Promise<string>`
    - `conversationOfMeeting(meetingId): Promise<string | null>`
    - `addParticipant(conversationId, { userId, name, preset }): Promise<RtkGrant & { authToken: string }>`
    - `revoke(grants: RtkGrant[]): Promise<void>` (không bao giờ ném lỗi)

- [ ] **Step 1: Viết test (sẽ đỏ)**

```ts
// realtimekit.service.spec.ts
import { RealtimeKitService } from './realtimekit.service'
import { RealtimeKitUnavailableError } from './realtimekit.service'
import {
  newCustomParticipantId,
  presetFor,
  userIdFromCustomId,
} from './realtimekit.types'

/** Redis giả đủ cho service: get/set (NX)/del. */
class MemRedis {
  m = new Map<string, string>()
  get(k: string) {
    return Promise.resolve(this.m.get(k) ?? null)
  }
  set(k: string, v: string, ...args: unknown[]) {
    if (args.includes('NX') && this.m.has(k)) return Promise.resolve(null)
    this.m.set(k, v)
    return Promise.resolve('OK')
  }
  del(...keys: string[]) {
    let n = 0
    for (const k of keys) if (this.m.delete(k)) n++
    return Promise.resolve(n)
  }
}

const reply = (data: unknown, status = 200) => ({
  ok: status < 300,
  status,
  text: () => Promise.resolve(JSON.stringify({ success: status < 300, data })),
})

describe('RealtimeKitService', () => {
  const OLD = process.env
  let redis: MemRedis
  let fetchMock: jest.Mock
  let svc: RealtimeKitService

  beforeEach(() => {
    process.env = {
      ...OLD,
      REALTIMEKIT_ACCOUNT_ID: 'acc',
      REALTIMEKIT_APP_ID: 'app',
      REALTIMEKIT_API_TOKEN: 'tok',
    }
    delete process.env.REALTIMEKIT_API_BASE
    redis = new MemRedis()
    fetchMock = jest.fn()
    svc = new RealtimeKitService(redis as never, fetchMock)
  })
  afterAll(() => {
    process.env = OLD
  })

  it('isConfigured cần đủ ba biến', () => {
    expect(svc.isConfigured()).toBe(true)
    delete process.env.REALTIMEKIT_API_TOKEN
    expect(svc.isConfigured()).toBe(false)
  })

  it('preset theo phạm vi + loại cuộc gọi; custom id = userId.hậu tố', () => {
    expect(presetFor('group', 'video')).toBe('daln_group_video')
    expect(presetFor('direct', 'audio')).toBe('daln_direct_audio')
    const id = newCustomParticipantId('64f0c0ffee')
    expect(id).toMatch(/^64f0c0ffee\.[0-9a-f]{8}$/)
    expect(userIdFromCustomId(id)).toBe('64f0c0ffee')
    expect(userIdFromCustomId(undefined)).toBe('')
  })

  it('tạo phòng một lần, dùng lại, ghi ánh xạ hai chiều', async () => {
    fetchMock.mockResolvedValueOnce(reply({ id: 'm1' }))

    expect(await svc.ensureMeeting('c1')).toBe('m1')
    expect(await svc.ensureMeeting('c1')).toBe('m1')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(
      'https://api.cloudflare.com/client/v4/accounts/acc/realtime/kit/app/meetings',
    )
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer tok',
    )
    expect(JSON.parse(init.body as string)).toEqual({ title: 'conv_c1' })
    expect(await svc.conversationOfMeeting('m1')).toBe('c1')
  })

  it('tạo đồng thời: bên thua dùng phòng của bên thắng', async () => {
    fetchMock.mockImplementationOnce(async () => {
      await redis.set('rtk:meeting:c1', 'winner')
      return reply({ id: 'loser' })
    })

    expect(await svc.ensureMeeting('c1')).toBe('winner')
    expect(await svc.conversationOfMeeting('loser')).toBeNull()
  })

  it('addParticipant: trả token, custom id duy nhất, đúng preset', async () => {
    await redis.set('rtk:meeting:c1', 'm1')
    fetchMock.mockResolvedValueOnce(reply({ id: 'p1', token: 'jwt' }))

    const grant = await svc.addParticipant('c1', {
      userId: 'u1',
      name: 'An',
      preset: 'daln_direct_audio',
    })

    expect(grant).toEqual({
      meetingId: 'm1',
      participantId: 'p1',
      customParticipantId: expect.stringMatching(/^u1\.[0-9a-f]{8}$/),
      authToken: 'jwt',
    })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toMatch(/\/meetings\/m1\/participants$/)
    expect(JSON.parse(init.body as string)).toEqual({
      custom_participant_id: grant.customParticipantId,
      name: 'An',
      preset_name: 'daln_direct_audio',
    })
  })

  it('phòng không còn (404) -> tạo phòng mới rồi thử lại một lần', async () => {
    await redis.set('rtk:meeting:c1', 'dead')
    fetchMock
      .mockResolvedValueOnce(reply(null, 404))
      .mockResolvedValueOnce(reply({ id: 'm2' }))
      .mockResolvedValueOnce(reply({ id: 'p1', token: 'jwt' }))

    const grant = await svc.addParticipant('c1', {
      userId: 'u1',
      name: 'An',
      preset: 'daln_group_video',
    })

    expect(grant.meetingId).toBe('m2')
    expect(await redis.get('rtk:meeting:c1')).toBe('m2')
  })

  it.each([
    ['5xx', () => Promise.resolve(reply(null, 503))],
    ['401', () => Promise.resolve(reply(null, 401))],
    ['mạng', () => Promise.reject(new Error('ECONNRESET'))],
  ])('lỗi %s -> RealtimeKitUnavailableError', async (_label, impl) => {
    await redis.set('rtk:meeting:c1', 'm1')
    fetchMock.mockImplementation(impl)

    await expect(
      svc.addParticipant('c1', {
        userId: 'u1',
        name: 'An',
        preset: 'daln_direct_audio',
      }),
    ).rejects.toBeInstanceOf(RealtimeKitUnavailableError)
  })

  it('chưa cấu hình -> RealtimeKitUnavailableError, không gọi mạng', async () => {
    delete process.env.REALTIMEKIT_APP_ID
    await expect(svc.ensureMeeting('c1')).rejects.toBeInstanceOf(
      RealtimeKitUnavailableError,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('quá 8 giây -> huỷ request, RealtimeKitUnavailableError', async () => {
    jest.useFakeTimers()
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) =>
          init.signal?.addEventListener('abort', () =>
            reject(new Error('aborted')),
          ),
        ),
    )
    const pending = svc.ensureMeeting('c1')
    const assertion = expect(pending).rejects.toBeInstanceOf(
      RealtimeKitUnavailableError,
    )
    await jest.advanceTimersByTimeAsync(8000)
    await assertion
    jest.useRealTimers()
  })

  it('revoke: kick theo custom id rồi xoá từng người; lỗi không ném ra', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(null, 400))
      .mockResolvedValueOnce(reply({}))
      .mockRejectedValueOnce(new Error('boom'))

    await expect(
      svc.revoke([
        { meetingId: 'm1', participantId: 'p1', customParticipantId: 'u1.aa' },
        { meetingId: 'm1', participantId: 'p2', customParticipantId: 'u2.bb' },
      ]),
    ).resolves.toBeUndefined()

    const calls = fetchMock.mock.calls as [string, RequestInit][]
    expect(calls[0][0]).toMatch(/\/meetings\/m1\/active-session\/kick$/)
    expect(JSON.parse(calls[0][1].body as string)).toEqual({
      custom_participant_ids: ['u1.aa', 'u2.bb'],
    })
    expect(calls[1][1].method).toBe('DELETE')
    expect(calls[1][0]).toMatch(/\/meetings\/m1\/participants\/p1$/)
    expect(calls[2][0]).toMatch(/\/meetings\/m1\/participants\/p2$/)
  })

  it('revoke với danh sách rỗng không gọi mạng', async () => {
    await svc.revoke([])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Chạy: `cd backend && npx jest apps/realtime-gateway/src/realtime/realtimekit.service.spec.ts`
Kỳ vọng: FAIL với lỗi `Cannot find module './realtimekit.service'`.

- [ ] **Step 3: Viết `realtimekit.types.ts`**

```ts
import { randomBytes } from 'crypto'

/**
 * Một người tham gia RealtimeKit mà gateway đã cấp cho một cuộc gọi. Lưu lại để
 * thu hồi khi cuộc gọi kết thúc: token RealtimeKit sống 100 ngày và chỉ mất
 * hiệu lực khi xoá người tham gia. KHÔNG chứa authToken — token chỉ đi trong ack.
 */
export interface RtkGrant {
  meetingId: string
  participantId: string
  customParticipantId: string
}

export type RtkPreset =
  | 'daln_direct_audio'
  | 'daln_direct_video'
  | 'daln_group_audio'
  | 'daln_group_video'

/**
 * Preset theo loại CUỘC GỌI, không theo lựa chọn camera của từng người: cuộc gọi
 * thoại dùng preset cấm phát video (giữ quy tắc cũ của LiveKit), cuộc gọi video
 * dùng preset cho phép dù người đó vào với camera tắt.
 */
export function presetFor(
  scope: 'direct' | 'group',
  callType: 'audio' | 'video',
): RtkPreset {
  return `daln_${scope}_${callType}`
}

/**
 * `custom_participant_id` luôn duy nhất: `<userId>.<8 hex>`. Nhờ vậy nhiều tab
 * của cùng một người, hay người tham gia sót lại sau một tab crash, không bao
 * giờ đụng nhau. userId (ObjectId, không có dấu chấm) lấy lại bằng split.
 */
export function newCustomParticipantId(userId: string): string {
  return `${userId}.${randomBytes(4).toString('hex')}`
}

export function userIdFromCustomId(id?: string | null): string {
  if (typeof id !== 'string') return ''
  return id.split('.')[0] ?? ''
}
```

- [ ] **Step 4: Viết `realtimekit.service.ts`**

```ts
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
    const { status, data } = await this.request<{ id?: string; token?: string }>(
      'POST',
      `/meetings/${meetingId}/participants`,
      {
        custom_participant_id: customParticipantId,
        name: input.name,
        preset_name: input.preset,
      },
    )
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
        await this.request('POST', `/meetings/${meetingId}/active-session/kick`, {
          custom_participant_ids: list.map((g) => g.customParticipantId),
        })
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
```

Nếu Task 1 cho thấy phòng INACTIVE trả mã khác 404, thêm mã đó vào điều kiện `if (result.status === 404)` và thêm một ca `it.each` tương ứng vào test.

- [ ] **Step 5: Chạy test, xác nhận xanh**

Chạy: `cd backend && npx jest apps/realtime-gateway/src/realtime/realtimekit.service.spec.ts`
Kỳ vọng: PASS, 11 test.

- [ ] **Step 6: Commit**

```bash
git add backend/apps/realtime-gateway/src/realtime/realtimekit.types.ts backend/apps/realtime-gateway/src/realtime/realtimekit.service.ts backend/apps/realtime-gateway/src/realtime/realtimekit.service.spec.ts
git commit -m "feat(realtime): add a RealtimeKit REST client with one meeting per conversation"
```

---

### Task 3: Xác thực webhook RealtimeKit

**Files:**
- Create: `backend/apps/realtime-gateway/src/realtime/rtk-webhook.ts`
- Test: `backend/apps/realtime-gateway/src/realtime/rtk-webhook.spec.ts`

**Interfaces:**
- Consumes: `RTK_FETCH` (Task 2), kết quả probe về `publicKey`.
- Produces:
  - `verifyRtkSignature(rawBody: string, signature: string | undefined, publicKeyPem: string): boolean`
  - `toPem(key: string): string`
  - `interface RtkWebhookEvent { event: string; meetingId: string; customParticipantId?: string }`
  - `parseRtkEvent(raw: string): RtkWebhookEvent | null`
  - `class RtkWebhookVerifier { verify(rawBody: string, signature?: string): Promise<boolean> }`

- [ ] **Step 1: Viết test (sẽ đỏ)**

```ts
// rtk-webhook.spec.ts
import { createSign, generateKeyPairSync } from 'crypto'
import {
  parseRtkEvent,
  RtkWebhookVerifier,
  toPem,
  verifyRtkSignature,
} from './rtk-webhook'

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
})
const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
const other = generateKeyPairSync('rsa', { modulusLength: 2048 })
const otherPem = other.publicKey.export({ type: 'spki', format: 'pem' }).toString()

const sign = (body: string) => {
  const signer = createSign('RSA-SHA256')
  signer.update(body)
  signer.end()
  return signer.sign(privateKey, 'base64')
}

const keyReply = (key: string) => ({
  ok: true,
  status: 200,
  text: () => Promise.resolve(JSON.stringify({ data: { publicKey: key } })),
})

describe('rtk-webhook', () => {
  const body = JSON.stringify({ event: 'meeting.started', meeting: { id: 'm1' } })

  it('chữ ký đúng -> true; sai body / sai khoá / thiếu chữ ký -> false', () => {
    const sig = sign(body)
    expect(verifyRtkSignature(body, sig, pem)).toBe(true)
    expect(verifyRtkSignature(body + ' ', sig, pem)).toBe(false)
    expect(verifyRtkSignature(body, sig, otherPem)).toBe(false)
    expect(verifyRtkSignature(body, undefined, pem)).toBe(false)
    expect(verifyRtkSignature(body, 'rác', pem)).toBe(false)
  })

  it('toPem: giữ nguyên PEM, bọc base64 trần thành PEM', () => {
    expect(toPem(pem)).toBe(pem)
    const bare = pem
      .replace(/-----[^-]+-----/g, '')
      .replace(/\s+/g, '')
    expect(verifyRtkSignature(body, sign(body), toPem(bare))).toBe(true)
  })

  it('parseRtkEvent lấy event, meeting.id, customParticipantId', () => {
    expect(
      parseRtkEvent(
        JSON.stringify({
          event: 'meeting.participantJoined',
          meeting: { id: 'm1' },
          participant: { customParticipantId: 'u1.aa' },
        }),
      ),
    ).toEqual({
      event: 'meeting.participantJoined',
      meetingId: 'm1',
      customParticipantId: 'u1.aa',
    })
    expect(parseRtkEvent('không phải json')).toBeNull()
    expect(parseRtkEvent(JSON.stringify({ event: 'x' }))).toBeNull()
  })

  it('verifier: cache khoá; sai thì tải lại đúng một lần', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(keyReply(otherPem))
      .mockResolvedValueOnce(keyReply(pem))
    const verifier = new RtkWebhookVerifier(fetchMock)

    expect(await verifier.verify(body, sign(body))).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    // Khoá mới đã được cache: lần sau không tải nữa.
    expect(await verifier.verify(body, sign(body))).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('verifier: không tải được khoá -> false, không nổ', async () => {
    const verifier = new RtkWebhookVerifier(
      jest.fn().mockRejectedValue(new Error('offline')),
    )
    expect(await verifier.verify(body, sign(body))).toBe(false)
  })
})
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Chạy: `cd backend && npx jest apps/realtime-gateway/src/realtime/rtk-webhook.spec.ts`
Kỳ vọng: FAIL, `Cannot find module './rtk-webhook'`.

- [ ] **Step 3: Viết `rtk-webhook.ts`**

```ts
import { Inject, Injectable, Logger, Optional } from '@nestjs/common'
import { createVerify } from 'crypto'
import { RTK_FETCH } from './realtimekit.service'

export const RTK_PUBLIC_KEY_URL =
  'https://api.realtime.cloudflare.com/.well-known/webhooks.json'
const KEY_TTL_MS = 60 * 60 * 1000

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
  return { event, meetingId, ...(customParticipantId ? { customParticipantId } : {}) }
}

/**
 * Giữ khoá công khai của RealtimeKit (cache 1 giờ). Chữ ký sai thì tải lại khoá
 * MỘT lần — phòng khi Cloudflare vừa xoay khoá — rồi mới kết luận là sai.
 */
@Injectable()
export class RtkWebhookVerifier {
  private readonly logger = new Logger(RtkWebhookVerifier.name)
  private cached: { pem: string; fetchedAt: number } | null = null

  constructor(@Optional() @Inject(RTK_FETCH) private readonly fetchImpl?: FetchLike) {}

  async verify(rawBody: string, signature?: string): Promise<boolean> {
    const current = await this.publicKey(false)
    if (current && verifyRtkSignature(rawBody, signature, current)) return true
    const fresh = await this.publicKey(true)
    return Boolean(
      fresh && fresh !== current && verifyRtkSignature(rawBody, signature, fresh),
    )
  }

  private async publicKey(force: boolean): Promise<string | null> {
    if (!force && this.cached && Date.now() - this.cached.fetchedAt < KEY_TTL_MS) {
      return this.cached.pem
    }
    try {
      const doFetch: FetchLike = this.fetchImpl ?? fetch
      const res = await doFetch(RTK_PUBLIC_KEY_URL)
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
    }
  }
}
```

- [ ] **Step 4: Chạy test, xác nhận xanh**

Chạy: `cd backend && npx jest apps/realtime-gateway/src/realtime/rtk-webhook.spec.ts`
Kỳ vọng: PASS, 5 test.

- [ ] **Step 5: Commit**

```bash
git add backend/apps/realtime-gateway/src/realtime/rtk-webhook.ts backend/apps/realtime-gateway/src/realtime/rtk-webhook.spec.ts
git commit -m "feat(realtime): verify RealtimeKit webhook signatures with a cached public key"
```

---

### Task 4: Script tạo preset và webhook; tunnel webhook cho dev

**Files:**
- Create: `backend/scripts/realtimekit-setup.ts`
- Create: `backend/scripts/realtimekit-dev-tunnel.sh`
- Modify: `backend/package.json` (scripts `rtk:setup`, `rtk:dev-tunnel`)
- Modify: `backend/docker-compose.yml` (service `rtk-tunnel`, profile `rtk`)

**Interfaces:**
- Consumes: kết quả probe (`ui` có bắt buộc không, định dạng response danh sách).
- Produces: 4 preset và webhook `daln` trên app dev. Các task sau giả định 4 preset đã tồn tại.

- [ ] **Step 1: Viết `backend/scripts/realtimekit-setup.ts`**

```ts
/**
 * Tạo/cập nhật preset và webhook của app RealtimeKit. Chạy lại bao nhiêu lần cũng
 * được: preset/webhook đã có thì sửa cho khớp.
 *
 *   npm run rtk:setup -- --env .env [--webhook-url https://.../realtime/rtk-webhook]
 *   ssh … "grep '^REALTIMEKIT_' .env.production" | npm run rtk:setup -- --env-stdin --webhook-url …
 */
import { readFileSync } from 'fs'

type Env = Record<string, string>

function parseEnv(text: string): Env {
  const env: Env = {}
  for (const line of text.split('\n')) {
    const m = /^(REALTIMEKIT_[A-Z_]+)=(.*)$/.exec(line.trim())
    if (m) env[m[1]] = m[2].replace(/^"|"$/g, '')
  }
  return env
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function readEnv(): Promise<Env> {
  if (process.argv.includes('--env-stdin')) {
    const chunks: Buffer[] = []
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
    return parseEnv(Buffer.concat(chunks).toString('utf8'))
  }
  const file = arg('--env')
  if (!file) throw new Error('Cần --env <file> hoặc --env-stdin')
  return parseEnv(readFileSync(file, 'utf8'))
}

const UI = {
  design_tokens: {
    border_radius: 'rounded',
    border_width: 'thin',
    spacing_base: 4,
    theme: 'dark',
    colors: {
      brand: { 300: '#844d1c', 400: '#9d5b22', 500: '#b56927', 600: '#d37c30', 700: '#d9904f' },
      background: { 600: '#222222', 700: '#1f1f1f', 800: '#1b1b1b', 900: '#181818', 1000: '#080808' },
      danger: '#FF2D2D',
      success: '#62A504',
      warning: '#FFCD07',
      text: '#EEEEEE',
      text_on_brand: '#EEEEEE',
      video_bg: '#191919',
    },
  },
}

function presetBody(name: string, scope: 'direct' | 'group', callType: 'audio' | 'video') {
  const video = callType === 'video'
  const group = scope === 'group'
  return {
    name,
    config: {
      view_type: 'GROUP_CALL',
      max_video_streams: video
        ? group ? { desktop: 9, mobile: 6 } : { desktop: 1, mobile: 1 }
        : { desktop: 0, mobile: 0 },
      max_screenshare_count: 0,
      media: {
        video: group
          ? { quality: 'vga', frame_rate: 24, simulcast: video }
          : { quality: 'hd', frame_rate: 30, simulcast: false },
        screenshare: { quality: 'vga', frame_rate: 5 },
      },
    },
    permissions: {
      accept_waiting_requests: false,
      can_accept_production_requests: false,
      can_change_participant_permissions: false,
      can_edit_display_name: false,
      can_livestream: false,
      can_record: false,
      can_spotlight: false,
      chat: {
        public: { can_send: false, text: false, files: false },
        private: { can_send: false, can_receive: false, text: false, files: false },
      },
      connected_meetings: {
        can_alter_connected_meetings: false,
        can_switch_connected_meetings: false,
        can_switch_to_parent_meeting: false,
      },
      disable_participant_audio: false,
      disable_participant_screensharing: false,
      disable_participant_video: false,
      hidden_participant: false,
      kick_participant: false,
      pin_participant: false,
      media: {
        audio: { can_produce: 'ALLOWED' },
        video: { can_produce: video ? 'ALLOWED' : 'NOT_ALLOWED' },
        screenshare: { can_produce: 'NOT_ALLOWED' },
      },
      plugins: { can_close: false, can_start: false, can_edit_config: false, config: {} },
      polls: { can_create: false, can_view: false, can_vote: false },
      recorder_type: 'NONE',
      show_participant_list: true,
      waiting_room_type: 'SKIP',
    },
    ui: UI,
  }
}

const PRESETS: [string, 'direct' | 'group', 'audio' | 'video'][] = [
  ['daln_direct_audio', 'direct', 'audio'],
  ['daln_direct_video', 'direct', 'video'],
  ['daln_group_audio', 'group', 'audio'],
  ['daln_group_video', 'group', 'video'],
]
const WEBHOOK_EVENTS = [
  'meeting.started',
  'meeting.ended',
  'meeting.participantJoined',
  'meeting.participantLeft',
]

async function main() {
  const env = await readEnv()
  const { REALTIMEKIT_ACCOUNT_ID: acc, REALTIMEKIT_APP_ID: app, REALTIMEKIT_API_TOKEN: token } = env
  if (!acc || !app || !token) throw new Error('Thiếu REALTIMEKIT_ACCOUNT_ID / APP_ID / API_TOKEN')
  const base = `https://api.cloudflare.com/client/v4/accounts/${acc}/realtime/kit/${app}`

  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(base + path, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`)
    return (JSON.parse(text || '{}') as { data?: unknown }).data
  }

  const existing = ((await call('GET', '/presets')) as { id: string; name: string }[]) ?? []
  for (const [name, scope, callType] of PRESETS) {
    const found = existing.find((p) => p.name === name)
    if (found) {
      await call('PATCH', `/presets/${found.id}`, presetBody(name, scope, callType))
      console.log(`preset ${name}: cập nhật`)
    } else {
      await call('POST', '/presets', presetBody(name, scope, callType))
      console.log(`preset ${name}: tạo mới`)
    }
  }

  const webhookUrl = arg('--webhook-url')
  if (webhookUrl) {
    const hooks = ((await call('GET', '/webhooks')) as { id: string; name: string }[]) ?? []
    const body = { name: 'daln', url: webhookUrl, events: WEBHOOK_EVENTS, enabled: true }
    const found = hooks.find((h) => h.name === 'daln')
    if (found) await call('PATCH', `/webhooks/${found.id}`, body)
    else await call('POST', '/webhooks', body)
    console.log(`webhook daln -> ${webhookUrl}`)
  }
}

main().catch((error: unknown) => {
  console.error((error as Error).message)
  process.exit(1)
})
```

Nếu probe cho thấy `GET /presets` hoặc `GET /webhooks` trả dữ liệu dạng khác mảng (ví dụ `data.presets`), sửa hai dòng đọc `existing` / `hooks` cho khớp, và ghi `Ruling:` vào ledger.

- [ ] **Step 2: Thêm npm scripts vào `backend/package.json`**

Thêm ngay sau dòng `"rcm:train-bootstrap": …`:

```json
    "rtk:setup": "ts-node --transpile-only --compiler-options '{\"module\":\"commonjs\",\"moduleResolution\":\"node\"}' scripts/realtimekit-setup.ts",
    "rtk:dev-tunnel": "bash scripts/realtimekit-dev-tunnel.sh",
```

- [ ] **Step 3: Thêm service `rtk-tunnel` vào `backend/docker-compose.yml`**

Thêm ngay trước service `realtime-gateway:`, cùng mức thụt lề với các service khác:

```yaml
  # Tunnel tạm để webhook RealtimeKit (Cloudflare) gọi được gateway đang chạy ở
  # máy dev. Chỉ chạy khi cần: `npm run rtk:dev-tunnel` (profile rtk).
  rtk-tunnel:
    image: cloudflare/cloudflared:latest
    container_name: daln-rtk-tunnel
    profiles: ['rtk']
    command: tunnel --no-autoupdate --url http://realtime-gateway:3001
    depends_on:
      - realtime-gateway
```

- [ ] **Step 4: Viết `backend/scripts/realtimekit-dev-tunnel.sh`**

```bash
#!/bin/bash
# Mở tunnel Cloudflare tới gateway dev rồi trỏ webhook của app daln-dev vào đó.
# URL *.trycloudflare.com đổi mỗi lần tunnel khởi động lại, nên chạy lại script
# này sau mỗi lần `docker compose up` lại service rtk-tunnel.
set -euo pipefail
cd "$(dirname "$0")/.."

docker compose --profile rtk up -d rtk-tunnel
url=""
for _ in $(seq 1 30); do
  url=$(docker compose --profile rtk logs rtk-tunnel 2>&1 | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1 || true)
  [ -n "$url" ] && break
  sleep 2
done
[ -n "$url" ] || { echo "không lấy được URL tunnel" >&2; exit 1; }
echo "tunnel: $url"
npm run rtk:setup -- --env .env --webhook-url "$url/realtime/rtk-webhook"
```

- [ ] **Step 5: Chạy setup cho app dev (chưa có webhook)**

Chạy: `cd backend && npm run rtk:setup -- --env .env`
Kỳ vọng: 4 dòng `preset daln_…: tạo mới`. Chạy lại lần hai: 4 dòng `…: cập nhật`, không lỗi.

Kiểm tra: chạy lại script probe của Task 1 phần `list presets` (hoặc `curl` bằng token dev) và thấy đủ 4 preset `daln_*`.

- [ ] **Step 6: Commit**

```bash
chmod +x backend/scripts/realtimekit-dev-tunnel.sh
git add backend/scripts/realtimekit-setup.ts backend/scripts/realtimekit-dev-tunnel.sh backend/package.json backend/docker-compose.yml
git commit -m "feat(realtime): script RealtimeKit presets and webhook, plus a dev webhook tunnel"
```

---

### Task 5: Lưu người tham gia RealtimeKit trong store cuộc gọi

**Files:**
- Modify: `backend/apps/realtime-gateway/src/realtime/call-session.store.ts`
- Modify: `backend/apps/realtime-gateway/src/realtime/group-call.store.ts`
- Test: `backend/apps/realtime-gateway/src/realtime/group-call.store.spec.ts`
- Test (mới): `backend/apps/realtime-gateway/src/realtime/call-session.store.spec.ts`

**Interfaces:**
- Consumes: `RtkGrant` (Task 2).
- Produces:
  - `CallSession.rtkGrants?: RtkGrant[]`
  - `CallSessionStore.releaseAccept(callId: string): Promise<void>`
  - `GroupCallSession.rtkGrants: RtkGrant[]`
  - `GroupCallStore.addGrant(conversationId: string, grant: RtkGrant): Promise<void>`
  - `finish()` và `delete()` xoá thêm `groupcall:<conv>:rtk`.

- [ ] **Step 1: Viết test (sẽ đỏ)**

Thêm vào cuối `describe` chính trong `group-call.store.spec.ts`. Đọc đầu file để dùng đúng tên biến store / Redis giả; nếu Redis giả của file đó thiếu `hset`/`hgetall`/`del` nhiều key, bổ sung theo mẫu `FakeRedis` trong `realtime.gateway.spec.ts`.

```ts
  it('addGrant lưu người tham gia RealtimeKit; finish trả về rồi xoá', async () => {
    await store.getOrCreate({
      conversationId: 'conv-g',
      startedBy: 'alice',
      members: [{ id: 'alice', username: 'Alice' }],
    })
    const grant = {
      meetingId: 'm1',
      participantId: 'p1',
      customParticipantId: 'alice.0a0b0c0d',
    }
    await store.addGrant('conv-g', grant)

    const session = await store.getByConversationId('conv-g')
    expect(session?.rtkGrants).toEqual([grant])

    const finished = await store.finish('conv-g')
    expect(finished?.rtkGrants).toEqual([grant])
    expect(await store.getByConversationId('conv-g')).toBeNull()
    await store.getOrCreate({
      conversationId: 'conv-g',
      startedBy: 'bob',
      members: [{ id: 'bob', username: 'Bob' }],
    })
    expect((await store.getByConversationId('conv-g'))?.rtkGrants).toEqual([])
  })
```

Tạo `call-session.store.spec.ts`:

```ts
import { CallSessionStore } from './call-session.store'

class MemRedis {
  m = new Map<string, string>()
  get(k: string) {
    return Promise.resolve(this.m.get(k) ?? null)
  }
  set(k: string, v: string, ...args: unknown[]) {
    if (args.includes('NX') && this.m.has(k)) return Promise.resolve(null)
    this.m.set(k, v)
    return Promise.resolve('OK')
  }
  del(...keys: string[]) {
    let n = 0
    for (const k of keys) if (this.m.delete(k)) n++
    return Promise.resolve(n)
  }
}

describe('CallSessionStore', () => {
  const CALL_ID = '11111111-2222-4333-8444-555555555555'

  it('releaseAccept nhả claim để tab khác nhận được', async () => {
    const store = new CallSessionStore(new MemRedis() as never)
    expect(await store.claimAccept(CALL_ID, 'sock-a')).toBe(true)
    expect(await store.claimAccept(CALL_ID, 'sock-b')).toBe(false)
    await store.releaseAccept(CALL_ID)
    expect(await store.claimAccept(CALL_ID, 'sock-b')).toBe(true)
  })

  it('rtkGrants được lưu và đọc lại cùng phiên', async () => {
    const store = new CallSessionStore(new MemRedis() as never)
    const grant = { meetingId: 'm1', participantId: 'p1', customParticipantId: 'u1.aa' }
    await store.create({
      callId: CALL_ID,
      callerId: 'u1',
      calleeId: 'u2',
      conversationId: 'c1',
      status: 'ringing',
      callType: 'audio',
      startedAt: 1,
      rtkGrants: [grant],
    })
    expect((await store.get(CALL_ID))?.rtkGrants).toEqual([grant])
  })
})
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Chạy: `cd backend && npx jest apps/realtime-gateway/src/realtime/group-call.store.spec.ts apps/realtime-gateway/src/realtime/call-session.store.spec.ts`
Kỳ vọng: FAIL. `store.addGrant is not a function`, `releaseAccept is not a function`, và lỗi TS `rtkGrants` không có trong kiểu.

- [ ] **Step 3: Sửa `call-session.store.ts`**

Thêm import ở đầu file:

```ts
import type { RtkGrant } from './realtimekit.types'
```

Trong `interface CallSession`, thêm trường sau `connectedAt?: number`:

```ts
  /** Người tham gia RealtimeKit đã cấp (người gọi, rồi người nhận) — để thu hồi khi kết thúc. */
  rtkGrants?: RtkGrant[]
```

Thêm method ngay sau `claimAccept`:

```ts
  /** Bỏ claim khi bắt máy thất bại giữa chừng (vd. API media lỗi) để thử lại được. */
  async releaseAccept(callId: string): Promise<void> {
    if (!isCallId(callId)) return
    await this.redisClient.del(this.acceptKey(callId))
  }
```

- [ ] **Step 4: Sửa `group-call.store.ts`**

Thêm import `import type { RtkGrant } from './realtimekit.types'`.

Trong `interface GroupCallSession`, thêm:

```ts
  /** Người tham gia RealtimeKit đã cấp trong phiên này — thu hồi khi kết thúc. */
  rtkGrants: RtkGrant[]
```

Thêm key helper cạnh `seenKey`:

```ts
  private rtkKey(conversationId: string) {
    return `groupcall:${conversationId}:rtk`
  }
```

Thay `assemble` để đọc thêm HASH `:rtk`:

```ts
  private async assemble(stat: GroupCallStatic): Promise<GroupCallSession> {
    const [rawParticipants, seen, rawGrants] = await Promise.all([
      this.redisClient.hgetall(this.participantsKey(stat.conversationId)),
      this.redisClient.smembers(this.seenKey(stat.conversationId)),
      this.redisClient.hgetall(this.rtkKey(stat.conversationId)),
    ])

    const participants: Record<string, GroupCallMember> = {}
    for (const [id, value] of Object.entries(rawParticipants || {})) {
      try {
        participants[id] = JSON.parse(value) as GroupCallMember
      } catch {
        // Bỏ qua bản ghi hỏng thay vì làm hỏng cả roster.
      }
    }

    const rtkGrants: RtkGrant[] = []
    for (const value of Object.values(rawGrants || {})) {
      try {
        rtkGrants.push(JSON.parse(value) as RtkGrant)
      } catch {
        // Bản ghi hỏng: bỏ qua, các grant khác vẫn được thu hồi.
      }
    }

    return {
      ...stat,
      participants,
      seen: Array.isArray(seen) ? seen : [],
      rtkGrants,
    }
  }
```

Trong `getOrCreate`, hai chỗ `return { ...stat, participants: {}, seen: [] }` đổi thành `return { ...stat, participants: {}, seen: [], rtkGrants: [] }`.

Thêm method sau `removeParticipant`:

```ts
  async addGrant(conversationId: string, grant: RtkGrant): Promise<void> {
    await this.redisClient.hset(
      this.rtkKey(conversationId),
      grant.customParticipantId,
      JSON.stringify(grant),
    )
    await this.redisClient.expire(this.rtkKey(conversationId), this.ttlSeconds)
  }
```

Trong `finish`, lời gọi `del` thứ hai thêm `this.rtkKey(conversationId)`. Trong `delete`, thêm `await this.redisClient.del(this.rtkKey(conversationId))`.

- [ ] **Step 5: Chạy test, xác nhận xanh; typecheck**

Chạy: `cd backend && npx jest apps/realtime-gateway/src/realtime/group-call.store.spec.ts apps/realtime-gateway/src/realtime/call-session.store.spec.ts && npm run typecheck`
Kỳ vọng: PASS. Typecheck có thể báo lỗi ở `realtime.gateway.spec.ts` hay chỗ khác đang dựng `GroupCallSession` bằng tay mà thiếu `rtkGrants`; nếu có thì thêm `rtkGrants: []` vào chỗ đó.

- [ ] **Step 6: Commit**

```bash
git add backend/apps/realtime-gateway/src/realtime/call-session.store.ts backend/apps/realtime-gateway/src/realtime/call-session.store.spec.ts backend/apps/realtime-gateway/src/realtime/group-call.store.ts backend/apps/realtime-gateway/src/realtime/group-call.store.spec.ts
git commit -m "feat(realtime): keep RealtimeKit participants on call sessions so they can be revoked"
```

---

### Task 6: Gateway — cuộc gọi 1-1 trên RealtimeKit

**Files:**
- Modify: `backend/apps/realtime-gateway/src/realtime/realtime.gateway.ts` (import; constructor; dòng 580–983)
- Modify: `backend/apps/realtime-gateway/src/realtime/socket.types.ts` (`CallBody`)
- Modify: `backend/apps/realtime-gateway/src/realtime-gateway.module.ts` (providers)
- Modify: `backend/libs/constant/websocket/socket.events.ts` (bỏ `ICE_CONFIG`, `ICE_CANDIDATE`, `MEDIA_STATE`)
- Delete: `backend/apps/realtime-gateway/src/realtime/turn-credentials.ts`, `turn-credentials.spec.ts`
- Test: `backend/apps/realtime-gateway/src/realtime/realtime.gateway.spec.ts` (setup + suite `gọi thoại 1-1`)

**Interfaces:**
- Consumes: `RealtimeKitService`, `presetFor`, `RtkGrant` (Task 2); `releaseAccept`, `rtkGrants` (Task 5).
- Produces:
  - Ack `call.incoming_call` = `{ ok, callId, calleeId, callType, authToken }`.
  - Ack `call.accepted` = `{ ok, callId, authToken }`.
  - Sự kiện gửi tới người nhận: `call.incoming_call { callId, callerId, conversationId, callType }`.
  - Sự kiện gửi tới người gọi: `call.accepted { callId, answererId }`.
  - Helper `isLegacyCallPayload(data)` (export) để Task 7 dùng lại.

- [ ] **Step 1: Sửa phần setup của `realtime.gateway.spec.ts` và viết test 1-1 mới (sẽ đỏ)**

Ở đầu file thêm `import { RealtimeKitService } from './realtimekit.service'`. Trong `describe('RealtimeGateway')`, ngay sau `sessionStub`, thêm:

```ts
  /** RealtimeKit giả: cấp grant kèm token, thu hồi ghi lại để kiểm. */
  let grantSeq = 0
  const rtkStub = {
    isConfigured: jest.fn(() => true),
    addParticipant: jest.fn(
      (conversationId: string, input: { userId: string }) => {
        grantSeq++
        return Promise.resolve({
          meetingId: `meeting-${conversationId}`,
          participantId: `p${grantSeq}`,
          customParticipantId: `${input.userId}.0000000${grantSeq}`,
          authToken: `token-${input.userId}`,
        })
      },
    ),
    revoke: jest.fn().mockResolvedValue(undefined),
    conversationOfMeeting: jest.fn(),
  }
```

Trong `providers` của `Test.createTestingModule`, thêm `{ provide: RealtimeKitService, useValue: rtkStub },`. Trong `beforeEach` chính, sau `jest.clearAllMocks()`, thêm `rtkStub.isConfigured.mockReturnValue(true)`.

Thay **toàn bộ** `describe('gọi thoại 1-1', …)` bằng:

```ts
  describe('gọi thoại 1-1', () => {
    const CALL_ID = '11111111-2222-4333-8444-555555555555'
    const GRANT = {
      meetingId: 'meeting-conv-1',
      participantId: 'p0',
      customParticipantId: 'caller.00000000',
    }

    const session = (overrides: Record<string, unknown> = {}) =>
      JSON.stringify({
        callId: CALL_ID,
        callerId: 'caller',
        calleeId: 'callee',
        conversationId: 'conv-1',
        status: 'ringing',
        callType: 'audio',
        startedAt: Date.now(),
        rtkGrants: [GRANT],
        ...overrides,
      })

    const start = { v: 2, conversationId: 'conv-1', callType: 'video' }

    it('client cũ (có offer hoặc thiếu v) -> CLIENT_OUTDATED, không gọi chat', async () => {
      for (const body of [
        { conversationId: 'conv-1', offer: { sdp: 'x' } },
        { v: 2, conversationId: 'conv-1', offer: { sdp: 'x' } },
        { conversationId: 'conv-1' },
      ]) {
        const ack = await gateway.handleIncomingCall(body, socketOf('caller'))
        expect(ack).toEqual(
          expect.objectContaining({ ok: false, code: 'CLIENT_OUTDATED' }),
        )
      }
      expect(fetchMock).not.toHaveBeenCalled()
      const accepted = await gateway.handleCallAccepted(
        { callId: CALL_ID, answer: { sdp: 'y' } },
        socketOf('callee'),
      )
      expect(accepted).toEqual(
        expect.objectContaining({ ok: false, code: 'CLIENT_OUTDATED' }),
      )
    })

    it('chat service từ chối (403) -> ack CALL_FORBIDDEN, không ai đổ chuông', async () => {
      respond(403)

      const ack = await gateway.handleIncomingCall(
        { ...start, targetUserId: 'victim' },
        socketOf('stranger'),
      )

      expect(ack).toEqual(
        expect.objectContaining({ ok: false, code: 'CALL_FORBIDDEN' }),
      )
      expect(emitted).not.toHaveBeenCalled()
      expect(rtkStub.addParticipant).not.toHaveBeenCalled()
    })

    it('đổ chuông đúng người nhận, không kèm SDP; ack trả authToken của người gọi', async () => {
      respond(200, { peerId: 'callee' })

      const ack = expectOk(
        await gateway.handleIncomingCall(
          { ...start, targetUserId: 'victim' },
          socketOf('caller'),
        ),
      )

      expect(ack.authToken).toBe('token-caller')
      expect(rtkStub.addParticipant).toHaveBeenCalledWith('conv-1', {
        userId: 'caller',
        name: 'caller',
        preset: 'daln_direct_video',
      })
      expect(to).toHaveBeenCalledWith('user:callee')
      expect(to).not.toHaveBeenCalledWith('user:victim')
      expect(emitted).toHaveBeenCalledWith('call.incoming_call', {
        callId: ack.callId,
        callerId: 'caller',
        conversationId: 'conv-1',
        callType: 'video',
      })
      // Phiên lưu grant để thu hồi sau, KHÔNG lưu token.
      const stored = redisStub.set.mock.calls.find(([key]) =>
        String(key).startsWith('call:'),
      )
      expect(stored?.[1]).toContain('"customParticipantId"')
      expect(stored?.[1]).not.toContain('token-caller')
    })

    it('chưa cấu hình RealtimeKit -> MEDIA_UNCONFIGURED', async () => {
      rtkStub.isConfigured.mockReturnValue(false)
      const ack = await gateway.handleIncomingCall(start, socketOf('caller'))
      expect(ack).toEqual(
        expect.objectContaining({ ok: false, code: 'MEDIA_UNCONFIGURED' }),
      )
    })

    it('API media lỗi khi gọi -> MEDIA_UNAVAILABLE, nhả khoá bận, không đổ chuông', async () => {
      respond(200, { peerId: 'callee' })
      rtkStub.addParticipant.mockRejectedValueOnce(new Error('down'))

      const ack = await gateway.handleIncomingCall(start, socketOf('caller'))

      expect(ack).toEqual(
        expect.objectContaining({ ok: false, code: 'MEDIA_UNAVAILABLE' }),
      )
      expect(emitted).not.toHaveBeenCalled()
      // release() của CallBusyStore là Lua compare-and-DEL.
      expect(redisStub.eval).toHaveBeenCalled()
    })

    it('người nhận đang bận -> CALLEE_BUSY, không cấp media', async () => {
      respond(200, { peerId: 'callee' })
      redisStub.get.mockResolvedValueOnce('another-call-id')

      const ack = await gateway.handleIncomingCall(start, socketOf('caller'))

      expect(ack).toEqual(
        expect.objectContaining({ ok: false, code: 'CALLEE_BUSY' }),
      )
      expect(rtkStub.addParticipant).not.toHaveBeenCalled()
    })

    it('người gọi đang bận -> BUSY, không tạo phiên', async () => {
      respond(200, { peerId: 'callee' })
      redisStub.set.mockResolvedValueOnce(null)
      redisStub.get.mockResolvedValueOnce('another-call-id')

      const ack = await gateway.handleIncomingCall(start, socketOf('caller'))

      expect(ack).toEqual(expect.objectContaining({ ok: false, code: 'BUSY' }))
      expect(emitted).not.toHaveBeenCalled()
    })

    it('sự kiện mang callId không có phiên thì bị bỏ', async () => {
      redisStub.get.mockResolvedValueOnce(null)

      const ack = await gateway.handleCallRejected(
        { callId: CALL_ID },
        socketOf('callee'),
      )

      expect(ack).toEqual(
        expect.objectContaining({ ok: false, code: 'CALL_NOT_FOUND' }),
      )
      expect(emitted).not.toHaveBeenCalled()
    })

    it('người ngoài phiên không chen được vào cuộc gọi', async () => {
      redisStub.get.mockResolvedValueOnce(session())

      const ack = await gateway.handleCallEnded(
        { callId: CALL_ID },
        socketOf('stranger'),
      )

      expect(ack).toEqual(
        expect.objectContaining({ ok: false, code: 'CALL_FORBIDDEN' }),
      )
      expect(emitted).not.toHaveBeenCalled()
    })

    it('chỉ người được gọi mới nghe máy được', async () => {
      redisStub.get.mockResolvedValueOnce(session())

      const ack = await gateway.handleCallAccepted(
        { v: 2, callId: CALL_ID },
        socketOf('caller'),
      )

      expect(ack).toEqual(
        expect.objectContaining({ ok: false, code: 'CALL_FORBIDDEN' }),
      )
    })

    it('nghe máy: cấp media cho người nhận, lưu cả hai grant, báo người gọi không kèm SDP', async () => {
      redisStub.get.mockResolvedValue(session())

      const ack = expectOk(
        await gateway.handleCallAccepted(
          { v: 2, callId: CALL_ID },
          socketOf('callee'),
        ),
      )

      expect(ack.authToken).toBe('token-callee')
      expect(rtkStub.addParticipant).toHaveBeenCalledWith('conv-1', {
        userId: 'callee',
        name: 'callee',
        preset: 'daln_direct_audio',
      })
      expect(emitted).toHaveBeenCalledWith('call.accepted', {
        callId: CALL_ID,
        answererId: 'callee',
      })
      const connected = redisStub.set.mock.calls
        .filter(([key]) => key === `call:${CALL_ID}`)
        .pop()
      const saved = JSON.parse(String(connected?.[1])) as {
        rtkGrants: unknown[]
      }
      expect(saved.rtkGrants).toHaveLength(2)
    })

    it('API media lỗi khi nghe máy -> MEDIA_UNAVAILABLE, nhả khoá bận và claim', async () => {
      redisStub.get.mockResolvedValue(session())
      rtkStub.addParticipant.mockRejectedValueOnce(new Error('down'))

      const ack = await gateway.handleCallAccepted(
        { v: 2, callId: CALL_ID },
        socketOf('callee'),
      )

      expect(ack).toEqual(
        expect.objectContaining({ ok: false, code: 'MEDIA_UNAVAILABLE' }),
      )
      expect(redisStub.del).toHaveBeenCalledWith(`callaccept:${CALL_ID}`)
      expect(emitted).not.toHaveBeenCalledWith('call.accepted', expect.anything())
    })

    it('kết thúc: ghi kết quả đúng một lần và thu hồi media đúng một lần', async () => {
      const connectedAt = Date.now() - 42_000
      redisStub.get.mockResolvedValue(
        session({ status: 'connected', connectedAt }),
      )
      redisStub.del
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)

      await gateway.handleCallEnded(
        { callId: CALL_ID, conversationId: 'conv-KHAC', durationSeconds: 9999 },
        socketOf('caller'),
      )
      await gateway.handleCallEnded({ callId: CALL_ID }, socketOf('callee'))

      const calls = publishedTo(ROUTING_RMQ.CALL_ENDED)
      expect(calls).toHaveLength(1)
      expect(calls[0][2]).toEqual(
        expect.objectContaining({
          conversationId: 'conv-1',
          outcome: 'COMPLETED',
          durationSeconds: 42,
        }),
      )
      expect(rtkStub.revoke).toHaveBeenCalledTimes(1)
      expect(rtkStub.revoke).toHaveBeenCalledWith([GRANT])
    })

    it('từ chối: báo người gọi, ghi REJECTED, thu hồi media', async () => {
      redisStub.get.mockResolvedValue(session())
      redisStub.del.mockResolvedValueOnce(1)

      await gateway.handleCallRejected({ callId: CALL_ID }, socketOf('callee'))

      const [[, , payload]] = publishedTo(ROUTING_RMQ.CALL_ENDED)
      expect(payload).toEqual(expect.objectContaining({ outcome: 'REJECTED' }))
      expect(rtkStub.revoke).toHaveBeenCalledWith([GRANT])
    })

    it('huỷ lúc đang đổ chuông là cuộc gọi nhỡ, không phải hoàn tất 0 giây', async () => {
      redisStub.get.mockResolvedValue(session())
      redisStub.del.mockResolvedValueOnce(1)

      await gateway.handleCallEnded({ callId: CALL_ID }, socketOf('caller'))

      const [[, , payload]] = publishedTo(ROUTING_RMQ.CALL_ENDED)
      expect(payload).toEqual(expect.objectContaining({ outcome: 'MISSED' }))
    })

    it('lý do unreachable được ghi lại để hiện "không kết nối được"', async () => {
      redisStub.get.mockResolvedValue(session())
      redisStub.del.mockResolvedValueOnce(1)

      await gateway.handleCallEnded(
        { callId: CALL_ID, reason: 'unreachable' },
        socketOf('caller'),
      )

      const [[, , payload]] = publishedTo(ROUTING_RMQ.CALL_ENDED)
      expect(payload).toEqual(
        expect.objectContaining({ outcome: 'UNREACHABLE' }),
      )
    })
  })
```

Trong `redisStub`, `get` / `set` / `del` dùng `mockResolvedValue` mặc định và `clearAllMocks` không reset implementation. Vì vậy test nào đã đổi mặc định bằng `mockResolvedValue(session())` phải được khôi phục: thêm vào `beforeEach` chính ngay sau `jest.clearAllMocks()`:

```ts
    redisStub.get.mockResolvedValue(null)
    redisStub.set.mockResolvedValue('OK')
    redisStub.del.mockResolvedValue(1)
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Chạy: `cd backend && npx jest apps/realtime-gateway/src/realtime/realtime.gateway.spec.ts -t "gọi thoại 1-1"`
Kỳ vọng: FAIL. Các test `CLIENT_OUTDATED`, `authToken`, `MEDIA_UNAVAILABLE`, `revoke` đỏ, vì gateway vẫn chạy luồng cũ.

- [ ] **Step 3: Sửa `socket.types.ts`**

Trong `CallBody`, thêm `v?: unknown` lên đầu. Xoá `candidate`, `cameraEnabled`, `micEnabled`. Giữ `offer` và `answer`: chúng chỉ còn dùng để nhận ra client cũ.

- [ ] **Step 4: Sửa `realtime.gateway.ts` — import, helper, constructor**

- Xoá dòng `import { buildIceConfig } from './turn-credentials'`.
- Thêm các import sau:

```ts
import { RealtimeKitService } from './realtimekit.service'
import { presetFor, RtkGrant } from './realtimekit.types'
```

Thêm ngay sau hàm `callError`:

```ts
/**
 * Client chạy JS trước khi chuyển sang RealtimeKit: vẫn gửi SDP, hoặc chưa gửi
 * `v: 2`. Trả CLIENT_OUTDATED để nó nhắc người dùng tải lại trang, thay vì kẹt ở
 * một luồng media mà server không còn phục vụ.
 */
export function isLegacyCallPayload(data: CallBody | undefined): boolean {
  if (!data) return true
  return data.v !== 2 || data.offer !== undefined || data.answer !== undefined
}

/** Grant để lưu vào Redis: bỏ authToken (token chỉ đi trong ack). */
function grantOf(grant: RtkGrant & { authToken?: string }): RtkGrant {
  return {
    meetingId: grant.meetingId,
    participantId: grant.participantId,
    customParticipantId: grant.customParticipantId,
  }
}
```

Trong constructor, thêm tham số sau `private readonly sessions: SessionStore,`:

```ts
    private readonly rtk: RealtimeKitService,
```

- [ ] **Step 5: Sửa `realtime.gateway.ts` — các handler 1-1**

Xoá hẳn `handleIceConfig`, `handleIceCandidate`, `handleCallMediaState`, kèm doc comment của chúng.

Thay thân `handleIncomingCall`, từ ngay sau `if (!callerId) {…}` tới hết hàm:

```ts
    if (isLegacyCallPayload(data)) {
      return callError('CLIENT_OUTDATED', 'Client is outdated, reload the page')
    }

    const conversationId =
      typeof data?.conversationId === 'string' ? data.conversationId.trim() : ''
    if (!conversationId) {
      return callError('INVALID_PAYLOAD', 'conversationId is required')
    }

    if (!this.rtk.isConfigured()) {
      return callError('MEDIA_UNCONFIGURED', 'Calling is not configured')
    }

    const peer = await fetchCallPeer(conversationId, callerId)
    if (!peer.ok) {
      return callError(
        peer.code,
        peer.code === 'CALL_FORBIDDEN'
          ? 'Not allowed to call in this conversation'
          : 'Could not verify the call peer',
      )
    }

    const callType = data?.callType === 'video' ? 'video' : 'audio'
    const callId = randomUUID()

    if (!(await this.callBusyStore.acquire(callerId, callId))) {
      return callError('BUSY', 'You are already in a call')
    }
    if (await this.callBusyStore.isBusy(peer.peerId, callId)) {
      await this.callBusyStore.release(callerId, callId)
      return callError('CALLEE_BUSY', 'The other person is in another call')
    }

    // Người gọi vào phòng RealtimeKit ngay (đứng chờ trong lúc đổ chuông), nên
    // cấp media TRƯỚC khi đổ chuông; lỗi thì nhả khoá, không để ai kẹt "bận".
    let grant: RtkGrant & { authToken: string }
    try {
      grant = await this.rtk.addParticipant(conversationId, {
        userId: callerId,
        name: callerId,
        preset: presetFor('direct', callType),
      })
    } catch (error) {
      this.logger.warn(`cấp media cho cuộc gọi ${callId} thất bại`, error)
      await this.callBusyStore.release(callerId, callId)
      return callError('MEDIA_UNAVAILABLE', 'Could not start the call')
    }

    const session: CallSession = {
      callId,
      callerId,
      calleeId: peer.peerId,
      conversationId,
      status: 'ringing',
      callType,
      startedAt: Date.now(),
      rtkGrants: [grantOf(grant)],
    }
    await this.callSessionStore.create(session)

    this.emitToUserSockets(
      [session.calleeId],
      SOCKET_EVENTS.CALL.INCOMING_CALL,
      { callId, callerId, conversationId, callType },
    )

    return {
      ok: true,
      callId,
      calleeId: session.calleeId,
      callType,
      authToken: grant.authToken,
    }
```

Trong `handleCallAccepted`:

- Thay đoạn `if (!data?.answer) {…}` bằng:

```ts
    if (isLegacyCallPayload(data)) {
      return callError('CLIENT_OUTDATED', 'Client is outdated, reload the page')
    }
```

- Thay phần từ `// Người nhận phải rảnh` tới hết hàm bằng:

```ts
    // Người nhận phải rảnh (có thể vừa vào cuộc gọi khác giữa lúc đổ chuông).
    if (!(await this.callBusyStore.acquire(userId, session.callId))) {
      return callError('BUSY', 'You are already in a call')
    }

    let grant: RtkGrant & { authToken: string }
    try {
      grant = await this.rtk.addParticipant(session.conversationId, {
        userId,
        name: userId,
        preset: presetFor('direct', session.callType),
      })
    } catch (error) {
      this.logger.warn(`cấp media khi nghe máy ${session.callId} thất bại`, error)
      await this.callBusyStore.release(userId, session.callId)
      await this.callSessionStore.releaseAccept(session.callId)
      return callError('MEDIA_UNAVAILABLE', 'Could not start the call')
    }

    await this.callBusyStore.refresh(userId, session.callId)
    await this.callBusyStore.refresh(session.callerId, session.callId)

    await this.callSessionStore.markConnected({
      ...session,
      rtkGrants: [...(session.rtkGrants ?? []), grantOf(grant)],
    })

    client.broadcast.to(`user:${userId}`).emit(SOCKET_EVENTS.CALL.CLAIMED, {
      callId: session.callId,
    })

    this.emitToUserSockets(
      [session.callerId],
      SOCKET_EVENTS.CALL.CALL_ACCEPTED,
      { callId: session.callId, answererId: userId },
    )

    return { ok: true, callId: session.callId, authToken: grant.authToken }
```

- Giữ nguyên comment chống 2 tab và chỗ gọi `claimAccept` ở trên.

Trong `handleCallRejected`: trong khối `if (await this.callSessionStore.end(session.callId)) {`, sau `this.recordCallOutcome({…})`, thêm:

```ts
      void this.rtk.revoke(session.rtkGrants ?? [])
```

Trong `handleCallEnded`: ngay trước `this.recordCallOutcome({` cuối (tức sau khối `if (!(await this.callSessionStore.end(...)))`), thêm:

```ts
    void this.rtk.revoke(session.rtkGrants ?? [])
```

- [ ] **Step 6: Đăng ký provider và bỏ hằng số sự kiện cũ**

`realtime-gateway.module.ts`:
- `import { RealtimeKitService } from './realtime/realtimekit.service'`;
- `providers: [RealtimeGateway, RealtimeKitService]`.

`backend/libs/constant/websocket/socket.events.ts`:
- xoá 3 dòng `ICE_CONFIG`, `ICE_CANDIDATE`, `MEDIA_STATE` trong `CALL`;
- sửa comment của `GROUP_CALL` thành `// Gọi nhóm (hội thoại GROUP) qua Cloudflare RealtimeKit. 1-1 (DIRECT) dùng CALL ở trên.`;
- sửa comment của `START` thành `//emit + ack: mở phòng, trả {callId, roomName, callType, authToken}`.

Xoá file: `git rm backend/apps/realtime-gateway/src/realtime/turn-credentials.ts backend/apps/realtime-gateway/src/realtime/turn-credentials.spec.ts`.

- [ ] **Step 7: Chạy test 1-1, xác nhận xanh; typecheck**

Chạy: `cd backend && npx jest apps/realtime-gateway/src/realtime/realtime.gateway.spec.ts -t "gọi thoại 1-1"`
Kỳ vọng: PASS, 16 test.

Chạy: `cd backend && npm run typecheck`
Kỳ vọng: lỗi **chỉ** còn ở phần gọi nhóm (`buildIceConfig` trong `handleGroupCallStart` / `handleGroupCallAccept`). Task 7 xử lý phần này. Nếu có lỗi ở chỗ khác thì sửa ngay.

Để typecheck xanh trước khi commit: trong `handleGroupCallStart` và `handleGroupCallAccept`, xoá dòng `iceServers: buildIceConfig(...)…` và comment đi kèm (Task 7 viết lại cả hai handler).

- [ ] **Step 8: Chạy toàn bộ test gateway và commit**

Chạy: `cd backend && npx jest apps/realtime-gateway`
Kỳ vọng: PASS. Suite gọi nhóm cũ vẫn chạy với LiveKit ở bước này; test nào của nó đòi `iceServers` thì bỏ phần kiểm `iceServers` đó.

```bash
git add backend/apps/realtime-gateway/src backend/libs/constant/websocket/socket.events.ts
git commit -m "feat(realtime): run 1-1 calls on RealtimeKit and drop SDP/ICE/TURN relaying"
```

---

### Task 7: Gateway — gọi nhóm trên RealtimeKit, webhook, bộ đếm phòng trống

**Files:**
- Modify: `backend/apps/realtime-gateway/src/realtime/realtime.gateway.ts` (import livekit; khoảng dòng 985–1460)
- Modify: `backend/apps/realtime-gateway/src/realtime-gateway.controller.ts`
- Modify: `backend/apps/realtime-gateway/src/realtime-gateway.controller.spec.ts`
- Modify: `backend/apps/realtime-gateway/src/main.ts`
- Modify: `backend/apps/realtime-gateway/src/realtime-gateway.module.ts`
- Delete: `backend/apps/realtime-gateway/src/realtime/livekit-token.ts`, `livekit-token.spec.ts`
- Modify: `backend/package.json`, `backend/package-lock.json` (gỡ `livekit-server-sdk`)
- Test: `realtime.gateway.spec.ts` (suite `gọi nhóm`)

**Interfaces:**
- Consumes: `RealtimeKitService.addParticipant` / `revoke` / `conversationOfMeeting`, `presetFor`, `userIdFromCustomId` (Task 2); `RtkWebhookVerifier`, `parseRtkEvent`, `RtkWebhookEvent` (Task 3); `addGrant`, `rtkGrants` (Task 5); `isLegacyCallPayload`, `grantOf` (Task 6).
- Produces:
  - Ack `group_call.start` = `{ ok, callId, roomName, callType, authToken }`.
  - Ack `group_call.accept` = `{ ok, callType, authToken }`.
  - `RealtimeGateway.applyRtkWebhook(event: RtkWebhookEvent): Promise<void>`.
  - Route `POST /realtime/rtk-webhook`.

- [ ] **Step 1: Viết test gọi nhóm mới (sẽ đỏ)**

Trong suite `describe('gọi nhóm', …)`:

- Bỏ 3 dòng `process.env.LIVEKIT_*` trong `beforeEach`.
- Thêm `jest.useRealTimers()` vào `afterEach` (tạo `afterEach` nếu chưa có).
- Thay các test `được phép…`, `LiveKit chưa cấu hình…`, `accept…`, `webhook room_finished…` bằng các test dưới đây. Giữ nguyên `chat trả 403…`, `fail-closed…`, `callType video…` nhưng thêm `v: 2` vào mọi payload `handleGroupCallStart`.

```ts
    const rtkEvent = (
      event: string,
      userId?: string,
    ): { event: string; meetingId: string; customParticipantId?: string } => ({
      event,
      meetingId: 'meeting-conv-1',
      ...(userId ? { customParticipantId: `${userId}.0a0b0c0d` } : {}),
    })

    beforeEach(() => {
      rtkStub.conversationOfMeeting.mockImplementation((meetingId: string) =>
        Promise.resolve(
          meetingId === 'meeting-conv-1' ? 'conv-1' : null,
        ),
      )
    })

    it('client cũ -> CLIENT_OUTDATED', async () => {
      const ack = await gateway.handleGroupCallStart(
        { conversationId: 'conv-1' },
        socketOf('alice'),
      )
      expect(ack).toEqual(
        expect.objectContaining({ ok: false, code: 'CLIENT_OUTDATED' }),
      )
    })

    it('được phép -> tạo phiên, đổ chuông, ack có authToken, lưu grant', async () => {
      respond(200, { members, type: 'GROUP' })

      const ack = expectOk(
        await gateway.handleGroupCallStart(
          { v: 2, conversationId: 'conv-1' },
          socketOf('alice'),
        ),
      )

      expect(isGroupCallId(ack.callId)).toBe(true)
      expect(ack.roomName).toBe('conv_conv-1')
      expect(ack.authToken).toBe('token-alice')
      expect(ack).not.toHaveProperty('url')
      expect(rtkStub.addParticipant).toHaveBeenCalledWith('conv-1', {
        userId: 'alice',
        name: 'Alice',
        preset: 'daln_group_audio',
      })
      expect((await store.getByConversationId('conv-1'))?.rtkGrants).toHaveLength(1)
      expect(to).toHaveBeenCalledWith('user:bob')
      expect(to).not.toHaveBeenCalledWith('user:alice')
    })

    it('RealtimeKit chưa cấu hình -> MEDIA_UNCONFIGURED', async () => {
      rtkStub.isConfigured.mockReturnValue(false)
      respond(200, { members, type: 'GROUP' })

      const ack = await gateway.handleGroupCallStart(
        { v: 2, conversationId: 'conv-1' },
        socketOf('alice'),
      )

      expect(ack).toEqual(
        expect.objectContaining({ ok: false, code: 'MEDIA_UNCONFIGURED' }),
      )
    })

    it('API media lỗi khi mở phòng -> MEDIA_UNAVAILABLE, không đổ chuông', async () => {
      respond(200, { members, type: 'GROUP' })
      rtkStub.addParticipant.mockRejectedValueOnce(new Error('down'))

      const ack = await gateway.handleGroupCallStart(
        { v: 2, conversationId: 'conv-1' },
        socketOf('alice'),
      )

      expect(ack).toEqual(
        expect.objectContaining({ ok: false, code: 'MEDIA_UNAVAILABLE' }),
      )
      expect(emitted).not.toHaveBeenCalledWith(
        'group_call.incoming',
        expect.anything(),
      )
    })

    it('accept: thành viên -> authToken theo preset của phòng; người ngoài -> NOT_MEMBER', async () => {
      const created = await store.getOrCreate({
        conversationId: 'conv-1',
        startedBy: 'alice',
        members,
        callType: 'video',
      })
      respond(200, { members, type: 'GROUP' })

      const ok = expectOk(
        await gateway.handleGroupCallAccept(
          { v: 2, callId: created.callId },
          socketOf('bob'),
        ),
      )
      expect(ok.authToken).toBe('token-bob')
      expect(rtkStub.addParticipant).toHaveBeenCalledWith('conv-1', {
        userId: 'bob',
        name: 'Bob',
        preset: 'daln_group_video',
      })

      const denied = await gateway.handleGroupCallAccept(
        { v: 2, callId: created.callId },
        socketOf('stranger'),
      )
      expect(denied).toEqual(
        expect.objectContaining({ ok: false, code: 'NOT_MEMBER' }),
      )
    })

    it('API media lỗi khi accept -> MEDIA_UNAVAILABLE và nhả khoá bận', async () => {
      const created = await store.getOrCreate({
        conversationId: 'conv-1',
        startedBy: 'alice',
        members,
      })
      respond(200, { members, type: 'GROUP' })
      rtkStub.addParticipant.mockRejectedValueOnce(new Error('down'))

      const ack = await gateway.handleGroupCallAccept(
        { v: 2, callId: created.callId },
        socketOf('bob'),
      )

      expect(ack).toEqual(
        expect.objectContaining({ ok: false, code: 'MEDIA_UNAVAILABLE' }),
      )
      expect(redisStub.eval).toHaveBeenCalled()
    })

    it('webhook participantJoined: vào roster, phát state; người ngoài danh sách bị bỏ qua', async () => {
      await store.getOrCreate({ conversationId: 'conv-1', startedBy: 'alice', members })

      await gateway.applyRtkWebhook(rtkEvent('meeting.participantJoined', 'bob'))
      await gateway.applyRtkWebhook(rtkEvent('meeting.participantJoined', 'mallory'))

      const session = await store.getByConversationId('conv-1')
      expect(Object.keys(session?.participants ?? {})).toEqual(['bob'])
      expect(emitted).toHaveBeenCalledWith(
        'group_call.state',
        expect.objectContaining({
          participants: [{ id: 'bob', username: 'Bob' }],
        }),
      )
    })

    it('webhook của phòng lạ hoặc phòng 1-1 thì bỏ qua', async () => {
      await gateway.applyRtkWebhook({
        event: 'meeting.participantJoined',
        meetingId: 'meeting-khac',
        customParticipantId: 'bob.00000001',
      })
      expect(emitted).not.toHaveBeenCalled()
    })

    it('người cuối rời -> 15 giây sau: ghi log, phát ended, thu hồi media, đúng một lần', async () => {
      jest.useFakeTimers()
      const created = await store.getOrCreate({
        conversationId: 'conv-1',
        startedBy: 'alice',
        members,
      })
      const grant = {
        meetingId: 'meeting-conv-1',
        participantId: 'p9',
        customParticipantId: 'alice.0a0b0c0d',
      }
      await store.addGrant('conv-1', grant)
      respond(200)

      await gateway.applyRtkWebhook(rtkEvent('meeting.participantJoined', 'alice'))
      await gateway.applyRtkWebhook(rtkEvent('meeting.participantJoined', 'bob'))
      await gateway.applyRtkWebhook(rtkEvent('meeting.participantLeft', 'alice'))
      await gateway.applyRtkWebhook(rtkEvent('meeting.participantLeft', 'bob'))

      // Chưa hết 15 giây: phòng còn.
      await jest.advanceTimersByTimeAsync(14_000)
      expect(await store.getByConversationId('conv-1')).not.toBeNull()

      await jest.advanceTimersByTimeAsync(1_000)
      expect(await store.getByConversationId('conv-1')).toBeNull()

      const logCalls = fetchMock.mock.calls.filter(([url]) =>
        url.includes('/chat/internal/group-call-log'),
      )
      expect(logCalls).toHaveLength(1)
      const body = JSON.parse(logCalls[0][1]?.body as string) as Record<
        string,
        unknown
      >
      expect(body).toEqual(
        expect.objectContaining({ conversationId: 'conv-1', participantCount: 2 }),
      )
      expect(emitted).toHaveBeenCalledWith(
        'group_call.ended',
        expect.objectContaining({ callId: created.callId, conversationId: 'conv-1' }),
      )
      expect(rtkStub.revoke).toHaveBeenCalledWith([grant])

      // meeting.ended tới muộn: finish đã chạy -> không ghi log lần hai.
      await gateway.applyRtkWebhook(rtkEvent('meeting.ended'))
      expect(
        fetchMock.mock.calls.filter(([url]) =>
          url.includes('/chat/internal/group-call-log'),
        ),
      ).toHaveLength(1)
    })

    it('rời rồi vào lại trong 15 giây -> không kết thúc', async () => {
      jest.useFakeTimers()
      await store.getOrCreate({ conversationId: 'conv-1', startedBy: 'alice', members })

      await gateway.applyRtkWebhook(rtkEvent('meeting.participantJoined', 'alice'))
      await gateway.applyRtkWebhook(rtkEvent('meeting.participantLeft', 'alice'))
      await jest.advanceTimersByTimeAsync(5_000)
      await gateway.applyRtkWebhook(rtkEvent('meeting.participantJoined', 'alice'))
      await jest.advanceTimersByTimeAsync(20_000)

      expect(await store.getByConversationId('conv-1')).not.toBeNull()
    })

    it('meeting.ended kết thúc ngay', async () => {
      await store.getOrCreate({ conversationId: 'conv-1', startedBy: 'alice', members })
      respond(200)

      await gateway.applyRtkWebhook(rtkEvent('meeting.ended'))

      expect(await store.getByConversationId('conv-1')).toBeNull()
      expect(emitted).toHaveBeenCalledWith('group_call.ended', expect.anything())
    })

    it('group_call.leave của người cuối cũng khởi động bộ đếm 15 giây', async () => {
      jest.useFakeTimers()
      const created = await store.getOrCreate({
        conversationId: 'conv-1',
        startedBy: 'alice',
        members,
      })
      respond(200)
      await gateway.applyRtkWebhook(rtkEvent('meeting.participantJoined', 'alice'))

      await gateway.handleGroupCallLeave({ callId: created.callId }, socketOf('alice'))
      await jest.advanceTimersByTimeAsync(15_000)

      expect(await store.getByConversationId('conv-1')).toBeNull()
    })
```

Controller: thay `realtime-gateway.controller.spec.ts` bằng:

```ts
import { Test } from '@nestjs/testing'
import {
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common'
import type { Request } from 'express'
import { RealtimeGatewayController } from './realtime-gateway.controller'
import { RealtimeGateway } from './realtime/realtime.gateway'
import { RtkWebhookVerifier } from './realtime/rtk-webhook'

describe('RealtimeGatewayController', () => {
  const gatewayStub = { applyRtkWebhook: jest.fn().mockResolvedValue(undefined) }
  const verifierStub = { verify: jest.fn().mockResolvedValue(true) }
  const redisStub = {
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
  }
  let controller: RealtimeGatewayController

  const body = JSON.stringify({
    event: 'meeting.participantJoined',
    meeting: { id: 'm1' },
    participant: { customParticipantId: 'u1.aa' },
  })
  const req = (raw: string) => ({ body: Buffer.from(raw) }) as unknown as Request

  beforeEach(async () => {
    jest.clearAllMocks()
    verifierStub.verify.mockResolvedValue(true)
    redisStub.set.mockResolvedValue('OK')
    gatewayStub.applyRtkWebhook.mockResolvedValue(undefined)
    const module = await Test.createTestingModule({
      controllers: [RealtimeGatewayController],
      providers: [
        { provide: RealtimeGateway, useValue: gatewayStub },
        { provide: RtkWebhookVerifier, useValue: verifierStub },
        { provide: 'REDIS_CLIENT', useValue: redisStub },
      ],
    }).compile()
    controller = module.get(RealtimeGatewayController)
  })

  it('chữ ký sai -> 401, không xử lý', async () => {
    verifierStub.verify.mockResolvedValue(false)
    await expect(
      controller.handleRtkWebhook(req(body), 'sig', 'uuid-1'),
    ).rejects.toBeInstanceOf(UnauthorizedException)
    expect(gatewayStub.applyRtkWebhook).not.toHaveBeenCalled()
  })

  it('hợp lệ -> áp sự kiện đã chuẩn hoá', async () => {
    await expect(controller.handleRtkWebhook(req(body), 'sig', 'uuid-1')).resolves.toEqual({ ok: true })
    expect(gatewayStub.applyRtkWebhook).toHaveBeenCalledWith({
      event: 'meeting.participantJoined',
      meetingId: 'm1',
      customParticipantId: 'u1.aa',
    })
    expect(redisStub.set).toHaveBeenCalledWith('rtk:webhook:uuid-1', '1', 'EX', 86400, 'NX')
  })

  it('trùng rtk-uuid -> 200, không xử lý lại', async () => {
    redisStub.set.mockResolvedValue(null)
    await controller.handleRtkWebhook(req(body), 'sig', 'uuid-1')
    expect(gatewayStub.applyRtkWebhook).not.toHaveBeenCalled()
  })

  it('xử lý lỗi -> 500 và xoá khoá chống lặp để Cloudflare gửi lại', async () => {
    gatewayStub.applyRtkWebhook.mockRejectedValue(new Error('redis down'))
    await expect(
      controller.handleRtkWebhook(req(body), 'sig', 'uuid-1'),
    ).rejects.toBeInstanceOf(InternalServerErrorException)
    expect(redisStub.del).toHaveBeenCalledWith('rtk:webhook:uuid-1')
  })
})
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Chạy: `cd backend && npx jest apps/realtime-gateway/src/realtime/realtime.gateway.spec.ts -t "gọi nhóm" apps/realtime-gateway/src/realtime-gateway.controller.spec.ts`
Kỳ vọng: FAIL. `applyRtkWebhook is not a function`, `handleRtkWebhook is not a function`, thiếu `authToken`.

- [ ] **Step 3: Gateway — import, bộ đếm, sửa start/accept/leave**

- Xoá import từ `'./livekit-token'`.
- Import: `import { presetFor, RtkGrant, userIdFromCustomId } from './realtimekit.types'` (gộp với dòng import của Task 6) và `import type { RtkWebhookEvent } from './rtk-webhook'`.
- Bỏ `conversationIdFromRoom` khỏi danh sách import của `./group-call.store` nếu không còn dùng.

Thêm trường cạnh `groupPendingMs`:

```ts
  /** Phòng nhóm trống (người cuối vừa rời): chờ ai đó rớt mạng vào lại. */
  private readonly groupEmptyTimers = new Map<string, NodeJS.Timeout>()
  private readonly groupEmptyMs = 15000
```

Trong `handleGroupCallStart`, thay phần từ khối `if (!isLivekitConfigured()) {…}` tới hết hàm bằng đoạn dưới, và thêm kiểm tra client cũ ngay sau `if (!callerId) {…}`:

```ts
    if (isLegacyCallPayload(data)) {
      return callError('CLIENT_OUTDATED', 'Client is outdated, reload the page')
    }
```

Phần thay thế (đặt sau khối `NOT_GROUP`):

```ts
    if (!this.rtk.isConfigured()) {
      return callError('MEDIA_UNCONFIGURED', 'Calling is not configured')
    }

    const callType: 'audio' | 'video' =
      data?.callType === 'video' ? 'video' : 'audio'
    const callerName =
      lookup.members.find((member) => member.id === callerId)?.username ||
      callerId

    // Phòng đã mở giữ nguyên callType của nó: bấm "video" khi đang có phòng audio
    // sẽ vào phòng audio (không tự nâng cấp) — preset cấp theo session.callType.
    const session = await this.groupCallStore.getOrCreate({
      conversationId,
      startedBy: callerId,
      members: lookup.members,
      callType,
    })

    // Hẹn huỷ nếu không ai vào phòng (35s): chạy cả khi các bước dưới thất bại,
    // để phòng vừa mở không treo lại. participantJoined sẽ huỷ timer.
    this.scheduleGroupPendingCancel(session)

    if (
      !(await this.callBusyStore.acquire(callerId, session.callId, 4 * 60 * 60))
    ) {
      return callError('BUSY', 'You are already in a call')
    }

    let grant: RtkGrant & { authToken: string }
    try {
      grant = await this.rtk.addParticipant(conversationId, {
        userId: callerId,
        name: callerName,
        preset: presetFor('group', session.callType),
      })
    } catch (error) {
      this.logger.warn(`cấp media cho cuộc gọi nhóm ${session.callId} thất bại`, error)
      await this.callBusyStore.release(callerId, session.callId)
      return callError('MEDIA_UNAVAILABLE', 'Could not start the call')
    }
    await this.groupCallStore.addGrant(conversationId, grantOf(grant))

    this.emitToUserSockets(
      lookup.members
        .filter((member) => member.id !== callerId)
        .map((member) => member.id),
      SOCKET_EVENTS.GROUP_CALL.INCOMING,
      {
        callId: session.callId,
        conversationId,
        roomName: session.roomName,
        callType: session.callType,
        from: { id: callerId, username: callerName },
      },
    )

    return {
      ok: true,
      callId: session.callId,
      roomName: session.roomName,
      callType: session.callType,
      authToken: grant.authToken,
    }
```

Trong `handleGroupCallAccept`:

- Thêm kiểm tra `isLegacyCallPayload` (cùng mẫu như trên) ngay sau `if (!userId) {…}`.
- Thay phần từ `const username = …` tới hết hàm bằng:

```ts
    const username =
      session.members.find((member) => member.id === userId)?.username || userId

    let grant: RtkGrant & { authToken: string }
    try {
      grant = await this.rtk.addParticipant(session.conversationId, {
        userId,
        name: username,
        preset: presetFor('group', session.callType),
      })
    } catch (error) {
      this.logger.warn(`cấp media khi vào nhóm ${session.callId} thất bại`, error)
      await this.callBusyStore.release(userId, session.callId)
      return callError('MEDIA_UNAVAILABLE', 'Could not join the call')
    }
    await this.groupCallStore.addGrant(session.conversationId, grantOf(grant))

    return {
      ok: true,
      callType: session.callType,
      authToken: grant.authToken,
    }
```

Trong `handleGroupCallLeave`, thay `if (updated) this.emitGroupCallState(updated)` bằng:

```ts
    if (updated) {
      this.emitGroupCallState(updated)
      if (GroupCallStore.participantList(updated).length === 0) {
        this.scheduleGroupEmptyFinish(updated)
      }
    }
```

Và sửa doc comment của nó: "Client tự rời phòng RealtimeKit; đây chỉ là cập nhật lạc quan — webhook `participantLeft` mới là nguồn sự thật cuối và cũng idempotent."

- [ ] **Step 4: Gateway — thay khối webhook LiveKit bằng webhook RealtimeKit**

Xoá từ comment `// ── Webhook LiveKit …` tới hết `handleGroupRoomFinished`: gồm `applyLivekitWebhook`, `handleGroupParticipantJoined`, `handleGroupParticipantLeft`, `handleGroupRoomFinished`. Thay bằng:

```ts
  // ── Webhook RealtimeKit (controller đã xác thực chữ ký) ─────────────────

  /**
   * Áp một sự kiện webhook RealtimeKit vào phiên gọi nhóm. Chỉ phòng của cuộc gọi
   * NHÓM đang mở mới được xử lý: phòng 1-1 có vòng đời riêng qua socket, phòng lạ
   * thì bỏ qua. `customParticipantId` phải thuộc danh sách thành viên của phiên.
   */
  async applyRtkWebhook(event: RtkWebhookEvent): Promise<void> {
    const conversationId = await this.rtk.conversationOfMeeting(event.meetingId)
    if (!conversationId) return
    const session = await this.groupCallStore.getByConversationId(conversationId)
    if (!session) return

    switch (event.event) {
      case 'meeting.participantJoined': {
        const member = this.memberOf(session, event.customParticipantId)
        if (!member) return
        const updated = await this.groupCallStore.addParticipant(
          conversationId,
          member,
        )
        if (!updated) return
        this.clearGroupPending(session.callId)
        this.clearGroupEmpty(session.callId)
        this.emitGroupCallState(updated)
        return
      }
      case 'meeting.participantLeft': {
        const member = this.memberOf(session, event.customParticipantId)
        if (!member) return
        const updated = await this.groupCallStore.removeParticipant(
          conversationId,
          member.id,
        )
        if (!updated) return
        this.emitGroupCallState(updated)
        if (GroupCallStore.participantList(updated).length === 0) {
          this.scheduleGroupEmptyFinish(updated)
        }
        return
      }
      case 'meeting.ended': {
        await this.finishGroupCall(conversationId)
        return
      }
      default:
        return
    }
  }

  private memberOf(
    session: GroupCallSession,
    customParticipantId?: string,
  ): GroupCallMember | null {
    const userId = userIdFromCustomId(customParticipantId)
    if (!userId) return null
    return session.members.find((member) => member.id === userId) ?? null
  }

  /**
   * Kết thúc cuộc gọi nhóm: ghi tin tổng kết, mở khoá bận, báo `group_call.ended`,
   * thu hồi media. `finish()` là latch — bộ đếm phòng trống và `meeting.ended` có
   * thể cùng tới, chỉ lần đầu làm việc.
   */
  private async finishGroupCall(conversationId: string): Promise<void> {
    const session = await this.groupCallStore.finish(conversationId)
    if (!session) return

    this.clearGroupPending(session.callId)
    this.clearGroupEmpty(session.callId)

    const durationSeconds = Math.max(
      0,
      Math.round((Date.now() - session.startedAt) / 1000),
    )

    await postGroupCallLog({
      conversationId,
      participantCount: session.seen.length,
      durationSeconds,
      callId: session.callId,
      callType: session.callType,
      startedBy: session.startedBy,
    })

    for (const uid of session.seen) {
      await this.callBusyStore.release(uid, session.callId)
    }

    this.emitToUserSockets(
      session.members.map((member) => member.id),
      SOCKET_EVENTS.GROUP_CALL.ENDED,
      { callId: session.callId, conversationId },
    )

    void this.rtk.revoke(session.rtkGrants)
  }

  private scheduleGroupEmptyFinish(session: GroupCallSession): void {
    this.clearGroupEmpty(session.callId)
    const timer = setTimeout(() => {
      this.groupEmptyTimers.delete(session.callId)
      void (async () => {
        const current = await this.groupCallStore.getByCallId(session.callId)
        if (!current) return
        if (GroupCallStore.participantList(current).length > 0) return
        await this.finishGroupCall(session.conversationId)
      })().catch((error: unknown) =>
        this.logger.error(`kết thúc phòng trống ${session.callId} lỗi`, error),
      )
    }, this.groupEmptyMs)
    if (typeof timer.unref === 'function') timer.unref()
    this.groupEmptyTimers.set(session.callId, timer)
  }

  private clearGroupEmpty(callId: string): void {
    const timer = this.groupEmptyTimers.get(callId)
    if (timer) clearTimeout(timer)
    this.groupEmptyTimers.delete(callId)
  }
```

Trong `cancelGroupIfEmpty`, ngay sau `await this.groupCallStore.delete(conversationId)`, thêm `void this.rtk.revoke(session.rtkGrants)`.

Sửa comment đầu khối gọi nhóm (`// ── Gọi nhóm (GROUP) qua SFU LiveKit …`) thành:

```ts
  // ── Gọi nhóm (GROUP) qua Cloudflare RealtimeKit ─────────────────────────
  //
  // Gateway không chuyển tiếp media: nó phân quyền, cấp người tham gia
  // RealtimeKit, và giữ "ai đang trong cuộc" (nguồn sự thật cuối là webhook).
```

- [ ] **Step 5: Controller, `main.ts`, module**

Thay `realtime-gateway.controller.ts`:

```ts
import {
  Controller,
  Headers,
  HttpCode,
  Inject,
  InternalServerErrorException,
  Logger,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common'
import type { Request } from 'express'
import type Redis from 'ioredis'
import { RealtimeGateway } from './realtime/realtime.gateway'
import { parseRtkEvent, RtkWebhookVerifier } from './realtime/rtk-webhook'

@Controller()
export class RealtimeGatewayController {
  private readonly logger = new Logger(RealtimeGatewayController.name)

  constructor(
    private readonly realtimeGateway: RealtimeGateway,
    private readonly verifier: RtkWebhookVerifier,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
  ) {}

  /**
   * Webhook RealtimeKit — nguồn sự thật cuối về "ai đang trong phòng" gọi nhóm.
   *
   * Public URL: https://<domain>/api/realtime/rtk-webhook (nginx bỏ /api, Kong
   * chuyển /realtime nguyên vẹn tới gateway). Body phải là raw vì chữ ký tính trên
   * byte gốc — `main.ts` gắn `express.raw()` riêng cho path này.
   *
   * Sai chữ ký -> 401. Lỗi xử lý -> 500 và xoá khoá chống lặp để Cloudflare gửi
   * lại. Trùng `rtk-uuid` -> 200, không làm gì.
   */
  @Post('realtime/rtk-webhook')
  @HttpCode(200)
  async handleRtkWebhook(
    @Req() req: Request,
    @Headers('rtk-signature') signature?: string,
    @Headers('rtk-uuid') uuid?: string,
  ): Promise<{ ok: true }> {
    const body: unknown = req.body
    const raw = Buffer.isBuffer(body)
      ? body.toString('utf8')
      : typeof body === 'string'
        ? body
        : ''
    if (!raw || !(await this.verifier.verify(raw, signature))) {
      throw new UnauthorizedException()
    }

    const event = parseRtkEvent(raw)
    if (!event) return { ok: true }

    const dedupeKey = uuid ? `rtk:webhook:${uuid}` : null
    if (
      dedupeKey &&
      !(await this.redis.set(dedupeKey, '1', 'EX', 86400, 'NX'))
    ) {
      return { ok: true }
    }

    try {
      await this.realtimeGateway.applyRtkWebhook(event)
    } catch (error) {
      if (dedupeKey) await this.redis.del(dedupeKey).catch(() => 0)
      this.logger.error('xử lý webhook RealtimeKit lỗi', error)
      throw new InternalServerErrorException()
    }
    return { ok: true }
  }
}
```

`main.ts`: thay dòng `app.use('/livekit/webhook', …)` và comment phía trên bằng:

```ts
  // Webhook RealtimeKit cần body THÔ để xác thực chữ ký RSA trên đúng byte gốc.
  // Chỉ gắn raw parser cho đúng path này; `limit` chặn request khổng lồ.
  app.use('/realtime/rtk-webhook', raw({ type: () => true, limit: '256kb' }))
```

Module: `providers: [RealtimeGateway, RealtimeKitService, RtkWebhookVerifier]`, kèm `import { RtkWebhookVerifier } from './realtime/rtk-webhook'`.

Gỡ LiveKit:

```bash
git rm backend/apps/realtime-gateway/src/realtime/livekit-token.ts backend/apps/realtime-gateway/src/realtime/livekit-token.spec.ts
cd backend && npm uninstall livekit-server-sdk
```

- [ ] **Step 6: Chạy toàn bộ test backend, typecheck, lint**

Chạy: `cd backend && npm test -- --ci 2>&1 | tail -15 && npm run typecheck && npx eslint apps/realtime-gateway/src scripts/realtimekit-setup.ts`
Kỳ vọng:
- Jest PASS toàn bộ; số test = 574 − 9 (spec LiveKit/TURN bị xoá) + số test mới.
- Typecheck xanh.
- ESLint không có **lỗi** trong các file đã sửa. Lỗi prettier thì chạy `npx eslint --fix` trên đúng các file đó.

Kiểm tra không còn dấu vết LiveKit/TURN trong code gateway:

```bash
cd backend && grep -rn "livekit\|LIVEKIT\|buildIceConfig\|TURN_SECRET" apps libs --include="*.ts"
```

Kỳ vọng: không còn kết quả nào ngoài comment lịch sử (nếu có comment thì sửa lại cho đúng hiện trạng).

- [ ] **Step 7: Commit**

```bash
git add backend/apps/realtime-gateway/src backend/package.json backend/package-lock.json
git commit -m "feat(realtime): run group calls on RealtimeKit with a signed webhook and an empty-room grace timer"
```

---

### Task 8: Bộ QC trình duyệt cho cuộc gọi (viết trước, chạy đỏ)

QC là bài kiểm tra cấp hệ thống: viết trước frontend, chạy thấy đỏ, rồi Task 9–11 làm cho nó xanh.

**Files:**
- Create: `qc/calls-fixtures.mjs`
- Create: `qc/calls-browser.mjs`
- Modify: `qc/package.json` (script `calls`)
- Modify: `qc/README.md` (mục "Cuộc gọi")

**Interfaces:**
- Consumes:
  - dev stack (Kong `http://localhost:8080`, Redis `daln-redis`), Vite `http://localhost:5174`;
  - biến `QC_ACCOUNTS_FILE` cho prod (JSON gồm 3 tài khoản và id nhóm).
- Produces:
  - `node qc/calls-browser.mjs`, in `TỔNG: N pass / M fail`, exit code khác 0 khi có mục đỏ;
  - nhãn mỗi kiểm tra bắt đầu bằng `[§7.<số>]` để đối chiếu với spec.

- [ ] **Step 1: Viết `qc/calls-fixtures.mjs`**

```js
/**
 * Dựng dữ liệu cho QC cuộc gọi: 3 tài khoản, A–B là bạn (có hội thoại DIRECT),
 * nhóm A–B–C. Dev: tạo mới mỗi lần (OTP đặt thẳng vào Redis như auth-api.sh).
 * Prod: đọc sẵn từ QC_ACCOUNTS_FILE (JSON), không tạo gì.
 */
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const API = process.env.API ?? 'http://localhost:8080'
const REDIS_CONTAINER = process.env.REDIS_CONTAINER ?? 'daln-redis'
const PASSWORD = 'MatKhau123'
const OTP = '135790'

const R = (cmd) =>
  execSync(`docker exec ${REDIS_CONTAINER} redis-cli ${cmd}`).toString().trim()

/** Cookie jar tối giản: giữ Set-Cookie của API để gọi tiếp bằng fetch. */
export async function login(email, password = PASSWORD) {
  const res = await fetch(`${API}/user/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) throw new Error(`login ${email} -> ${res.status}`)
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')
  const me = await (await fetch(`${API}/user/me`, { headers: { cookie } })).json()
  return { email, password, cookie, id: me.id ?? me.data?.id, username: me.username ?? me.data?.username }
}

async function api(account, method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { cookie: account.cookie, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 200)}`)
  return text ? JSON.parse(text) : null
}

async function register(tag) {
  const stamp = Date.now().toString(36)
  const email = `qc.call.${tag}.${stamp}@example.test`
  const username = `qccall${tag}${stamp}`.slice(0, 30)
  await fetch(`${API}/user/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, username, password: PASSWORD, fullName: `QC Call ${tag.toUpperCase()}` }),
  })
  const hash = createHash('sha256').update(OTP).digest('hex')
  R(`set otp:reg:${email} ${hash} EX 300`)
  const res = await fetch(`${API}/user/verify-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, otp: OTP }),
  })
  if (res.status !== 201 && res.status !== 200) throw new Error(`verify-otp ${email} -> ${res.status}`)
  return login(email)
}

async function befriend(a, b) {
  await api(a, 'POST', '/user/make-friend-by-username', { username: b.username })
  const list = await api(b, 'GET', '/user/list-friend-requests?direction=received')
  const items = list?.items ?? list?.data ?? list ?? []
  const req = items.find((r) => (r.inviterId ?? r.sender?.id ?? r.from?.id) === a.id) ?? items[0]
  await api(b, 'POST', `/user/friend-requests/${req.id}/respond`, { status: 'ACCEPTED' })
  // Saga tạo hội thoại DIRECT bất đồng bộ — chờ tới khi có.
  for (let i = 0; i < 40; i++) {
    try {
      const conv = await api(a, 'GET', `/chat/conversation-by-friend?friendId=${b.id}`)
      if (conv?.id) return conv.id
    } catch {}
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('không thấy hội thoại DIRECT sau khi kết bạn')
}

export async function fixtures() {
  if (process.env.QC_ACCOUNTS_FILE) {
    const cfg = JSON.parse(readFileSync(process.env.QC_ACCOUNTS_FILE, 'utf8'))
    const [a, b, c] = await Promise.all(cfg.accounts.map((acc) => login(acc.email, acc.password)))
    return { a, b, c, directId: cfg.directId, groupId: cfg.groupId, groupName: cfg.groupName }
  }
  const [a, b, c] = [await register('a'), await register('b'), await register('c')]
  const directId = await befriend(a, b)
  await befriend(a, c)
  const groupName = `QC gọi nhóm ${Date.now().toString(36)}`
  const group = await api(a, 'POST', '/chat/create', { groupName, memberIds: [b.id, c.id] })
  return { a, b, c, directId, groupId: group.id, groupName }
}
```

Dạng dữ liệu trả về của `list-friend-requests` và `/user/me` chưa được kiểm chứng. Lần chạy đầu, nếu `befriend` hoặc `login` báo lỗi, in `JSON.stringify` của response ra rồi sửa đúng chỗ đọc trường, và ghi `Ruling:` vào ledger.

- [ ] **Step 2: Viết `qc/calls-browser.mjs`**

```js
/**
 * QC trình duyệt cho cuộc gọi (spec realtimekit-calls §7).
 *
 *   node qc/calls-browser.mjs                  # dev: tự dựng 3 tài khoản
 *   APP=https://nguyen1976.xyz API=https://nguyen1976.xyz/api \
 *     QC_ACCOUNTS_FILE=qc/.env.prod.json node qc/calls-browser.mjs   # prod
 *
 * Mỗi tài khoản một Chrome riêng, camera/mic giả (Chrome phát hình chuyển động +
 * tiếng bíp). Kiểm cả media chạy thật: video có khung hình và thời gian tăng,
 * audio có năng lượng khác 0 — không chỉ kiểm giao diện.
 */
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'
import { fixtures } from './calls-fixtures.mjs'

const APP = process.env.APP ?? 'http://localhost:5174'
const API = process.env.API ?? 'http://localhost:8080'
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ONLY = process.env.ONLY // vd ONLY=direct hoặc ONLY=group

let pass = 0
let fail = 0
const ok = (m) => { console.log(`  ✅ ${m}`); pass++ }
const bad = (m) => { console.log(`  ❌ ${m}`); fail++ }
const check = (cond, label, detail = '') => (cond ? ok(label) : bad(`${label}${detail ? ` — ${detail}` : ''}`))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
mkdirSync('shots', { recursive: true })

async function until(fn, ms = 15000, step = 300) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    try { if (await fn()) return true } catch {}
    await sleep(step)
  }
  return false
}

async function openBrowser(account) {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      '--no-sandbox',
    ],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 860 })
  await page.goto(APP, { waitUntil: 'networkidle2' })
  await page.evaluate(async (api, email, password) => {
    await fetch(`${api}/user/login`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
  }, API, account.email, account.password)
  return { browser, page, account }
}

const text = (page) => page.evaluate(() => document.body.innerText)
const hasText = (page, needle) => text(page).then((t) => t.includes(needle))

/** Bấm nút theo tên truy cập (aria-label / title / chữ trên nút). */
async function press(page, name) {
  const el = await page.waitForSelector(`::-p-aria(${name})`, { timeout: 10000 })
  await el.evaluate((node) => node.scrollIntoView({ block: 'center' }))
  await el.click()
}

async function openConversation(page, id) {
  await page.goto(`${APP}/chat/${id}`, { waitUntil: 'networkidle2' })
  await sleep(800)
}

/** Video có khung hình thật: kích thước > 0 và currentTime tăng. */
const videoFlowing = (page, selector) =>
  page.evaluate(async (sel) => {
    const v = [...document.querySelectorAll(sel)].find((n) => n.srcObject && n.offsetParent !== null)
    if (!v || v.videoWidth === 0) return false
    const t0 = v.currentTime
    await new Promise((r) => setTimeout(r, 800))
    return v.currentTime > t0
  }, selector)

/** Có âm thanh thật từ phía kia: đo năng lượng trên mọi <audio> đang phát. */
const audioFlowing = (page) =>
  page.evaluate(async () => {
    const els = [...document.querySelectorAll('audio')].filter((a) => a.srcObject)
    if (!els.length) return false
    const ctx = new AudioContext()
    let peak = 0
    for (const el of els) {
      const src = ctx.createMediaStreamSource(el.srcObject)
      const an = ctx.createAnalyser()
      src.connect(an)
      const buf = new Uint8Array(an.fftSize)
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 100))
        an.getByteTimeDomainData(buf)
        for (const x of buf) peak = Math.max(peak, Math.abs(x - 128))
      }
    }
    await ctx.close()
    return peak > 2
  })

async function shot(page, name) {
  await page.screenshot({ path: `shots/calls-${name}.png` })
}

async function direct({ A, B, directId }) {
  console.log('\n== Gọi 1-1 ==')
  await openConversation(A.page, directId)

  // §7.1–5: gọi video, người nhận thấy màn hình đến, nhận kèm camera, media chạy
  await press(A.page, 'Gọi video')
  if (await until(() => hasText(A.page, 'Xem trước'), 5000)) await press(A.page, 'Gọi')
  check(await until(() => hasText(A.page, 'Đang gọi')), '[§7.4] bên gọi thấy "Đang gọi..."')
  check(await until(() => hasText(B.page, 'Cuộc gọi đến')), '[§7.2] bên nhận thấy "Cuộc gọi đến..."')
  await press(B.page, 'Nhận cuộc gọi video')
  check(await until(() => videoFlowing(A.page, 'video')), '[§7.5] bên gọi thấy video bên kia')
  check(await until(() => videoFlowing(B.page, 'video')), '[§7.5] bên nhận thấy video bên kia')
  check(await until(() => audioFlowing(A.page)), '[§7.5] bên gọi nghe được tiếng')
  check(await until(() => audioFlowing(B.page)), '[§7.5] bên nhận nghe được tiếng')
  await shot(A.page, 'direct-video-caller')

  // §7.6 tắt micro -> bên kia thấy nhãn
  await press(B.page, 'Tắt micro')
  check(await until(() => hasText(A.page, 'đã tắt micro')), '[§7.6] bên kia thấy "… đã tắt micro"')
  await press(B.page, 'Bật micro')
  check(await until(async () => !(await hasText(A.page, 'đã tắt micro'))), '[§7.6] bật lại thì nhãn biến mất')

  // §7.7 tắt camera -> bên kia thấy avatar; bật lại thấy video (không đứng hình)
  await press(B.page, 'Tắt camera')
  check(
    // VoiceCallModal giữ thẻ <video> của đối phương nhưng thêm class `invisible`
    // và hiện avatar khi camera bên kia tắt.
    await until(() => A.page.evaluate(() => [...document.querySelectorAll('video')].some((v) => v.classList.contains('invisible')))),
    '[§7.7] tắt camera: bên kia thấy avatar thay khung video',
  )
  await press(B.page, 'Bật camera')
  check(await until(() => videoFlowing(A.page, 'video')), '[§7.7] bật lại: video B chạy lại, không đứng hình')

  // §7.15 thu nhỏ + chuyển trang, cuộc gọi vẫn còn
  await press(A.page, 'Thu nhỏ cuộc gọi')
  await A.page.goto(`${APP}/settings/account`, { waitUntil: 'networkidle2' }).catch(() => {})
  check(await until(() => hasText(A.page, 'Mở lại cuộc gọi')), '[§7.15] thu nhỏ: còn thanh "Mở lại cuộc gọi" sau khi chuyển trang')
  check(await until(() => audioFlowing(A.page)), '[§7.15] thu nhỏ: vẫn nghe tiếng')
  await press(A.page, 'Mở lại cuộc gọi')

  // §7.14 kết thúc -> nhật ký có thời lượng
  await sleep(2500)
  await press(A.page, 'Kết thúc cuộc gọi')
  await openConversation(A.page, directId)
  check(await until(() => hasText(A.page, 'Cuộc gọi video')), '[§7.14] nhật ký "Cuộc gọi video"')
  check(await until(() => A.page.evaluate(() => /\d+ giây/.test(document.body.innerText))), '[§7.14] nhật ký có thời lượng')

  // §7.9 từ chối
  await openConversation(A.page, directId)
  await press(A.page, 'Gọi thoại')
  await until(() => hasText(B.page, 'Cuộc gọi đến'))
  await press(B.page, 'Từ chối cuộc gọi')
  check(await until(() => hasText(A.page, 'Bị từ chối') || hasText(A.page, 'bị từ chối')), '[§7.9] từ chối: bên gọi/nhật ký thấy "Bị từ chối"')

  // §7.3 nhận chỉ âm thanh cho cuộc gọi video; §7.27 không bật được camera trong cuộc gọi thoại
  await openConversation(A.page, directId)
  await press(A.page, 'Gọi video')
  if (await until(() => hasText(A.page, 'Xem trước'), 5000)) await press(A.page, 'Gọi')
  await until(() => hasText(B.page, 'Cuộc gọi đến'))
  await press(B.page, 'Nhận chỉ âm thanh')
  check(await until(() => videoFlowing(B.page, 'video')), '[§7.3] nhận chỉ âm thanh vẫn thấy video người gọi')
  check(await until(() => audioFlowing(A.page)), '[§7.3] người gọi nghe được tiếng')
  await press(A.page, 'Kết thúc cuộc gọi')
  await sleep(1500)

  // §7.10 không ai nhận 30 giây -> "Người dùng bận" + nhật ký nhỡ
  await openConversation(A.page, directId)
  await press(A.page, 'Gọi thoại')
  check(await until(() => hasText(A.page, 'Người dùng bận'), 40000), '[§7.10] hết 30 giây: "Người dùng bận"')
  await openConversation(A.page, directId)
  check(await until(() => hasText(A.page, 'Cuộc gọi nhỡ')), '[§7.10] nhật ký "Cuộc gọi nhỡ"')
}

async function group({ A, B, C, groupId }) {
  console.log('\n== Gọi nhóm ==')
  await openConversation(A.page, groupId)
  await openConversation(C.page, groupId)

  await press(A.page, 'Gọi video nhóm')
  if (await until(() => hasText(A.page, 'Xem trước'), 5000)) await press(A.page, 'Bắt đầu')
  check(await until(() => hasText(B.page, 'đang mời bạn vào cuộc gọi')), '[§7.17] thành viên thấy lời mời')
  await press(B.page, 'Tham gia cuộc gọi nhóm')
  check(await until(() => videoFlowing(A.page, 'video')), '[§7.18] A thấy video của B')
  check(await until(() => audioFlowing(B.page)), '[§7.18] B nghe được A')

  // §7.22 banner + chấm "Đang gọi…" cho C chưa vào
  check(await until(() => hasText(C.page, 'Đang có cuộc gọi')), '[§7.22] C thấy banner "Đang có cuộc gọi…"')
  await press(C.page, 'Tham gia')
  check(await until(() => A.page.evaluate(() => document.querySelectorAll('video').length >= 2)), '[§7.18] A thấy thêm tile khi C vào')

  // §7.19 ghim
  await press(A.page, 'Ghim')
  check(await until(() => hasText(A.page, 'Bỏ ghim')), '[§7.19] ghim được một người')
  await press(A.page, 'Bỏ ghim')

  // §7.20 huy hiệu tắt micro
  await press(B.page, 'Tắt micro')
  check(await until(() => hasText(A.page, 'Đã tắt micro')), '[§7.20] A thấy B "Đã tắt micro"')

  // §7.21 bật lại camera hiện hình ngay
  await press(B.page, 'Tắt camera')
  await sleep(1000)
  await press(B.page, 'Bật camera')
  check(await until(() => videoFlowing(A.page, 'video')), '[§7.21] bật lại camera: hình hiện lại ngay')
  await shot(A.page, 'group-video')

  // §7.23–24 rời; người cuối rời -> ~15 giây sau ended + nhật ký
  await press(C.page, 'Rời cuộc gọi')
  await press(B.page, 'Rời cuộc gọi')
  await press(A.page, 'Rời cuộc gọi')
  check(await until(async () => !(await hasText(C.page, 'Đang có cuộc gọi')), 30000), '[§7.24] banner biến mất sau khi mọi người rời')
  await openConversation(A.page, groupId)
  check(await until(() => hasText(A.page, 'Cuộc gọi video nhóm'), 30000), '[§7.24] nhật ký "Cuộc gọi video nhóm"')
}

async function main() {
  const fx = await fixtures()
  const A = await openBrowser(fx.a)
  const B = await openBrowser(fx.b)
  const C = await openBrowser(fx.c)
  try {
    if (!ONLY || ONLY === 'direct') await direct({ A, B, directId: fx.directId })
    if (!ONLY || ONLY === 'group') await group({ A, B, C, groupId: fx.groupId })
  } catch (error) {
    bad(`lỗi dừng bộ QC: ${error.message}`)
    await shot(A.page, 'crash-a').catch(() => {})
  } finally {
    await Promise.all([A, B, C].map((x) => x.browser.close()))
  }
  console.log(`\nTỔNG: ${pass} pass / ${fail} fail`)
  process.exit(fail ? 1 : 0)
}

main()
```

Nhãn trong `press(...)` lấy từ bảng chữ hiển thị trong spec §7 và từ `aria-label` / `title` hiện có trong các modal. Nếu một nút không có tên truy cập khớp, **thêm `aria-label` vào nút đó** ở Task 10/11 (không đổi chữ hiển thị) thay vì đổi QC. Mỗi thay đổi như vậy ghi `Ruling:` vào ledger.

- [ ] **Step 3: Thêm script và README**

`qc/package.json`, trong `"scripts"`, thêm: `"calls": "node ./calls-browser.mjs"`.

`qc/README.md`, thêm mục:

````markdown
## Cuộc gọi (RealtimeKit)

```bash
node qc/calls-browser.mjs            # dev: tự tạo 3 tài khoản, kết bạn, nhóm
ONLY=direct node qc/calls-browser.mjs
```

Cần: stack dev chạy, Vite ở 5174, `npm run rtk:dev-tunnel` (backend) đã chạy để
webhook tới được gateway, Chrome. Prod: `APP`, `API` trỏ domain thật và
`QC_ACCOUNTS_FILE` là file JSON `{accounts:[{email,password}×3], directId, groupId, groupName}`
(gitignore, không commit).
````

- [ ] **Step 4: Chạy trên dev (frontend cũ) — xác nhận đỏ đúng chỗ**

Chuẩn bị:

```bash
cd backend && docker compose up -d realtime-gateway   # nạp REALTIMEKIT_* và code Task 6–7
npm run rtk:dev-tunnel
```

Chạy (với Vite dev ở 5174 đang chạy frontend **cũ**): `cd qc && ONLY=direct node calls-browser.mjs`

Kỳ vọng:
- **FAIL**: bộ dựng dữ liệu chạy được (đăng ký, kết bạn, nhóm);
- bên gọi **không** vào được trạng thái "Đang gọi…" vì frontend cũ gửi `offer` nên nhận `CLIENT_OUTDATED`;
- `TỔNG` có mục ❌ ở `[§7.4]`.

Nếu lỗi nằm ở bộ dựng dữ liệu thì sửa `calls-fixtures.mjs` cho tới khi chỉ còn đỏ do giao thức.

- [ ] **Step 5: Commit**

```bash
git add qc/calls-fixtures.mjs qc/calls-browser.mjs qc/package.json qc/README.md
git commit -m "test(qc): browser QC for 1-1 and group calls with fake media and media-flow checks"
```

---

### Task 9: Frontend — `useRtkRoom`, dependency, hằng số sự kiện, thông báo lỗi

**Files:**
- Modify: `frontend/package.json`, `frontend/package-lock.json`
- Create: `frontend/src/hooks/useRtkRoom.ts`
- Create: `frontend/src/utils/callErrors.ts`
- Modify: `frontend/src/lib/socket.events.ts`
- Modify: `frontend/src/utils/groupCallError.ts`

**Interfaces:**
- Consumes: SDK `@cloudflare/realtimekit`:
  - default export `Client` với `static init({ authToken, defaults: { audio, video } })`;
  - `join()`, `leave()`;
  - `self` (`audioEnabled`, `videoEnabled`, `videoTrack`, `customParticipantId`, `name`, `id`, `enableAudio` / `disableAudio` / `enableVideo` / `disableVideo`, `getVideoDevices`, `setDevice`, sự kiện `videoUpdate` / `audioUpdate` / `roomLeft` / `autoplayError`);
  - `participants.joined` (`toArray()`, các sự kiện `participantJoined` / `participantLeft` / `videoUpdate` / `audioUpdate`);
  - `participants.on('activeSpeaker', { peerId })`.
- Produces:
  - `interface RtkPeer { identity; name; isLocal; isSpeaking; isMuted; isCameraEnabled; videoTrack: MediaStreamTrack | null; audioTrack: MediaStreamTrack | null }`
  - `type RtkRoomState = 'connecting' | 'connected' | 'failed' | 'left'`
  - `useRtkRoom({ authToken, audio, video, manageAudio?, onDisconnected? })` trả về `{ peers, state, micOn, cameraOn, needsAudioUnlock, toggleMic(): Promise<boolean>, toggleCamera(): Promise<boolean>, switchCamera(): Promise<void>, leave(): Promise<void>, unlockAudio(): void }`
  - `utils/callErrors.ts` export `CallSetupError`, `CallSetupErrorCode`, `MicrophoneTimeoutError`, `describeMicrophoneError`, `describeCallError`, `probeLocalMedia(withVideo: boolean): Promise<void>`

- [ ] **Step 1: Cài / gỡ dependency**

```bash
cd frontend && npm install --save-exact @cloudflare/realtimekit@2.0.2 && npm uninstall livekit-client
```

Kỳ vọng: `package.json` có `"@cloudflare/realtimekit": "2.0.2"` và không còn `livekit-client`.

- [ ] **Step 2: Viết `frontend/src/utils/callErrors.ts`**

Chuyển nguyên văn `CallSetupError`, `MicrophoneTimeoutError`, `describeMicrophoneError`, `describeCallError` từ `hooks/useWebRTC.ts` sang file này, rồi bổ sung mã mới và `probeLocalMedia`:

```ts
export type CallSetupErrorCode =
  | "CALL_FORBIDDEN"
  | "CALLEE_OFFLINE"
  | "BUSY"
  | "CALLEE_BUSY"
  | "CLIENT_OUTDATED"
  | "MEDIA_UNAVAILABLE"
  | "MEDIA_UNCONFIGURED"
  | "UNKNOWN";

/** Lỗi thiết lập cuộc gọi từ phía gateway (không phải lỗi micro). */
export class CallSetupError extends Error {
  code: CallSetupErrorCode;
  constructor(code: CallSetupErrorCode) {
    super("Không thiết lập được cuộc gọi");
    this.name = "CallSetupError";
    this.code = code;
  }
}

/** Bao lâu chờ micro trước khi coi là hỏng. */
const MIC_ACQUIRE_TIMEOUT_MS = 15000;

export class MicrophoneTimeoutError extends Error {
  constructor() {
    super("Không truy cập được micro");
    this.name = "MicrophoneTimeoutError";
  }
}

/** Thông điệp cho người dùng ứng với từng lý do không lấy được micro. */
export function describeMicrophoneError(error: unknown): string {
  const name = (error as { name?: string })?.name;

  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Bạn đã từ chối quyền dùng micro. Hãy bật lại quyền cho trang này trong cài đặt trình duyệt rồi gọi lại.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "Không tìm thấy micro nào trên thiết bị này.";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "Micro đang được ứng dụng khác sử dụng. Hãy đóng ứng dụng đó rồi thử lại.";
  }
  if (name === "MicrophoneTimeoutError") {
    return "Không truy cập được micro sau 15 giây. Hãy kiểm tra quyền micro của trình duyệt rồi gọi lại.";
  }
  return "Không thể bắt đầu cuộc gọi. Vui lòng thử lại.";
}

/** Gộp lỗi thiết lập từ gateway lẫn lỗi micro cho luồng gọi/nhận. */
export function describeCallError(error: unknown): string {
  if (error instanceof CallSetupError) {
    switch (error.code) {
      case "CALL_FORBIDDEN":
        return "Bạn không thể gọi cho người này.";
      case "CALLEE_OFFLINE":
        return "Người nhận hiện không trực tuyến.";
      case "BUSY":
        return "Bạn đang trong một cuộc gọi khác.";
      case "CALLEE_BUSY":
        return "Người này đang bận trong cuộc gọi khác.";
      case "CLIENT_OUTDATED":
        return "Ứng dụng vừa được cập nhật, vui lòng tải lại trang.";
      case "MEDIA_UNAVAILABLE":
        return "Không thể bắt đầu cuộc gọi, thử lại sau.";
      case "MEDIA_UNCONFIGURED":
        return "Tính năng gọi chưa sẵn sàng. Vui lòng thử lại sau.";
      default:
        return "Không thể bắt đầu cuộc gọi. Vui lòng thử lại.";
    }
  }
  return describeMicrophoneError(error);
}

/**
 * Xin quyền micro (và camera nếu cần) trước khi vào phòng, có giới hạn 15 giây,
 * rồi trả thiết bị ngay. SDK RealtimeKit tự mở thiết bị khi vào phòng; bước này
 * chỉ để giữ nguyên các thông báo lỗi quyền/thiết bị rõ ràng như trước.
 */
export async function probeLocalMedia(withVideo: boolean): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const media = navigator.mediaDevices.getUserMedia({
    audio: true,
    video: withVideo,
  });
  try {
    const stream = await Promise.race([
      media,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          reject(new MicrophoneTimeoutError());
        }, MIC_ACQUIRE_TIMEOUT_MS);
      }),
    ]);
    stream.getTracks().forEach((track) => track.stop());
  } catch (error) {
    if (timedOut) {
      void media
        .then((late) => late.getTracks().forEach((track) => track.stop()))
        .catch(() => undefined);
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
```

- [ ] **Step 3: Viết `frontend/src/hooks/useRtkRoom.ts`**

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import type RealtimeKitClient from "@cloudflare/realtimekit";

type RtkClient = Awaited<ReturnType<typeof RealtimeKitClient.init>>;
type RtkRemote = ReturnType<RtkClient["participants"]["joined"]["toArray"]>[number];

/** Một người trong phòng, đã chuẩn hoá để UI không chạm trực tiếp SDK. */
export interface RtkPeer {
  /** userId — lấy từ custom_participant_id `<userId>.<hex>` do gateway cấp. */
  identity: string;
  name: string;
  isLocal: boolean;
  isSpeaking: boolean;
  isMuted: boolean;
  isCameraEnabled: boolean;
  videoTrack: MediaStreamTrack | null;
  /** Chỉ có ở người khác; tiếng của chính mình không bao giờ được phát lại. */
  audioTrack: MediaStreamTrack | null;
}

export type RtkRoomState = "connecting" | "connected" | "failed" | "left";

export function userIdFromCustomId(id?: string | null): string {
  return (id ?? "").split(".")[0] ?? "";
}

/** Thời gian giữ vòng "đang nói" sau sự kiện activeSpeaker cuối cùng. */
const SPEAKING_HOLD_MS = 1500;

interface UseRtkRoomOptions {
  /** null = chưa có token (chưa gọi/nhận) → chưa vào phòng. */
  authToken: string | null;
  audio: boolean;
  video: boolean;
  /**
   * true (mặc định): hook tự phát tiếng người khác qua các <audio> ẩn. Cuộc gọi
   * 1-1 truyền false vì VoiceCallModal đã có thẻ <audio> riêng.
   */
  manageAudio?: boolean;
  /** Rớt khỏi phòng GIỮA cuộc gọi (sau khi đã vào): failed/disconnected. */
  onDisconnected?: () => void;
}

/**
 * Vào một phòng Cloudflare RealtimeKit bằng authToken do gateway cấp, và phơi ra
 * danh sách người + điều khiển mic/camera. SDK được import động: người chưa gọi
 * không phải tải ~170 KB gzip.
 */
export function useRtkRoom({
  authToken,
  audio,
  video,
  manageAudio = true,
  onDisconnected,
}: UseRtkRoomOptions) {
  const clientRef = useRef<RtkClient | null>(null);
  const [peers, setPeers] = useState<RtkPeer[]>([]);
  const [state, setState] = useState<RtkRoomState>("connecting");
  const [micOn, setMicOn] = useState(audio);
  const [cameraOn, setCameraOn] = useState(video);
  const [needsAudioUnlock, setNeedsAudioUnlock] = useState(false);
  const onDisconnectedRef = useRef(onDisconnected);
  const audioEls = useRef(new Map<string, HTMLAudioElement>());
  // Giá trị mới nhất của audio/video/manageAudio, đọc LÚC VÀO PHÒNG. Không làm
  // deps của effect vào phòng (đổi camera giữa cuộc gọi là việc của toggle*),
  // nhưng phải là giá trị của lần render có authToken — useDirectCall đặt
  // withCamera và authToken trong cùng một lượt. Effect đồng bộ này khai báo
  // TRƯỚC effect vào phòng nên chạy trước nó trong cùng commit.
  const latest = useRef({ audio, video, manageAudio });

  useEffect(() => {
    latest.current = { audio, video, manageAudio };
  }, [audio, video, manageAudio]);

  useEffect(() => {
    onDisconnectedRef.current = onDisconnected;
  }, [onDisconnected]);

  useEffect(() => {
    if (!authToken) return;
    let cancelled = false;
    let joined = false;
    let speakingId: string | null = null;
    let speakingTimer: ReturnType<typeof setTimeout> | undefined;
    const els = audioEls.current;

    const syncAudio = (client: RtkClient) => {
      if (!latest.current.manageAudio) return;
      const alive = new Set<string>();
      for (const p of client.participants.joined.toArray()) {
        const track = p.audioEnabled ? p.audioTrack : null;
        if (!track) continue;
        alive.add(p.id);
        let el = els.get(p.id);
        if (!el) {
          el = document.createElement("audio");
          el.autoplay = true;
          el.style.display = "none";
          document.body.append(el);
          els.set(p.id, el);
        }
        const current = (el.srcObject as MediaStream | null)?.getAudioTracks()[0];
        if (current !== track) {
          el.srcObject = new MediaStream([track]);
          void el.play().catch(() => setNeedsAudioUnlock(true));
        }
      }
      for (const [id, el] of els) {
        if (!alive.has(id)) {
          el.remove();
          els.delete(id);
        }
      }
    };

    const describeRemote = (p: RtkRemote): RtkPeer => ({
      identity: userIdFromCustomId(p.customParticipantId),
      name: p.name || userIdFromCustomId(p.customParticipantId),
      isLocal: false,
      isSpeaking: speakingId === p.id,
      isMuted: !p.audioEnabled,
      isCameraEnabled: p.videoEnabled,
      videoTrack: p.videoEnabled ? (p.videoTrack ?? null) : null,
      audioTrack: p.audioEnabled ? (p.audioTrack ?? null) : null,
    });

    const refresh = () => {
      const client = clientRef.current;
      if (!client) return;
      const self = client.self;
      setPeers([
        {
          identity: userIdFromCustomId(self.customParticipantId),
          name: self.name,
          isLocal: true,
          isSpeaking: speakingId === self.id,
          isMuted: !self.audioEnabled,
          isCameraEnabled: self.videoEnabled,
          videoTrack: self.videoEnabled ? (self.videoTrack ?? null) : null,
          audioTrack: null,
        },
        ...client.participants.joined.toArray().map(describeRemote),
      ]);
      setMicOn(self.audioEnabled);
      setCameraOn(self.videoEnabled);
      syncAudio(client);
    };

    void (async () => {
      try {
        const { default: RTK } = await import("@cloudflare/realtimekit");
        const client = await RTK.init({
          authToken,
          defaults: {
            audio: latest.current.audio,
            video: latest.current.video,
          },
        });
        if (cancelled) {
          void client.leave().catch(() => undefined);
          return;
        }
        clientRef.current = client;

        const joinedMap = client.participants.joined;
        joinedMap.on("participantJoined", refresh);
        joinedMap.on("participantLeft", refresh);
        joinedMap.on("videoUpdate", refresh);
        joinedMap.on("audioUpdate", refresh);
        client.participants.on("activeSpeaker", ({ peerId }) => {
          speakingId = peerId;
          if (speakingTimer) clearTimeout(speakingTimer);
          speakingTimer = setTimeout(() => {
            speakingId = null;
            refresh();
          }, SPEAKING_HOLD_MS);
          refresh();
        });
        client.self.on("videoUpdate", refresh);
        client.self.on("audioUpdate", refresh);
        client.self.on("autoplayError", () => setNeedsAudioUnlock(true));
        client.self.on("roomLeft", ({ state: leftState }) => {
          if (cancelled) return;
          if (
            joined &&
            (leftState === "failed" || leftState === "disconnected")
          ) {
            setState("failed");
            onDisconnectedRef.current?.();
          } else {
            setState("left");
          }
        });

        await client.join();
        if (cancelled) {
          void client.leave().catch(() => undefined);
          return;
        }
        joined = true;
        setState("connected");
        refresh();
      } catch {
        if (!cancelled) setState("failed");
      }
    })();

    return () => {
      cancelled = true;
      if (speakingTimer) clearTimeout(speakingTimer);
      const client = clientRef.current;
      clientRef.current = null;
      if (client) {
        client.participants.joined.removeAllListeners();
        client.participants.removeAllListeners();
        client.self.removeAllListeners();
        void client.leave().catch(() => undefined);
      }
      els.forEach((el) => el.remove());
      els.clear();
      setPeers([]);
      // Trạng thái của cuộc gọi trước không được lọt sang cuộc gọi sau: một
      // "failed" còn sót sẽ làm useDirectCall báo không kết nối được ngay.
      setState("connecting");
      setNeedsAudioUnlock(false);
    };
  }, [authToken]);

  const toggleMic = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return false;
    try {
      if (client.self.audioEnabled) await client.self.disableAudio();
      else await client.self.enableAudio();
    } catch {
      // Giữ nguyên trạng thái nếu SDK/thiết bị từ chối.
    }
    setMicOn(client.self.audioEnabled);
    return client.self.audioEnabled;
  }, []);

  const toggleCamera = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return false;
    try {
      if (client.self.videoEnabled) await client.self.disableVideo();
      else await client.self.enableVideo();
    } catch {
      // Preset cấm video (cuộc gọi thoại) hoặc camera bận: giữ nguyên.
    }
    setCameraOn(client.self.videoEnabled);
    return client.self.videoEnabled;
  }, []);

  const switchCamera = useCallback(async () => {
    const client = clientRef.current;
    if (!client?.self.videoEnabled) return;
    try {
      const devices = await client.self.getVideoDevices();
      if (devices.length < 2) return;
      const currentId = client.self.videoTrack?.getSettings().deviceId;
      const idx = devices.findIndex((d) => d.deviceId === currentId);
      const next = devices[(idx + 1) % devices.length];
      if (next && next.deviceId !== currentId) await client.self.setDevice(next);
    } catch {
      // Không đổi được — giữ camera hiện tại.
    }
  }, []);

  const leave = useCallback(async () => {
    const client = clientRef.current;
    if (client) await client.leave().catch(() => undefined);
  }, []);

  const unlockAudio = useCallback(() => {
    audioEls.current.forEach((el) => void el.play().catch(() => undefined));
    setNeedsAudioUnlock(false);
  }, []);

  return {
    peers,
    state,
    micOn,
    cameraOn,
    needsAudioUnlock,
    toggleMic,
    toggleCamera,
    switchCamera,
    leave,
    unlockAudio,
  };
}
```

Lưu ý: kiểu `RtkRemote` và các tên sự kiện lấy từ `dist/index.d.ts` v2.0.2 (`ParticipantMapEvents`, `ParticipantEvents`, `ParticipantsEvents`). Nếu `tsc` báo `removeAllListeners` không tồn tại trên một đối tượng nào đó, thay bằng `off(tên, handler)` cho từng handler đã đăng ký, và ghi `Ruling:` vào ledger.

- [ ] **Step 4: Hằng số sự kiện và lỗi gọi nhóm**

`frontend/src/lib/socket.events.ts`:
- xoá `ICE_CONFIG`, `ICE_CANDIDATE`, `MEDIA_STATE`;
- sửa comment `GROUP_CALL` thành `// Gọi nhóm (hội thoại GROUP) qua Cloudflare RealtimeKit. 1-1 (DIRECT) dùng CALL.`.

`frontend/src/utils/groupCallError.ts`: thay `case "LIVEKIT_UNCONFIGURED":` bằng:

```ts
    case "MEDIA_UNCONFIGURED":
      return "Tính năng gọi chưa sẵn sàng. Vui lòng thử lại sau.";
    case "MEDIA_UNAVAILABLE":
      return "Không thể bắt đầu cuộc gọi, thử lại sau.";
    case "CLIENT_OUTDATED":
      return "Ứng dụng vừa được cập nhật, vui lòng tải lại trang.";
    case "BUSY":
      return "Bạn đang trong một cuộc gọi khác.";
```

- [ ] **Step 5: Typecheck riêng file mới**

Chạy: `cd frontend && npx tsc -p tsconfig.app.json --noEmit 2>&1 | grep -E "useRtkRoom|callErrors|groupCallError|socket.events" || echo "các file mới sạch"`
Kỳ vọng: `các file mới sạch`. Những lỗi còn lại nằm ở `useWebRTC.ts` / `useGroupCall.ts` / các modal, do `livekit-client` đã gỡ và hằng số đã xoá; Task 10–11 xử lý.

Nếu tên file tsconfig khác (`tsconfig.json` / `tsconfig.app.json`), xem `frontend/package.json` script `build` để dùng đúng file.

- [ ] **Step 6: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/hooks/useRtkRoom.ts frontend/src/utils/callErrors.ts frontend/src/lib/socket.events.ts frontend/src/utils/groupCallError.ts
git commit -m "feat(web): add a RealtimeKit room hook and call error messages for the new codes"
```

---

### Task 10: Frontend — gọi 1-1 (`useDirectCall`, VoiceCallModal, IncomingCallManager)

**Files:**
- Create: `frontend/src/hooks/useDirectCall.ts`
- Delete: `frontend/src/hooks/useWebRTC.ts`
- Modify: `frontend/src/components/VoiceCallModal/index.tsx`
- Modify: `frontend/src/components/IncomingCallManager/index.tsx`

**Interfaces:**
- Consumes: `useRtkRoom`, `RtkPeer` (Task 9); `CallSetupError`, `probeLocalMedia`, `describeCallError` (Task 9); ack của Task 6.
- Produces: `useDirectCall(socket)` trả về:
  - `localStream: MediaStream | null`, `remoteStream: MediaStream | null`
  - `callStatus: CallStatus`, `callType: CallType`, `isCameraOn: boolean`
  - `remoteMedia: { cameraOn: boolean; micOn: boolean }`
  - `connectedAt: number | null`, `callIdRef`
  - `startCall(conversationId, callType)`, `acceptCall(callId, { withCamera })`, `rejectCall(callId)`, `endCall(reason?, { emit? })`, `handlePeerAccepted()`, `cleanup()`
  - `toggleMute(): Promise<boolean>` (true = đang tắt tiếng), `toggleCamera(): Promise<boolean>`, `switchCamera(): Promise<void>`
  - Export thêm `type CallStatus`, `type CallType`.

- [ ] **Step 1: Viết `frontend/src/hooks/useDirectCall.ts`**

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { SOCKET_EVENTS } from "@/lib/socket.events";
import { useRtkRoom } from "@/hooks/useRtkRoom";
import {
  CallSetupError,
  type CallSetupErrorCode,
  probeLocalMedia,
} from "@/utils/callErrors";

export type CallStatus =
  | "idle"
  | "calling"
  | "ringing"
  | "connecting"
  | "connected"
  | "ended"
  | "rejected"
  | "no_answer"
  | "unreachable";

export type CallType = "audio" | "video";

/** Chờ ack gọi/nhận: server có thể mất tới 8s gọi API media + tra quyền. */
const CALL_ACK_TIMEOUT_MS = 12000;
/** Đã nhận cuộc gọi mà quá 15s chưa thấy bên kia trong phòng → không nối được. */
const CONNECTING_TIMEOUT_MS = 15000;
/** Đang nói chuyện mà bên kia biến khỏi phòng quá lâu (và không có call.ended). */
const PEER_GONE_GRACE_MS = 8000;

type CallAck =
  | { ok: true; callId?: string; authToken: string }
  | { ok: false; code: CallSetupErrorCode }
  | null;

function emitWithAck(socket: Socket, event: string, payload: unknown) {
  return new Promise<CallAck>((resolve) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(null);
    }, CALL_ACK_TIMEOUT_MS);
    socket.emit(event, payload, (res: CallAck) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(res ?? null);
    });
  });
}

/**
 * Cuộc gọi 1-1 trên Cloudflare RealtimeKit. Nghiệp vụ (đổ chuông, nhận, từ chối,
 * kết thúc) vẫn đi qua socket như trước; media là một phòng RealtimeKit 2 người
 * mà gateway cấp token qua ack. Giữ nguyên hình dạng trả về của useWebRTC cũ để
 * VoiceCallModal không phải đổi bố cục.
 */
export const useDirectCall = (socket: Socket) => {
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [withCamera, setWithCamera] = useState(false);
  const [callStatus, setCallStatus] = useState<CallStatus>("idle");
  const [callType, setCallType] = useState<CallType>("audio");
  const [connectedAt, setConnectedAt] = useState<number | null>(null);
  const callIdRef = useRef<string | null>(null);
  const statusRef = useRef<CallStatus>("idle");
  const connectingTimerRef = useRef<number | null>(null);
  const peerGoneTimerRef = useRef<number | null>(null);

  useEffect(() => {
    statusRef.current = callStatus;
  }, [callStatus]);

  const clearTimers = useCallback(() => {
    if (connectingTimerRef.current !== null) {
      window.clearTimeout(connectingTimerRef.current);
      connectingTimerRef.current = null;
    }
    if (peerGoneTimerRef.current !== null) {
      window.clearTimeout(peerGoneTimerRef.current);
      peerGoneTimerRef.current = null;
    }
  }, []);

  const cleanup = useCallback(() => {
    clearTimers();
    setAuthToken(null);
    setWithCamera(false);
    setCallType("audio");
    setCallStatus("idle");
  }, [clearTimers]);

  const endCall = useCallback(
    (reason?: "no_answer" | "unreachable", options?: { emit?: boolean }) => {
      const callId = callIdRef.current;
      if ((options?.emit ?? true) && callId) {
        socket.emit(SOCKET_EVENTS.CALL.CALL_ENDED, { callId, reason });
      }
      callIdRef.current = null;
      setConnectedAt(null);
      cleanup();
      setCallStatus(
        reason === "no_answer"
          ? "no_answer"
          : reason === "unreachable"
            ? "unreachable"
            : "ended",
      );
    },
    [cleanup, socket],
  );

  const failUnreachable = useCallback(() => {
    clearTimers();
    if (!callIdRef.current) return;
    endCall("unreachable");
  }, [clearTimers, endCall]);

  const room = useRtkRoom({
    authToken,
    audio: true,
    video: withCamera,
    manageAudio: false,
    onDisconnected: failUnreachable,
  });

  const remote = useMemo(
    () => room.peers.find((peer) => !peer.isLocal) ?? null,
    [room.peers],
  );
  const local = useMemo(
    () => room.peers.find((peer) => peer.isLocal) ?? null,
    [room.peers],
  );

  // Không vào được phòng (token hỏng, mạng chặn…) = không kết nối được.
  useEffect(() => {
    if (authToken && room.state === "failed") failUnreachable();
  }, [authToken, room.state, failUnreachable]);

  // Bên kia xuất hiện trong phòng → mới tính là đã kết nối và bắt đầu đếm giờ.
  useEffect(() => {
    const status = statusRef.current;
    if (remote && (status === "calling" || status === "connecting")) {
      clearTimers();
      setConnectedAt((prev) => prev ?? Date.now());
      setCallStatus("connected");
    }
    if (!remote && status === "connected" && peerGoneTimerRef.current === null) {
      peerGoneTimerRef.current = window.setTimeout(() => {
        peerGoneTimerRef.current = null;
        failUnreachable();
      }, PEER_GONE_GRACE_MS);
    }
    if (remote && peerGoneTimerRef.current !== null) {
      window.clearTimeout(peerGoneTimerRef.current);
      peerGoneTimerRef.current = null;
    }
  }, [remote, clearTimers, failUnreachable]);

  const startConnectingWatchdog = useCallback(() => {
    if (connectingTimerRef.current !== null) return;
    connectingTimerRef.current = window.setTimeout(() => {
      connectingTimerRef.current = null;
      if (statusRef.current !== "connected") failUnreachable();
    }, CONNECTING_TIMEOUT_MS);
  }, [failUnreachable]);

  const startCall = useCallback(
    async (conversationId: string, type: CallType = "audio") => {
      const video = type === "video";
      await probeLocalMedia(video);
      const ack = await emitWithAck(socket, SOCKET_EVENTS.CALL.INCOMING_CALL, {
        v: 2,
        conversationId,
        callType: type,
      });
      if (!ack || ack.ok !== true || !ack.callId) {
        throw new CallSetupError(ack && ack.ok === false ? ack.code : "UNKNOWN");
      }
      callIdRef.current = ack.callId;
      setCallType(type);
      setWithCamera(video);
      setAuthToken(ack.authToken);
      setCallStatus("calling");
    },
    [socket],
  );

  const acceptCall = useCallback(
    async (callId: string, opts?: { withCamera?: boolean }) => {
      const camera = opts?.withCamera === true;
      await probeLocalMedia(camera);
      const ack = await emitWithAck(socket, SOCKET_EVENTS.CALL.CALL_ACCEPTED, {
        v: 2,
        callId,
      });
      if (!ack || ack.ok !== true) {
        throw new CallSetupError(ack && ack.ok === false ? ack.code : "UNKNOWN");
      }
      callIdRef.current = callId;
      setCallType(camera ? "video" : "audio");
      setWithCamera(camera);
      setAuthToken(ack.authToken);
      setCallStatus("connecting");
      startConnectingWatchdog();
    },
    [socket, startConnectingWatchdog],
  );

  /** Người gọi: bên kia vừa bấm nghe (socket call.accepted). */
  const handlePeerAccepted = useCallback(() => {
    if (statusRef.current === "calling") {
      setCallStatus("connecting");
      startConnectingWatchdog();
    }
  }, [startConnectingWatchdog]);

  const rejectCall = useCallback(
    (callId: string) => {
      socket.emit(SOCKET_EVENTS.CALL.CALL_REJECTED, { callId });
      setCallStatus("rejected");
    },
    [socket],
  );

  const toggleMute = useCallback(async () => !(await room.toggleMic()), [room]);

  const localStream = useMemo(
    () => (local?.videoTrack ? new MediaStream([local.videoTrack]) : null),
    [local?.videoTrack],
  );
  const remoteStream = useMemo(() => {
    const tracks = [remote?.audioTrack, remote?.videoTrack].filter(
      (track): track is MediaStreamTrack => Boolean(track),
    );
    return tracks.length ? new MediaStream(tracks) : null;
  }, [remote?.audioTrack, remote?.videoTrack]);

  return {
    localStream,
    remoteStream,
    callStatus,
    callType,
    isCameraOn: room.cameraOn,
    remoteMedia: {
      cameraOn: remote?.isCameraEnabled ?? false,
      micOn: remote ? !remote.isMuted : true,
    },
    startCall,
    acceptCall,
    rejectCall,
    endCall,
    connectedAt,
    handlePeerAccepted,
    toggleMute,
    toggleCamera: room.toggleCamera,
    switchCamera: room.switchCamera,
    cleanup,
    callIdRef,
  };
};
```

Xoá file cũ: `git rm frontend/src/hooks/useWebRTC.ts`.

- [ ] **Step 2: Sửa `VoiceCallModal/index.tsx`**

1. Import: thay dòng `import { describeCallError, useWebRTC } from "@/hooks/useWebRTC";` bằng:

```ts
import { useDirectCall } from "@/hooks/useDirectCall";
import { describeCallError } from "@/utils/callErrors";
```

2. Props: xoá `incomingOffer?: RTCSessionDescriptionInit;` khỏi `VoiceCallModalProps` và khỏi phần destructure tham số.

3. Thay khối state camera/micro của bên kia (dòng ~104–113: `remoteCameraByTrack`, `remoteCameraSignaled`, `remoteMicOn`, `remoteCameraOn`) bằng: không khai báo gì ở đây. Hai giá trị được suy ra sau khi gọi hook, ở bước 4.

4. Thay lời gọi hook:

```ts
  const {
    localStream,
    remoteStream,
    callStatus,
    startCall,
    acceptCall,
    rejectCall,
    endCall,
    handlePeerAccepted,
    toggleMute,
    toggleCamera,
    switchCamera,
    isCameraOn: cameraOnFromHook,
    remoteMedia,
    cleanup,
    connectedAt,
    callIdRef,
  } = useDirectCall(socket);

  // Trạng thái camera/micro của đối phương đến thẳng từ RealtimeKit (videoUpdate/
  // audioUpdate) — không còn tín hiệu call.media_state hay suy luận từ RTP mute.
  const remoteCameraOn = remoteMedia.cameraOn;
  const remoteMicOn = remoteMedia.micOn;
```

5. Trong effect lắng nghe socket:
   - thay `handleCallAccepted` bằng:

```ts
    const handleCallAccepted = ({
      callId: eventCallId,
    }: { callId?: string } = {}) => {
      if (!isSameCall(eventCallId)) return;
      handlePeerAccepted();
    };
```

   - xoá `handleIceCandidate` và `handleMediaState`, cùng các dòng `socket.on/off` cho `ICE_CANDIDATE` và `MEDIA_STATE`;
   - trong mảng deps, thay `handleReceiveAnswer, handleReceiveIceCandidate` bằng `handlePeerAccepted`.

6. Xoá hẳn 2 effect: effect "Báo trạng thái camera/micro của mình…" (emit `MEDIA_STATE`) và effect "Theo dõi track video của đối phương…" (`setRemoteCameraByTrack`).

7. `handleAccept`: đổi `if (!callId || !incomingOffer) return;` thành `if (!callId) return;`, và `await acceptCall(callId, incomingOffer, { withCamera });` thành `await acceptCall(callId, { withCamera });`.

8. Nút micro: thay `setIsMuted(toggleMute());` bằng `void toggleMute().then(setIsMuted);`.

9. Sau khi xoá các state ở mục 3, `tsc` sẽ chỉ ra mọi chỗ còn gọi `setRemoteCameraByTrack` / `setRemoteCameraSignaled` / `setRemoteMicOn` (ví dụ reset lúc dọn dẹp): xoá các lời gọi đó — giá trị giờ suy ra từ hook nên tự đúng theo phòng.

10. Mọi nút mà QC Task 8 bấm (`Gọi video`, `Gọi thoại`, `Nhận cuộc gọi video`, `Nhận chỉ âm thanh`, `Từ chối cuộc gọi`, `Tắt micro` / `Bật micro`, `Tắt camera` / `Bật camera`, `Thu nhỏ cuộc gọi`, `Mở lại cuộc gọi`, `Kết thúc cuộc gọi`) phải có `aria-label` đúng chữ đó. Nút nào chưa có thì thêm; không đổi chữ hiển thị.

- [ ] **Step 3: Sửa `IncomingCallManager/index.tsx` (phần 1-1)**

- Trong kiểu state cuộc gọi đến (dòng ~31), xoá `incomingOffer: RTCSessionDescriptionInit;`.
- Trong `handleIncomingCall`: xoá `offer` khỏi tham số destructure và kiểu, xoá dòng `incomingOffer: offer,` trong `setIncomingCall`.
- Chỗ render `<VoiceCallModal … incomingOffer={…} />` (nếu có): xoá prop đó.

- [ ] **Step 4: Typecheck + lint + build**

Chạy: `cd frontend && npx tsc -p tsconfig.app.json --noEmit 2>&1 | grep -vE "GroupCall|useGroupCall|CallProvider" | head -20; npm run lint 2>&1 | tail -5`
Kỳ vọng: không còn lỗi nào ngoài nhóm file gọi nhóm (Task 11). Lint không có lỗi ở `useDirectCall.ts`, `VoiceCallModal`, `IncomingCallManager`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useDirectCall.ts frontend/src/hooks/useWebRTC.ts frontend/src/components/VoiceCallModal/index.tsx frontend/src/components/IncomingCallManager/index.tsx
git commit -m "feat(web): run 1-1 calls on RealtimeKit behind the same call screen"
```

---

### Task 11: Frontend — gọi nhóm (`useGroupCall`, GroupCallModal, CallProvider, IncomingCallManager)

**Files:**
- Modify (viết lại): `frontend/src/hooks/useGroupCall.ts`
- Modify: `frontend/src/components/GroupCallModal/index.tsx`
- Modify: `frontend/src/contexts/CallProvider.tsx`
- Modify: `frontend/src/components/IncomingCallManager/index.tsx` (phần nhóm)

**Interfaces:**
- Consumes: `useRtkRoom`, `RtkPeer` (Task 9); ack nhóm của Task 7.
- Produces: `useGroupCall({ authToken, callType?, startWithCamera?, onDisconnected? })` trả về:
  - `participants: GroupCallParticipant[]`, với `GroupCallParticipant = RtkPeer`;
  - `isMicEnabled`, `isCameraEnabled`, `connectionState: 'connecting' | 'connected' | 'disconnected' | 'error'`, `connectedAt`;
  - `toggleMic`, `toggleCamera`, `switchCamera`, `leave`;
  - `needsAudioUnlock`, `unlockAudio`.

- [ ] **Step 1: Viết lại `frontend/src/hooks/useGroupCall.ts`**

```ts
import { useCallback, useEffect, useState } from "react";
import { type RtkPeer, useRtkRoom } from "@/hooks/useRtkRoom";

/** Một người trong cuộc gọi nhóm; `identity` = userId, videoTrack là MediaStreamTrack. */
export type GroupCallParticipant = RtkPeer;

export type GroupCallConnectionState =
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

interface UseGroupCallOptions {
  /** authToken RealtimeKit lấy từ ack group_call.start / group_call.accept. */
  authToken: string;
  callType?: "audio" | "video";
  /** Cuộc gọi video có bật camera khi vào không ("Tham gia chỉ âm thanh" = false). */
  startWithCamera?: boolean;
  /** Rớt khỏi phòng giữa cuộc gọi — modal đóng lại. */
  onDisconnected?: () => void;
}

/**
 * Một phiên gọi nhóm trên Cloudflare RealtimeKit. Giữ nguyên hình dạng trả về
 * của bản LiveKit trước đây để GroupCallModal không phải đổi bố cục.
 */
export function useGroupCall({
  authToken,
  callType = "audio",
  startWithCamera = true,
  onDisconnected,
}: UseGroupCallOptions) {
  const room = useRtkRoom({
    authToken,
    audio: true,
    video: callType === "video" && startWithCamera,
    onDisconnected,
  });
  const [connectedAt, setConnectedAt] = useState<number | null>(null);

  useEffect(() => {
    if (room.state === "connected") setConnectedAt((prev) => prev ?? Date.now());
  }, [room.state]);

  const connectionState: GroupCallConnectionState =
    room.state === "connected"
      ? "connected"
      : room.state === "failed"
        ? "error"
        : room.state === "left"
          ? "disconnected"
          : "connecting";

  const { toggleMic: rtkToggleMic, toggleCamera: rtkToggleCamera, leave: rtkLeave } = room;
  const toggleMic = useCallback(async () => {
    await rtkToggleMic();
  }, [rtkToggleMic]);
  const toggleCamera = useCallback(async () => {
    await rtkToggleCamera();
  }, [rtkToggleCamera]);
  const leave = useCallback(() => {
    void rtkLeave();
  }, [rtkLeave]);

  return {
    participants: room.peers,
    isMicEnabled: room.micOn,
    isCameraEnabled: room.cameraOn,
    connectionState,
    connectedAt,
    toggleMic,
    toggleCamera,
    switchCamera: room.switchCamera,
    leave,
    needsAudioUnlock: room.needsAudioUnlock,
    unlockAudio: room.unlockAudio,
  };
}
```

- [ ] **Step 2: Sửa `GroupCallModal/index.tsx`**

1. Props `GroupCallModalProps`:
   - xoá `url`, `token`, `iceServers` (và doc comment của chúng);
   - thêm `/** authToken RealtimeKit (ack.authToken). */ authToken: string;`;
   - cập nhật phần destructure cho khớp;
   - lời gọi hook thành `useGroupCall({ authToken, callType, startWithCamera, onDisconnected: … })` (giữ nguyên callback hiện có).
2. Trong `GroupCallVideoTile`, thay effect gắn track bằng:

```ts
  // Gắn track vào thẻ <video>. PHẢI phụ thuộc cả `showVideo`: tắt camera thì thẻ
  // <video> bị gỡ (hiện avatar), bật lại thì thẻ MỚI được tạo — cùng một track vẫn
  // phải được gắn lại vào đúng thẻ mới (lỗi đã sửa ở PR #30, giữ nguyên nguyên tắc).
  useEffect(() => {
    const element = videoRef.current;
    if (!element || !track || !showVideo) return;
    element.srcObject = new MediaStream([track]);
    void element.play().catch(() => undefined);
    return () => {
      element.srcObject = null;
    };
  }, [track, showVideo]);
```

   Sửa doc comment phía trên `GroupCallVideoTile`: bỏ nhắc tới adaptiveStream của LiveKit, ghi "gắn MediaStreamTrack của RealtimeKit vào thẻ `<video>`".
3. Lấy thêm `needsAudioUnlock`, `unlockAudio` từ hook. Hiện một nút khi trình duyệt chặn phát âm thanh, đặt ngay dưới dòng trạng thái của modal đầy đủ:

```tsx
        {needsAudioUnlock && (
          <Button size="sm" variant="secondary" onClick={unlockAudio} aria-label="Bật âm thanh">
            Bật âm thanh
          </Button>
        )}
```

4. Các nút QC bấm (`Gọi video nhóm` / `Gọi nhóm` ở header thuộc ChatWindow; trong modal: `Ghim …` / `Bỏ ghim`, `Tắt micro` / `Bật micro`, `Tắt camera` / `Bật camera`, `Rời cuộc gọi`) phải có `aria-label` bắt đầu bằng đúng chữ đó. Thiếu thì thêm; không đổi chữ hiển thị.

- [ ] **Step 3: Sửa `CallProvider.tsx`**

- Kiểu state `groupCall` (dòng ~37–41): thay `url: string; token: string;` và `iceServers?: RTCIceServer[];` bằng `authToken: string;`.
- Kiểu ack (dòng ~49–57): thay bằng:

```ts
type GroupCallAck =
  | {
      ok: true;
      callId?: string;
      roomName?: string;
      callType?: CallType;
      authToken: string;
    }
  | { ok: false; code?: string };
```

  Dùng `GroupCallAck` cho cả ack `START` lẫn `ACCEPT`; xoá các kiểu ack cũ trùng lặp.
- Lời gọi `socket.emit(SOCKET_EVENTS.GROUP_CALL.START, { conversationId, callType }, …)`: thêm `v: 2` vào payload.
- Lời gọi `socket.emit(SOCKET_EVENTS.GROUP_CALL.ACCEPT, { callId }, …)`: payload thành `{ v: 2, callId }`.
- Ở 2 chỗ `setGroupCall({ … url: ack.url, token: ack.token, … iceServers: ack.iceServers })`: thay bằng `authToken: ack.authToken`.
- Chỗ render `<GroupCallModal url={…} token={…} iceServers={…} …>`: thay bằng `authToken={groupCall.authToken}`.

- [ ] **Step 4: Sửa `IncomingCallManager/index.tsx` (phần nhóm)**

- Kiểu state nhóm đã chấp nhận (dòng ~49–58) và kiểu ack (dòng ~60–69): thay `url`, `token`, `iceServers` bằng `authToken: string` (kiểu ack giống `GroupCallAck` ở Step 3).
- `socket.emit(SOCKET_EVENTS.GROUP_CALL.ACCEPT, { callId }, …)` thành `{ v: 2, callId }`.
- `setAcceptedGroupCall({ … url: ack.url, token: ack.token, … iceServers: ack.iceServers })` thành `authToken: ack.authToken`.
- Render `<GroupCallModal …>` truyền `authToken={…}` thay 3 prop cũ.

- [ ] **Step 5: Typecheck, lint, build toàn frontend**

Chạy:

```bash
cd frontend && npx tsc -p tsconfig.app.json --noEmit && npm run lint && npm run build 2>&1 | tail -15
grep -rn "livekit\|iceServers\|incomingOffer\|MEDIA_STATE\|ICE_CANDIDATE" src
```

Kỳ vọng:
- tsc sạch, lint sạch, build thành công;
- output build có chunk **riêng** cho `@cloudflare/realtimekit`, và chunk này không nằm trong `index-*.js` chính (xác nhận lazy load);
- `grep` không còn kết quả.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/hooks/useGroupCall.ts frontend/src/components/GroupCallModal/index.tsx frontend/src/contexts/CallProvider.tsx frontend/src/components/IncomingCallManager/index.tsx
git commit -m "feat(web): run group calls on RealtimeKit and drop livekit-client"
```

---

### Task 12: QC dev xanh toàn bộ, kiểm các giả định phía client, tài liệu

**Files:**
- Modify: `qc/calls-browser.mjs` (các bổ sung ở Step 2 dưới đây)
- Modify: `deploy/README.md`, `backend/.env.production.example`
- Modify: `docs/superpowers/specs/2026-09-27-realtimekit-calls-design.md` (§11.2 kết quả client)

**Interfaces:**
- Consumes: toàn bộ Task 2–11; stack dev cùng tunnel webhook.
- Produces: bằng chứng QC dev xanh, dùng làm điều kiện để merge.

- [ ] **Step 1: Chạy QC dev đầy đủ**

```bash
cd backend && docker compose up -d realtime-gateway && npm run rtk:dev-tunnel
cd ../frontend && npm run dev -- --port 5174 &   # nếu Vite chưa chạy
cd ../qc && node calls-browser.mjs 2>&1 | tee /tmp/qc-calls-dev.txt | tail -60
```

Kỳ vọng: `TỔNG: N pass / 0 fail`.

Mục nào đỏ thì dùng superpowers:systematic-debugging:
- xem ảnh chụp trong `qc/shots/`;
- xem log gateway: `docker logs daln-realtime --since 5m | grep -i rtk`;
- log webhook tới: tạm thêm `this.logger.log(raw)` trong controller, rồi gỡ sau khi xong.

Sửa đúng gốc lỗi rồi chạy lại. **Kiểm cụ thể tên trường webhook thật**: log một body `participantJoined` và đối chiếu với `parseRtkEvent`. Nếu Cloudflare dùng tên trường khác `event` / `meeting.id` / `participant.customParticipantId`, sửa `parseRtkEvent` và test của nó (Task 3) theo body thật, rồi ghi `Ruling:`.

- [ ] **Step 2: Bổ sung QC cho các mục chưa phủ ở Task 8**

Thêm hàm `extra` dưới đây vào `calls-browser.mjs` và gọi nó trong `main`, sau `group(...)`: `if (!ONLY || ONLY === 'extra') await extra({ A, B, C, fx })`.

```js
async function extra({ A, B, C, fx }) {
  console.log('\n== Bổ sung ==')

  // §7.11 bận: B đang trong cuộc gọi với A, C gọi B -> báo bận
  await openConversation(A.page, fx.directId)
  await press(A.page, 'Gọi thoại')
  await until(() => hasText(B.page, 'Cuộc gọi đến'))
  await press(B.page, 'Chấp nhận cuộc gọi')
  await until(() => audioFlowing(A.page))
  // B đang trong cuộc gọi 1-1 với A. C mở cuộc gọi nhóm có B; B bấm tham gia
  // thì gateway trả BUSY cho group_call.accept.
  await openConversation(C.page, fx.groupId)
  await press(C.page, 'Gọi nhóm')
  check(await until(() => hasText(B.page, 'đang mời bạn vào cuộc gọi'), 8000), '[§7.11] người đang trong cuộc gọi 1-1 vẫn thấy lời mời nhóm')
  await press(B.page, 'Tham gia chỉ âm thanh').catch(() => {})
  check(await until(() => hasText(B.page, 'Bạn đang trong một cuộc gọi khác')), '[§7.11] tham gia khi đang bận -> báo bận')
  await press(A.page, 'Kết thúc cuộc gọi')
  // C đang đứng một mình trong phòng nhóm: rời để phòng kết thúc (15 giây sau).
  await press(C.page, 'Rời cuộc gọi')
  await sleep(1500)

  // §7.12 nhiều tab: B mở tab thứ hai; nhận ở tab 1 thì tab 2 ngừng đổ chuông
  const B2 = await B.browser.newPage()
  await B2.goto(APP, { waitUntil: 'networkidle2' })
  await openConversation(A.page, fx.directId)
  await press(A.page, 'Gọi thoại')
  check(await until(() => hasText(B2, 'Cuộc gọi đến')), '[§7.12] tab 2 cũng đổ chuông')
  await press(B.page, 'Chấp nhận cuộc gọi')
  check(await until(async () => !(await hasText(B2, 'Cuộc gọi đến'))), '[§7.12] tab 2 ngừng đổ chuông sau khi tab 1 nhận')
  await press(A.page, 'Kết thúc cuộc gọi')
  await B2.close()

  // §7.27 cuộc gọi thoại: bật camera không phát được video sang bên kia
  await openConversation(A.page, fx.directId)
  await press(A.page, 'Gọi thoại')
  await until(() => hasText(B.page, 'Cuộc gọi đến'))
  await press(B.page, 'Chấp nhận cuộc gọi')
  await until(() => audioFlowing(A.page))
  const camButton = await A.page.$('::-p-aria(Bật camera)')
  if (camButton) await camButton.click()
  await sleep(3000)
  check(
    !(await B.page.evaluate(() => [...document.querySelectorAll('video')].some((v) => v.srcObject && v.videoWidth > 0))),
    '[§7.27] cuộc gọi thoại: bên kia không nhận được video',
  )
  await press(A.page, 'Kết thúc cuộc gọi')

  // §7.28 client cũ: gửi payload kiểu cũ qua socket.io (Node, mang cookie của A)
  // -> CLIENT_OUTDATED. socket.io-client lấy từ node_modules của frontend.
  const { createRequire } = await import('node:module')
  const { io } = createRequire(new URL('../frontend/package.json', import.meta.url))('socket.io-client')
  const socketBase = API.replace(/\/api$/, '')
  const code = await new Promise((resolve) => {
    const s = io(`${socketBase}/realtime`, {
      path: '/socket.io',
      transports: ['websocket'],
      extraHeaders: { cookie: fx.a.cookie },
    })
    const timer = setTimeout(() => { s.close(); resolve('timeout') }, 8000)
    s.on('connect', () =>
      s.emit('call.incoming_call', { conversationId: fx.directId, offer: { sdp: 'x' } }, (ack) => {
        clearTimeout(timer)
        s.close()
        resolve(ack?.code)
      }),
    )
  })
  check(code === 'CLIENT_OUTDATED', '[§7.28] payload kiểu cũ -> CLIENT_OUTDATED', `nhận ${code}`)
  // §7.30 (token cũ không vào lại được) kiểm ở Step 3 bằng SDK, không nằm ở đây.
}
```

Hai mục được để ngỏ có chủ đích:
- **§7.25 (35 giây không ai tham gia):** đã được unit test gateway phủ. Mục bận ở trên cũng tự nhiên chờ phòng tự huỷ.
- **§7.30 (token cũ không vào lại được):** kiểm ở Step 3.

- [ ] **Step 3: Kiểm các giả định phía client (spec §11.3, 5, 6) và mục §7.30**

Trong Chrome (thủ công hoặc qua Puppeteer), mở một cuộc gọi dev, rồi dùng DevTools console của trang:
- Giả định **5** và **6** (spec §11): lấy trực tiếp từ Step 1–2. `§7.27` đỏ nghĩa là giả định 5 sai. Nhận cuộc gọi bằng thoại rồi bật camera được (§7.3 cộng thao tác bật camera) nghĩa là giả định 6 đúng.
- Giả định **3** và mục **§7.30**: trong lúc cuộc gọi đang chạy, ghi lại `authToken` của B (đặt breakpoint ở `setAuthToken` hoặc log tạm trong `useDirectCall`, rồi **gỡ log sau khi xong**). Kết thúc cuộc gọi, sau đó dùng Node:

```js
// $SCRATCH/rtk-rejoin.mjs — node rtk-rejoin.mjs <token>  (chạy trong frontend/ để resolve package)
import RTK from '@cloudflare/realtimekit'
try {
  const c = await RTK.init({ authToken: process.argv[2], defaults: { audio: false, video: false } })
  await c.join()
  console.log('JOINED — token cũ vẫn dùng được: LỖI')
} catch (e) {
  console.log('bị từ chối như mong đợi:', e?.message ?? e)
}
```

Nếu SDK không chạy được trong Node, làm tương tự trong console trình duyệt: `(await import('/node_modules/.vite/deps/@cloudflare_realtimekit.js')).default.init({authToken:'…'})`.

Ghi kết quả vào spec thành mục §11.2:

```markdown
### 11.2 Kết quả kiểm phía client (dev)

| Giả định | Kết quả | Ghi chú |
|---|---|---|
| 3. Xoá participant đá khỏi phiên / token cũ bị từ chối | <điền> | |
| 5. Preset cấm video: enableVideo bị chặn | <điền> | |
| 6. defaults.video=false rồi enableVideo giữa cuộc gọi | <điền> | |
| Tên trường webhook thật | <điền> | |
```

Nếu giả định 3 sai (token cũ vẫn vào được) thì đó là lỗi bảo mật. **Dừng lại, báo người dùng** trước khi merge.

- [ ] **Step 4: Tài liệu**

`backend/.env.production.example`: thêm khối sau, ngay trước khối LiveKit hiện có:

```bash
# ── Cuộc gọi: Cloudflare RealtimeKit ────────────────────────────────────────
# App "daln-prod" trong dashboard Cloudflare → Realtime → Kit. Token cần quyền
# Account · Realtime · Admin. Preset + webhook tạo bằng `npm run rtk:setup`
# (deploy/README.md, mục RealtimeKit). Thiếu một biến thì mọi cuộc gọi trả
# MEDIA_UNCONFIGURED.
REALTIMEKIT_ACCOUNT_ID=
REALTIMEKIT_APP_ID=
REALTIMEKIT_API_TOKEN=
```

Đổi comment đầu khối TURN và khối LiveKit thành: `# KHÔNG CÒN ĐƯỢC CODE DÙNG từ khi chuyển sang RealtimeKit — giữ tới PR dọn hạ tầng.`

`deploy/README.md`: thêm mục mới **trước** mục "TURN (coturn)":

```markdown
## RealtimeKit — cuộc gọi thoại/video

Mọi cuộc gọi (1-1 và nhóm) chạy trên Cloudflare RealtimeKit; server chỉ cấp
quyền vào phòng qua REST API và nhận webhook. Coturn và LiveKit bên dưới **không
còn được code dùng** (giữ tới PR dọn hạ tầng).

- Env trên server (`.env.production`): `REALTIMEKIT_ACCOUNT_ID`, `REALTIMEKIT_APP_ID`
  (app `daln-prod`), `REALTIMEKIT_API_TOKEN` (quyền Realtime Admin).
- Preset (`daln_direct_audio|video`, `daln_group_audio|video`) và webhook tạo/cập nhật
  bằng script, chạy từ máy dev, token prod stream qua SSH (không ghi ra máy):

  ```bash
  ssh root@<server> "grep '^REALTIMEKIT_' /root/workspace/DALN/backend/.env.production" \
    | (cd backend && npm run rtk:setup -- --env-stdin --webhook-url https://nguyen1976.xyz/api/realtime/rtk-webhook)
  ```

- Webhook đi vào `https://nguyen1976.xyz/api/realtime/rtk-webhook` (nginx → Kong
  `/realtime` → gateway), xác thực chữ ký RSA. Nếu sau này bật Bot Fight Mode / WAF
  trên Cloudflare, **bỏ qua đường dẫn này**, nếu không danh sách người trong cuộc
  gọi nhóm sẽ không cập nhật.
- Dev: `npm run rtk:dev-tunnel` (backend) mở tunnel tạm và trỏ webhook của app
  `daln-dev` vào gateway dev. URL đổi mỗi lần tunnel khởi động lại.
- QC: `qc/calls-browser.mjs` (xem qc/README.md).
```

- [ ] **Step 5: Toàn bộ kiểm tra cuối trên dev**

Chạy: `cd backend && npm run typecheck && npm test -- --ci 2>&1 | tail -6; cd ../frontend && npm run lint && npm run build >/dev/null && echo FE-OK; cd ../qc && node calls-browser.mjs 2>&1 | tail -3`
Kỳ vọng: typecheck xanh; Jest toàn bộ PASS; `FE-OK`; `TỔNG: N pass / 0 fail`.

Chạy lại các bộ QC hiện có để chắc không hỏng thứ khác: `cd qc && bash auth-api.sh | tail -2 && node auth-browser.mjs | tail -2 && node session-location-browser.mjs | tail -2`
Kỳ vọng: 0 fail ở cả 3 bộ.

- [ ] **Step 6: Commit**

```bash
git add qc/calls-browser.mjs deploy/README.md backend/.env.production.example docs/superpowers/specs/2026-09-27-realtimekit-calls-design.md
git commit -m "docs: document RealtimeKit calls and record the client-side checks"
```

---

### Task 13: Đưa lên prod và nghiệm thu

Task này có thao tác ra ngoài và có rủi ro: tạo dữ liệu trên prod, merge vào `main`. Mỗi chỗ **hỏi người dùng** là điểm dừng bắt buộc.

**Files:**
- Create (gitignore, không commit): `qc/.env.prod.json`
- Modify: `qc/.gitignore` hoặc `.gitignore` gốc (thêm `qc/.env*`, nếu chưa có)

**Interfaces:**
- Consumes: branch `feature/realtimekit-calls` đã xanh ở Task 12.
- Produces: PR vào `main`, deploy, QC prod xanh, người dùng tự gọi thử.

- [ ] **Step 1: Tạo preset trên app prod (chưa có webhook)**

```bash
ssh -o BatchMode=yes root@109.199.115.126 "grep '^REALTIMEKIT_' /root/workspace/DALN/backend/.env.production" \
  | (cd backend && npm run rtk:setup -- --env-stdin)
```

Kỳ vọng: 4 dòng `preset daln_…: tạo mới`.

- [ ] **Step 2: Hỏi người dùng về tài khoản QA prod**

Đây là điểm dừng. Hỏi đúng câu: "Tạo 3 tài khoản QA trên prod bằng luồng đăng ký thật. Mã OTP em đặt trực tiếp vào Redis prod (giống cách QC dev làm, vẫn đi qua bước xác minh thật), email dạng `trungdungvu172+daln-qa1@gmail.com`. Anh/chị đồng ý không?" Có đồng ý thì mới làm Step 3.

- [ ] **Step 3: Tạo tài khoản QA prod và file cấu hình QC**

- Chạy dựng dữ liệu một lần với `API=https://nguyen1976.xyz/api`. `calls-fixtures.mjs` cần sửa tạm `register` để đặt OTP qua SSH vào Redis prod: `ssh root@… docker exec daln-prod-redis redis-cli -a $REDIS_PASSWORD set otp:reg:<email> <hash> EX 300`.
- Ghi `{accounts:[…], directId, groupId, groupName}` vào `qc/.env.prod.json`. Đảm bảo `qc/.env*` đã có trong gitignore; `git status` không được hiện file này.
- Thay đổi tạm trong `calls-fixtures.mjs` **không** commit.

- [ ] **Step 4: Rà soát toàn nhánh trước khi mở PR**

Làm theo final review của skill thực thi: dựng review package, cho một reviewer độc lập đọc với model mạnh nhất, sửa các phát hiện mức Critical/Important bằng TDD, ghi các phát hiện Minor vào ledger.

- [ ] **Step 5: PR vào main, CI, merge, deploy**

```bash
git push -u origin feature/realtimekit-calls
git checkout develop && git merge --ff-only feature/realtimekit-calls && git push origin develop
gh pr create --base main --head develop --title "feat: move voice/video calls to Cloudflare RealtimeKit" --body "<tóm tắt thay đổi, số test, QC dev N/N, ghi chú PR 2 dọn hạ tầng>

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- Chờ CI xanh (`gh pr checks <n> --watch`), rồi `gh pr merge <n> --merge`.
- Theo dõi lượt chạy trên `main` tới khi xong.
- Log deploy phải cho thấy các container backend được tạo lại, vì `package-lock` và code đều đổi.

- [ ] **Step 6: Gắn webhook prod và kiểm webhook tới được server**

```bash
ssh -o BatchMode=yes root@109.199.115.126 "grep '^REALTIMEKIT_' /root/workspace/DALN/backend/.env.production" \
  | (cd backend && npm run rtk:setup -- --env-stdin --webhook-url https://nguyen1976.xyz/api/realtime/rtk-webhook)
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://nguyen1976.xyz/api/realtime/rtk-webhook -d '{}'
```

Kỳ vọng: dòng `webhook daln -> …`, và `curl` trả **401** (chữ ký sai). 401 chứng minh đường vào tới được gateway qua Cloudflare, nginx và Kong. Nếu trả 404 hoặc 403: kiểm Kong route `/realtime` và WAF của Cloudflare.

- [ ] **Step 7: QC prod**

Chạy: `cd qc && APP=https://nguyen1976.xyz API=https://nguyen1976.xyz/api QC_ACCOUNTS_FILE=.env.prod.json node calls-browser.mjs 2>&1 | tail -40`
Kỳ vọng: `TỔNG: N pass / 0 fail`. Riêng mục §7.28 dùng socket trực tiếp; nếu URL socket prod khác thì chỉnh cho đúng base `https://nguyen1976.xyz`, path `/socket.io`.

Mục nào đỏ trên prod mà trên dev xanh: điều tra bằng systematic-debugging. Nếu người dùng thật đang bị ảnh hưởng thì **rollback**: chạy "Run workflow" với SHA `main` trước PR, rồi báo người dùng.

- [ ] **Step 8: Người dùng gọi thử thật, rồi ghi memory**

Nhờ người dùng gọi 1-1 và gọi nhóm từ điện thoại, qua 4G và wifi.
Cập nhật memory `project-deferred-work.md`:
- cuộc gọi đã chạy trên RealtimeKit;
- PR 2 dọn hạ tầng đang chờ người dùng xác nhận;
- các lệnh `rtk:setup`, `rtk:dev-tunnel`.
```
