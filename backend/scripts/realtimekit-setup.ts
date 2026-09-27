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
      brand: {
        300: '#844d1c',
        400: '#9d5b22',
        500: '#b56927',
        600: '#d37c30',
        700: '#d9904f',
      },
      background: {
        600: '#222222',
        700: '#1f1f1f',
        800: '#1b1b1b',
        900: '#181818',
        1000: '#080808',
      },
      danger: '#FF2D2D',
      success: '#62A504',
      warning: '#FFCD07',
      text: '#EEEEEE',
      text_on_brand: '#EEEEEE',
      video_bg: '#191919',
    },
  },
}

function presetBody(
  name: string,
  scope: 'direct' | 'group',
  callType: 'audio' | 'video',
) {
  const video = callType === 'video'
  const group = scope === 'group'
  return {
    name,
    config: {
      view_type: 'GROUP_CALL',
      // Số ô lưới GỒM cả ô của chính mình: SDK (ACTIVE_GRID) chỉ đăng ký nhận
      // video của max_video_streams − 1 người khác — để 1 cho 1-1 thì không nhận
      // được video của ai (QC 2026-09-27). Cùng giá trị cho preset thoại: SDK
      // đăng ký nghe max_video_streams + 4 người, để 0 sẽ cắt tiếng người thứ 5.
      // Preset thoại vẫn không phát được video (can_produce).
      max_video_streams: group
        ? { desktop: 9, mobile: 6 }
        : { desktop: 2, mobile: 2 },
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
        private: {
          can_send: false,
          can_receive: false,
          text: false,
          files: false,
        },
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
      plugins: {
        can_close: false,
        can_start: false,
        can_edit_config: false,
        config: {},
      },
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
  const {
    REALTIMEKIT_ACCOUNT_ID: acc,
    REALTIMEKIT_APP_ID: app,
    REALTIMEKIT_API_TOKEN: token,
  } = env
  if (!acc || !app || !token)
    throw new Error('Thiếu REALTIMEKIT_ACCOUNT_ID / APP_ID / API_TOKEN')
  const base = `https://api.cloudflare.com/client/v4/accounts/${acc}/realtime/kit/${app}`

  const call = async (
    method: string,
    path: string,
    body?: unknown,
    options: { emptyOn404?: boolean } = {},
  ) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    // GET /webhooks trả 404 "Webhook not found" khi app chưa có webhook nào
    // (probe 2026-09-27), không phải mảng rỗng.
    if (res.status === 404 && options.emptyOn404) return []
    if (!res.ok)
      throw new Error(
        `${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`,
      )
    return (JSON.parse(text || '{}') as { data?: unknown }).data
  }

  const existing =
    ((await call('GET', '/presets')) as { id: string; name: string }[]) ?? []
  for (const [name, scope, callType] of PRESETS) {
    const found = existing.find((p) => p.name === name)
    if (found) {
      await call(
        'PATCH',
        `/presets/${found.id}`,
        presetBody(name, scope, callType),
      )
      console.log(`preset ${name}: cập nhật`)
    } else {
      await call('POST', '/presets', presetBody(name, scope, callType))
      console.log(`preset ${name}: tạo mới`)
    }
  }

  const webhookUrl = arg('--webhook-url')
  if (webhookUrl) {
    const hooks =
      ((await call('GET', '/webhooks', undefined, { emptyOn404: true })) as {
        id: string
        name: string
      }[]) ?? []
    const body = {
      name: 'daln',
      url: webhookUrl,
      events: WEBHOOK_EVENTS,
      enabled: true,
    }
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
