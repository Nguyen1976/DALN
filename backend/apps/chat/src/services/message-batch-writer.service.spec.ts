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

function makeWriter(
  insertResult: (cmd: InsertCommand) => unknown,
  stored: Record<string, unknown>[] = [],
) {
  const prisma = {
    $runCommandRaw: jest.fn((cmd: InsertCommand) =>
      Promise.resolve(insertResult(cmd)),
    ),
    message: { findMany: jest.fn(() => Promise.resolve(stored)) },
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

  it('rejects the whole batch on an error other than a duplicate key', async () => {
    const { writer } = makeWriter(() => ({
      ok: 1,
      n: 0,
      writeErrors: [{ index: 0, code: 121, errmsg: 'validation' }],
    }))

    const pending = writer.enqueue(input(1))
    const settled = pending.then(
      () => 'resolved',
      () => 'rejected',
    )
    await jest.advanceTimersByTimeAsync(20)

    await expect(settled).resolves.toBe('rejected')
  })

  it('QC switch CHAT_QC_DISABLE_DEDUP writes without clientMessageId', async () => {
    process.env.CHAT_QC_DISABLE_DEDUP = '1'
    try {
      const { writer, prisma } = makeWriter((cmd) => ({
        ok: 1,
        n: cmd.documents.length,
      }))

      const pending = writer.enqueue(input(1))
      await jest.advanceTimersByTimeAsync(20)
      await pending

      const [cmd] = prisma.$runCommandRaw.mock.calls[0]
      expect(cmd.documents[0]).not.toHaveProperty('clientMessageId')
    } finally {
      delete process.env.CHAT_QC_DISABLE_DEDUP
    }
  })
})
