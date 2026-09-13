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
