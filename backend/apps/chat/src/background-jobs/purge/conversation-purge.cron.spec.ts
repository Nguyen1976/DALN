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
        order.push(cmd.delete)
        deleted[cmd.delete] = (deleted[cmd.delete] ?? 0) + 1
        return Promise.resolve({ ok: 1, n: ids.length })
      },
    ),
  }
  let conversationAlive = true
  const order: string[] = []
  let lockHolder: string | null = null
  // SET NX với token, rồi chỉ xoá khi token còn khớp.
  const redis = {
    eval: jest.fn(
      (script: string, _keys: string[], args: (string | number)[]) => {
        if (script.includes('NX')) {
          if (lockHolder) return Promise.resolve(null)
          lockHolder = String(args[0])
          return Promise.resolve('OK')
        }
        if (lockHolder === args[0]) lockHolder = null
        return Promise.resolve(1)
      },
    ),
  }
  const cron = new ConversationPurgeCron(prisma as never, redis as never)
  return {
    cron,
    prisma,
    messages,
    deleted,
    redis,
    order,
    setHolder: (holder: string | null) => (lockHolder = holder),
    holder: () => lockHolder,
  }
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

  it('reads batches in seq order so it never walks the whole _id index', async () => {
    const { cron, prisma } = setup(3)

    await cron.purge()

    for (const [args] of prisma.message.findMany.mock.calls) {
      expect((args as { orderBy?: unknown }).orderBy).toEqual({ seq: 'asc' })
    }
  })

  it('removes the members before the conversation document, which goes last', async () => {
    const { cron, order } = setup(3)

    await cron.purge()

    expect(order.indexOf('conversationMember')).toBeLessThan(
      order.indexOf('conversation'),
    )
    expect(order.at(-1)).toBe('conversation')
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

  it('does nothing when another instance holds the lock, and never releases it', async () => {
    const { cron, prisma, setHolder, holder } = setup(10)
    setHolder('someone-else')

    await cron.purge()

    expect(prisma.conversation.findMany).not.toHaveBeenCalled()
    expect(holder()).toBe('someone-else')
  })
})
