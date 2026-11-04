/**
 * Lệnh thô của chat chạy trên Mongo và Redis THẬT (MONGO_IT=1, stack dev đang
 * chạy). Unit test với Prisma giả không bắt được: id viết sai kiểu (chuỗi thay
 * vì {$oid}) làm lệnh lặng lẽ không khớp dòng nào, ngữ nghĩa $max / pipeline
 * $cond, chuỗi lỗi E11000 thật khi đụng (conversationId, seq), và Lua.
 *
 *   MONGO_IT=1 npx jest apps/chat/src/repositories/raw-commands.mongo
 *
 * Dùng DB riêng `chat-itest`, xoá sạch trước mỗi test.
 */
import { Redis } from 'ioredis'
import { ObjectId } from 'mongodb'
import { PrismaClient } from 'apps/chat/src/generated'
import { ConversationMemberRepository } from './conversation-member.repository'
import { ConversationRepository } from './conversation.repository'
import { ConversationNotReadyError, reserveSeq } from './seq-allocator'
import { MessageBatchWriter } from '../services/message-batch-writer.service'
import {
  CLAIM_SCRIPT,
  RESTORE_SCRIPT,
  SET_LAST_MESSAGE_SCRIPT,
  SET_NEWEST_SEQ_SCRIPT,
} from '../background-jobs/unread/unread.constants'

const run = process.env.MONGO_IT ? describe : describe.skip
const URL =
  process.env.MONGO_IT_URL ??
  'mongodb://localhost:27017/chat-itest?replicaSet=rs0&directConnection=true'

run('chat raw commands on a real MongoDB', () => {
  let prisma: PrismaClient
  const redis = { delMany: jest.fn(() => Promise.resolve()) }
  const id = () => new ObjectId().toHexString()

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL } } })
    await prisma.$connect()
  })
  afterAll(async () => {
    await prisma.$runCommandRaw({ dropDatabase: 1 })
    await prisma.$disconnect()
  })
  beforeEach(async () => {
    for (const c of ['conversation', 'conversationMember', 'message']) {
      await prisma.$runCommandRaw({ delete: c, deletes: [{ q: {}, limit: 0 }] })
    }
    await prisma.$runCommandRaw({
      createIndexes: 'message',
      indexes: [
        {
          key: { conversationId: 1, seq: 1 },
          name: 'message_conversation_seq',
          unique: true,
        },
      ],
    })
  })

  async function conversation(
    fields: Record<string, unknown> = { lastSeq: 0 },
  ) {
    const conv = await prisma.conversation.create({
      data: { type: 'GROUP', memberCount: 0, ...fields },
    })
    return conv.id
  }
  async function member(
    conversationId: string,
    userId: string,
    fields: Record<string, unknown> = {},
  ) {
    await prisma.conversationMember.create({
      data: {
        conversationId,
        userId,
        isActive: true,
        unreadCount: 0,
        lastReadMessageId: null,
        lastReadSeq: 0,
        latestSeq: 0,
        ...fields,
      },
    })
  }
  const row = (conversationId: string, userId: string) =>
    prisma.conversationMember.findFirst({ where: { conversationId, userId } })

  it('reserveSeq hands out disjoint ranges under concurrency and refuses unready conversations', async () => {
    const conv = await conversation()
    const firsts = await Promise.all(
      Array.from({ length: 50 }, () => reserveSeq(prisma, conv, 2)),
    )

    const taken = firsts
      .flatMap((first) => [first, first + 1])
      .sort((a, b) => a - b)
    expect(taken).toEqual(Array.from({ length: 100 }, (_, i) => i + 1))
    expect(
      (await prisma.conversation.findUnique({ where: { id: conv } }))?.lastSeq,
    ).toBe(100)

    const unmigrated = await conversation({})
    const deleted = await conversation({ lastSeq: 3, deletedAt: new Date() })
    await expect(reserveSeq(prisma, unmigrated, 1)).rejects.toBeInstanceOf(
      ConversationNotReadyError,
    )
    await expect(reserveSeq(prisma, deleted, 1)).rejects.toBeInstanceOf(
      ConversationNotReadyError,
    )
  })

  it('the batch writer numbers a batch, and survives a real seq collision', async () => {
    const conv = await conversation()
    const sender = id()
    const writer = new MessageBatchWriter(prisma as never)
    const first = await Promise.all(
      [1, 2, 3].map((n) =>
        writer.enqueue({
          conversationId: conv,
          senderId: sender,
          type: 'TEXT',
          content: `m${n}`,
          clientMessageId: `c${n}`,
        }),
      ),
    )
    expect(first.map((m) => m.seq)).toEqual([1, 2, 3])

    // Ai đó (zombie, bug) đã chiếm seq 4 mà không tăng bộ đếm.
    await prisma.$runCommandRaw({
      insert: 'message',
      documents: [
        {
          _id: { $oid: id() },
          conversationId: { $oid: conv },
          senderId: { $oid: sender },
          type: 'TEXT',
          seq: 4,
          createdAt: { $date: new Date().toISOString() },
          updatedAt: { $date: new Date().toISOString() },
        },
      ],
    })
    const next = await writer.enqueue({
      conversationId: conv,
      senderId: sender,
      type: 'TEXT',
      content: 'm4',
      clientMessageId: 'c4',
    })
    expect(next.seq).toBe(5)
    expect(
      await prisma.message.count({
        where: { conversationId: conv, clientMessageId: 'c4' },
      }),
    ).toBe(1)
    await writer.beforeApplicationShutdown()
  })

  it('read marks only move forward and clear the mention badge once past it', async () => {
    const conv = await conversation({ lastSeq: 10 })
    const user = id()
    await member(conv, user, {
      unreadMentionCount: 1,
      lastMentionSeq: 8,
      lastMentionMessageId: id(),
    })
    const msg = async (seq: number) =>
      (
        await prisma.message.create({
          data: {
            conversationId: conv,
            senderId: id(),
            type: 'TEXT',
            content: `s${seq}`,
            seq,
          },
        })
      ).id
    const [m5, m9, m7] = [await msg(5), await msg(9), await msg(7)]
    const repo = new ConversationMemberRepository(
      prisma as never,
      redis as never,
    )

    await expect(repo.updateLastRead(conv, user, m5)).resolves.toEqual({
      count: 1,
    })
    expect(await row(conv, user)).toMatchObject({
      lastReadSeq: 5,
      lastReadMessageId: m5,
      unreadMentionCount: 1,
    })
    await repo.updateLastRead(conv, user, m9)
    expect(await row(conv, user)).toMatchObject({
      lastReadSeq: 9,
      unreadMentionCount: 0,
      lastMentionMessageId: null,
    })
    await expect(repo.updateLastRead(conv, user, m7)).resolves.toEqual({
      count: 0,
    })
    expect(await row(conv, user)).toMatchObject({
      lastReadSeq: 9,
      lastReadMessageId: m9,
    })
  })

  it('mentions skip whoever read past them; members and senders advance with $max', async () => {
    const conv = await conversation({ lastSeq: 20 })
    const [reader, behind, sender] = [id(), id(), id()]
    await member(conv, reader, { lastReadSeq: 15 })
    await member(conv, behind, { lastReadSeq: 3 })
    await member(conv, sender, {
      lastReadSeq: 3,
      unreadMentionCount: 2,
      lastMentionSeq: 12,
    })
    const repo = new ConversationMemberRepository(
      prisma as never,
      redis as never,
    )
    const mentionId = id()

    await repo.markMention(conv, [reader, behind], mentionId, 14)
    expect(await row(conv, reader)).toMatchObject({ unreadMentionCount: 0 })
    expect(await row(conv, behind)).toMatchObject({
      unreadMentionCount: 1,
      lastMentionSeq: 14,
      lastMentionMessageId: mentionId,
    })

    await repo.advanceMembers(conv, {
      lastMessageAt: new Date('2026-11-04T10:00:00Z'),
      seq: 20,
    })
    await repo.advanceMembers(conv, {
      lastMessageAt: new Date('2026-11-04T09:00:00Z'),
      seq: 18,
    })
    expect(await row(conv, behind)).toMatchObject({
      latestSeq: 20,
      lastMessageAt: new Date('2026-11-04T10:00:00Z'),
    })

    await repo.advanceReadOfSenders(conv, [{ senderId: sender, seq: 13 }])
    expect(await row(conv, sender)).toMatchObject({
      lastReadSeq: 13,
      unreadMentionCount: 0,
    })
    await repo.advanceReadOfSenders(conv, [{ senderId: sender, seq: 4 }])
    expect(await row(conv, sender)).toMatchObject({ lastReadSeq: 13 })
  })

  it('adding members starts them fully read; clearing history hides and reads everything', async () => {
    const conv = await conversation({ lastSeq: 42 })
    const [gone, fresh] = [id(), id()]
    await member(conv, gone, { isActive: false, lastReadSeq: 2, latestSeq: 2 })
    const repo = new ConversationMemberRepository(
      prisma as never,
      redis as never,
    )

    const changed = await repo.addMembers(conv, [
      { userId: gone, username: 'gone', fullName: 'Gone', avatar: null },
      { userId: fresh, username: 'fresh', fullName: 'Fresh', avatar: null },
    ])
    expect(changed).toBe(2)
    expect(await row(conv, gone)).toMatchObject({
      isActive: true,
      lastReadSeq: 42,
      latestSeq: 42,
    })
    expect(await row(conv, fresh)).toMatchObject({
      isActive: true,
      lastReadSeq: 42,
      latestSeq: 42,
    })

    await prisma.conversation.update({
      where: { id: conv },
      data: { lastSeq: 50 },
    })
    await repo.clearHistoryForMember(conv, fresh, new Date())
    expect(await row(conv, fresh)).toMatchObject({
      clearedHistorySeq: 50,
      lastReadSeq: 50,
    })
  })

  it('the last message only moves forward; a deleted conversation is hidden', async () => {
    const conv = await conversation({ lastSeq: 9 })
    const repo = new ConversationRepository(prisma as never, redis as never)
    const [m6, m4] = [id(), id()]

    await repo.saveLastMessage(conv, {
      seq: 6,
      lastMessageId: m6,
      lastMessageText: 'sáu',
      lastMessageAt: new Date(),
    })
    await repo.saveLastMessage(conv, {
      seq: 4,
      lastMessageId: m4,
      lastMessageText: 'bốn',
      lastMessageAt: new Date(),
    })
    expect(
      await prisma.conversation.findUnique({ where: { id: conv } }),
    ).toMatchObject({
      lastMessageSeq: 6,
      lastMessageId: m6,
      lastMessageText: 'sáu',
    })

    const user = id()
    await member(conv, user)
    await repo.deleteConversationById(conv)
    await expect(repo.findById(conv)).resolves.toBeNull()
    expect(await row(conv, user)).toMatchObject({ isActive: false })
    await expect(reserveSeq(prisma, conv, 1)).rejects.toBeInstanceOf(
      ConversationNotReadyError,
    )
  })
})

run('unread Lua scripts on a real Redis', () => {
  let r: Redis
  const k = (name: string) => `itest:${name}:${process.pid}`
  beforeAll(() => {
    r = new Redis(process.env.REDIS_IT_URL ?? 'redis://localhost:6380')
  })
  afterAll(async () => {
    await r.del(k('count'), k('last'), k('newest'))
    r.disconnect()
  })

  it('set-if-greater for the sender seq and the last message, claim and restore', async () => {
    await r.del(k('count'), k('last'), k('newest'))
    await r.eval(SET_NEWEST_SEQ_SCRIPT, 1, k('newest'), 'a', 7)
    await r.eval(SET_NEWEST_SEQ_SCRIPT, 1, k('newest'), 'a', 5)
    await r.hset(k('newest'), 'b', '6a350000000000000000ab01') // ObjectId của bản cũ
    await r.eval(SET_NEWEST_SEQ_SCRIPT, 1, k('newest'), 'b', 2)
    expect(await r.hgetall(k('newest'))).toEqual({ a: '7', b: '2' })

    await r.eval(
      SET_LAST_MESSAGE_SCRIPT,
      1,
      k('last'),
      9,
      JSON.stringify({ seq: 9, t: 'chín' }),
    )
    await r.eval(
      SET_LAST_MESSAGE_SCRIPT,
      1,
      k('last'),
      8,
      JSON.stringify({ seq: 8, t: 'tám' }),
    )
    expect(JSON.parse(String(await r.get(k('last'))))).toEqual({
      seq: 9,
      t: 'chín',
    })

    const claimed = (await r.eval(
      CLAIM_SCRIPT,
      3,
      k('count'),
      k('last'),
      k('newest'),
    )) as [string, string[]]
    expect(JSON.parse(claimed[0])).toEqual({ seq: 9, t: 'chín' })
    expect(claimed[1]).toEqual(['a', '7', 'b', '2'])
    expect(await r.exists(k('last'), k('newest'))).toBe(0)

    // Tin mới hơn tới sau lúc claim: restore không được đè nó, không hạ seq.
    await r.eval(
      SET_LAST_MESSAGE_SCRIPT,
      1,
      k('last'),
      10,
      JSON.stringify({ seq: 10, t: 'mười' }),
    )
    await r.hset(k('newest'), 'a', '11')
    await r.eval(
      RESTORE_SCRIPT,
      3,
      k('count'),
      k('last'),
      k('newest'),
      JSON.stringify({ newest: { a: 7, b: 2 }, last: claimed[0], lastSeq: 9 }),
    )
    expect(JSON.parse(String(await r.get(k('last'))))).toEqual({
      seq: 10,
      t: 'mười',
    })
    expect(await r.hgetall(k('newest'))).toEqual({ a: '11', b: '2' })
  })
})
