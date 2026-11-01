/**
 * Tải gửi tin qua Socket.IO, đi qua Kong, chia theo nấc tốc độ cố định.
 * Không chạy trực tiếp: `node throughput.mjs` dựng dữ liệu, chạy file này và đo.
 *
 * Mỗi VU là một người dùng, một socket:
 *   - sender: gửi vào các nhóm của mình theo tốc độ được chia, đo thời gian tới ack.
 *   - receiver: chỉ nhận `message:new`, đo độ trễ đầu-cuối (thời điểm gửi nằm trong content).
 * Một người dùng có thể vừa gửi vừa nhận (bài hội thoại nóng).
 */
import { WebSocket } from 'k6/websockets'
import { setInterval, clearInterval, setTimeout } from 'k6/timers'
import { Counter, Trend } from 'k6/metrics'

const F = JSON.parse(open(__ENV.FIXTURES))
const COOKIES = JSON.parse(open(__ENV.COOKIES))
const T0 = Number(__ENV.T0)
const API = __ENV.API || 'http://localhost:8080'
const WS = API.replace(/^http/, 'ws') + '/socket.io/?EIO=4&transport=websocket'
const RUN = __ENV.RUN
// [{name, rate, sec}] — rate là tổng msg/s của mọi sender.
const STAGES = JSON.parse(__ENV.STAGES)
const LOAD_MS = STAGES.reduce((t, s) => t + s.sec * 1000, 0)
const GRACE_MS = 15000
const ACK_TIMEOUT_MS = 10000
const TICK_MS = 10

const ackLatency = new Trend('ack_latency', true)
const deliverLatency = new Trend('deliver_latency', true)
const sent = new Counter('sent')
const acked = new Counter('acked')
const delivered = new Counter('delivered')
const failed = new Counter('failed')
const timeouts = new Counter('ack_timeouts')

const thresholds = {}
for (const s of STAGES) {
  // Ngưỡng giả chỉ để k6 in submetric theo từng nấc trong summary.
  thresholds[`ack_latency{stage:${s.name}}`] = ['p(95)>=0']
  thresholds[`deliver_latency{stage:${s.name}}`] = ['p(95)>=0']
  thresholds[`acked{stage:${s.name}}`] = ['count>=0']
}

export const options = {
  scenarios: {
    chat: {
      executor: 'per-vu-iterations',
      vus: F.vus.length,
      iterations: 1,
      maxDuration: `${Math.ceil((LOAD_MS + GRACE_MS) / 1000) + 60}s`,
    },
  },
  thresholds,
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
}

function stageAt(elapsed) {
  let acc = 0
  for (const s of STAGES) {
    acc += s.sec * 1000
    if (elapsed < acc) return s
  }
  return null
}

export default function () {
  const me = F.vus[__VU - 1]
  const ns = '/realtime'
  const ws = new WebSocket(WS, null, { headers: { Cookie: COOKIES[me.userId] } })
  const pending = new Map()
  let seq = 0
  let tokens = 0
  let ticker = null

  const emit = (event, payload) => ws.send(`42${ns},${JSON.stringify([event, payload])}`)

  function startSending() {
    // Mọi VU bắt đầu cùng mốc t0 để các nấc khớp nhau giữa các VU.
    setTimeout(() => {
      let last = Date.now()
      ticker = setInterval(() => {
        const now = Date.now()
        const stage = stageAt(now - T0)
        for (const [id, p] of pending) {
          if (now - p.at > ACK_TIMEOUT_MS) {
            pending.delete(id)
            timeouts.add(1, { stage: p.stage })
          }
        }
        if (!stage) {
          clearInterval(ticker)
          setTimeout(() => ws.close(), GRACE_MS)
          return
        }
        tokens += (stage.rate * me.share * (now - last)) / 1000
        last = now
        while (tokens >= 1) {
          tokens -= 1
          seq += 1
          const conversationId = me.groups[seq % me.groups.length]
          const clientMessageId = `lt-${RUN}-${Date.now()}-${__VU}-${seq}`
          pending.set(clientMessageId, { at: Date.now(), stage: stage.name })
          emit('message:create', {
            conversationId,
            type: 'TEXT',
            content: `lt|${Date.now()}|${stage.name}`,
            clientMessageId,
            medias: [],
          })
          sent.add(1, { stage: stage.name })
        }
      }, TICK_MS)
    }, Math.max(0, T0 - Date.now()))
  }

  ws.onmessage = (e) => {
    const raw = String(e.data)
    if (raw === '2') return ws.send('3')
    if (raw.startsWith('0')) return ws.send(`40${ns},`)
    if (raw.startsWith(`40${ns}`)) {
      if (me.share > 0) startSending()
      else setTimeout(() => ws.close(), LOAD_MS + GRACE_MS + Math.max(0, T0 - Date.now()))
      return
    }
    if (!raw.startsWith(`42${ns},`)) return
    const [event, payload] = JSON.parse(raw.slice(ns.length + 3))
    if (event === 'message:ack') {
      const p = pending.get(payload.clientMessageId)
      if (!p) return
      pending.delete(payload.clientMessageId)
      ackLatency.add(Date.now() - p.at, { stage: p.stage })
      acked.add(1, { stage: p.stage })
    } else if (event === 'message:new') {
      const [tag, at, stage] = String(payload.message?.content ?? '').split('|')
      if (tag !== 'lt') return
      deliverLatency.add(Date.now() - Number(at), { stage })
      delivered.add(1, { stage })
    } else if (event === 'message:error') {
      const p = pending.get(payload.clientMessageId)
      if (p) pending.delete(payload.clientMessageId)
      failed.add(1, { stage: p?.stage ?? 'unknown', code: String(payload.code) })
    }
  }
  ws.onerror = (e) => console.error(`vu ${__VU} ws error ${e.error}`)
}
