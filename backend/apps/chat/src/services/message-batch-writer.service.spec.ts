/* eslint-disable @typescript-eslint/no-unsafe-assignment -- matcher bất đối xứng của jest (expect.any...) có kiểu any */
import {
  MessageBatchWriter,
  type BatchMessageInput,
} from './message-batch-writer.service'

const CONV = '6a3500000000000000000c01'
const SENDER = '6a3500000000000000000a01'
const STORED_AT = new Date('2026-10-01T10:00:00Z')

const input = (n: number): BatchMessageInput => ({
  conversationId: CONV,
  senderId: SENDER,
  type: 'TEXT',
  content: `m${n}`,
  clientMessageId: `c${n}`,
})

type InsertCommand = {
  insert: string
  ordered: boolean
  documents: Record<string, unknown>[]
}
/** Writer gửi cả insert lẫn find qua $runCommandRaw; find mang filter. */
type RawCommand = InsertCommand & {
  find?: string
  filter?: Record<string, unknown>
}
type StoredRow = {
  id: string
  senderId: string
  clientMessageId: string
  createdAt: Date
  updatedAt: Date
}

/** Kết quả `find` thô như MongoDB trả qua $runCommandRaw (extended JSON). */
const findResult = (rows: StoredRow[]) => ({
  cursor: {
    firstBatch: rows.map((row) => ({
      _id: { $oid: row.id },
      senderId: { $oid: row.senderId },
      clientMessageId: row.clientMessageId,
      createdAt: { $date: row.createdAt.toISOString() },
      updatedAt: { $date: row.updatedAt.toISOString() },
    })),
    id: 0,
  },
  ok: 1,
})

function makeWriter(
  insertResult: (cmd: InsertCommand) => unknown,
  stored: StoredRow[] = [],
) {
  const prisma = {
    $runCommandRaw: jest.fn((cmd: RawCommand) =>
      cmd.find
        ? Promise.resolve(findResult(stored))
        : Promise.resolve(insertResult(cmd)),
    ),
    message: { findMany: jest.fn(() => Promise.resolve([])) },
  }
  return { writer: new MessageBatchWriter(prisma as never), prisma }
}

describe('MessageBatchWriter', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('writes a batch with one insert command using ordered false', async () => {
    const { writer, prisma } = makeWriter((cmd) => ({
      ok: 1,
      n: cmd.documents.length,
    }))

    const pending = Promise.all([
      writer.enqueue(input(1)),
      writer.enqueue(input(2)),
    ])
    await jest.advanceTimersByTimeAsync(20)
    await pending

    expect(prisma.$runCommandRaw).toHaveBeenCalledTimes(1)
    const [cmd] = prisma.$runCommandRaw.mock.calls[0]
    expect(cmd.insert).toBe('message')
    expect(cmd.ordered).toBe(false)
    expect(cmd.documents.map((d) => d.clientMessageId)).toEqual(['c1', 'c2'])
    expect(cmd.documents[0]._id).toEqual({ $oid: expect.any(String) })
    expect(cmd.documents[0].senderId).toEqual({ $oid: SENDER })
    expect(cmd.documents[0].createdAt).toEqual({ $date: expect.any(String) })
  })

  it('returns the stored message when the same clientMessageId is written twice', async () => {
    const { writer } = makeWriter(
      () => ({ ok: 1, n: 0, writeErrors: [{ index: 0, code: 11000 }] }),
      [
        {
          id: 'old',
          senderId: SENDER,
          clientMessageId: 'c1',
          createdAt: STORED_AT,
          updatedAt: STORED_AT,
        },
      ],
    )

    const pending = writer.enqueue(input(1))
    await jest.advanceTimersByTimeAsync(20)
    const saved = await pending

    expect(saved.id).toBe('old')
    expect(saved.createdAt).toEqual(STORED_AT)
    expect(saved.replayed).toBe(true)
  })

  it('resolves every caller when one row of the batch is a duplicate', async () => {
    const { writer } = makeWriter(
      () => ({ ok: 1, n: 2, writeErrors: [{ index: 1, code: 11000 }] }),
      [
        {
          id: 'old',
          senderId: SENDER,
          clientMessageId: 'c2',
          createdAt: STORED_AT,
          updatedAt: STORED_AT,
        },
      ],
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

  it('retries a failed batch with the same ids and createdAt', async () => {
    let calls = 0
    const { writer, prisma } = makeWriter((cmd) => {
      calls += 1
      if (calls === 1) throw new Error('not primary')
      return { ok: 1, n: cmd.documents.length }
    })

    const pending = writer.enqueue(input(1))
    await jest.advanceTimersByTimeAsync(20 + 50)
    const saved = await pending

    expect(prisma.$runCommandRaw).toHaveBeenCalledTimes(2)
    const [first, second] = prisma.$runCommandRaw.mock.calls.map(
      ([cmd]) => cmd.documents[0],
    )
    expect(second._id).toEqual(first._id)
    expect(second.createdAt).toEqual(first.createdAt)
    expect(saved.replayed).toBeUndefined()
  })

  it('does not treat a row its own failed attempt already inserted as a replay', async () => {
    const results = [
      {
        ok: 1,
        n: 1,
        writeErrors: [{ index: 1, code: 91, errmsg: 'shutdown' }],
      },
      { ok: 1, n: 1, writeErrors: [{ index: 0, code: 11000 }] },
    ]
    const calls: InsertCommand[] = []
    const prisma = {
      $runCommandRaw: jest.fn((cmd: InsertCommand | { find: string }) => {
        if ('find' in cmd) {
          const doc = calls[0].documents[0] as { _id: { $oid: string } }
          return Promise.resolve(
            findResult([
              {
                id: doc._id.$oid,
                senderId: SENDER,
                clientMessageId: 'c1',
                createdAt: STORED_AT,
                updatedAt: STORED_AT,
              },
            ]),
          )
        }
        calls.push(cmd)
        return Promise.resolve(results.shift())
      }),
    }
    const writer = new MessageBatchWriter(prisma as never)

    const pending = Promise.all([
      writer.enqueue(input(1)),
      writer.enqueue(input(2)),
    ])
    await jest.advanceTimersByTimeAsync(20 + 50)
    const [first] = await pending

    expect(first.replayed).toBeUndefined()
  })

  it('rejects the batch after three retries on an error other than a duplicate key', async () => {
    const { writer, prisma } = makeWriter(() => ({
      ok: 1,
      n: 0,
      writeErrors: [{ index: 0, code: 121, errmsg: 'validation' }],
    }))

    const pending = writer.enqueue(input(1))
    const settled = pending.then(
      () => 'resolved',
      () => 'rejected',
    )
    await jest.advanceTimersByTimeAsync(20 + 50 + 200 + 800)

    await expect(settled).resolves.toBe('rejected')
    expect(prisma.$runCommandRaw).toHaveBeenCalledTimes(4)
  })

  it('writes a lone message right away instead of waiting for a timer', async () => {
    const { writer, prisma } = makeWriter((cmd) => ({
      ok: 1,
      n: cmd.documents.length,
    }))

    const pending = writer.enqueue(input(1))
    await jest.advanceTimersByTimeAsync(0)

    expect(prisma.$runCommandRaw).toHaveBeenCalledTimes(1)
    await expect(pending).resolves.toMatchObject({ clientMessageId: 'c1' })
  })

  it('gathers messages that arrive during a write into the next write', async () => {
    let finishFirst!: () => void
    const calls: InsertCommand[] = []
    const prisma = {
      $runCommandRaw: jest.fn((cmd: InsertCommand) => {
        calls.push(cmd)
        return calls.length === 1
          ? new Promise((r) => (finishFirst = () => r({ ok: 1, n: 1 })))
          : Promise.resolve({ ok: 1, n: cmd.documents.length })
      }),
      message: { findMany: jest.fn(() => Promise.resolve([])) },
    }
    const writer = new MessageBatchWriter(prisma as never)

    const first = writer.enqueue(input(1))
    await jest.advanceTimersByTimeAsync(0)
    const rest = Promise.all([
      writer.enqueue(input(2)),
      writer.enqueue(input(3)),
    ])
    await jest.advanceTimersByTimeAsync(0)
    expect(calls).toHaveLength(1)

    finishFirst()
    await first
    await jest.advanceTimersByTimeAsync(0)
    await rest

    expect(calls).toHaveLength(2)
    expect(calls[1].documents).toHaveLength(2)
  })

  it('never stamps a message earlier than the one before it when the clock steps back', async () => {
    const { writer } = makeWriter((cmd) => ({ ok: 1, n: cmd.documents.length }))

    jest.setSystemTime(new Date('2026-11-01T06:17:27.985Z'))
    const first = writer.enqueue(input(1))
    jest.setSystemTime(new Date('2026-11-01T06:17:27.983Z'))
    const second = writer.enqueue(input(2))
    await jest.advanceTimersByTimeAsync(0)
    const [a, b] = await Promise.all([first, second])

    expect(b.createdAt.getTime()).toBeGreaterThanOrEqual(a.createdAt.getTime())
    expect(b.id > a.id).toBe(true)
  })

  it('looks duplicates up through the partial dedup index, not through Prisma', async () => {
    const { writer, prisma } = makeWriter(
      () => ({ ok: 1, n: 0, writeErrors: [{ index: 0, code: 11000 }] }),
      [
        {
          id: 'old',
          senderId: SENDER,
          clientMessageId: 'c1',
          createdAt: STORED_AT,
          updatedAt: STORED_AT,
        },
      ],
    )

    const pending = writer.enqueue(input(1))
    await jest.advanceTimersByTimeAsync(0)
    await pending

    expect(prisma.message.findMany).not.toHaveBeenCalled()
    const find = prisma.$runCommandRaw.mock.calls
      .map(([cmd]) => cmd)
      .find((cmd) => cmd.find)
    expect(find?.filter?.clientMessageId).toEqual({ $type: 'string' })
  })
})
