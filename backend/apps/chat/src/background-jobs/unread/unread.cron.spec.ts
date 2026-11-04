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
const A1 = '6a350000000000000000ab01'
const B1 = '6a350000000000000000ab03'

type RestorePayload = {
  newest: Record<string, number>
  last: string
  lastSeq: number
}

const seqOf = (raw: string | undefined) =>
  raw ? ((JSON.parse(raw) as { seq?: number }).seq ?? 0) : 0

/**
 * Redis giả trong bộ nhớ. CLAIM/RESTORE mô phỏng ngữ nghĩa của hai script Lua
 * (lấy-và-xoá nguyên tử; trả lại không hạ seq, không đè last_message mới hơn).
 * Cái được kiểm ở đây là cron dùng chúng ĐÚNG CÁCH; bản thân Lua được chạy
 * trên redis-server thật ở unread.redis.spec.ts.
 */
class FakeRedis {
  hashes = new Map<string, Record<string, string>>()
  strings = new Map<string, string>()
  sets = new Map<string, Set<string>>()

  hsetIfGreater(key: string, field: string, seq: number) {
    const hash = this.hashes.get(key) ?? {}
    if (!(Number(hash[field]) >= seq)) hash[field] = String(seq)
    this.hashes.set(key, hash)
  }

  addToSet(key: string, members: string[]) {
    const set = this.sets.get(key) ?? new Set<string>()
    members.forEach((member) => set.add(member))
    this.sets.set(key, set)
  }

  /** Một tin nhắn mới đi qua pipeline của MessageService. */
  newMessage(
    conversationId: string,
    senderId: string,
    messageId: string,
    seq: number,
  ) {
    this.hsetIfGreater(unreadLastKey(conversationId), senderId, seq)
    if (seqOf(this.strings.get(lastMessageKey(conversationId))) < seq) {
      this.strings.set(
        lastMessageKey(conversationId),
        JSON.stringify({
          seq,
          senderId,
          lastMessageId: messageId,
          lastMessageAt: '2026-09-01T10:00:00.000Z',
          lastMessageText: 'xin chào',
        }),
      )
    }
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
      for (const [sender, seq] of Object.entries(data.newest))
        this.hsetIfGreater(newestKey, sender, seq)
      if (data.last && !(seqOf(this.strings.get(lastKey)) >= data.lastSeq))
        this.strings.set(lastKey, data.last)
      return 1
    }
    throw new Error('script lạ')
  }
}

function setup() {
  const redis = new FakeRedis()
  const memberRepo = {
    advanceMembers: jest
      .fn<Promise<number>, [string, { lastMessageAt: Date; seq: number }]>()
      .mockResolvedValue(2),
    advanceReadOfSenders: jest
      .fn<Promise<number>, [string, { senderId: string; seq: number }[]]>()
      .mockResolvedValue(1),
    updateMany: jest.fn(() =>
      Promise.reject(new Error('cron không được dùng Prisma updateMany')),
    ),
  }
  const conversationRepo = {
    saveLastMessage: jest
      .fn<
        Promise<number>,
        [string, { seq: number; lastMessageId?: string | null }]
      >()
      .mockResolvedValue(1),
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
  afterEach(() => jest.restoreAllMocks())

  it("writes the newest last message, members' latest seq and each sender's read mark", async () => {
    const { redis, memberRepo, conversationRepo, cron } = setup()
    redis.newMessage(CONV, A, A1, 11)
    redis.newMessage(CONV, B, B1, 12)
    redis.newMessage(CONV, A, A1, 10) // tới trễ: không kéo lùi

    await cron.handleCron()

    expect(conversationRepo.saveLastMessage).toHaveBeenCalledTimes(1)
    expect(conversationRepo.saveLastMessage.mock.calls[0][1]).toMatchObject({
      seq: 12,
      lastMessageId: B1,
    })
    expect(memberRepo.advanceMembers).toHaveBeenCalledWith(CONV, {
      lastMessageAt: new Date('2026-09-01T10:00:00.000Z'),
      seq: 12,
    })
    expect(memberRepo.advanceReadOfSenders.mock.calls[0][1]).toEqual(
      expect.arrayContaining([
        { senderId: A, seq: 11 },
        { senderId: B, seq: 12 },
      ]),
    )
    // Claim đúng một lần bằng script, trên đủ ba key; flush xong không còn gì.
    expect(redis.eval.mock.calls).toEqual([[CLAIM_SCRIPT, liveKeys]])
    expect(redis.hashes.size).toBe(0)
    expect(redis.strings.size).toBe(0)
  })

  it('cron writes no transactions', async () => {
    const { redis, memberRepo, cron } = setup()
    redis.newMessage(CONV, A, A1, 1)

    await cron.handleCron()

    expect(memberRepo.updateMany).not.toHaveBeenCalled()
  })

  it('claim nguyên tử: tin tới GIỮA lúc flush vẫn còn nguyên cho lượt sau', async () => {
    const { redis, conversationRepo, cron } = setup()
    redis.newMessage(CONV, A, A1, 1)
    conversationRepo.saveLastMessage.mockImplementationOnce(() => {
      redis.newMessage(CONV, B, B1, 2)
      return Promise.resolve(1)
    })

    await cron.handleCron()

    expect(seqOf(redis.strings.get(lastMessageKey(CONV)))).toBe(2)
    expect(redis.sets.get(DIRTY_CONVERSATIONS_KEY)?.has(CONV)).toBe(true)
  })

  it('ghi Mongo lỗi -> trả dữ liệu về Redis và đưa conversation lại hàng đợi', async () => {
    const { redis, memberRepo, cron } = setup()
    redis.newMessage(CONV, A, A1, 5)
    memberRepo.advanceReadOfSenders.mockRejectedValueOnce(
      new Error('mongo down'),
    )

    await cron.handleCron()

    expect(redis.hashes.get(unreadLastKey(CONV))).toEqual({ [A]: '5' })
    // Tin cuối chưa ghi (người gửi trước, rồi mới tới thành viên) -> trả về luôn.
    expect(redis.strings.has(lastMessageKey(CONV))).toBe(true)
    expect(redis.sets.get(DIRTY_CONVERSATIONS_KEY)?.has(CONV)).toBe(true)
  })

  it('a failed sender read mark holds back the members too, so nobody sees their own message as unread', async () => {
    const { redis, memberRepo, conversationRepo, cron } = setup()
    redis.newMessage(CONV, A, A1, 5)
    memberRepo.advanceReadOfSenders.mockRejectedValueOnce(
      new Error('mongo down'),
    )

    await cron.handleCron()

    expect(memberRepo.advanceMembers).not.toHaveBeenCalled()
    expect(conversationRepo.saveLastMessage).not.toHaveBeenCalled()
    expect(redis.hashes.get(unreadLastKey(CONV))).toEqual({ [A]: '5' })
    expect(redis.strings.has(lastMessageKey(CONV))).toBe(true)
  })

  it('trả về không hạ seq mới nhất, không đè last_message mới hơn', async () => {
    const { redis, conversationRepo, cron } = setup()
    redis.newMessage(CONV, A, A1, 5)
    conversationRepo.saveLastMessage.mockImplementationOnce(() => {
      redis.newMessage(CONV, B, B1, 9)
      return Promise.reject(new Error('mongo down'))
    })

    await cron.handleCron()

    expect(seqOf(redis.strings.get(lastMessageKey(CONV)))).toBe(9)
  })

  it('an old snapshot without seq is only written when nothing is shown yet', async () => {
    const { redis, conversationRepo, memberRepo, cron } = setup()
    redis.strings.set(
      lastMessageKey(CONV),
      JSON.stringify({
        senderId: A,
        lastMessageId: A1,
        lastMessageAt: '2026-09-01T10:00:00.000Z',
      }),
    )
    redis.hashes.set(unreadLastKey(CONV), { [A]: A1 }) // ObjectId của bản cũ
    redis.addToSet(DIRTY_CONVERSATIONS_KEY, [CONV])

    await cron.handleCron()

    expect(conversationRepo.saveLastMessage.mock.calls[0][1]).toMatchObject({
      seq: 0,
    })
    expect(memberRepo.advanceReadOfSenders).not.toHaveBeenCalled()
  })
})
