import { Logger } from '@nestjs/common'
import { UnreadCron } from './unread.cron'
import {
  CLAIM_SCRIPT,
  DIRTY_CONVERSATIONS_KEY,
  RESTORE_SCRIPT,
  lastMessageKey,
  unreadCountKey,
  unreadLastKey,
} from './unread.constants'

const CONV = '6a35000000000000000c0001'
const A = '6a35000000000000000a0001'
const B = '6a35000000000000000a0002'
const C = '6a35000000000000000a0003'
const A1 = '6a350000000000000000ab01'
const A2 = '6a350000000000000000ab02'
const B1 = '6a350000000000000000ab03'
const B2 = '6a350000000000000000ab04'

type RestorePayload = {
  counts: Record<string, string>
  newest: Record<string, string>
  last: string
  lastId: string
}

const lastMessageIdOf = (raw: string | undefined) =>
  raw ? (JSON.parse(raw) as { lastMessageId?: string }).lastMessageId : ''

/**
 * Redis giả trong bộ nhớ. CLAIM/RESTORE mô phỏng đúng ngữ nghĩa của hai script
 * Lua (lấy-và-xoá nguyên tử; trả lại không hạ id mới nhất, không đè last_message
 * mới hơn). Cái được kiểm ở đây là cron dùng chúng ĐÚNG CÁCH; bản thân Lua
 * được chạy thử trên redis-server thật.
 */
class FakeRedis {
  hashes = new Map<string, Record<string, string>>()
  strings = new Map<string, string>()
  sets = new Map<string, Set<string>>()

  hincrby(key: string, field: string, by: number) {
    const hash = this.hashes.get(key) ?? {}
    hash[field] = String(Number(hash[field] ?? 0) + by)
    this.hashes.set(key, hash)
  }

  hsetIfGreater(key: string, field: string, value: string) {
    const hash = this.hashes.get(key) ?? {}
    if (!hash[field] || hash[field] < value) hash[field] = value
    this.hashes.set(key, hash)
  }

  addToSet(key: string, members: string[]) {
    const set = this.sets.get(key) ?? new Set<string>()
    members.forEach((member) => set.add(member))
    this.sets.set(key, set)
  }

  /** Một tin nhắn mới đi qua pipeline của MessageService. */
  newMessage(conversationId: string, senderId: string, messageId: string) {
    this.hsetIfGreater(unreadLastKey(conversationId), senderId, messageId)
    this.hincrby(unreadCountKey(conversationId), senderId, 1)
    this.strings.set(
      lastMessageKey(conversationId),
      JSON.stringify({
        senderId,
        lastMessageId: messageId,
        lastMessageAt: '2026-09-01T10:00:00.000Z',
        lastMessageText: 'xin chào',
      }),
    )
    this.addToSet(DIRTY_CONVERSATIONS_KEY, [conversationId])
  }

  spop = jest.fn<Promise<string[]>, [string, number]>((key, count) => {
    const set = this.sets.get(key) ?? new Set<string>()
    const out = [...set].slice(0, count)
    out.forEach((member) => set.delete(member))
    return Promise.resolve(out)
  })

  sadd = jest.fn<Promise<number>, [string, ...string[]]>((key, ...members) => {
    this.addToSet(key, members)
    return Promise.resolve(members.length)
  })

  eval = jest.fn<Promise<unknown>, [string, string[], (string | number)[]?]>(
    (script, keys, args = []) =>
      Promise.resolve(this.runScript(script, keys, args)),
  )

  private runScript(
    script: string,
    keys: string[],
    args: (string | number)[],
  ): unknown {
    const [countKey, lastKey, newestKey] = keys
    const flat = (hash?: Record<string, string>) =>
      Object.entries(hash ?? {}).flat()

    if (script === CLAIM_SCRIPT) {
      const result = [
        flat(this.hashes.get(countKey)),
        this.strings.get(lastKey) ?? null,
        flat(this.hashes.get(newestKey)),
      ]
      this.hashes.delete(countKey)
      this.strings.delete(lastKey)
      this.hashes.delete(newestKey)
      return result
    }

    if (script === RESTORE_SCRIPT) {
      const data = JSON.parse(String(args[0])) as RestorePayload
      for (const [sender, delta] of Object.entries(data.counts)) {
        this.hincrby(countKey, sender, Number(delta))
      }
      for (const [sender, id] of Object.entries(data.newest)) {
        this.hsetIfGreater(newestKey, sender, id)
      }
      if (data.last) {
        const current = this.strings.get(lastKey)
        if (
          !current ||
          (data.lastId && lastMessageIdOf(current)! < data.lastId)
        ) {
          this.strings.set(lastKey, data.last)
        }
      }
      return 1
    }

    throw new Error('script lạ')
  }
}

type UpdateUpdatedAtData = { lastMessageId?: string }

function setup() {
  const redis = new FakeRedis()
  const memberRepo = {
    updateUnreadCount: jest
      .fn<Promise<{ count: number }>, [string, string, number, string?]>()
      .mockResolvedValue({ count: 1 }),
    updateLastMessageAt: jest
      .fn<Promise<{ count: number }>, [string, Date]>()
      .mockResolvedValue({ count: 1 }),
  }
  const conversationRepo = {
    saveLastMessage: jest
      .fn<Promise<object>, [string, UpdateUpdatedAtData]>()
      .mockResolvedValue({}),
  }
  const cron = new UnreadCron(
    redis as never,
    conversationRepo as never,
    memberRepo as never,
  )
  return { redis, memberRepo, conversationRepo, cron }
}

const liveKeys = [
  unreadCountKey(CONV),
  lastMessageKey(CONV),
  unreadLastKey(CONV),
]

describe('UnreadCron', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('truyền id tin mới nhất của TỪNG người gửi; thiếu thì để trống (hành vi cũ)', async () => {
    const { redis, memberRepo, conversationRepo, cron } = setup()
    redis.newMessage(CONV, A, A1)
    redis.newMessage(CONV, A, A2)
    redis.newMessage(CONV, B, B1)
    // Dữ liệu còn sót từ bản cũ: có số đếm nhưng chưa có id mới nhất.
    redis.hincrby(unreadCountKey(CONV), C, 1)

    await cron.handleCron()

    expect(memberRepo.updateUnreadCount).toHaveBeenCalledTimes(3)
    expect(memberRepo.updateUnreadCount).toHaveBeenCalledWith(CONV, A, 2, A2)
    expect(memberRepo.updateUnreadCount).toHaveBeenCalledWith(CONV, B, 1, B1)
    expect(memberRepo.updateUnreadCount).toHaveBeenCalledWith(
      CONV,
      C,
      1,
      undefined,
    )
    expect(
      conversationRepo.saveLastMessage.mock.calls[0][1].lastMessageId,
    ).toBe(B1)
    // Claim đúng một lần bằng script, trên đủ ba key; flush xong không còn gì.
    expect(redis.eval.mock.calls).toEqual([[CLAIM_SCRIPT, liveKeys]])
    expect(redis.hashes.size).toBe(0)
    expect(redis.strings.size).toBe(0)
  })

  it('claim nguyên tử: tin tới GIỮA lúc flush vẫn còn nguyên cho lượt sau', async () => {
    const { redis, memberRepo, cron } = setup()
    redis.newMessage(CONV, A, A1)
    memberRepo.updateUnreadCount.mockImplementationOnce(() => {
      // Tin mới tới đúng lúc cron đang ghi Mongo. Bản cũ DEL key sau khi ghi
      // xong nên xoá luôn cả số đếm của tin này.
      redis.newMessage(CONV, A, A2)
      return Promise.resolve({ count: 1 })
    })

    await cron.handleCron()

    expect(memberRepo.updateUnreadCount).toHaveBeenCalledWith(CONV, A, 1, A1)
    expect(redis.hashes.get(unreadCountKey(CONV))).toEqual({ [A]: '1' })
    expect(redis.hashes.get(unreadLastKey(CONV))).toEqual({ [A]: A2 })
    expect(lastMessageIdOf(redis.strings.get(lastMessageKey(CONV)))).toBe(A2)
    expect(redis.sets.get(DIRTY_CONVERSATIONS_KEY)).toEqual(new Set([CONV]))

    // Lượt sau xử lý đúng tin đó, không hơn không kém.
    await cron.handleCron()
    expect(memberRepo.updateUnreadCount).toHaveBeenLastCalledWith(
      CONV,
      A,
      1,
      A2,
    )
  })

  it('ghi Mongo lỗi -> trả nguyên dữ liệu về Redis và đưa conversation lại hàng đợi', async () => {
    const { redis, memberRepo, conversationRepo, cron } = setup()
    redis.newMessage(CONV, A, A1)
    redis.newMessage(CONV, A, A2)
    const before = {
      counts: redis.hashes.get(unreadCountKey(CONV)),
      newest: redis.hashes.get(unreadLastKey(CONV)),
      last: redis.strings.get(lastMessageKey(CONV)),
    }
    memberRepo.updateUnreadCount.mockRejectedValue(new Error('mongo down'))
    conversationRepo.saveLastMessage.mockRejectedValue(new Error('mongo down'))

    await cron.handleCron()

    const restore = redis.eval.mock.calls.find(
      ([script]) => script === RESTORE_SCRIPT,
    )
    expect(restore?.[1]).toEqual(liveKeys)
    expect(redis.hashes.get(unreadCountKey(CONV))).toEqual(before.counts)
    expect(redis.hashes.get(unreadLastKey(CONV))).toEqual(before.newest)
    expect(redis.strings.get(lastMessageKey(CONV))).toBe(before.last)
    expect(redis.sets.get(DIRTY_CONVERSATIONS_KEY)).toEqual(new Set([CONV]))
  })

  it('chỉ trả phần ghi lỗi, không hạ id mới nhất, không đè last_message mới hơn', async () => {
    const { redis, memberRepo, cron } = setup()
    redis.newMessage(CONV, A, A1)
    redis.newMessage(CONV, B, B1)
    memberRepo.updateUnreadCount.mockImplementation((_conv, senderId) => {
      if (senderId !== B) return Promise.resolve({ count: 1 })
      // Tin mới của B tới trong lúc flush, rồi write của B lỗi.
      redis.newMessage(CONV, B, B2)
      return Promise.reject(new Error('mongo down'))
    })

    await cron.handleCron()

    const restore = redis.eval.mock.calls.find(
      ([script]) => script === RESTORE_SCRIPT,
    )
    // A đã ghi xong nên KHÔNG trả lại — trả thì lượt sau cộng trùng. last
    // rỗng vì write last_message đã thành công.
    expect(JSON.parse(String(restore?.[2]?.[0])) as RestorePayload).toEqual({
      counts: { [B]: '1' },
      newest: { [B]: B1 },
      last: '',
      lastId: '',
    })
    expect(redis.hashes.get(unreadCountKey(CONV))).toEqual({ [B]: '2' })
    expect(redis.hashes.get(unreadLastKey(CONV))).toEqual({ [B]: B2 })
    expect(lastMessageIdOf(redis.strings.get(lastMessageKey(CONV)))).toBe(B2)
    expect(redis.sets.get(DIRTY_CONVERSATIONS_KEY)).toEqual(new Set([CONV]))
  })
})
