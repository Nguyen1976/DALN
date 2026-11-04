import { ConversationMemberRepository } from './conversation-member.repository'

const CONV = '6a35000000000000000c0001'
const USER = '6a35000000000000000a0001'
const OTHER = '6a35000000000000000a0002'
const M1 = '6a350000000000000000ab01'

/**
 * Đường nóng (đọc tin, nhắc tên, cron) phải là lệnh thô: trên MongoDB, Prisma
 * chạy `updateMany` bằng MỘT transaction (đọc id rồi mới ghi) — đo 2026-11-01:
 * 25% số transaction của cron unread bị abort vì giẫm lên nhau. Ngữ nghĩa của
 * các lệnh thô ($max, pipeline $cond) được kiểm trên Mongo thật ở
 * conversation-member.repository.mongo.spec.ts.
 */
function setup(message: { seq: number } | null = { seq: 40 }) {
  const commands: Record<string, unknown>[] = []
  const prisma = {
    message: { findFirst: jest.fn(() => Promise.resolve(message)) },
    conversation: {
      findUnique: jest.fn(() => Promise.resolve({ lastSeq: 77 })),
    },
    conversationMember: {
      updateMany: jest.fn(() =>
        Promise.reject(new Error('không được dùng updateMany ở đường nóng')),
      ),
      findFirst: jest.fn(),
    },
    $runCommandRaw: jest.fn((cmd: Record<string, unknown>) => {
      commands.push(cmd)
      return Promise.resolve({ ok: 1, n: 1, nModified: 1 })
    }),
  }
  const redis = { delMany: jest.fn(() => Promise.resolve()) }
  const repo = new ConversationMemberRepository(prisma as never, redis as never)
  return { repo, prisma, commands }
}

describe('ConversationMemberRepository on the hot paths', () => {
  it('read is one raw update, conditional on moving forward', async () => {
    const { repo, prisma, commands } = setup()

    await expect(repo.updateLastRead(CONV, USER, M1)).resolves.toEqual({
      count: 1,
    })

    expect(prisma.message.findFirst).toHaveBeenCalledTimes(1)
    expect(commands).toHaveLength(1)
    expect(commands[0]).toMatchObject({ update: 'conversationMember' })
    const [update] = commands[0].updates as { q: Record<string, unknown> }[]
    expect(update.q).toMatchObject({
      conversationId: { $oid: CONV },
      userId: { $oid: USER },
      isActive: true,
      $or: [{ lastReadSeq: { $lt: 40 } }, { lastReadSeq: null }],
    })
  })

  it('a message from another conversation or an invalid id writes nothing', async () => {
    const missing = setup(null)
    await expect(missing.repo.updateLastRead(CONV, USER, M1)).resolves.toEqual({
      count: 0,
    })
    expect(missing.commands).toHaveLength(0)

    const invalid = setup()
    await expect(
      invalid.repo.updateLastRead(CONV, USER, 'not-an-id'),
    ).resolves.toEqual({ count: 0 })
    expect(invalid.prisma.message.findFirst).not.toHaveBeenCalled()
  })

  it('mention is one raw multi-update that skips whoever already read past it', async () => {
    const { repo, commands } = setup()

    await repo.markMention(CONV, [USER, OTHER], M1, 41)

    expect(commands).toHaveLength(1)
    const [update] = commands[0].updates as {
      q: Record<string, unknown>
      multi: boolean
    }[]
    expect(update.multi).toBe(true)
    expect(update.q).toMatchObject({
      userId: { $in: [{ $oid: USER }, { $oid: OTHER }] },
      $or: [{ lastReadSeq: { $lt: 41 } }, { lastReadSeq: null }],
    })
  })

  it('advancing members and senders are raw updates with $max', async () => {
    const { repo, commands } = setup()

    await repo.advanceMembers(CONV, {
      lastMessageAt: new Date('2026-11-04T00:00:00Z'),
      seq: 50,
    })
    await repo.advanceReadOfSenders(CONV, [
      { senderId: USER, seq: 50 },
      { senderId: OTHER, seq: 48 },
    ])

    expect(commands).toHaveLength(2)
    expect(commands[0]).toMatchObject({
      update: 'conversationMember',
      updates: [
        {
          q: { conversationId: { $oid: CONV } },
          u: { $max: { latestSeq: 50 } },
          multi: true,
        },
      ],
    })
    expect((commands[1].updates as unknown[]).length).toBe(2)
  })

  it('clearing history marks everything so far as read and hidden', async () => {
    const { repo, commands } = setup()

    await repo.clearHistoryForMember(
      CONV,
      USER,
      new Date('2026-11-04T00:00:00Z'),
    )

    expect(commands).toHaveLength(1)
    const [update] = commands[0].updates as {
      u: { $set: Record<string, unknown> }
    }[]
    expect(update.u.$set).toMatchObject({
      clearedHistorySeq: 77,
      lastReadSeq: 77,
      unreadCount: 0,
    })
  })
})

describe('ConversationMemberRepository — không còn backfill lúc runtime', () => {
  it('findByConversationIdAndUserId: đúng một findFirst, lỗi enum ném thẳng ra ngoài', async () => {
    const enumError = new Error(
      "Value 'member' not found in enum 'participantRole'",
    )
    const prisma = {
      conversationMember: { findFirst: jest.fn().mockRejectedValue(enumError) },
    }
    const repo = new ConversationMemberRepository(prisma as never, {} as never)

    await expect(repo.findByConversationIdAndUserId(CONV, USER)).rejects.toBe(
      enumError,
    )
    expect(prisma.conversationMember.findFirst).toHaveBeenCalledTimes(1)
  })
})

describe('ConversationMemberRepository.addMembers', () => {
  const profile = (n: number) => ({
    userId: `6a35000000000000000a01${String(n).padStart(2, '0')}`,
    username: `u${n}`,
    fullName: `U ${n}`,
    avatar: null,
  })

  function setupAdd(existing: { userId: string; isActive: boolean }[]) {
    const commands: Record<string, unknown>[] = []
    const prisma = {
      conversation: {
        findUnique: jest.fn(() => Promise.resolve({ lastSeq: 120 })),
      },
      conversationMember: {
        findMany: jest.fn(() => Promise.resolve(existing)),
        createMany: jest.fn((args: { data: unknown[] }) =>
          Promise.resolve({ count: args.data.length }),
        ),
        findFirst: jest.fn(() =>
          Promise.reject(new Error('không được tra từng người')),
        ),
        updateMany: jest.fn(() =>
          Promise.reject(new Error('không được updateMany từng người')),
        ),
        create: jest.fn(() =>
          Promise.reject(new Error('không được create từng người')),
        ),
      },
      $runCommandRaw: jest.fn((cmd: Record<string, unknown>) => {
        commands.push(cmd)
        return Promise.resolve({ ok: 1, n: 1, nModified: 1 })
      }),
    }
    const redis = { delMany: jest.fn(() => Promise.resolve()) }
    const repo = new ConversationMemberRepository(
      prisma as never,
      redis as never,
    )
    return { repo, prisma, commands, redis }
  }

  it('adds new, reactivates removed, ignores active members in a fixed number of commands', async () => {
    const people = Array.from({ length: 20 }, (_, i) => profile(i))
    const { repo, prisma, commands, redis } = setupAdd([
      { userId: people[0].userId, isActive: false },
      { userId: people[1].userId, isActive: true },
    ])

    const changed = await repo.addMembers(CONV, people)

    expect(changed).toBe(19) // 18 mới + 1 vào lại; người đang ở trong nhóm không tính
    expect(prisma.conversationMember.findMany).toHaveBeenCalledTimes(1)
    expect(prisma.conversationMember.createMany).toHaveBeenCalledTimes(1)
    expect(commands).toHaveLength(1)
    expect(redis.delMany).toHaveBeenCalledTimes(1)
  })

  it('new and returning members start fully read', async () => {
    const people = [profile(1), profile(2)]
    const { repo, prisma, commands } = setupAdd([
      { userId: people[0].userId, isActive: false },
    ])

    await repo.addMembers(CONV, people)

    const created = (
      prisma.conversationMember.createMany.mock.calls[0] as unknown as [
        { data: Record<string, unknown>[] },
      ]
    )[0].data
    expect(created[0]).toMatchObject({
      userId: people[1].userId,
      lastReadSeq: 120,
      latestSeq: 120,
    })
    const [update] = commands[0].updates as {
      u: { $set: Record<string, unknown> }
    }[]
    expect(update.u.$set).toMatchObject({
      isActive: true,
      lastReadSeq: 120,
      latestSeq: 120,
    })
  })
})
