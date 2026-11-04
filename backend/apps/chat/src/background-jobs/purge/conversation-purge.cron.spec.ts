import { Logger } from '@nestjs/common'
import { ConversationPurgeCron, PURGE_BATCH } from './conversation-purge.cron'

const CONV = '6a35000000000000000c0001'

/** Mongo giả: tin của một hội thoại đã xoá, cùng các dòng con của chúng. */
function setup(
  total: number,
  { failOnDeleteCall }: { failOnDeleteCall?: number } = {},
) {
  const messages = Array.from({ length: total }, (_, i) => ({
    id: `m${i}`,
    pollId: i % 5 === 0 ? `p${i}` : null,
  }))
  const deleted: Record<string, number> = {}
  let deleteCalls = 0
  const prisma = {
    conversation: {
      findMany: jest.fn(() =>
        Promise.resolve(conversationAlive ? [{ id: CONV }] : []),
      ),
    },
    message: {
      findMany: jest.fn((args: { take: number }) =>
        Promise.resolve(messages.slice(0, args.take)),
      ),
    },
    $runCommandRaw: jest.fn(
      (cmd: {
        delete: string
        deletes: { q: Record<string, { $in?: { $oid: string }[] }> }[]
      }) => {
        deleteCalls += 1
        if (deleteCalls === failOnDeleteCall)
          return Promise.reject(new Error('mongo down'))
        const q = cmd.deletes[0].q
        const ids = (q._id?.$in ?? []).map((x) => x.$oid)
        if (cmd.delete === 'message') {
          for (const id of ids) {
            const i = messages.findIndex((m) => m.id === id)
            if (i >= 0) messages.splice(i, 1)
          }
        }
        if (cmd.delete === 'conversation') conversationAlive = false
        deleted[cmd.delete] = (deleted[cmd.delete] ?? 0) + 1
        return Promise.resolve({ ok: 1, n: ids.length })
      },
    ),
  }
  let conversationAlive = true
  const redis = {
    claimOnce: jest.fn(() => Promise.resolve(true)),
    del: jest.fn(() => Promise.resolve()),
  }
  const cron = new ConversationPurgeCron(prisma as never, redis as never)
  return { cron, prisma, messages, deleted, redis }
}

describe('ConversationPurgeCron', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
  })
  afterEach(() => jest.restoreAllMocks())

  it('purge removes messages and their rows in batches, then the conversation', async () => {
    const { cron, messages, deleted, prisma } = setup(PURGE_BATCH * 2 + 3)

    await cron.purge()

    expect(messages).toHaveLength(0)
    // 3 lô tin, mỗi lô xoá media, delete-for-me, phiếu và poll rồi tới tin.
    expect(deleted.message).toBe(3)
    expect(deleted.messageMedia).toBe(3)
    expect(deleted.DeleteMessage).toBe(3)
    expect(deleted.conversation).toBe(1)
    expect(deleted.conversationMember).toBe(1)
    expect(
      prisma.message.findMany.mock.calls.every(
        ([args]) => (args as { take: number }).take === PURGE_BATCH,
      ),
    ).toBe(true)
  })

  it('purge resumes after a crash midway', async () => {
    const { cron, messages, deleted } = setup(PURGE_BATCH * 2, {
      failOnDeleteCall: 7,
    })

    await cron.purge() // hỏng giữa lô thứ hai
    expect(messages.length).toBeGreaterThan(0)
    expect(deleted.conversation).toBeUndefined()

    await cron.purge()
    expect(messages).toHaveLength(0)
    expect(deleted.conversation).toBe(1)
  })

  it('does nothing when another instance holds the lock', async () => {
    const { cron, redis, prisma } = setup(10)
    redis.claimOnce.mockResolvedValueOnce(false)

    await cron.purge()

    expect(prisma.conversation.findMany).not.toHaveBeenCalled()
  })
})
