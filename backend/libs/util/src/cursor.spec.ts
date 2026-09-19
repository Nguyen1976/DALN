import {
  buildKeysetCursor,
  olderThanCursor,
  parseKeysetCursor,
  toPage,
} from './cursor'

describe('keyset cursor', () => {
  const at = new Date('2026-09-01T10:00:00.000Z')

  it('round-trips a timestamp and id', () => {
    const raw = buildKeysetCursor(at, 'abc')
    expect(parseKeysetCursor(raw)).toEqual({ at, id: 'abc' })
  })

  it('breaks ties on the id field the cursor was built from', () => {
    const where = olderThanCursor(
      'lastMessageAt',
      { at, id: 'conv-2' },
      'conversationId',
    )
    expect(where).toEqual({
      OR: [
        { lastMessageAt: { lt: at } },
        { lastMessageAt: at, conversationId: { lt: 'conv-2' } },
      ],
    })
  })

  it('defaults to the row id, and drops the tie-break for bare timestamps', () => {
    expect(olderThanCursor('createdAt', { at, id: 'm1' })).toEqual({
      OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: 'm1' } }],
    })
    expect(olderThanCursor('createdAt', { at, id: null })).toEqual({
      createdAt: { lt: at },
    })
    expect(olderThanCursor('createdAt', null)).toEqual({})
  })

  it('pages with one extra row: a cursor only when more exist', () => {
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    expect(toPage(rows, 2, (row) => row.id)).toEqual({
      items: [{ id: 'a' }, { id: 'b' }],
      nextCursor: 'b',
    })
    expect(toPage(rows, 3, (row) => row.id)).toEqual({
      items: rows,
      nextCursor: null,
    })
  })
})
