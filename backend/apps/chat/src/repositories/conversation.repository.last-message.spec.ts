import { ConversationRepository } from './conversation.repository'

const conversationId = '6a3500000000000000000c01'

function setup() {
  const $runCommandRaw = jest.fn().mockResolvedValue({ n: 1, nModified: 1 })
  const repo = new ConversationRepository(
    { $runCommandRaw } as never,
    {} as never,
  )
  const guard = () => {
    const [{ updates }] = $runCommandRaw.mock.calls[0] as [
      { updates: { q: { $or: Record<string, unknown>[] } }[] },
    ]
    return updates[0].q.$or
  }
  return { repo, guard }
}

/**
 * Hai lệnh ghi cùng một `seq` là lúc thu hồi chạy đua với cron: cron còn giữ nội
 * dung gốc trong Redis, nên lệnh của cron phải thua còn lệnh thu hồi phải thắng.
 */
describe('ConversationRepository: tin cuối theo seq', () => {
  it('cron chỉ ghi khi seq lớn hơn hẳn: không đè preview đã thu hồi cùng seq', async () => {
    const { repo, guard } = setup()

    await repo.saveLastMessage(conversationId, { seq: 7 })

    expect(guard()).toEqual([
      { lastMessageSeq: null },
      { lastMessageSeq: { $lt: 7 } },
    ])
  })

  it('thu hồi ghi được khi đúng là tin cuối, nhưng không đè tin mới hơn', async () => {
    const { repo, guard } = setup()

    await repo.saveRevokedLastMessage(conversationId, { seq: 7 })

    expect(guard()).toEqual([
      { lastMessageSeq: null },
      { lastMessageSeq: { $lte: 7 } },
    ])
  })
})
