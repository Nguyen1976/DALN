import { ConversationRepository } from './conversation.repository'

const CONV = '6a35000000000000000c0001'

function setup(
  row: Record<string, unknown> | null = { id: CONV, type: 'GROUP' },
) {
  const commands: Record<string, unknown>[] = []
  const prisma = {
    conversation: { findUnique: jest.fn(() => Promise.resolve(row)) },
    message: {
      findMany: jest.fn(() =>
        Promise.reject(new Error('xoá không được nạp id tin')),
      ),
    },
    $transaction: jest.fn(() =>
      Promise.reject(new Error('xoá không được dùng transaction')),
    ),
    $runCommandRaw: jest.fn((cmd: Record<string, unknown>) => {
      commands.push(cmd)
      return Promise.resolve({ ok: 1, n: 1, nModified: 1 })
    }),
  }
  const redis = { delMany: jest.fn(() => Promise.resolve()) }
  return {
    repo: new ConversationRepository(prisma as never, redis as never),
    prisma,
    commands,
    redis,
  }
}

describe('ConversationRepository delete', () => {
  it('delete hides the conversation at once, without loading its messages', async () => {
    const { repo, prisma, commands, redis } = setup()

    await repo.deleteConversationById(CONV)

    expect(prisma.message.findMany).not.toHaveBeenCalled()
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(commands.map((c) => c.update)).toEqual([
      'conversation',
      'conversationMember',
    ])
    expect(
      (commands[0].updates as { u: { $set: Record<string, unknown> } }[])[0].u
        .$set,
    ).toHaveProperty('deletedAt')
    expect(
      (commands[1].updates as { u: unknown; multi: boolean }[])[0],
    ).toMatchObject({ u: { $set: { isActive: false } }, multi: true })
    expect(redis.delMany).toHaveBeenCalledWith([`conv:members:${CONV}`])
  })

  it('hidden conversation is unreachable by id', async () => {
    const hidden = setup({ id: CONV, type: 'GROUP', deletedAt: new Date() })

    await expect(hidden.repo.findById(CONV)).resolves.toBeNull()
    await expect(hidden.repo.findByIdWithMembers(CONV)).resolves.toBeNull()
  })
})
