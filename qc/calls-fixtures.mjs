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
