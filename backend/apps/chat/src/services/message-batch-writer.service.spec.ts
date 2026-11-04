/* eslint-disable @typescript-eslint/no-unsafe-assignment -- matcher bất đối xứng của jest (expect.any...) có kiểu any */
import {
  MessageBatchWriter,
  type BatchMessageInput,
} from './message-batch-writer.service'
import { ConversationNotReadyError } from '../repositories/seq-allocator'

const CONV = '6a3500000000000000000c01'
const OTHER = '6a3500000000000000000c02'
const SENDER = '6a3500000000000000000a01'
const STORED_AT = new Date('2026-10-01T10:00:00Z')

const input = (n: number, conversationId = CONV): BatchMessageInput => ({
  conversationId,
  senderId: SENDER,
  type: 'TEXT',
  content: `m${n}`,
  clientMessageId: `c${n}`,
})

type Doc = Record<string, unknown> & {
  _id: { $oid: string }
  conversationId: { $oid: string }
  seq: number
  clientMessageId?: string
}
type InsertCommand = { insert: string; ordered: boolean; documents: Doc[] }
type StoredRow = {
  id: string
  senderId: string
  clientMessageId: string
  createdAt: Date
  updatedAt: Date
  seq?: number
}

const SEQ_DUP =
  'E11000 duplicate key error collection: chat-service.message index: message_conversation_seq dup key'
const CLIENT_DUP =
  'E11000 duplicate key error collection: chat-service.message index: message_sender_client_id dup key'

/**
 * Mongo giả cho đúng ba lệnh batch writer gửi: findAndModify (giữ chỗ seq),
 * insert (lô tin), find (tra bản đã lưu theo clientMessageId hoặc _id).
 */
function makeWriter(
  insertResult: (cmd: InsertCommand, call: number) => unknown,
  {
    stored = [] as StoredRow[],
    byId = [] as { id: string; seq: number }[],
    notReady = new Set<string>(),
    counters = new Map<string, number>(),
  } = {},
) {
  const inserts: InsertCommand[] = []
  const reserves: { conversationId: string; n: number }[] = []
  const finds: { filter: Record<string, unknown> }[] = []
  const prisma = {
    $runCommandRaw: jest.fn((cmd: Record<string, unknown>) => {
      if (cmd.findAndModify) {
        const id = (cmd.query as { _id: { $oid: string } })._id.$oid
        const n = (cmd.update as { $inc: { lastSeq: number } }).$inc.lastSeq
        reserves.push({ conversationId: id, n })
        if (notReady.has(id)) return Promise.resolve({ ok: 1, value: null })
        const next = (counters.get(id) ?? 0) + n
        counters.set(id, next)
        return Promise.resolve({
          ok: 1,
          value: { _id: { $oid: id }, lastSeq: next },
        })
      }
      if (cmd.find) {
        const filter = cmd.filter as Record<string, unknown>
        finds.push({ filter })
        const rows = filter._id
          ? byId.map((r) => ({
              _id: { $oid: r.id },
              seq: r.seq,
              createdAt: { $date: STORED_AT.toISOString() },
              updatedAt: { $date: STORED_AT.toISOString() },
            }))
          : stored.map((row) => ({
              _id: { $oid: row.id },
              senderId: { $oid: row.senderId },
              clientMessageId: row.clientMessageId,
              createdAt: { $date: row.createdAt.toISOString() },
              updatedAt: { $date: row.updatedAt.toISOString() },
              seq: row.seq ?? 99,
            }))
        return Promise.resolve({ cursor: { firstBatch: rows, id: 0 }, ok: 1 })
      }
      const insert = cmd as unknown as InsertCommand
      inserts.push(insert)
      try {
        return Promise.resolve(insertResult(insert, inserts.length))
      } catch (error) {
        return Promise.reject(error as Error)
      }
    }),
    message: { findMany: jest.fn(() => Promise.resolve([])) },
  }
  return {
    writer: new MessageBatchWriter(prisma as never),
    prisma,
    inserts,
    reserves,
    finds,
    counters,
  }
}

const ok = (cmd: InsertCommand) => ({ ok: 1, n: cmd.documents.length })

describe('MessageBatchWriter', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('writes a batch with one insert command using ordered false', async () => {
    const { writer, inserts } = makeWriter(ok)

    const pending = Promise.all([
      writer.enqueue(input(1)),
      writer.enqueue(input(2)),
    ])
    await jest.advanceTimersByTimeAsync(20)
    await pending

    expect(inserts).toHaveLength(1)
    const [cmd] = inserts
    expect(cmd.insert).toBe('message')
    expect(cmd.ordered).toBe(false)
    expect(cmd.documents.map((d) => d.clientMessageId)).toEqual(['c1', 'c2'])
    expect(cmd.documents[0]._id).toEqual({ $oid: expect.any(String) })
    expect(cmd.documents[0].senderId).toEqual({ $oid: SENDER })
    expect(cmd.documents[0].createdAt).toEqual({ $date: expect.any(String) })
  })

  it('assigns increasing seq per conversation in buffer order', async () => {
    const counters = new Map([
      [CONV, 10],
      [OTHER, 3],
    ])
    const { writer, inserts, reserves } = makeWriter(ok, { counters })

    const pending = Promise.all([
      writer.enqueue(input(1, CONV)),
      writer.enqueue(input(2, OTHER)),
      writer.enqueue(input(3, CONV)),
      writer.enqueue(input(4, OTHER)),
      writer.enqueue(input(5, CONV)),
    ])
    await jest.advanceTimersByTimeAsync(0)
    const saved = await pending

    expect(saved.map((m) => m.seq)).toEqual([11, 4, 12, 5, 13])
    expect(inserts[0].documents.map((d) => d.seq)).toEqual([11, 4, 12, 5, 13])
    // Một lần giữ chỗ cho mỗi hội thoại trong lô, không phải mỗi tin.
    expect(reserves).toEqual([
      { conversationId: CONV, n: 3 },
      { conversationId: OTHER, n: 2 },
    ])
  })

  it('stores the facets the asset tabs read', async () => {
    const { writer, inserts } = makeWriter(ok)

    const pending = Promise.all([
      writer.enqueue({ ...input(1), content: 'xem https://a.vn' }),
      writer.enqueue(input(2)),
    ])
    await jest.advanceTimersByTimeAsync(0)
    await pending

    expect(
      inserts[0].documents.map((d) => [d.hasLink, d.hasMedia, d.hasFile]),
    ).toEqual([
      [true, false, false],
      [false, false, false],
    ])
  })

  it('returns the stored message and its seq when the same clientMessageId is written twice', async () => {
    const { writer } = makeWriter(
      () => ({
        ok: 1,
        n: 0,
        writeErrors: [{ index: 0, code: 11000, errmsg: CLIENT_DUP }],
      }),
      {
        stored: [
          {
            id: 'old',
            senderId: SENDER,
            clientMessageId: 'c1',
            createdAt: STORED_AT,
            updatedAt: STORED_AT,
            seq: 4,
          },
        ],
      },
    )

    const pending = writer.enqueue(input(1))
    await jest.advanceTimersByTimeAsync(20)
    const saved = await pending

    expect(saved.id).toBe('old')
    expect(saved.seq).toBe(4)
    expect(saved.createdAt).toEqual(STORED_AT)
    expect(saved.replayed).toBe(true)
  })

  it('resolves every caller when one row of the batch is a duplicate', async () => {
    const { writer } = makeWriter(
      () => ({
        ok: 1,
        n: 2,
        writeErrors: [{ index: 1, code: 11000, errmsg: CLIENT_DUP }],
      }),
      {
        stored: [
          {
            id: 'old',
            senderId: SENDER,
            clientMessageId: 'c2',
            createdAt: STORED_AT,
            updatedAt: STORED_AT,
          },
        ],
      },
    )

    const pending = Promise.all([1, 2, 3].map((n) => writer.enqueue(input(n))))
    await jest.advanceTimersByTimeAsync(20)
    const [first, second, third] = await pending

    expect(second.id).toBe('old')
    expect(second.replayed).toBe(true)
    expect(first.id).not.toBe('old')
    expect(first.replayed).toBeUndefined()
    expect(third.id).not.toBe('old')
  })

  it('retries a failed batch with the same ids, createdAt and seq', async () => {
    const { writer, inserts, reserves } = makeWriter((cmd, call) => {
      if (call === 1) throw new Error('not primary')
      return ok(cmd)
    })

    const pending = writer.enqueue(input(1))
    await jest.advanceTimersByTimeAsync(20 + 50)
    const saved = await pending

    expect(inserts).toHaveLength(2)
    const [first, second] = inserts.map((cmd) => cmd.documents[0])
    expect(second._id).toEqual(first._id)
    expect(second.createdAt).toEqual(first.createdAt)
    expect(second.seq).toBe(first.seq)
    expect(reserves).toHaveLength(1)
    expect(saved.replayed).toBeUndefined()
  })

  it('does not treat a row its own failed attempt already inserted as a replay', async () => {
    let firstId = ''
    const results: unknown[] = [
      {
        ok: 1,
        n: 1,
        writeErrors: [{ index: 1, code: 91, errmsg: 'shutdown' }],
      },
      {
        ok: 1,
        n: 1,
        writeErrors: [{ index: 0, code: 11000, errmsg: CLIENT_DUP }],
      },
    ]
    const stored: StoredRow[] = []
    const { writer } = makeWriter(
      (cmd) => {
        firstId ||= cmd.documents[0]._id.$oid
        stored.splice(0, stored.length, {
          id: firstId,
          senderId: SENDER,
          clientMessageId: 'c1',
          createdAt: STORED_AT,
          updatedAt: STORED_AT,
        })
        return results.shift()
      },
      { stored },
    )

    const pending = Promise.all([
      writer.enqueue(input(1)),
      writer.enqueue(input(2)),
    ])
    await jest.advanceTimersByTimeAsync(20 + 50)
    const [first] = await pending

    expect(first.replayed).toBeUndefined()
  })

  it('rejects the batch after three retries on an error other than a duplicate key', async () => {
    const { writer, inserts } = makeWriter(() => ({
      ok: 1,
      n: 0,
      writeErrors: [{ index: 0, code: 121, errmsg: 'validation' }],
    }))

    const settled = writer.enqueue(input(1)).then(
      () => 'resolved',
      () => 'rejected',
    )
    await jest.advanceTimersByTimeAsync(20 + 50 + 200 + 800)

    await expect(settled).resolves.toBe('rejected')
    expect(inserts).toHaveLength(4)
  })

  it('a deleted conversation in the batch does not fail the others', async () => {
    const { writer, inserts, reserves } = makeWriter(ok, {
      notReady: new Set([OTHER]),
    })

    const kept = writer.enqueue(input(1, CONV))
    const refused = writer.enqueue(input(2, OTHER)).then(
      () => null,
      (error: unknown) => error,
    )
    await jest.advanceTimersByTimeAsync(0)

    await expect(kept).resolves.toMatchObject({ clientMessageId: 'c1', seq: 1 })
    await expect(refused).resolves.toBeInstanceOf(ConversationNotReadyError)
    expect(inserts).toHaveLength(1)
    expect(inserts[0].documents.map((d) => d.clientMessageId)).toEqual(['c1'])
    // Không thử lại hội thoại đã xoá.
    await jest.advanceTimersByTimeAsync(2000)
    expect(reserves.filter((r) => r.conversationId === OTHER)).toHaveLength(1)
  })

  it('a seq collision re-reserves only that conversation and is never acked as stored', async () => {
    const counters = new Map([
      [CONV, 0],
      [OTHER, 0],
    ])
    const { writer, inserts, reserves } = makeWriter(
      (cmd, call) =>
        call === 1
          ? {
              ok: 1,
              n: 1,
              writeErrors: [{ index: 1, code: 11000, errmsg: SEQ_DUP }],
            }
          : ok(cmd),
      { counters },
    )

    const pending = Promise.all([
      writer.enqueue(input(1, CONV)),
      writer.enqueue(input(2, OTHER)),
    ])
    await jest.advanceTimersByTimeAsync(20 + 50)
    const [a, b] = await pending

    expect(a.seq).toBe(1)
    expect(inserts).toHaveLength(2)
    expect(inserts[1].documents.map((d) => d.clientMessageId)).toEqual(['c2'])
    expect(inserts[1].documents[0].seq).toBe(2)
    expect(b.seq).toBe(2)
    expect(b.replayed).toBeUndefined()
    expect(reserves).toEqual([
      { conversationId: CONV, n: 1 },
      { conversationId: OTHER, n: 1 },
      { conversationId: OTHER, n: 1 },
    ])
  })

  it('a seq collision on a row that is already stored under its own _id keeps the stored seq', async () => {
    let id = ''
    const byId: { id: string; seq: number }[] = []
    const { writer, inserts } = makeWriter(
      (cmd) => {
        id = cmd.documents[0]._id.$oid
        byId.push({ id, seq: 7 })
        return {
          ok: 1,
          n: 0,
          writeErrors: [{ index: 0, code: 11000, errmsg: SEQ_DUP }],
        }
      },
      { byId },
    )

    const pending = writer.enqueue(input(1))
    await jest.advanceTimersByTimeAsync(0)
    const saved = await pending

    expect(inserts).toHaveLength(1)
    expect(saved.id).toBe(id)
    expect(saved.seq).toBe(7)
  })

  it('writes a lone message right away instead of waiting for a timer', async () => {
    const { writer, inserts } = makeWriter(ok)

    const pending = writer.enqueue(input(1))
    await jest.advanceTimersByTimeAsync(0)

    expect(inserts).toHaveLength(1)
    await expect(pending).resolves.toMatchObject({ clientMessageId: 'c1' })
  })

  it('gathers messages that arrive during a write into the next write', async () => {
    let finishFirst!: () => void
    const { writer, inserts } = makeWriter((cmd, call) =>
      call === 1
        ? new Promise((r) => (finishFirst = () => r({ ok: 1, n: 1 })))
        : ok(cmd),
    )

    const first = writer.enqueue(input(1))
    await jest.advanceTimersByTimeAsync(0)
    const rest = Promise.all([
      writer.enqueue(input(2)),
      writer.enqueue(input(3)),
    ])
    await jest.advanceTimersByTimeAsync(0)
    expect(inserts).toHaveLength(1)

    finishFirst()
    await first
    await jest.advanceTimersByTimeAsync(0)
    await rest

    expect(inserts).toHaveLength(2)
    expect(inserts[1].documents).toHaveLength(2)
  })

  it('never stamps a message earlier than the one before it when the clock steps back', async () => {
    const { writer } = makeWriter(ok)

    jest.setSystemTime(new Date('2026-11-01T06:17:27.985Z'))
    const first = writer.enqueue(input(1))
    jest.setSystemTime(new Date('2026-11-01T06:17:27.983Z'))
    const second = writer.enqueue(input(2))
    await jest.advanceTimersByTimeAsync(0)
    const [a, b] = await Promise.all([first, second])

    expect(b.createdAt.getTime()).toBeGreaterThanOrEqual(a.createdAt.getTime())
    expect(b.id > a.id).toBe(true)
    expect(b.seq).toBeGreaterThan(a.seq)
  })

  it('looks duplicates up through the partial dedup index, not through Prisma', async () => {
    const { writer, prisma, finds } = makeWriter(
      () => ({
        ok: 1,
        n: 0,
        writeErrors: [{ index: 0, code: 11000, errmsg: CLIENT_DUP }],
      }),
      {
        stored: [
          {
            id: 'old',
            senderId: SENDER,
            clientMessageId: 'c1',
            createdAt: STORED_AT,
            updatedAt: STORED_AT,
          },
        ],
      },
    )

    const pending = writer.enqueue(input(1))
    await jest.advanceTimersByTimeAsync(0)
    await pending

    expect(prisma.message.findMany).not.toHaveBeenCalled()
    expect(finds[0].filter.clientMessageId).toEqual({ $type: 'string' })
  })

  it('resolves a duplicate of a system message (no clientMessageId) by its _id', async () => {
    const byId: { id: string; seq: number }[] = []
    const { writer } = makeWriter(
      (cmd) => {
        byId.push({ id: cmd.documents[0]._id.$oid, seq: cmd.documents[0].seq })
        return {
          ok: 1,
          n: 0,
          writeErrors: [
            {
              index: 0,
              code: 11000,
              errmsg:
                'E11000 duplicate key error collection: chat-service.message index: _id_ dup key',
            },
          ],
        }
      },
      { byId },
    )

    const pending = writer.enqueue({
      ...input(1),
      clientMessageId: undefined,
      isSystem: true,
    })
    await jest.advanceTimersByTimeAsync(0)
    const saved = await pending

    expect(saved.replayed).toBeUndefined()
    expect(saved.seq).toBe(1)
  })
})
