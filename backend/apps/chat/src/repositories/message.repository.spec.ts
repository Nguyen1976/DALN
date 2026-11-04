import { MessageRepository } from './message.repository'
import { ConversationNotReadyError } from './seq-allocator'

const CONV = '6a35000000000000000c0001'
const SENDER = '6a35000000000000000a0001'

const media = {
  mediaType: 'IMAGE' as const,
  objectKey: 'chat/a.png',
  url: 'http://minio/a.png',
  mimeType: 'image/png',
  size: '10',
}

describe('MessageRepository.create', () => {
  it('returns the existing message when a media message is retried', async () => {
    const existing = {
      id: 'old',
      conversationId: CONV,
      senderId: SENDER,
      clientMessageId: 'c1',
      medias: [{ id: 'media-1' }],
      poll: null,
    }
    const prisma = {
      message: {
        create: jest.fn(() =>
          Promise.reject(
            Object.assign(new Error('Unique constraint failed'), {
              code: 'P2002',
            }),
          ),
        ),
        findUnique: jest.fn(() => Promise.resolve(existing)),
      },
      // Giữ chỗ seq, rồi tra id qua partial index bằng find thô, rồi Prisma đọc theo _id.
      $runCommandRaw: jest.fn((cmd: Record<string, unknown>) =>
        cmd.findAndModify
          ? Promise.resolve({ ok: 1, value: { lastSeq: 5 } })
          : Promise.resolve({
              cursor: {
                firstBatch: [
                  {
                    _id: { $oid: '6a35000000000000000b0001' },
                    senderId: { $oid: SENDER },
                    clientMessageId: 'c1',
                    createdAt: { $date: '2026-11-01T00:00:00.000Z' },
                    updatedAt: { $date: '2026-11-01T00:00:00.000Z' },
                  },
                ],
              },
            }),
      ),
    }
    const repo = new MessageRepository(prisma as never, {} as never)

    const saved = await repo.create({
      conversationId: CONV,
      senderId: SENDER,
      type: 'IMAGE',
      medias: [media],
      clientMessageId: 'c1',
    })

    expect(saved.id).toBe('old')
    expect(saved).toHaveProperty('replayed', true)
    expect(prisma.message.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: '6a35000000000000000b0001' } }),
    )
  })

  it('still rejects other write errors', async () => {
    const prisma = {
      message: {
        create: jest.fn(() => Promise.reject(new Error('connection lost'))),
        findUnique: jest.fn(),
      },
      $runCommandRaw: jest.fn(() =>
        Promise.resolve({ ok: 1, value: { lastSeq: 5 } }),
      ),
    }
    const repo = new MessageRepository(prisma as never, {} as never)

    await expect(
      repo.create({
        conversationId: CONV,
        senderId: SENDER,
        type: 'IMAGE',
        medias: [media],
        clientMessageId: 'c1',
      }),
    ).rejects.toThrow('connection lost')
    // Chỉ lệnh giữ chỗ seq; không tra bản đã lưu khi lỗi không phải trùng khoá.
    expect(prisma.$runCommandRaw).toHaveBeenCalledTimes(1)
  })
})

describe('MessageRepository.create onQueued', () => {
  it('signals as soon as a text message is in the write batch, before it is written', () => {
    const batchWriter = { enqueue: jest.fn(() => new Promise(() => {})) }
    const repo = new MessageRepository({} as never, batchWriter as never)
    const onQueued = jest.fn()

    void repo.create(
      {
        conversationId: CONV,
        senderId: SENDER,
        type: 'TEXT',
        content: 'hi',
        clientMessageId: 'c1',
      },
      onQueued,
    )

    expect(batchWriter.enqueue).toHaveBeenCalledTimes(1)
    expect(onQueued).toHaveBeenCalledTimes(1)
  })

  it('does not signal for a media message, whose createdAt is set when it is written', async () => {
    const prisma = {
      message: { create: jest.fn(() => Promise.resolve({ id: 'm1' })) },
      $runCommandRaw: jest.fn(() =>
        Promise.resolve({ ok: 1, value: { lastSeq: 1 } }),
      ),
    }
    const repo = new MessageRepository(prisma as never, {} as never)
    const onQueued = jest.fn()

    await repo.create(
      {
        conversationId: CONV,
        senderId: SENDER,
        type: 'IMAGE',
        medias: [media],
        clientMessageId: 'c1',
      },
      onQueued,
    )

    expect(onQueued).not.toHaveBeenCalled()
  })
})

describe('MessageRepository seq on every write path', () => {
  const makePrisma = (lastSeq: number | null) => ({
    message: {
      create: jest.fn((args: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'm1', ...args.data }),
      ),
    },
    $runCommandRaw: jest.fn(() =>
      Promise.resolve({ ok: 1, value: lastSeq === null ? null : { lastSeq } }),
    ),
  })
  const dataOf = (prisma: ReturnType<typeof makePrisma>) =>
    (
      prisma.message.create.mock.calls[0] as unknown as [
        { data: Record<string, unknown> },
      ]
    )[0].data

  it('a media message takes the next seq and is marked as media', async () => {
    const prisma = makePrisma(42)
    const repo = new MessageRepository(prisma as never, {} as never)

    const saved = await repo.create({
      conversationId: CONV,
      senderId: SENDER,
      type: 'IMAGE',
      medias: [media],
      clientMessageId: 'c1',
    })

    expect(dataOf(prisma)).toMatchObject({
      seq: 42,
      hasMedia: true,
      hasFile: false,
      hasLink: false,
    })
    expect(saved).toMatchObject({ seq: 42 })
  })

  it('a file with a link in its caption is marked as both', async () => {
    const prisma = makePrisma(7)
    const repo = new MessageRepository(prisma as never, {} as never)

    await repo.create({
      conversationId: CONV,
      senderId: SENDER,
      type: 'FILE',
      content: 'xem www.a.vn',
      medias: [
        { ...media, mediaType: 'FILE' as never, mimeType: 'application/pdf' },
      ],
    })

    expect(dataOf(prisma)).toMatchObject({
      seq: 7,
      hasMedia: false,
      hasFile: true,
      hasLink: true,
    })
  })

  it('a poll message takes a seq', async () => {
    const prisma = makePrisma(3)
    const repo = new MessageRepository(prisma as never, {} as never)

    await repo.create({
      conversationId: CONV,
      senderId: SENDER,
      type: 'POLL',
      content: 'ăn gì?',
      pollId: '6a35000000000000000f0001',
    })

    expect(dataOf(prisma)).toMatchObject({
      seq: 3,
      hasMedia: false,
      hasFile: false,
      hasLink: false,
    })
  })

  it('a call log takes a seq', async () => {
    const prisma = makePrisma(9)
    const repo = new MessageRepository(prisma as never, {} as never)

    const saved = await repo.createCallLog({
      conversationId: CONV,
      senderId: SENDER,
      content: 'Cuộc gọi',
      callInfo: { outcome: 'ended' },
    })

    expect(dataOf(prisma)).toMatchObject({ seq: 9, type: 'CALL' })
    expect(saved).toMatchObject({ seq: 9 })
  })

  it('refuses to write into a conversation that does not take messages', async () => {
    const prisma = makePrisma(null)
    const repo = new MessageRepository(prisma as never, {} as never)

    await expect(
      repo.createCallLog({
        conversationId: CONV,
        senderId: SENDER,
        content: 'x',
        callInfo: {},
      }),
    ).rejects.toBeInstanceOf(ConversationNotReadyError)
    expect(prisma.message.create).not.toHaveBeenCalled()
  })
})

describe('MessageRepository history and assets by seq', () => {
  type Row = { id: string; seq: number }
  const rows = (from: number, to: number): Row[] => {
    const out: Row[] = []
    for (let s = from; from <= to ? s <= to : s >= to; s += from <= to ? 1 : -1)
      out.push({ id: `m${s}`, seq: s })
    return out
  }
  function makePrisma(pages: Row[][], deleted: string[] = []) {
    const findMany = jest.fn(() => Promise.resolve(pages.shift() ?? []))
    return {
      message: { findMany },
      deleteMessage: {
        findMany: jest.fn(() =>
          Promise.resolve(deleted.map((messageId) => ({ messageId }))),
        ),
      },
    }
  }
  const argsOf = (prisma: ReturnType<typeof makePrisma>, call = 0) =>
    (
      prisma.message.findMany.mock.calls[call] as unknown as [
        { where: Record<string, unknown>; orderBy: unknown; take: number },
      ]
    )[0]

  it('pages by seq, newest first, below the cursor', async () => {
    const prisma = makePrisma([rows(49, 20)])
    const repo = new MessageRepository(prisma as never, {} as never)

    const page = await repo.findByConversationIdPaginatedForUser(
      CONV,
      SENDER,
      10,
      { beforeSeq: 50, afterSeq: null, clearedHistorySeq: null },
    )

    expect(page.map((m) => m.seq)).toEqual([
      49, 48, 47, 46, 45, 44, 43, 42, 41, 40,
    ])
    expect(argsOf(prisma).where).toEqual({
      conversationId: CONV,
      AND: [{ seq: { lt: 50 } }],
    })
    expect(argsOf(prisma).orderBy).toEqual({ seq: 'desc' })
  })

  it('respects clearedHistorySeq and delete-for-me', async () => {
    const prisma = makePrisma([rows(10, 1)], ['m9'])
    const repo = new MessageRepository(prisma as never, {} as never)

    const page = await repo.findByConversationIdPaginatedForUser(
      CONV,
      SENDER,
      3,
      { beforeSeq: null, afterSeq: null, clearedHistorySeq: 6 },
    )

    expect(argsOf(prisma).where).toEqual({
      conversationId: CONV,
      AND: [{ seq: { gt: 6 } }],
    })
    expect(page.map((m) => m.seq)).toEqual([10, 8, 7])
  })

  it('afterSeq returns newer messages ascending', async () => {
    const prisma = makePrisma([rows(121, 130)])
    const repo = new MessageRepository(prisma as never, {} as never)

    const page = await repo.findByConversationIdPaginatedForUser(
      CONV,
      SENDER,
      5,
      { beforeSeq: null, afterSeq: 120, clearedHistorySeq: 100 },
    )

    expect(page.map((m) => m.seq)).toEqual([121, 122, 123, 124, 125])
    expect(argsOf(prisma).where).toEqual({
      conversationId: CONV,
      AND: [{ seq: { gt: 120 } }, { seq: { gt: 100 } }],
    })
    expect(argsOf(prisma).orderBy).toEqual({ seq: 'asc' })
  })

  it('keeps reading past rows deleted for this user', async () => {
    const deleted = rows(30, 1)
      .map((r) => r.id)
      .filter((id) => id !== 'm2')
    const prisma = makePrisma([rows(30, 1), []], deleted)
    const repo = new MessageRepository(prisma as never, {} as never)

    const page = await repo.findByConversationIdPaginatedForUser(
      CONV,
      SENDER,
      5,
      { beforeSeq: null, afterSeq: null, clearedHistorySeq: null },
    )

    expect(page.map((m) => m.seq)).toEqual([2])
    // A full batch of mostly deleted rows: read on from where it ended.
    expect(prisma.message.findMany).toHaveBeenCalledTimes(2)
    expect(argsOf(prisma, 1).where).toEqual({
      conversationId: CONV,
      AND: [{ seq: { lt: 1 } }],
    })
  })

  it.each([
    ['MEDIA', { hasMedia: true }],
    ['DOC', { hasFile: true }],
    ['LINK', { hasLink: true }],
  ] as const)(
    'assets %s filter on the stored flag, no $lookup, by seq',
    async (kind, flag) => {
      const prisma = makePrisma([rows(9, 1)])
      const repo = new MessageRepository(prisma as never, {} as never)

      await repo.findConversationAssets(CONV, kind, 30, 40)

      const { where, orderBy } = argsOf(prisma)
      expect(where).toEqual({
        conversationId: CONV,
        ...flag,
        isDeleted: false,
        isRevoked: false,
        seq: { lt: 40 },
      })
      expect(JSON.stringify(where)).not.toContain('medias')
      expect(orderBy).toEqual({ seq: 'desc' })
    },
  )
})
