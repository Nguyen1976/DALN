/* eslint-disable @typescript-eslint/no-unsafe-assignment -- matcher bất đối xứng của jest (expect.any...) có kiểu any */
// Test các migration THẬT trong backend/migrations trên DB giả trong bộ nhớ.
import { ObjectId } from 'mongodb'
import { EXCHANGE_RMQ } from 'libs/constant/rmq/exchange'
import { ROUTING_RMQ } from 'libs/constant/rmq/routing'
import normalizeUserEmails from '../../../migrations/user/0001-normalize-user-emails'
import resyncUserCopies from '../../../migrations/user/0002-resync-user-copies'
import backfillConversationUpdatedAt from '../../../migrations/chat/0001-backfill-conversation-updated-at'
import normalizeParticipantRole from '../../../migrations/chat/0002-normalize-participant-role'
import initUnreadCount from '../../../migrations/chat/0003-init-unread-count'
import repairUnreadCounts from '../../../migrations/chat/0004-repair-unread-counts'
import messageClientIdUnique from '../../../migrations/chat/0007-message-client-id-unique'
import messageSeq from '../../../migrations/chat/0008-message-seq'
import messageSeqUniquePartial from '../../../migrations/chat/0009-message-seq-unique-partial'
import dropPreSeqLeftovers from '../../../migrations/chat/0010-drop-pre-seq-leftovers'
import { FakeDb, matches, type FakeDoc } from './testing/fake-db'
import { makeContext } from './testing/helpers'

const oid = (n: number) => ObjectId.createFromTime(1_750_000_000 + n)
const byId = (docs: FakeDoc[], field: string) =>
  Object.fromEntries(docs.map((doc) => [String(doc._id), doc[field]]))

describe('user/0001-normalize-user-emails', () => {
  const OLD = new Date('2026-01-01T00:00:00Z')

  function seedUsers(emails: string[]) {
    const db = new FakeDb('user-service')
    db.collection('User').seed(
      ...emails.map((email, i) => ({
        _id: oid(i),
        email,
        fullName: `U${i}`,
        updatedAt: OLD,
      })),
    )
    return db
  }

  it('trùng email khi bỏ qua hoa thường -> ném lỗi, KHÔNG ghi dòng nào', async () => {
    const db = seedUsers(['Binh@Mail.com', 'An@Mail.com', 'an@mail.com '])
    const before = db.snapshot()
    const { ctx, logs } = makeContext(db)

    await expect(normalizeUserEmails.up(ctx)).rejects.toThrow(
      '1 email trùng nhau khi bỏ qua hoa thường',
    )

    expect(db.snapshot()).toEqual(before)
    expect(logs).toEqual([
      `  an@mail.com: ${String(oid(1))}, ${String(oid(2))}`,
    ])
  })

  it('dry-run -> chỉ báo cáo, không ghi', async () => {
    const db = seedUsers(['An@Mail.com', 'binh@mail.com'])
    const before = db.snapshot()
    const { ctx, logs } = makeContext(db, { dryRun: true })

    await normalizeUserEmails.up(ctx)

    expect(db.snapshot()).toEqual(before)
    expect(logs).toEqual([
      '2 tài khoản, 1 email cần chuẩn hoá',
      `  ${String(oid(0))}: An@Mail.com -> an@mail.com`,
    ])
  })

  it('chỉ ghi dòng cần sửa (email + updatedAt); chạy lại không đổi gì', async () => {
    const db = seedUsers([' An@Mail.com', 'binh@mail.com'])

    await normalizeUserEmails.up(makeContext(db).ctx)

    const [an, binh] = db.collection('User').docs
    expect(an.email).toBe('an@mail.com')
    expect((an.updatedAt as Date).getTime()).toBeGreaterThan(OLD.getTime())
    expect(binh).toMatchObject({ email: 'binh@mail.com', updatedAt: OLD })

    const after = db.snapshot()
    await normalizeUserEmails.up(makeContext(db).ctx)
    expect(db.snapshot()).toEqual(after)
  })
})

describe('chat/0001-backfill-conversation-updated-at', () => {
  const CREATED = new Date('2026-02-01T00:00:00Z')
  const KEPT = new Date('2026-03-01T00:00:00Z')

  function seed() {
    const db = new FakeDb('chat-service')
    db.collection('conversation').seed(
      { _id: 'null', createdAt: CREATED, updatedAt: null },
      { _id: 'thieu', createdAt: CREATED },
      { _id: 'thieu-ca-hai' },
      { _id: 'co-roi', createdAt: CREATED, updatedAt: KEPT },
    )
    return db
  }

  it('đúng filter/update của forceBackfillConversationUpdatedAt cũ: null/thiếu -> createdAt, không có thì lúc chạy', async () => {
    const db = seed()
    const updateMany = jest.spyOn(db.collection('conversation'), 'updateMany')
    const { ctx, logs } = makeContext(db)

    await backfillConversationUpdatedAt.up(ctx)

    expect(updateMany).toHaveBeenCalledWith(
      { $or: [{ updatedAt: null }, { updatedAt: { $exists: false } }] },
      [{ $set: { updatedAt: { $ifNull: ['$createdAt', '$$NOW'] } } }],
    )
    const updatedAt = byId(db.collection('conversation').docs, 'updatedAt')
    expect(updatedAt.null).toEqual(CREATED)
    expect(updatedAt.thieu).toEqual(CREATED)
    expect(updatedAt['thieu-ca-hai']).toBeInstanceOf(Date)
    expect(updatedAt['co-roi']).toEqual(KEPT)
    expect(logs).toEqual(['Đã điền updatedAt cho 3 conversation'])
  })

  it('dry-run -> chỉ đếm, không ghi', async () => {
    const db = seed()
    const before = db.snapshot()
    const { ctx, logs } = makeContext(db, { dryRun: true })

    await backfillConversationUpdatedAt.up(ctx)

    expect(db.snapshot()).toEqual(before)
    expect(logs).toEqual(['3 conversation thiếu updatedAt sẽ được điền'])
  })
})

describe('chat/0002-normalize-participant-role', () => {
  function seed() {
    const db = new FakeDb('chat-service')
    db.collection('conversationMember').seed(
      { _id: 'member', role: 'member' },
      { _id: 'admin', role: 'admin' },
      { _id: 'owner', role: 'owner' },
      { _id: 'null', role: null },
      { _id: 'thieu' },
      { _id: 'ADMIN', role: 'ADMIN' },
      { _id: 'OWNER', role: 'OWNER' },
    )
    return db
  }

  it('đúng filter của forceBackfillParticipantRole cũ: chữ thường -> enum, null/thiếu -> MEMBER, enum đúng giữ nguyên', async () => {
    const db = seed()
    const updateMany = jest.spyOn(
      db.collection('conversationMember'),
      'updateMany',
    )
    const { ctx, logs } = makeContext(db)

    await normalizeParticipantRole.up(ctx)

    expect(updateMany.mock.calls[0][0]).toEqual({
      $or: [
        { role: null },
        { role: { $exists: false } },
        { role: 'member' },
        { role: 'admin' },
        { role: 'owner' },
      ],
    })
    expect(byId(db.collection('conversationMember').docs, 'role')).toEqual({
      member: 'MEMBER',
      admin: 'ADMIN',
      owner: 'OWNER',
      null: 'MEMBER',
      thieu: 'MEMBER',
      ADMIN: 'ADMIN',
      OWNER: 'OWNER',
    })
    expect(logs).toEqual(['Đã chuẩn hoá role cho 5 conversationMember'])
  })

  it('dry-run -> chỉ đếm, không ghi', async () => {
    const db = seed()
    const before = db.snapshot()
    const { ctx, logs } = makeContext(db, { dryRun: true })

    await normalizeParticipantRole.up(ctx)

    expect(db.snapshot()).toEqual(before)
    expect(logs).toEqual([
      '5 conversationMember có role cũ/thiếu sẽ được chuẩn hoá',
    ])
  })
})

describe('chat/0003-init-unread-count', () => {
  it('đúng filter của forceBackfillUnreadCount cũ: null/thiếu -> 0, có số rồi thì giữ', async () => {
    const db = new FakeDb('chat-service')
    db.collection('conversationMember').seed(
      { _id: 'null', unreadCount: null },
      { _id: 'thieu' },
      { _id: 'nam', unreadCount: 5 },
    )
    const updateMany = jest.spyOn(
      db.collection('conversationMember'),
      'updateMany',
    )

    await initUnreadCount.up(makeContext(db).ctx)

    expect(updateMany).toHaveBeenCalledWith(
      { $or: [{ unreadCount: null }, { unreadCount: { $exists: false } }] },
      { $set: { unreadCount: 0 } },
    )
    expect(
      byId(db.collection('conversationMember').docs, 'unreadCount'),
    ).toEqual({ null: 0, thieu: 0, nam: 5 })
  })

  it('dry-run -> chỉ đếm, không ghi', async () => {
    const db = new FakeDb('chat-service')
    db.collection('conversationMember').seed({ _id: 'thieu' })
    const before = db.snapshot()

    await initUnreadCount.up(makeContext(db, { dryRun: true }).ctx)

    expect(db.snapshot()).toEqual(before)
  })
})

describe('chat/0004-repair-unread-counts', () => {
  const CONV = oid(200)
  const [X, Y, Z, W, V] = [oid(100), oid(101), oid(102), oid(103), oid(104)]
  const [m1, m2, m3, m4] = [oid(1), oid(2), oid(3), oid(4)]

  function seed() {
    const db = new FakeDb('chat-service')
    db.collection('message').seed(
      { _id: m1, conversationId: CONV, senderId: X },
      { _id: m2, conversationId: CONV, senderId: Y },
      { _id: m3, conversationId: CONV, senderId: X },
      { _id: m4, conversationId: CONV, senderId: Y },
      // Hội thoại khác — không được đếm vào.
      { _id: oid(5), conversationId: oid(201), senderId: Y },
    )
    const member = (userId: ObjectId, fields: FakeDoc) => ({
      conversationId: CONV,
      userId,
      isActive: true,
      ...fields,
    })
    db.collection('conversationMember').seed(
      // Thật: m2, m4 (m3 do chính X gửi) = 2 < 5 -> hạ về 2.
      member(X, { _id: oid(300), lastReadMessageId: m1, unreadCount: 5 }),
      // Thật: m3 = 1 -> đúng rồi, giữ.
      member(Y, { _id: oid(301), lastReadMessageId: m2, unreadCount: 1 }),
      // Thật: 3 > 1 -> KHÔNG bao giờ nâng lên.
      member(Z, { _id: oid(302), lastReadMessageId: m1, unreadCount: 1 }),
      // Chưa có marker -> để nguyên.
      member(W, { _id: oid(303), lastReadMessageId: null, unreadCount: 3 }),
      // Đã rời nhóm -> để nguyên.
      member(V, {
        _id: oid(304),
        isActive: false,
        lastReadMessageId: m1,
        unreadCount: 4,
      }),
    )
    return db
  }
  const unread = (db: FakeDb) =>
    db.collection('conversationMember').docs.map((doc) => doc.unreadCount)

  it('chỉ HẠ về số tin thật do người khác gửi sau marker', async () => {
    const db = seed()
    const { ctx, logs } = makeContext(db)

    await repairUnreadCounts.up(ctx)

    expect(unread(db)).toEqual([2, 1, 1, 3, 4])
    expect(logs.at(-1)).toBe(
      '3 dòng có marker và unreadCount > 0, 1 dòng cần sửa, đã ghi 1',
    )
  })

  it('dry-run -> báo cáo, không ghi', async () => {
    const db = seed()
    const before = db.snapshot()
    const { ctx, logs } = makeContext(db, { dryRun: true })

    await repairUnreadCounts.up(ctx)

    expect(db.snapshot()).toEqual(before)
    expect(logs).toEqual([
      `  ${String(oid(300))} (conv ${String(CONV)}, user ${String(X)}): 5 -> 2`,
      '3 dòng có marker và unreadCount > 0, 1 dòng cần sửa (dry-run, không ghi)',
    ])
  })

  it('compare-and-set: dòng bị đổi giữa lúc đếm và lúc ghi thì không bị đè', async () => {
    const db = seed()
    const messages = db.collection('message')
    const row = db.collection('conversationMember').docs[0]
    jest.spyOn(messages, 'countDocuments').mockImplementationOnce((filter) => {
      // Người dùng đọc tới m4 đúng lúc migration đang đếm cho dòng này.
      row.lastReadMessageId = m4
      row.unreadCount = 0
      // Lời gọi lồng đi vào hàm thật: bản "Once" đã được dùng xong.
      return messages.countDocuments(filter)
    })

    await repairUnreadCounts.up(makeContext(db).ctx)

    expect(row).toMatchObject({ lastReadMessageId: m4, unreadCount: 0 })
  })

  it('mode background (không chặn deploy)', () => {
    expect(repairUnreadCounts.mode).toBe('background')
  })
})

describe('user/0002-resync-user-copies', () => {
  function seed() {
    const db = new FakeDb('user-service')
    db.collection('User').seed(
      {
        _id: oid(1),
        email: 'a@x.vn',
        fullName: 'An',
        bio: 'xin chào',
        avatar: 'https://cdn/a.png',
        password: 'hash',
      },
      {
        _id: oid(2),
        email: 'b@x.vn',
        fullName: 'Bình',
        bio: null,
        password: 'hash',
      },
    )
    return db
  }
  const outboxOf = (db: FakeDb) => db.collection('OutboxEvent').docs

  it('mode manual: không bao giờ tự chạy', () => {
    expect(resyncUserCopies.mode).toBe('manual')
  })

  it('mỗi user một event USER_UPDATED trong outbox của user-service, đúng hình dạng OutboxRelay đọc', async () => {
    const db = seed()

    await resyncUserCopies.up(makeContext(db, { service: 'user' }).ctx)

    const common = {
      _id: expect.any(ObjectId),
      exchange: EXCHANGE_RMQ.USER_EVENTS,
      routingKey: ROUTING_RMQ.USER_UPDATED,
      status: 'NEW',
      attempt: 0,
      maxAttempts: 10,
      nextAttemptAt: expect.any(Date),
      createdAt: expect.any(Date),
      updatedAt: expect.any(Date),
    }
    const docs = outboxOf(db)
    expect(docs).toEqual([
      {
        ...common,
        messageId: `0002-resync-user-copies:${String(oid(1))}`,
        payload: {
          userId: String(oid(1)),
          fullName: 'An',
          bio: 'xin chào',
          avatar: 'https://cdn/a.png',
        },
      },
      {
        ...common,
        messageId: `0002-resync-user-copies:${String(oid(2))}`,
        payload: { userId: String(oid(2)), fullName: 'Bình', bio: '' },
      },
    ])
    // Không có avatar thì không gửi field (giống updateProfile) để không xoá bản sao.
    expect(Object.keys(docs[1].payload as object)).not.toContain('avatar')
    // Đúng điều kiện OutboxRelay.tick() dùng để lấy event.
    const relayWhere = {
      status: { $in: ['NEW', 'FAILED'] },
      $or: [
        { nextAttemptAt: null },
        { nextAttemptAt: { $lte: new Date(Date.now() + 1000) } },
      ],
    }
    expect(docs.every((doc) => matches(doc, relayWhere))).toBe(true)
  })

  it('chạy lại (vd sau khi bị dừng) không sinh event trùng', async () => {
    const db = seed()
    await resyncUserCopies.up(makeContext(db).ctx)
    const first = db.snapshot()

    await resyncUserCopies.up(makeContext(db).ctx)

    expect(db.snapshot()).toEqual(first)
  })

  it('dry-run -> không ghi outbox', async () => {
    const db = seed()
    const before = db.snapshot()

    await resyncUserCopies.up(makeContext(db, { dryRun: true }).ctx)

    expect(db.snapshot()).toEqual(before)
  })

  it('chạy theo lô 100 qua eachBatch (có checkpoint), nghỉ 5s giữa các lô', async () => {
    const db = new FakeDb('user-service')
    db.collection('User').seed(
      ...Array.from({ length: 250 }, (_, i) => ({
        _id: oid(i),
        fullName: `U${i}`,
      })),
    )
    const { ctx, sleep, checkpoint } = makeContext(db)

    await resyncUserCopies.up(ctx)

    expect(outboxOf(db)).toHaveLength(250)
    expect(sleep.mock.calls).toEqual([[5000], [5000]])
    const saved = (await checkpoint.get()) as { User: ObjectId }
    expect(String(saved.User)).toBe(String(oid(249)))
  })
})

describe('chat/0007-message-client-id-unique', () => {
  it('creates a unique index scoped to documents that have a clientMessageId', async () => {
    const db = new FakeDb('chat-service')

    await messageClientIdUnique.up(makeContext(db).ctx)

    expect(db.collection('message').indexSpecs).toEqual([
      {
        key: { senderId: 1, clientMessageId: 1 },
        options: {
          name: 'message_sender_client_id',
          unique: true,
          partialFilterExpression: { clientMessageId: { $type: 'string' } },
        },
      },
    ])
  })

  it('dry-run creates nothing', async () => {
    const db = new FakeDb('chat-service')

    await messageClientIdUnique.up(makeContext(db, { dryRun: true }).ctx)

    expect(db.collection('message').indexSpecs).toEqual([])
  })
})

describe('chat/0008-message-seq', () => {
  const CONV = oid(500)
  const EMPTY = oid(501)
  const [X, Y] = [oid(100), oid(101)]
  const at = (s: number) => new Date(Date.UTC(2026, 10, 1, 0, 0, s))
  // m2 và m3 cùng createdAt: _id phân xử.
  const [m1, m2, m3, m4, m5] = [oid(11), oid(12), oid(13), oid(14), oid(15)]

  function seed() {
    const db = new FakeDb('chat-service')
    db.collection('conversation').seed(
      { _id: CONV, type: 'GROUP', lastMessageId: m4 },
      { _id: EMPTY, type: 'DIRECT' },
    )
    db.collection('message').seed(
      {
        _id: m3,
        conversationId: CONV,
        senderId: X,
        type: 'TEXT',
        content: 'c https://a.vn',
        createdAt: at(2),
      },
      {
        _id: m1,
        conversationId: CONV,
        senderId: X,
        type: 'TEXT',
        content: 'a',
        createdAt: at(1),
      },
      {
        _id: m5,
        conversationId: CONV,
        senderId: Y,
        type: 'FILE',
        content: null,
        createdAt: at(3),
      },
      {
        _id: m2,
        conversationId: CONV,
        senderId: Y,
        type: 'IMAGE',
        content: null,
        createdAt: at(2),
      },
      {
        _id: m4,
        conversationId: CONV,
        senderId: X,
        type: 'TEXT',
        content: 'vào www.b.vn',
        createdAt: at(3),
      },
    )
    db.collection('messageMedia').seed(
      { _id: oid(40), messageId: m2, mediaType: 'IMAGE' },
      { _id: oid(41), messageId: m5, mediaType: 'FILE' },
    )
    db.collection('conversationMember').seed(
      // 2 tin chưa đọc thì mốc đọc là 5 − 2 = 3: badge giữ nguyên sau migration.
      {
        _id: oid(300),
        conversationId: CONV,
        userId: X,
        isActive: true,
        unreadCount: 2,
        lastReadMessageId: m3,
        lastMentionMessageId: m2,
        clearedHistoryAt: at(2),
      },
      {
        _id: oid(301),
        conversationId: CONV,
        userId: Y,
        isActive: true,
        unreadCount: 0,
        lastReadMessageId: m4,
      },
      // Số đếm cũ lớn hơn số tin thật thì kẹp lại, không ra mốc âm.
      {
        _id: oid(302),
        conversationId: CONV,
        userId: oid(102),
        isActive: false,
        unreadCount: 99,
      },
      {
        _id: oid(303),
        conversationId: EMPTY,
        userId: X,
        isActive: true,
        unreadCount: 0,
      },
    )
    return db
  }
  const seqOf = (db: FakeDb) => byId(db.collection('message').docs, 'seq')

  it('numbers messages by (createdAt, _id), ties broken by _id', async () => {
    const db = seed()
    await messageSeq.up(makeContext(db).ctx)

    expect(seqOf(db)).toEqual({
      [String(m1)]: 1,
      [String(m2)]: 2,
      [String(m3)]: 3,
      [String(m4)]: 4,
      [String(m5)]: 5,
    })
    const conv = db
      .collection('conversation')
      .docs.find((c) => String(c._id) === String(CONV))
    expect(conv).toMatchObject({ lastSeq: 5, lastMessageSeq: 4 })
  })

  it('stores the facets the asset tabs read', async () => {
    const db = seed()
    await messageSeq.up(makeContext(db).ctx)

    const facets = Object.fromEntries(
      db
        .collection('message')
        .docs.map((d) => [String(d._id), [d.hasMedia, d.hasFile, d.hasLink]]),
    )
    expect(facets).toEqual({
      [String(m1)]: [false, false, false],
      [String(m2)]: [true, false, false],
      [String(m3)]: [false, false, true],
      [String(m4)]: [false, false, true],
      [String(m5)]: [false, true, false],
    })
  })

  it("keeps each member's unread count and maps the other marks to seq", async () => {
    const db = seed()
    await messageSeq.up(makeContext(db).ctx)

    const rows = Object.fromEntries(
      db.collection('conversationMember').docs.map((d) => [String(d._id), d]),
    )
    expect(rows[String(oid(300))]).toMatchObject({
      latestSeq: 5,
      lastReadSeq: 3,
      lastMentionSeq: 2,
      clearedHistorySeq: 3,
    })
    expect(rows[String(oid(301))]).toMatchObject({
      latestSeq: 5,
      lastReadSeq: 5,
    })
    expect(rows[String(oid(302))]).toMatchObject({
      latestSeq: 5,
      lastReadSeq: 0,
    })
  })

  it('an empty conversation gets lastSeq 0 and can be written to', async () => {
    const db = seed()
    await messageSeq.up(makeContext(db).ctx)

    const conv = db
      .collection('conversation')
      .docs.find((c) => String(c._id) === String(EMPTY))
    expect(conv).toMatchObject({ lastSeq: 0 })
    const member = db
      .collection('conversationMember')
      .docs.find((d) => String(d._id) === String(oid(303)))
    expect(member).toMatchObject({ latestSeq: 0, lastReadSeq: 0 })
  })

  it('creates the unique (conversationId, seq) index after numbering', async () => {
    const db = seed()
    await messageSeq.up(makeContext(db).ctx)

    expect(db.collection('message').indexSpecs).toContainEqual({
      key: { conversationId: 1, seq: 1 },
      options: { name: 'message_conversation_seq', unique: true },
    })
  })

  it('renumbers a conversation that still has a message without seq', async () => {
    const db = seed()
    await messageSeq.up(makeContext(db).ctx)
    db.collection('message').seed({
      _id: oid(16),
      conversationId: CONV,
      senderId: Y,
      type: 'TEXT',
      content: 'muộn',
      createdAt: at(4),
    })

    await messageSeq.up(makeContext(db).ctx)

    expect(seqOf(db)[String(oid(16))]).toBe(6)
    expect(seqOf(db)[String(m1)]).toBe(1)
    // Mốc đọc của lần đầu được giữ, không suy lại từ unreadCount cũ.
    const x = db
      .collection('conversationMember')
      .docs.find((d) => String(d._id) === String(oid(300)))
    expect(x).toMatchObject({ lastReadSeq: 3, latestSeq: 6 })
    const conv = db
      .collection('conversation')
      .docs.find((c) => String(c._id) === String(CONV))
    expect(conv).toMatchObject({ lastSeq: 6 })
  })

  it('is a no-op on a second run', async () => {
    const db = seed()
    await messageSeq.up(makeContext(db).ctx)
    const after = db.snapshot()

    await messageSeq.up(makeContext(db).ctx)

    expect(db.snapshot()).toEqual(after)
  })

  it('dry run writes nothing', async () => {
    const db = seed()
    const before = db.snapshot()
    const { ctx, logs } = makeContext(db, { dryRun: true })

    await messageSeq.up(ctx)

    expect(db.snapshot()).toEqual(before)
    expect(logs.at(-1)).toMatch(/2 hội thoại cần đánh số/)
  })
})

describe('chat/0009-message-seq-unique-partial', () => {
  const names = async (db: FakeDb) =>
    (await db.collection('message').indexes()).map((i) => i.name)

  it('replaces the plain unique index with a partial one', async () => {
    const db = new FakeDb('chat-service')
    void db
      .collection('message')
      .createIndex(
        { conversationId: 1, seq: 1 },
        { name: 'message_conversation_seq', unique: true },
      )

    await messageSeqUniquePartial.up(makeContext(db).ctx)

    expect(db.collection('message').indexSpecs).toEqual([
      {
        key: { conversationId: 1, seq: 1 },
        options: {
          name: 'message_conversation_seq_unique',
          unique: true,
          partialFilterExpression: { seq: { $type: 'number' } },
        },
      },
    ])
  })

  it('runs where the old index is already gone (db push dropped it)', async () => {
    const db = new FakeDb('chat-service')

    await messageSeqUniquePartial.up(makeContext(db).ctx)

    expect(await names(db)).toEqual(['_id_', 'message_conversation_seq_unique'])
  })

  it('dry-run creates nothing', async () => {
    const db = new FakeDb('chat-service')

    await messageSeqUniquePartial.up(makeContext(db, { dryRun: true }).ctx)

    expect(db.collection('message').indexSpecs).toEqual([])
  })
})

describe('chat/0010-drop-pre-seq-leftovers', () => {
  const MEMBER = oid(600)
  const MSG = oid(601)

  function seed() {
    const db = new FakeDb('chat-service')
    db.collection('conversationMember').seed({
      _id: MEMBER,
      lastReadSeq: 7,
      unreadMentionCount: 1,
      unreadCount: 12,
      lastReadMessageId: oid(11),
      lastReadAt: new Date(),
      clearedHistoryAt: new Date(),
    })
    db.collection('message').seed({ _id: MSG, seq: 3, isDeleted: false })
    return db
  }

  it('unsets the fields seq replaced, keeps the rest', async () => {
    const db = seed()

    await dropPreSeqLeftovers.up(makeContext(db).ctx)

    expect(db.collection('conversationMember').docs).toEqual([
      { _id: MEMBER, lastReadSeq: 7, unreadMentionCount: 1 },
    ])
    expect(db.collection('message').docs).toEqual([{ _id: MSG, seq: 3 }])
  })

  it('runs again as a no-op', async () => {
    const db = seed()
    await dropPreSeqLeftovers.up(makeContext(db).ctx)
    const before = db.snapshot()

    await dropPreSeqLeftovers.up(makeContext(db).ctx)

    expect(db.snapshot()).toEqual(before)
  })

  it('dry-run changes nothing', async () => {
    const db = seed()
    const before = db.snapshot()

    await dropPreSeqLeftovers.up(makeContext(db, { dryRun: true }).ctx)

    expect(db.snapshot()).toEqual(before)
  })
})
