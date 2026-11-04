import { ConversationNotReadyError, reserveSeq } from './seq-allocator'

const CONV = '6a3500000000000000000c01'

function makePrisma(value: unknown) {
  const commands: Record<string, unknown>[] = []
  const prisma = {
    $runCommandRaw: jest.fn((cmd: Record<string, unknown>) => {
      commands.push(cmd)
      return Promise.resolve({ ok: 1, value })
    }),
  }
  return { prisma, commands }
}

describe('reserveSeq', () => {
  it('reserves a contiguous range and returns its first seq', async () => {
    const { prisma, commands } = makePrisma({
      _id: { $oid: CONV },
      lastSeq: 12,
    })

    await expect(reserveSeq(prisma as never, CONV, 3)).resolves.toBe(10)

    expect(commands[0]).toMatchObject({
      findAndModify: 'conversation',
      update: { $inc: { lastSeq: 3 } },
      new: true,
    })
  })

  it('only counts on a migrated, live conversation', async () => {
    const { prisma, commands } = makePrisma({ _id: { $oid: CONV }, lastSeq: 1 })

    await reserveSeq(prisma as never, CONV, 1)

    expect(commands[0].query).toEqual({
      _id: { $oid: CONV },
      lastSeq: { $type: 'number' },
      deletedAt: null,
    })
  })

  it('refuses a conversation that is deleted, missing or not migrated', async () => {
    const { prisma } = makePrisma(null)

    await expect(reserveSeq(prisma as never, CONV, 1)).rejects.toBeInstanceOf(
      ConversationNotReadyError,
    )
  })

  it('does not touch the database for an empty range', async () => {
    const { prisma } = makePrisma(null)

    await expect(reserveSeq(prisma as never, CONV, 0)).rejects.toThrow()
    expect(prisma.$runCommandRaw).not.toHaveBeenCalled()
  })
})
