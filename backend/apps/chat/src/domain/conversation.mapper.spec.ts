import { ConversationMapper } from './conversation.mapper'

const VIEWER = '6a35000000000000000a0001'
const base = {
  id: '6a35000000000000000c0001',
  type: 'GROUP',
  groupName: 'Nhóm',
  memberCount: 3,
  lastMessageSeq: 40,
  createdAt: new Date('2026-11-01T00:00:00Z'),
  updatedAt: new Date('2026-11-01T00:00:00Z'),
}
const row = (mine: Record<string, unknown>) =>
  ConversationMapper.toSummary({ ...base, ...mine } as never, VIEWER)

describe('ConversationMapper unread count', () => {
  it('unreadCount is latestSeq minus lastReadSeq, floored at 0', () => {
    expect(row({ latestSeq: 40, lastReadSeq: 33 }).unreadCount).toBe(7)
    expect(row({ latestSeq: 30, lastReadSeq: 33 }).unreadCount).toBe(0)
  })

  it('never yields NaN for a row without seq marks', () => {
    expect(row({}).unreadCount).toBe(0)
  })

  it("carries the conversation's own lastMessageSeq, not a member's latestSeq", () => {
    expect(row({ latestSeq: 12, lastReadSeq: 12 }).lastMessageSeq).toBe(40)
  })
})

describe('ConversationMapper members', () => {
  it('a member carries its read mark as seq only', () => {
    const summary = ConversationMapper.toSummary(
      {
        ...base,
        members: [
          {
            userId: VIEWER,
            role: 'MEMBER',
            username: 'a',
            fullName: 'A',
            avatar: null,
            lastReadSeq: 12,
            latestSeq: 40,
            lastMessageAt: null,
          },
        ],
      } as never,
      VIEWER,
    )
    expect(summary.members).toEqual([
      {
        userId: VIEWER,
        role: 'MEMBER',
        username: 'a',
        fullName: 'A',
        avatar: null,
        lastReadSeq: 12,
        lastMessageAt: null,
      },
    ])
  })
})
