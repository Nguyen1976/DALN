import {
  findIdByPollId,
  findStoredByIds,
  findStoredBySenderClientIds,
} from './message-raw.queries'

const SENDER = '6a35000000000000000a0001'
const AT = '2026-11-01T02:50:42.382Z'

type FindCommand = {
  find: string
  filter: Record<string, unknown>
  projection: Record<string, unknown>
}

function makePrisma(firstBatch: unknown[]) {
  const commands: FindCommand[] = []
  const prisma = {
    $runCommandRaw: jest.fn((cmd: FindCommand) => {
      commands.push(cmd)
      return Promise.resolve({ cursor: { firstBatch, id: 0 }, ok: 1 })
    }),
  }
  return { prisma, commands }
}

describe('findStoredBySenderClientIds', () => {
  it('repeats the partial index filter so MongoDB can use message_sender_client_id', async () => {
    const { prisma, commands } = makePrisma([])

    await findStoredBySenderClientIds(prisma as never, [
      { senderId: SENDER, clientMessageId: 'c1' },
    ])

    expect(commands[0].find).toBe('message')
    expect(commands[0].filter).toEqual({
      $or: [{ senderId: { $oid: SENDER }, clientMessageId: 'c1' }],
      clientMessageId: { $type: 'string' },
    })
  })

  it('maps extended JSON rows to ids and dates', async () => {
    const { prisma } = makePrisma([
      {
        _id: { $oid: '6ae6a902f6e85be7e915e1ca' },
        senderId: { $oid: SENDER },
        clientMessageId: 'c1',
        createdAt: { $date: AT },
        updatedAt: { $date: AT },
        seq: 41,
      },
    ])

    const [row] = await findStoredBySenderClientIds(prisma as never, [
      { senderId: SENDER, clientMessageId: 'c1' },
    ])

    expect(row).toEqual({
      id: '6ae6a902f6e85be7e915e1ca',
      senderId: SENDER,
      clientMessageId: 'c1',
      createdAt: new Date(AT),
      updatedAt: new Date(AT),
      seq: 41,
    })
  })

  it('does not query when there is nothing to look up', async () => {
    const { prisma } = makePrisma([])

    await expect(
      findStoredBySenderClientIds(prisma as never, []),
    ).resolves.toEqual([])
    expect(prisma.$runCommandRaw).not.toHaveBeenCalled()
  })
})

describe('findIdByPollId', () => {
  it('looks the message up by pollId and returns its id', async () => {
    const { prisma, commands } = makePrisma([
      { _id: { $oid: '6ae6a902f6e85be7e915e1cb' } },
    ])

    await expect(
      findIdByPollId(prisma as never, '6a3500000000000000000f01'),
    ).resolves.toBe('6ae6a902f6e85be7e915e1cb')
    expect(commands[0].filter).toEqual({
      pollId: { $oid: '6a3500000000000000000f01' },
    })
  })

  it('returns null when no message carries the poll', async () => {
    const { prisma } = makePrisma([])

    await expect(
      findIdByPollId(prisma as never, '6a3500000000000000000f01'),
    ).resolves.toBeNull()
  })
})

describe('findStoredByIds', () => {
  it('reads seq and timestamps of rows by _id', async () => {
    const { prisma, commands } = makePrisma([
      {
        _id: { $oid: '6ae6a902f6e85be7e915e1ca' },
        seq: 7,
        createdAt: { $date: AT },
        updatedAt: { $date: AT },
      },
    ])

    const rows = await findStoredByIds(prisma as never, [
      '6ae6a902f6e85be7e915e1ca',
    ])

    expect(commands[0].filter).toEqual({
      _id: { $in: [{ $oid: '6ae6a902f6e85be7e915e1ca' }] },
    })
    expect(rows).toEqual([
      {
        id: '6ae6a902f6e85be7e915e1ca',
        seq: 7,
        createdAt: new Date(AT),
        updatedAt: new Date(AT),
      },
    ])
  })

  it('does not query when there is nothing to look up', async () => {
    const { prisma } = makePrisma([])
    await expect(findStoredByIds(prisma as never, [])).resolves.toEqual([])
    expect(prisma.$runCommandRaw).not.toHaveBeenCalled()
  })
})
