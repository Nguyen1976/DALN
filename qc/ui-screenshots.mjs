/**
 * Chụp lại toàn bộ docs/ui-screenshots bằng dữ liệu giả — KHÔNG cần backend.
 *
 *   cd frontend && npm run dev     # cổng 5174
 *   node qc/ui-screenshots.mjs                 # mọi màn, sáng + tối
 *   ONLY=10,18 THEMES=light node qc/ui-screenshots.mjs   # chụp thử vài màn
 *
 * HTTP tới API bị chặn ngay trong trình duyệt và trả từ `route()` bên dưới;
 * WebSocket của Socket.IO được thay bằng bản giả chỉ biết bắt tay, nên app thấy
 * mình đang online. Giờ trong trang bị đóng băng ở một mốc cố định để ảnh giống
 * nhau giữa các lần chạy.
 *
 * Script thoát với mã 1 nếu một màn gọi API chưa giả lập, nổ lỗi trang, hoặc
 * hiện toast lỗi: ảnh chụp lỗi không được lọt vào docs.
 * Ghi đè bằng biến môi trường: APP, API, CHROME_PATH, OUT, ONLY, THEMES.
 */
import puppeteer from 'puppeteer-core'
import { mkdirSync, writeFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const APP = process.env.APP ?? 'http://localhost:5174'
const API = process.env.API ?? 'http://localhost:8080'
const OUT = process.env.OUT ?? join(HERE, '../docs/ui-screenshots')
const CHROME =
  process.env.CHROME_PATH ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const THEMES = (process.env.THEMES ?? 'light,dark').split(',')
const ONLY = process.env.ONLY?.split(',')

/* ---------------------------------- Thời gian ---------------------------------- */

// Thứ Sáu 6/11/2026, 17:10 giờ Việt Nam: mốc "bây giờ" của mọi ảnh.
const NOW = Date.parse('2026-11-06T17:10:00+07:00')
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const ago = (ms) => new Date(NOW - ms).toISOString()

/* ---------------------------------- Người dùng --------------------------------- */

// Form đăng ký dùng `username` làm tên hiển thị, nên ở đây nó là tên có dấu.
const person = (id, fullName, slug, online, lastSeenMs, bio = '') => ({
  id,
  fullName,
  username: fullName,
  email: `${slug}@daln.chat`,
  avatar: '',
  bio,
  status: online,
  lastSeen: online ? null : ago(lastSeenMs),
})

const me = {
  id: 'u-me',
  email: 'minhanh@daln.chat',
  username: 'Minh Anh',
  fullName: 'Minh Anh',
  avatar: '',
  bio: 'Sinh viên năm cuối, đang làm đồ án tốt nghiệp về hệ thống nhắn tin.',
  interests: ['lap-trinh', 'am-nhac', 'du-lich'],
  hasCompletedInterestOnboarding: true,
}

const thuha = person('u-thuha', 'Thu Hà', 'thuha', true, 0, 'Thích cà phê và thiết kế giao diện.')
const bao = person('u-bao', 'Quốc Bảo', 'quocbao', true, 0, 'Backend developer. Cuối tuần đá bóng.')
const lanchi = person('u-lanchi', 'Lan Chi', 'lanchi', false, 16 * MIN)
const duy = person('u-duy', 'Đức Duy', 'ducduy', false, 3 * HOUR)
const mai = person('u-mai', 'Ngọc Mai', 'ngocmai', false, DAY)
const friends = [thuha, bao, lanchi, duy, mai]

const memberOf = (p, role = 'MEMBER', lastReadSeq = null) => ({
  userId: p.id,
  role,
  lastReadSeq,
  username: p.username,
  fullName: p.fullName,
  avatar: p.avatar,
})

const senderOf = (p) => ({
  userId: p.id,
  username: p.username,
  fullName: p.fullName,
  avatar: p.avatar,
})

/* ---------------------------------- Tin nhắn ---------------------------------- */

const buildThread = (conversationId, rows) =>
  rows.map(([sender, atMs, content, extra = {}], index) => ({
    id: `${conversationId}-m${index + 1}`,
    conversationId,
    senderId: sender.id,
    seq: index + 1,
    content,
    type: 'TEXT',
    createdAt: ago(atMs),
    senderMember: senderOf(sender),
    status: 'sent',
    ...extra,
  }))

const threads = {
  'c-thuha': buildThread('c-thuha', [
    [thuha, 41 * MIN, 'Chào Minh Anh, đồ án tới đâu rồi bạn?'],
    [me, 40 * MIN, 'Mình vừa xong phần realtime, còn màn hình gợi ý bạn bè nữa thôi.'],
    [thuha, 38 * MIN, 'Ngon quá 😄 Chiều nay mình rảnh, gọi cho bạn xem qua nhé?'],
    [me, 37 * MIN, 'Ok luôn, khoảng 3 giờ mình gọi nha.'],
    [thuha, 35 * MIN, 'Chốt vậy đi!'],
  ]),
  'c-group': buildThread('c-group', [
    [me, 70 * MIN, 'Cả nhà ơi, mai 9h họp nhóm ở thư viện nhé.'],
    [thuha, 68 * MIN, 'Mình ok.'],
    [bao, 66 * MIN, 'Mình tới hơi trễ chút, khoảng 9h15.'],
    [lanchi, 65 * MIN, 'Mình mang theo bản in báo cáo.'],
    [me, 64 * MIN, 'Tuyệt vời, hẹn gặp mọi người.'],
    [me, 8 * MIN, 'Buổi họp nhóm tuần này nên vào thứ mấy?', {
      type: 'POLL',
      poll: {
        id: 'poll-1',
        question: 'Buổi họp nhóm tuần này nên vào thứ mấy?',
        isMultipleChoice: false,
        isClosed: false,
        closedAt: null,
        totalVoters: 4,
        myOptionIds: ['opt-1'],
        options: [
          { id: 'opt-1', text: 'Thứ ba, 9h', count: 2 },
          { id: 'opt-2', text: 'Thứ năm, 14h', count: 1 },
          { id: 'opt-3', text: 'Thứ bảy, 10h', count: 1 },
        ],
      },
    }],
  ]),
  'c-lanchi': buildThread('c-lanchi', [
    [lanchi, 3 * HOUR, 'Bạn gửi mình file báo cáo được không?'],
    [me, 2 * HOUR + 50 * MIN, 'Mình gửi trong nhóm luôn cho tiện nhé.'],
  ]),
  'c-bao': buildThread('c-bao', [
    [bao, 25 * MIN, 'Đính chính: mai họp nhóm lúc 9h15 nhé.'],
    [bao, 24 * MIN, 'Bạn nhớ mang sạc nữa.'],
  ]),
  'c-duy': [],
  'c-mai': [],
}

/* ---------------------------------- Hội thoại ---------------------------------- */

const conversationRow = (id, type, name, peer, unreadCount, extra = {}) => {
  const last = threads[id].at(-1)
  return {
    id,
    type,
    groupName: type === 'GROUP' ? name : null,
    groupAvatar: null,
    displayName: name,
    displayAvatar: '',
    unreadCount,
    unreadMentionCount: 0,
    lastMentionMessageId: null,
    membershipStatus: 'ACTIVE',
    canSendMessage: true,
    memberCount: type === 'GROUP' ? 4 : 2,
    peerUserId: peer?.id ?? null,
    createdAt: ago(30 * DAY),
    updatedAt: last?.createdAt ?? ago(2 * DAY),
    lastMessageId: last?.id ?? null,
    lastMessageSeq: last?.seq ?? null,
    lastMessageAt: last?.createdAt ?? null,
    lastMessageText: last?.content ?? '',
    lastMessageSenderId: last?.senderId ?? null,
    lastMessageSenderName: last?.senderMember.fullName ?? null,
    lastMessageSenderAvatar: null,
    ...extra,
  }
}

const conversations = [
  conversationRow('c-group', 'GROUP', 'Nhóm Đồ án tốt nghiệp', null, 3),
  conversationRow('c-bao', 'DIRECT', bao.fullName, bao, 2),
  conversationRow('c-thuha', 'DIRECT', thuha.fullName, thuha, 0),
  conversationRow('c-lanchi', 'DIRECT', lanchi.fullName, lanchi, 0),
  conversationRow('c-duy', 'DIRECT', duy.fullName, duy, 0),
  conversationRow('c-mai', 'DIRECT', mai.fullName, mai, 0),
]

const membersByConversation = {
  'c-group': [
    memberOf(me, 'OWNER', 6),
    memberOf(thuha, 'ADMIN', 6),
    memberOf(bao, 'MEMBER', 5),
    memberOf(lanchi, 'MEMBER', 4),
  ],
  'c-thuha': [memberOf(me, 'MEMBER', 5), memberOf(thuha, 'MEMBER', 5)],
  'c-bao': [memberOf(me, 'MEMBER', 0), memberOf(bao, 'MEMBER', 2)],
  'c-lanchi': [memberOf(me, 'MEMBER', 2), memberOf(lanchi, 'MEMBER', 2)],
  'c-duy': [memberOf(me), memberOf(duy)],
  'c-mai': [memberOf(me), memberOf(mai)],
}

const conversationDetail = (id) => ({
  ...conversations.find((c) => c.id === id),
  members: membersByConversation[id],
})

/* ---------------------------------- Dữ liệu khác --------------------------------- */

const lam = { id: 'u-lam', email: 'tunglam@daln.chat', username: 'Tùng Lâm', fullName: 'Tùng Lâm', avatar: '' }
const huong = { id: 'u-huong', email: 'thuhuong@daln.chat', username: 'Thu Hương', fullName: 'Thu Hương', avatar: '' }
const khoa = { id: 'u-khoa', email: 'anhkhoa@daln.chat', username: 'Anh Khoa', fullName: 'Anh Khoa', avatar: '' }

const requestRow = (id, counterpart, atMs) => ({
  id,
  status: 'PENDING',
  createdAt: ago(atMs),
  updatedAt: ago(atMs),
  counterpart,
})

const receivedRequests = [requestRow('fr-1', lam, 2 * HOUR), requestRow('fr-2', huong, DAY)]
const sentRequests = [requestRow('fr-3', khoa, 2 * DAY)]

const preview = (p) => ({ userId: p.id, username: p.username, fullName: p.fullName, avatar: p.avatar })
const suggestion = (id, fullName, count, mutual) => ({
  userId: id,
  username: fullName,
  fullName,
  avatar: null,
  mutualFriends: { count, preview: mutual.map(preview) },
})

const recommendations = [
  suggestion('u-s1', 'Hoàng Nam', 4, [thuha, bao]),
  suggestion('u-s2', 'Phương Linh', 3, [lanchi, thuha]),
  suggestion('u-s3', 'Gia Huy', 2, [bao, duy]),
  suggestion('u-s4', 'Khánh Vy', 1, [mai]),
  suggestion('u-s5', 'Trọng Tín', 0, []),
]

const notification = (id, type, message, atMs, isRead, friendRequestId) => ({
  id,
  userId: me.id,
  type,
  message,
  isRead,
  friendRequestId,
  createdAt: ago(atMs),
})

const notifications = [
  notification('n-1', 'FRIEND_REQUEST_SENT', 'Tùng Lâm đã gửi cho bạn lời mời kết bạn', 2 * HOUR, false, 'fr-1'),
  notification('n-2', 'MENTIONED_IN_CONVERSATION', 'Thu Hà đã nhắc đến bạn trong Nhóm Đồ án tốt nghiệp', 3 * HOUR, false),
  notification('n-3', 'FRIEND_REQUEST_SENT', 'Thu Hương đã gửi cho bạn lời mời kết bạn', DAY, false, 'fr-2'),
  notification('n-4', 'FRIEND_REQUEST_ACCEPTED', 'Ngọc Mai đã chấp nhận lời mời kết bạn của bạn', 2 * DAY, true),
  notification('n-5', 'SYSTEM_NOTIFICATION', 'Tài khoản của bạn vừa đăng nhập trên một thiết bị mới', 3 * DAY, true),
]

const allOn = { IN_APP: true, EMAIL: true, REALTIME: true }
const preferences = {
  global: { enabled: true, channels: allOn },
  overrides: {
    FRIEND_REQUEST_SENT: allOn,
    FRIEND_REQUEST_ACCEPTED: { IN_APP: true, EMAIL: false, REALTIME: true },
    FRIEND_REQUEST_REJECTED: { IN_APP: true, EMAIL: false, REALTIME: false },
    MENTIONED_IN_CONVERSATION: allOn,
    SYSTEM_NOTIFICATION: { IN_APP: true, EMAIL: true, REALTIME: false },
  },
  digest: { enabled: true, minUnread: 5, cooldownMinutes: 60, lastDigestAt: null },
  version: 1,
  updatedAt: ago(DAY),
}

const place = (city, latitude, longitude, accuracyRadiusKm = 20) => ({
  city,
  country: 'Việt Nam',
  latitude,
  longitude,
  accuracyRadiusKm,
})
const hanoi = place('Hà Nội', 21.03, 105.85)
const hcm = place('Thành phố Hồ Chí Minh', 10.82, 106.63)

const sessions = [
  {
    sid: 's-1',
    createdAt: NOW - 3 * DAY,
    lastSeenAt: NOW - 2 * MIN,
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    ip: '203.0.113.24',
    lastIp: '203.0.113.24',
    location: hanoi,
    lastLocation: hanoi,
    current: true,
  },
  {
    sid: 's-2',
    createdAt: NOW - 9 * DAY,
    lastSeenAt: NOW - 5 * HOUR,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    ip: '198.51.100.7',
    lastIp: '198.51.100.7',
    location: hcm,
    lastLocation: hcm,
    current: false,
  },
]

const interestTags = [
  ['lap-trinh', 'Lập trình', '💻', 'Công nghệ'],
  ['ai', 'Trí tuệ nhân tạo', '🤖', 'Công nghệ'],
  ['thiet-ke', 'Thiết kế', '🎨', 'Công nghệ'],
  ['am-nhac', 'Âm nhạc', '🎵', 'Giải trí'],
  ['phim', 'Phim ảnh', '🎬', 'Giải trí'],
  ['game', 'Trò chơi', '🎮', 'Giải trí'],
  ['du-lich', 'Du lịch', '✈️', 'Đời sống'],
  ['nau-an', 'Nấu ăn', '🍳', 'Đời sống'],
  ['the-thao', 'Thể thao', '⚽', 'Đời sống'],
  ['doc-sach', 'Đọc sách', '📚', 'Đời sống'],
].map(([slug, label, emoji, category], order) => ({
  id: `tag-${slug}`,
  slug,
  label,
  emoji,
  category,
  order,
}))

/* ------------------------------------ API giả ----------------------------------- */

const pageOf = (items) => ({ items, nextCursor: null })

/** Trả `undefined` nghĩa là chưa giả lập: script sẽ báo lỗi. */
function route(method, path, query, user) {
  const key = `${method} ${path}`
  const keyword = (query.get('keyword') ?? '').toLowerCase()
  switch (key) {
    case 'GET /user/me':
      return user
    case 'GET /user/list-friends':
      return pageOf(friends)
    case 'GET /user/search':
      return friends.filter((f) => f.fullName.toLowerCase().includes(keyword))
    case 'GET /user/list-friend-requests':
      return pageOf(query.get('direction') === 'sent' ? sentRequests : receivedRequests)
    case 'GET /user/detail-friend-request':
      return {
        ...receivedRequests.find((r) => r.id === query.get('friendRequestId')),
        toUserId: me.id,
      }
    case 'GET /user/sessions':
      return sessions
    case 'GET /user/reset-password/validate':
      return { valid: true, maskedEmail: 'm***h@daln.chat' }
    case 'GET /user': {
      const p = friends.find((f) => f.id === query.get('userId')) ?? me
      return { email: p.email, username: p.username, fullName: p.fullName, avatar: p.avatar, bio: p.bio }
    }
    case 'GET /chat/conversations':
      return pageOf(conversations)
    case 'GET /chat/search':
      return conversations.filter((c) => c.displayName.toLowerCase().includes(keyword))
    case 'GET /chat/assets':
      return pageOf([])
    case 'GET /notification':
      return pageOf(notifications)
    case 'GET /notification/unread-count':
      return notifications.filter((n) => !n.isRead).length
    case 'GET /notification/types':
      return Object.keys(preferences.overrides)
    case 'GET /notification/preferences':
      return preferences
    case 'GET /recommendation/me':
      return recommendations
    case 'GET /recommendation/interest-tags':
      return interestTags
    case 'POST /chat/mentions/clear':
    case 'PATCH /notification/read-all':
      return {}
  }
  const conversationId = path.match(/^\/chat\/conversations\/([\w-]+)$/)?.[1]
  if (method === 'GET' && conversationId) return conversationDetail(conversationId)
  const threadId = path.match(/^\/chat\/messages\/([\w-]+)$/)?.[1]
  if (method === 'GET' && threadId) {
    // Trang tin mới nhất trước; lấy bù theo seq không có gì mới.
    if (query.has('afterSeq')) return { items: [], nextCursor: null, hasMore: false }
    return pageOf([...threads[threadId]].reverse())
  }
  return undefined
}

/* -------------------------------- Thiết lập trang -------------------------------- */

const problems = []

/** Chạy trong trang, trước mọi script của app. */
function installPageFakes({ now, theme, persisted }) {
  localStorage.setItem('vite-ui-theme', theme)
  if (persisted) localStorage.setItem('persist:root', persisted)
  else localStorage.removeItem('persist:root')

  // Đóng băng mốc "bây giờ", đồng hồ vẫn chạy tiếp từ đó.
  const RealDate = Date
  const offset = now - RealDate.now()
  // eslint-disable-next-line no-global-assign
  Date = class extends RealDate {
    constructor(...args) {
      if (args.length) super(...args)
      else super(RealDate.now() + offset)
    }
    static now() {
      return RealDate.now() + offset
    }
  }

  // Camera: hình người mờ thay cho mẫu thử xanh chóe của Chrome.
  const realGetUserMedia = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices)
  if (realGetUserMedia) {
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      if (!constraints?.video) return realGetUserMedia(constraints)
      const canvas = document.createElement('canvas')
      canvas.width = 1280
      canvas.height = 720
      const paint = canvas.getContext('2d')
      const draw = () => {
        const sky = paint.createLinearGradient(0, 0, 1280, 720)
        sky.addColorStop(0, '#46566b')
        sky.addColorStop(1, '#27303d')
        paint.fillStyle = sky
        paint.fillRect(0, 0, 1280, 720)
        paint.fillStyle = '#8c9bad'
        paint.beginPath()
        paint.arc(640, 300, 120, 0, Math.PI * 2)
        paint.fill()
        paint.beginPath()
        paint.ellipse(640, 720, 260, 250, 0, 0, Math.PI * 2)
        paint.fill()
      }
      draw()
      setInterval(draw, 200)
      const stream = canvas.captureStream(5)
      if (constraints.audio) {
        const audio = await realGetUserMedia({ audio: constraints.audio })
        audio.getAudioTracks().forEach((track) => stream.addTrack(track))
      }
      return stream
    }
  }

  // Socket.IO: chỉ bắt tay engine.io + namespace; HMR của Vite đi qua WS thật.
  const RealWebSocket = window.WebSocket
  class FakeSocket extends EventTarget {
    static CONNECTING = 0
    static OPEN = 1
    static CLOSING = 2
    static CLOSED = 3
    constructor(url) {
      super()
      this.url = url
      this.readyState = 0
      setTimeout(() => {
        this.readyState = 1
        this.onopen?.({})
        this.receive('0' + JSON.stringify({
          sid: 'mock', upgrades: [], pingInterval: 3_600_000, pingTimeout: 3_600_000, maxPayload: 1e6,
        }))
      }, 0)
    }
    receive(data) {
      this.onmessage?.({ data })
    }
    send(data) {
      if (String(data).startsWith('40/realtime')) {
        setTimeout(() => this.receive('40/realtime,{"sid":"mock-ns"}'), 0)
      }
      // Mọi sự kiện khác không trả lời: cuộc gọi đứng ở trạng thái "đang gọi".
    }
    close() {
      this.readyState = 3
      this.onclose?.({ code: 1000, reason: '' })
    }
  }
  window.WebSocket = new Proxy(RealWebSocket, {
    construct(target, args) {
      return String(args[0]).includes('/socket.io/')
        ? new FakeSocket(args[0])
        : new target(...args)
    },
  })
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function newPage(browser, { theme, viewport, user, scene }) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await page.emulateTimezone('Asia/Ho_Chi_Minh')
  await page.setViewport(viewport)
  await page.emulateMediaFeatures([
    { name: 'prefers-reduced-motion', value: 'reduce' },
    { name: 'prefers-color-scheme', value: theme },
  ])

  const persisted = user
    ? JSON.stringify({
        user: JSON.stringify(user),
        _persist: JSON.stringify({ version: -1, rehydrated: true }),
      })
    : null
  await page.evaluateOnNewDocument(installPageFakes, { now: NOW, theme, persisted })

  await page.setRequestInterception(true)
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.origin !== API) return request.continue()
    const headers = {
      'Access-Control-Allow-Origin': APP,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': 'content-type',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    }
    if (request.method() === 'OPTIONS') return request.respond({ status: 204, headers })
    const body = route(request.method(), url.pathname, url.searchParams, user ?? me)
    if (body === undefined) {
      problems.push(`${scene}: API chưa giả lập: ${request.method()} ${url.pathname}`)
      return request.respond({ status: 404, headers, contentType: 'application/json', body: '{}' })
    }
    return request.respond({
      status: 200,
      headers,
      contentType: 'application/json',
      body: JSON.stringify(body),
    })
  })
  page.on('pageerror', (error) => problems.push(`${scene}: lỗi trang: ${error.message}`))
  return page
}

/* -------------------------------- Thao tác trong màn ------------------------------ */

const clickLabel = async (page, label) => {
  const button = await page.waitForSelector(`[aria-label="${label}"]`, { visible: true, timeout: 8000 })
  await button.click()
  await sleep(350)
}

const clickText = async (page, text, selector = 'button, [role="button"], [role="tab"], a') => {
  const handle = await page.waitForFunction(
    (sel, wanted) =>
      [...document.querySelectorAll(sel)].find(
        (el) => el.offsetParent !== null && el.textContent.trim().includes(wanted),
      ),
    { timeout: 8000 },
    selector,
    text,
  )
  await handle.asElement().click()
  await sleep(350)
}

const typeInto = async (page, selector, text) => {
  const field = await page.waitForSelector(selector, { visible: true, timeout: 8000 })
  await field.type(text)
}

const waitForText = (page, text) =>
  page.waitForFunction((wanted) => document.body.innerText.includes(wanted), { timeout: 8000 }, text)

const openRegister = async (page) => {
  await clickText(page, 'Đăng ký', '[role="tab"], button')
  await typeInto(page, 'input[name="username"]', 'Minh Anh')
  await typeInto(page, 'input[name="email"]', 'minhanh@daln.chat')
  await typeInto(page, 'input[name="password"]', 'Daln@2026chat')
  await typeInto(page, 'input[name="confirmPassword"]', 'Daln@2026chat')
}

const openProfilePanel = (page) => clickLabel(page, 'Thông tin cuộc trò chuyện')

const hoverLastOwnMessage = async (page) => {
  await waitForText(page, 'Ok luôn, khoảng 3 giờ')
  const bubble = await page.evaluateHandle(() =>
    [...document.querySelectorAll('[role="log"] *')]
      .filter((el) => el.children.length === 0 && el.textContent.includes('Ok luôn, khoảng 3 giờ'))
      .pop(),
  )
  await bubble.asElement().hover()
  await sleep(250)
}

/* ------------------------------------ Danh sách màn -------------------------------- */

const DESKTOP = { width: 1440, height: 900, deviceScaleFactor: 1 }
const MOBILE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }

const SIGNED_OUT = { user: null }
const needsOnboarding = {
  ...me,
  interests: [],
  hasCompletedInterestOnboarding: false,
}

const scenes = [
  { id: '01', name: 'auth-login', caption: 'Đăng nhập', path: '/auth', ...SIGNED_OUT },
  { id: '02', name: 'auth-register-strength', caption: 'Đăng ký + độ mạnh mật khẩu', path: '/auth', ...SIGNED_OUT, act: openRegister },
  { id: '03', name: 'verify-otp', caption: 'Xác thực OTP', path: '/verify-otp?email=minhanh%40daln.chat', ...SIGNED_OUT },
  { id: '04', name: 'chat-empty', caption: 'Chat: chưa chọn hội thoại', path: '/' },
  {
    id: '05', name: 'chat-sidebar-search', caption: 'Sidebar: tìm kiếm', path: '/',
    act: async (page) => {
      await typeInto(page, 'input[aria-label="Tìm cuộc trò chuyện"]', 'Nhóm')
      await sleep(600)
    },
  },
  {
    id: '06', name: 'chat-sidebar-filter-unread', caption: 'Sidebar: lọc chưa đọc', path: '/',
    act: (page) => clickText(page, 'Chưa đọc', '[role="tab"]'),
  },
  {
    id: '08', name: 'popover-notifications', caption: 'Popover thông báo', path: '/',
    act: async (page) => {
      const bell = await page.waitForSelector('[aria-label*="hông báo"]', { visible: true })
      await bell.click()
      await waitForText(page, 'Tùng Lâm')
    },
  },
  { id: '10', name: 'chat-direct', caption: 'Chat 1-1', path: '/chat/c-thuha', ready: 'Chốt vậy đi!' },
  {
    id: '11', name: 'dropdown-message-actions', caption: 'Thao tác tin nhắn', path: '/chat/c-thuha',
    act: async (page) => {
      await hoverLastOwnMessage(page)
      const revealed = await page.evaluateHandle(() =>
        [...document.querySelectorAll('[aria-label="Tuỳ chọn tin nhắn"]')].find(
          (el) => getComputedStyle(el).opacity !== '0' && getComputedStyle(el).visibility !== 'hidden',
        ),
      )
      await revealed.asElement().click()
      await sleep(350)
    },
  },
  {
    id: '12', name: 'composer-multiline-focus', caption: 'Ô soạn tin nhiều dòng', path: '/chat/c-thuha',
    act: async (page) => {
      await waitForText(page, 'Chốt vậy đi!')
      await page.focus('[aria-label="Nhập tin nhắn"]')
      await page.keyboard.type('Mình gửi bạn bản demo giao diện mới nhé.')
      await page.keyboard.down('Shift')
      await page.keyboard.press('Enter')
      await page.keyboard.up('Shift')
      await page.keyboard.type('Bạn xem giúp mình phần danh sách hội thoại với.')
    },
  },
  {
    id: '13', name: 'popover-emoji', caption: 'Bảng chọn emoji', path: '/chat/c-thuha',
    act: async (page) => {
      await waitForText(page, 'Chốt vậy đi!')
      await clickLabel(page, 'Chèn biểu tượng cảm xúc')
      await sleep(900)
    },
  },
  {
    id: '15', name: 'dialog-clear-history', caption: 'Dialog xoá lịch sử', path: '/chat/c-thuha',
    act: async (page) => {
      await openProfilePanel(page)
      await clickText(page, 'Xóa lịch sử trò chuyện')
      await waitForText(page, 'Xóa toàn bộ lịch sử trò chuyện?')
    },
  },
  { id: '16', name: 'chat-profile-panel', caption: 'Panel thông tin hội thoại', path: '/chat/c-thuha', act: openProfilePanel },
  {
    id: '17', name: 'modal-voice-call', caption: 'Cuộc gọi thoại', path: '/chat/c-thuha',
    act: async (page) => {
      await waitForText(page, 'Chốt vậy đi!')
      await clickLabel(page, 'Gọi thoại')
      await sleep(900)
    },
  },
  { id: '18', name: 'chat-group-poll', caption: 'Chat nhóm + bình chọn', path: '/chat/c-group', ready: 'Thứ năm, 14h' },
  {
    id: '19', name: 'dialog-create-poll', caption: 'Dialog tạo bình chọn', path: '/chat/c-group',
    act: async (page) => {
      await waitForText(page, 'Thứ năm, 14h')
      await clickLabel(page, 'Tạo bình chọn')
    },
  },
  {
    id: '20', name: 'friends', caption: 'Danh sách bạn bè', path: '/friends',
    act: async (page) => {
      await clickText(page, 'Thu Hà', 'main *, #main-content button, #main-content [role="button"]')
    },
  },
  { id: '21', name: 'groups', caption: 'Nhóm & cộng đồng', path: '/groups', ready: 'Nhóm Đồ án tốt nghiệp' },
  { id: '22', name: 'friend-requests', caption: 'Lời mời kết bạn', path: '/friend_requests', ready: 'Tùng Lâm' },
  {
    id: '23', name: 'modal-friend-request', caption: 'Chi tiết lời mời', path: '/friend_requests',
    act: async (page) => {
      await waitForText(page, 'Tùng Lâm')
      await clickText(page, 'Tùng Lâm', '#main-content button, #main-content [role="button"]')
      await sleep(500)
    },
  },
  { id: '24', name: 'recommendations', caption: 'Gợi ý kết bạn', path: '/recommendations', ready: 'Hoàng Nam' },
  { id: '25', name: 'notification-settings', caption: 'Cài đặt thông báo', path: '/settings/notifications', ready: 'Email tổng hợp' },
  {
    id: '26', name: 'modal-add-friend', caption: 'Modal thêm bạn', path: '/friends',
    act: async (page) => {
      await waitForText(page, 'Thu Hà')
      await clickLabel(page, 'Thêm bạn')
    },
  },
  { id: '27', name: 'forgot-password', caption: 'Quên mật khẩu', path: '/forgot-password', ...SIGNED_OUT },
  { id: '28', name: 'reset-password', caption: 'Đặt lại mật khẩu', path: '/reset-password?token=mock', ...SIGNED_OUT },
  {
    id: '29', name: 'modal-new-group', caption: 'Tạo nhóm mới', path: '/',
    act: (page) => clickLabel(page, 'Tạo nhóm mới'),
  },
  {
    id: '30', name: 'modal-video-prejoin', caption: 'Xem trước cuộc gọi video', path: '/chat/c-thuha',
    act: async (page) => {
      await waitForText(page, 'Chốt vậy đi!')
      await clickLabel(page, 'Gọi video')
      await sleep(1200)
    },
  },
  { id: '31', name: 'settings-profile', caption: 'Cài đặt: hồ sơ', path: '/settings', ready: 'Minh Anh' },
  { id: '32', name: 'settings-account', caption: 'Cài đặt: tài khoản', path: '/settings/account', settle: 2500,
    act: async (page) => {
      await waitForText(page, 'Hồ Chí Minh')
      await clickText(page, 'Hồ Chí Minh', 'button[aria-expanded]')
      await waitForText(page, 'Ước tính từ IP')
      // Hàng vừa mở nằm cuối màn: cuộn để thấy trọn bản đồ.
      await page.evaluate(() =>
        [...document.querySelectorAll('button[aria-expanded]')]
          .find((el) => el.textContent.includes('Hồ Chí Minh'))
          .scrollIntoView({ block: 'start' }),
      )
    },
  },
  {
    id: '33', name: 'dialog-change-password', caption: 'Dialog đổi mật khẩu', path: '/settings/account',
    act: async (page) => {
      await waitForText(page, 'Hồ Chí Minh')
      await clickText(page, 'Đổi mật khẩu')
    },
  },
  { id: '34', name: 'settings-privacy', caption: 'Cài đặt: riêng tư', path: '/settings/privacy' },
  { id: '35', name: 'onboarding-interests', caption: 'Chọn sở thích', path: '/onboarding/interests', user: needsOnboarding, ready: 'Lập trình' },

  { id: '101', name: 'm-chat-list', caption: 'Mobile: danh sách chat', path: '/', viewport: MOBILE, ready: 'Nhóm Đồ án tốt nghiệp' },
  { id: '102', name: 'm-chat-thread', caption: 'Mobile: khung chat', path: '/chat/c-thuha', viewport: MOBILE, ready: 'Chốt vậy đi!' },
  {
    id: '107', name: 'm-message-actions', caption: 'Mobile: chạm tin nhắn để mở thao tác', path: '/chat/c-thuha', viewport: MOBILE,
    act: async (page) => {
      await waitForText(page, 'Ok luôn, khoảng 3 giờ')
      const count = () =>
        page.$$eval('[aria-label="Tuỳ chọn tin nhắn"]', (buttons) =>
          buttons.filter((el) => getComputedStyle(el).opacity !== '0').length,
        )
      if ((await count()) !== 0) throw new Error('nút tuỳ chọn hiện sẵn trước khi chạm')
      const bubble = await page.evaluateHandle(() =>
        [...document.querySelectorAll('[data-message-bubble]')].find((el) =>
          el.textContent.includes('Ok luôn, khoảng 3 giờ'),
        ),
      )
      await bubble.asElement().tap()
      await sleep(350)
      if ((await count()) !== 1) throw new Error('chạm tin nhắn không hiện đúng một nút tuỳ chọn')
      const button = await bubble.asElement().$('[aria-label="Tuỳ chọn tin nhắn"]')
      await button.tap()
      await waitForText(page, 'Thu hồi với mọi người')
    },
  },
  { id: '103', name: 'm-friends', caption: 'Mobile: bạn bè', path: '/friends', viewport: MOBILE, ready: 'Thu Hà' },
  { id: '104', name: 'm-recommendations', caption: 'Mobile: gợi ý', path: '/recommendations', viewport: MOBILE, ready: 'Hoàng Nam' },
  { id: '105', name: 'm-notification-settings', caption: 'Mobile: cài đặt thông báo', path: '/settings/notifications', viewport: MOBILE, ready: 'Email tổng hợp' },
  { id: '106', name: 'm-auth', caption: 'Mobile: đăng nhập', path: '/auth', viewport: MOBILE, ...SIGNED_OUT },
]

/* --------------------------------------- Chạy -------------------------------------- */

async function shoot(browser, scene, theme) {
  const label = `${scene.id}-${scene.name}-${theme}`
  const user = scene.user === undefined ? me : scene.user
  const page = await newPage(browser, {
    theme,
    viewport: scene.viewport ?? DESKTOP,
    user,
    scene: label,
  })
  try {
    await page.goto(APP + scene.path, { waitUntil: 'networkidle2', timeout: 30000 })
    if (scene.ready) await waitForText(page, scene.ready)
    if (scene.act) await scene.act(page)
    await sleep(scene.settle ?? 500)
    await page.evaluate(() => document.fonts.ready)
    const toast = await page.$eval('body', () =>
      [...document.querySelectorAll('[data-sonner-toast][data-type="error"]')]
        .map((el) => el.textContent.trim())
        .join(' | '),
    )
    if (toast) problems.push(`${label}: toast lỗi: ${toast}`)
    await page.screenshot({ path: join(OUT, `${scene.id}-${scene.name}-${theme}.png`) })
    console.log(`  ✅ ${label}`)
  } catch (error) {
    problems.push(`${label}: ${error.message.split('\n')[0]}`)
    console.log(`  ❌ ${label}: ${error.message.split('\n')[0]}`)
  } finally {
    await page.browserContext().close()
  }
}

/** tong-hop-<theme>.png: một tờ gom mọi màn, để liếc qua toàn bộ giao diện. */
async function contactSheet(browser, theme) {
  const dark = theme === 'dark'
  const tile = (scene) => {
    const file = join(OUT, `${scene.id}-${scene.name}-${theme}.png`)
    const span = scene.viewport ? '' : 'wide'
    return `<figure class="${span}"><img src="${pathToFileURL(file)}"><figcaption>${scene.caption}</figcaption></figure>`
  }
  const html = `<!doctype html><meta charset="utf-8"><style>
    body { margin: 0; padding: 32px; width: 1336px; font: 14px Inter, system-ui, sans-serif;
      background: ${dark ? '#14151f' : '#f4f7f7'}; color: ${dark ? '#f2f2f7' : '#1a2224'}; }
    h1 { margin: 0 0 4px; font-size: 22px; } p { margin: 0 0 24px; opacity: .7; }
    .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; align-items: start; }
    figure { margin: 0; } img { width: 100%; display: block; border-radius: 8px;
      border: 1px solid ${dark ? '#2c2e3d' : '#dbe4e4'}; }
    figcaption { margin-top: 6px; font-size: 13px; opacity: .75; }
  </style>
  <h1>DALN Chat: toàn bộ màn hình (${dark ? 'Tối' : 'Sáng'})</h1>
  <p>${scenes.length} màn hình, desktop 1440×900 và mobile 390×844. Dữ liệu minh hoạ.</p>
  <div class="grid">${scenes.map(tile).join('')}</div>`
  const file = join(tmpdir(), `daln-tong-hop-${theme}.html`)
  writeFileSync(file, html)
  const page = await browser.newPage()
  await page.setViewport({ width: 1400, height: 900 })
  await page.goto(pathToFileURL(file).href, { waitUntil: 'networkidle0' })
  await page.screenshot({ path: join(OUT, `tong-hop-${theme}.png`), fullPage: true })
  await page.close()
}

mkdirSync(OUT, { recursive: true })
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: [
    '--no-sandbox',
    '--allow-file-access-from-files',
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
  ],
})

const chosen = ONLY ? scenes.filter((scene) => ONLY.includes(scene.id)) : scenes
for (const theme of THEMES) {
  console.log(`\n${theme}`)
  for (const scene of chosen) await shoot(browser, scene, theme)
  if (!ONLY && !problems.length) await contactSheet(browser, theme)
}
await browser.close()

const known = new Set(
  scenes.flatMap((scene) => THEMES.map((theme) => `${scene.id}-${scene.name}-${theme}.png`)),
)
const stale = readdirSync(OUT).filter(
  (file) => THEMES.some((theme) => file.endsWith(`-${theme}.png`)) && !known.has(file) && !file.startsWith('tong-hop'),
)
if (stale.length) console.log(`\nẢnh không còn màn tương ứng:\n  ${stale.join('\n  ')}`)

if (problems.length) {
  console.log(`\n❌ ${problems.length} vấn đề:\n  ${[...new Set(problems)].join('\n  ')}`)
  process.exit(1)
}
console.log(`\n✅ Đã chụp ${chosen.length} màn × ${THEMES.length} theme vào ${OUT}`)
