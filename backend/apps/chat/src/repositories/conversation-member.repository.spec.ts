import { ConversationMemberRepository } from './conversation-member.repository'

const CONV = '6a35000000000000000c0001'
const USER = '6a35000000000000000a0001'
// Có chữ cái để kiểm được việc chuẩn hoá hoa/thường. M1 < M2 < M3.
const M1 = '6a350000000000000000ab01'
const M2 = '6a350000000000000000ab02'
const M3 = '6a350000000000000000ab03'
const CREATED_AT: Record<string, Date> = {
  [M1]: new Date('2026-09-01T10:00:00Z'),
  [M2]: new Date('2026-09-01T10:00:01Z'),
  [M3]: new Date('2026-09-01T10:00:02Z'),
}

type Row = {
  userId?: string
  isActive: boolean
  unreadCount: number
  lastReadMessageId?: string | null
  lastReadAt?: Date
}

/** Hình dạng `where` repo gửi xuống, đủ cho các test này. */
type MarkerFilter = null | { isSet?: boolean; lt?: string }
type MemberWhere = {
  conversationId?: string
  userId?: string | { not: string }
  isActive?: boolean
  lastReadMessageId?: string | null
  OR?: { lastReadMessageId: MarkerFilter }[]
}

/**
 * Một nhánh OR trên lastReadMessageId, theo ngữ nghĩa Prisma MongoDB đo trên
 * dev: `null` chỉ khớp field bằng null, `isSet: false` chỉ khớp field không tồn
 * tại, `lt` không bao giờ khớp field không tồn tại. Mô hình chặt: `lt` ở đây
 * cũng không khớp null.
 */
function markerMatches(row: Row, filter: MarkerFilter): boolean {
  if (filter === null) return row.lastReadMessageId === null
  if (filter.isSet === false) return !('lastReadMessageId' in row)
  if (typeof filter.lt === 'string') {
    return (
      typeof row.lastReadMessageId === 'string' &&
      row.lastReadMessageId < filter.lt
    )
  }
  return false
}

/** Dòng có khớp `where` không. Bảng giả chỉ có một hội thoại. */
function rowMatches(row: Row, where: MemberWhere): boolean {
  if (typeof where.userId === 'object' && row.userId === where.userId.not) {
    return false
  }
  if (where.isActive !== undefined && row.isActive !== where.isActive) {
    return false
  }
  if (
    'lastReadMessageId' in where &&
    row.lastReadMessageId !== where.lastReadMessageId
  ) {
    return false
  }
  if (
    where.OR &&
    !where.OR.some((cond) => markerMatches(row, cond.lastReadMessageId))
  ) {
    return false
  }
  return true
}

type FindMessageArgs = {
  where: { id: string; conversationId: string }
  select: { createdAt: true }
}
type FindManyArgs = {
  where: {
    conversationId: string
    senderId: { not: string }
    id: { gt: string }
    createdAt: { gte: Date }
  }
  select: { id: true }
  take: number
}

/**
 * Prisma giả, chỉ đủ cho updateLastRead. Bảng thành viên là MỘT dòng trong bộ
 * nhớ, updateMany chỉ ghi khi điều kiện khớp.
 */
function setup(
  row: Row | null,
  opts: { messageExists?: boolean; unreadIds?: string[] } = {},
) {
  // Không có $runCommandRaw: repo gọi backfill lúc runtime là test nổ ngay.
  const prisma = {
    message: {
      findFirst: jest.fn<
        Promise<{ createdAt: Date } | null>,
        [FindMessageArgs]
      >(({ where }) =>
        Promise.resolve(
          opts.messageExists === false
            ? null
            : { createdAt: CREATED_AT[where.id] ?? new Date() },
        ),
      ),
      findMany: jest.fn<Promise<{ id: string }[]>, [FindManyArgs]>(() =>
        Promise.resolve((opts.unreadIds ?? []).map((id) => ({ id }))),
      ),
    },
    conversationMember: {
      findFirst: jest.fn<
        Promise<{ lastReadMessageId: string | null } | null>,
        [{ where: MemberWhere }]
      >(({ where }) =>
        Promise.resolve(
          row && rowMatches(row, where)
            ? { lastReadMessageId: row.lastReadMessageId ?? null }
            : null,
        ),
      ),
      updateMany: jest.fn<
        Promise<{ count: number }>,
        [{ where: MemberWhere; data: Partial<Row> }]
      >(({ where, data }) => {
        if (!row || !rowMatches(row, where))
          return Promise.resolve({ count: 0 })
        Object.assign(row, data)
        return Promise.resolve({ count: 1 })
      }),
    },
  }

  const repo = new ConversationMemberRepository(prisma as never, {} as never)
  return { repo, prisma }
}

describe('ConversationMemberRepository.updateLastRead', () => {
  it('dòng kẹt số ảo: đọc lại đúng tin đang là marker -> đếm lại, unreadCount về 0', async () => {
    // Người dùng đọc M2 ngay khi tin tới (unread=0), rồi cron cộng muộn +1 cho
    // chính M2. Bản cũ thấy "id đã lưu >= id tới" là thoát sớm, số 1 kẹt mãi.
    const row: Row = { isActive: true, unreadCount: 1, lastReadMessageId: M2 }
    const { repo } = setup(row)

    await expect(repo.updateLastRead(CONV, USER, M2)).resolves.toEqual({
      count: 0,
    })

    expect(row).toMatchObject({ lastReadMessageId: M2, unreadCount: 0 })
  })

  it('id mới hơn -> marker tiến lên, unreadCount = số tin còn lại sau nó', async () => {
    const row: Row = { isActive: true, unreadCount: 5, lastReadMessageId: M1 }
    const { repo, prisma } = setup(row, { unreadIds: [M3] })

    await expect(repo.updateLastRead(CONV, USER, M2)).resolves.toEqual({
      count: 1,
    })

    expect(row).toMatchObject({ lastReadMessageId: M2, unreadCount: 1 })
    expect(row.lastReadAt).toBeInstanceOf(Date)
    expect(prisma.message.findMany.mock.calls).toEqual([
      [
        {
          where: {
            conversationId: CONV,
            senderId: { not: USER },
            id: { gt: M2 },
            createdAt: { gte: CREATED_AT[M2] },
          },
          select: { id: true },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: 99,
        },
      ],
    ])
  })

  it('dòng chưa từng có field lastReadMessageId (tạo qua addMembers) -> marker vẫn tiến được', async () => {
    const row: Row = { isActive: true, unreadCount: 2 }
    const { repo } = setup(row)

    await repo.updateLastRead(CONV, USER, M1)

    expect(row).toMatchObject({ lastReadMessageId: M1, unreadCount: 0 })
  })

  it('id cũ hơn -> marker KHÔNG lùi, nhưng vẫn đếm lại từ marker đang lưu', async () => {
    const row: Row = { isActive: true, unreadCount: 2, lastReadMessageId: M3 }
    const { repo, prisma } = setup(row)

    await expect(repo.updateLastRead(CONV, USER, M1)).resolves.toEqual({
      count: 0,
    })

    expect(row).toMatchObject({ lastReadMessageId: M3, unreadCount: 0 })
    expect(prisma.message.findMany.mock.calls[0][0].where).toMatchObject({
      id: { gt: M3 },
      createdAt: { gte: CREATED_AT[M1] },
    })
  })

  it('lần đọc đồng thời đã đẩy marker xa hơn -> không ghi đè unreadCount của nó', async () => {
    const row: Row = { isActive: true, unreadCount: 3, lastReadMessageId: M1 }
    const { repo, prisma } = setup(row)
    prisma.message.findMany.mockImplementationOnce(() => {
      // Một lần đọc M3 chạy xong đúng lúc lần đọc M2 này đang đếm.
      row.lastReadMessageId = M3
      row.unreadCount = 0
      return Promise.resolve([{ id: M3 }])
    })

    await repo.updateLastRead(CONV, USER, M2)

    expect(row).toMatchObject({ lastReadMessageId: M3, unreadCount: 0 })
  })

  it('tin không thuộc hội thoại này -> không ghi gì', async () => {
    const row: Row = { isActive: true, unreadCount: 1, lastReadMessageId: M1 }
    const { repo, prisma } = setup(row, { messageExists: false })

    await expect(repo.updateLastRead(CONV, USER, M3)).resolves.toEqual({
      count: 0,
    })

    expect(prisma.message.findFirst.mock.calls).toEqual([
      [
        {
          where: { id: M3, conversationId: CONV },
          select: { createdAt: true },
        },
      ],
    ])
    expect(prisma.conversationMember.updateMany).not.toHaveBeenCalled()
    expect(row).toEqual({
      isActive: true,
      unreadCount: 1,
      lastReadMessageId: M1,
    })
  })

  it('không còn là thành viên (isActive=false) -> không ghi gì', async () => {
    const row: Row = { isActive: false, unreadCount: 1, lastReadMessageId: M1 }
    const { repo, prisma } = setup(row)

    await expect(repo.updateLastRead(CONV, USER, M2)).resolves.toEqual({
      count: 0,
    })

    expect(prisma.conversationMember.updateMany).not.toHaveBeenCalled()
    expect(row.lastReadMessageId).toBe(M1)
  })

  it('id không phải ObjectId -> bỏ qua, không truy vấn gì', async () => {
    const row: Row = { isActive: true, unreadCount: 1, lastReadMessageId: M1 }
    const { repo, prisma } = setup(row)

    await expect(
      repo.updateLastRead(CONV, USER, 'not-an-object-id'),
    ).resolves.toEqual({ count: 0 })

    expect(prisma.message.findFirst).not.toHaveBeenCalled()
    expect(prisma.conversationMember.updateMany).not.toHaveBeenCalled()
  })

  it('id chữ hoa được chuẩn hoá về chữ thường', async () => {
    const row: Row = { isActive: true, unreadCount: 1, lastReadMessageId: M1 }
    const { repo, prisma } = setup(row)

    await repo.updateLastRead(CONV, USER, M2.toUpperCase())

    expect(prisma.message.findFirst.mock.calls[0][0].where).toEqual({
      id: M2,
      conversationId: CONV,
    })
    expect(row.lastReadMessageId).toBe(M2)
  })
})

describe('ConversationMemberRepository.updateUnreadCount', () => {
  const SENDER = '6a35000000000000000a0009'

  /** Bảng nhiều thành viên; updateMany cộng cho mọi dòng khớp điều kiện. */
  function setupTable(rows: Row[]) {
    const prisma = {
      conversationMember: {
        updateMany: jest.fn<
          Promise<{ count: number }>,
          [
            {
              where: MemberWhere
              data: { unreadCount: { increment: number } }
            },
          ]
        >(({ where, data }) => {
          const hit = rows.filter((row) => rowMatches(row, where))
          hit.forEach((row) => {
            row.unreadCount += data.unreadCount.increment
          })
          return Promise.resolve({ count: hit.length })
        }),
      },
    }
    return new ConversationMemberRepository(prisma as never, {} as never)
  }

  const members = (): Row[] => [
    { userId: SENDER, isActive: true, unreadCount: 0, lastReadMessageId: M2 },
    { userId: 'da-doc', isActive: true, unreadCount: 0, lastReadMessageId: M2 },
    { userId: 'doc-do', isActive: true, unreadCount: 1, lastReadMessageId: M1 },
    {
      userId: 'chua-doc',
      isActive: true,
      unreadCount: 0,
      lastReadMessageId: null,
    },
    { userId: 'thieu-field', isActive: true, unreadCount: 0 },
    {
      userId: 'da-roi',
      isActive: false,
      unreadCount: 0,
      lastReadMessageId: null,
    },
  ]

  it('có newestMessageId -> bỏ qua người đã đọc tới tin đó, vẫn cộng cho người chưa đọc và dòng thiếu field', async () => {
    const rows = members()
    const repo = setupTable(rows)

    await expect(repo.updateUnreadCount(CONV, SENDER, 2, M2)).resolves.toEqual({
      count: 3,
    })

    expect(rows.map((row) => [row.userId, row.unreadCount])).toEqual([
      [SENDER, 0],
      ['da-doc', 0],
      ['doc-do', 3],
      ['chua-doc', 2],
      ['thieu-field', 2],
      ['da-roi', 0],
    ])
  })

  it('không có newestMessageId (dữ liệu Redis từ bản cũ) -> cộng cho mọi thành viên trừ người gửi như trước', async () => {
    const rows = members()
    const repo = setupTable(rows)

    await expect(repo.updateUnreadCount(CONV, SENDER, 1)).resolves.toEqual({
      count: 4,
    })

    expect(rows.map((row) => row.unreadCount)).toEqual([0, 1, 2, 1, 1, 0])
  })
})

describe('ConversationMemberRepository — không còn backfill lúc runtime', () => {
  // Dữ liệu cũ do migrations/chat/0002, 0003 xử lý lúc deploy. Repo phải gọi
  // thẳng Prisma: không $runCommandRaw, không nuốt lỗi enum rồi thử lại.
  it('findByConversationIdAndUserId: đúng một findFirst, lỗi enum ném thẳng ra ngoài', async () => {
    const enumError = new Error(
      "Value 'member' not found in enum 'participantRole'",
    )
    const prisma = {
      conversationMember: { findFirst: jest.fn().mockRejectedValue(enumError) },
    }
    const repo = new ConversationMemberRepository(prisma as never, {} as never)

    await expect(repo.findByConversationIdAndUserId(CONV, USER)).rejects.toBe(
      enumError,
    )
    expect(prisma.conversationMember.findFirst).toHaveBeenCalledTimes(1)
  })

  it('findByConversationIdAndUserIds / clearHistoryForMember: chỉ một lời gọi Prisma', async () => {
    const prisma = {
      conversationMember: {
        findMany: jest.fn().mockResolvedValue([{ userId: USER }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    }
    const repo = new ConversationMemberRepository(prisma as never, {} as never)

    await expect(
      repo.findByConversationIdAndUserIds(CONV, [USER]),
    ).resolves.toEqual([{ userId: USER }])
    await repo.clearHistoryForMember(CONV, USER, new Date())

    expect(prisma.conversationMember.findMany).toHaveBeenCalledTimes(1)
    expect(prisma.conversationMember.updateMany).toHaveBeenCalledTimes(1)
  })
})
