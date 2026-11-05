import { MessageMapper } from './message.mapper'

const row = {
  id: '6a3500000000000000000b01',
  conversationId: '6a3500000000000000000c01',
  senderId: '6a3500000000000000000a01',
  createdAt: new Date('2026-11-04T00:00:00Z'),
  content: 'hi',
}

describe('MessageMapper.toResponse', () => {
  it('carries seq, the order clients sort and resync by', () => {
    expect(MessageMapper.toResponse({ ...row, seq: 12 }).seq).toBe(12)
  })

  it('sends null when a row has no seq', () => {
    expect(MessageMapper.toResponse(row).seq).toBeNull()
  })

  it('sends no isDeleted: nothing ever sets it', () => {
    expect(MessageMapper.toResponse(row)).not.toHaveProperty('isDeleted')
  })
})
