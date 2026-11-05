import { MessageService } from './message.service'

const CONV = '6a35000000000000000c0001'
const USER = '6a35000000000000000a0001'

const msg = (seq: number) => ({
  id: `6a35000000000000000b${String(seq).padStart(4, '0')}`,
  conversationId: CONV,
  senderId: USER,
  content: `m${seq}`,
  type: 'TEXT',
  createdAt: new Date(Date.UTC(2026, 10, 1, 0, 0, seq)),
  seq,
  medias: [],
  poll: null,
})

function makeService(
  rows: ReturnType<typeof msg>[],
  member = { clearedHistorySeq: null as number | null },
) {
  const messageRepo = {
    findByConversationIdPaginatedForUser: jest.fn(() => Promise.resolve(rows)),
    findConversationAssets: jest.fn(() => Promise.resolve(rows)),
    findQuotedByIds: jest.fn(() => Promise.resolve([])),
    findById: jest.fn((id: string) =>
      Promise.resolve(id === msg(40).id ? msg(40) : null),
    ),
  }
  const memberRepo = {
    findByConversationIdAndUserId: jest.fn(() => Promise.resolve(member)),
  }
  const pollRepo = {
    findVotesByUser: jest.fn(() => Promise.resolve(new Map())),
  }
  const service = new MessageService(
    memberRepo as never,
    messageRepo as never,
    {} as never,
    {} as never,
    {} as never,
    pollRepo as never,
  )
  return { service, messageRepo }
}

describe('MessageService pages by seq', () => {
  it('pages history below a seq cursor and hands back the next one', async () => {
    const { service, messageRepo } = makeService([msg(49), msg(48), msg(47)], {
      clearedHistorySeq: 10,
    })

    const page = await service.getMessagesByConversationId(CONV, USER, {
      limit: 2,
      cursor: 's:50',
    })

    expect(
      messageRepo.findByConversationIdPaginatedForUser,
    ).toHaveBeenCalledWith(CONV, USER, 3, {
      beforeSeq: 50,
      afterSeq: null,
      clearedHistorySeq: 10,
    })
    expect(page.items.map((m) => m.seq)).toEqual([49, 48])
    expect(page.nextCursor).toBe('s:48')
  })

  it('afterSeq returns newer messages oldest first and says whether there are more', async () => {
    const { service, messageRepo } = makeService([msg(121), msg(122), msg(123)])

    const page = await service.getMessagesByConversationId(CONV, USER, {
      limit: 2,
      afterSeq: 120,
    })

    expect(
      messageRepo.findByConversationIdPaginatedForUser,
    ).toHaveBeenCalledWith(CONV, USER, 3, {
      beforeSeq: null,
      afterSeq: 120,
      clearedHistorySeq: null,
    })
    expect(page.items.map((m) => m.seq)).toEqual([121, 122])
    expect(page).toMatchObject({ nextCursor: null, hasMore: true })
  })

  it('pages an asset tab by seq', async () => {
    const { service, messageRepo } = makeService([msg(9), msg(5)])

    const page = await service.getConversationAssets(CONV, USER, 'MEDIA', {
      limit: 1,
      cursor: 's:12',
    })

    expect(messageRepo.findConversationAssets).toHaveBeenCalledWith(
      CONV,
      'MEDIA',
      2,
      12,
    )
    expect(page.nextCursor).toBe('s:9')
  })
})
