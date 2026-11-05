import { buildMemberRow } from './member-row'

describe('buildMemberRow', () => {
  it('starts the read marks at the given seq and writes no counter of the old kind', () => {
    const row = buildMemberRow(
      '6a35000000000000000c0001',
      {
        userId: '6a35000000000000000a0001',
        username: 'a',
        fullName: null,
        avatar: null,
      },
      { type: 'GROUP', members: [], seq: 9 },
    )
    expect(row).toMatchObject({ lastReadSeq: 9, latestSeq: 9 })
    // unreadCount = latestSeq − lastReadSeq; mốc đọc là lastReadSeq.
    expect(row).not.toHaveProperty('unreadCount')
    expect(row).not.toHaveProperty('lastReadMessageId')
  })
})
