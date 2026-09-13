/* eslint-disable @typescript-eslint/no-unsafe-assignment -- matcher bất đối xứng của jest (expect.any...) có kiểu any */
import { ObjectId } from 'mongodb'
import type { LoadedMigration } from './discovery'
import { LEDGER_COLLECTION, readLedger } from './ledger'
import { LOCK_COLLECTION } from './lock'
import { computeStatus, runService, type RunServiceOptions } from './runner'
import { FakeDb } from './testing/fake-db'
import { fakeMigration } from './testing/helpers'
import type { LedgerDoc, MigrationContext } from './types'

function ledgerDoc(id: string, fields: Partial<LedgerDoc> = {}): LedgerDoc {
  const status = fields.status ?? 'applied'
  return {
    _id: id,
    description: `mô tả ${id}`,
    mode: 'deploy',
    checksum: `sum-${id}`,
    status,
    startedAt: new Date('2026-09-01T00:00:00Z'),
    ...(status === 'applied'
      ? { appliedAt: new Date('2026-09-01T00:00:01Z'), durationMs: 5 }
      : {}),
    ...fields,
  }
}

async function run(
  db: FakeDb,
  migrations: LoadedMigration[],
  overrides: Partial<RunServiceOptions> = {},
) {
  const out: string[] = []
  const err: string[] = []
  const ok = await runService({
    db: db.asDb(),
    service: 'chat',
    migrations,
    selection: { mode: 'deploy' },
    dryRun: false,
    command: 'up',
    out: (line) => {
      out.push(line)
    },
    err: (line) => {
      err.push(line)
    },
    lockWaitMs: 40,
    lockPollMs: 5,
    ...overrides,
  })
  return { ok, out, err }
}

const ledgerOf = (db: FakeDb) => readLedger(db.asDb())
const lockDocs = (db: FakeDb) => db.collection(LOCK_COLLECTION).docs

async function waitFor(condition: () => boolean) {
  for (let i = 0; i < 200 && !condition(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  if (!condition()) throw new Error('waitFor: hết giờ')
}

describe('computeStatus', () => {
  it('phân loại applied / changed / failed / running / pending và ledger mồ côi', () => {
    const migrations = ['0001-a', '0002-b', '0003-c', '0004-d', '0005-e'].map(
      (id) => fakeMigration(id),
    )
    const ledger = new Map(
      [
        ledgerDoc('0001-a'),
        ledgerDoc('0002-b', { checksum: 'checksum-cu' }),
        ledgerDoc('0003-c', { status: 'failed', error: 'nổ' }),
        ledgerDoc('0004-d', { status: 'running' }),
        ledgerDoc('0000-da-xoa-file'),
      ].map((doc) => [doc._id, doc]),
    )

    const { entries, orphans } = computeStatus(migrations, ledger)

    expect(entries.map((entry) => [entry.migration.id, entry.state])).toEqual([
      ['0001-a', 'applied'],
      ['0002-b', 'changed'],
      ['0003-c', 'failed'],
      ['0004-d', 'running'],
      ['0005-e', 'pending'],
    ])
    expect(orphans.map((doc) => doc._id)).toEqual(['0000-da-xoa-file'])
  })
})

describe('runService', () => {
  it('chỉ chạy migration deploy còn pending, đúng thứ tự, in một dòng mỗi migration', async () => {
    const db = new FakeDb()
    const calls: string[] = []
    const track = (id: string) => () => {
      calls.push(id)
      return Promise.resolve()
    }
    db.collection(LEDGER_COLLECTION).seed(ledgerDoc('0001-a'))

    const { ok, out } = await run(db, [
      fakeMigration('0001-a', { up: track('0001-a') }),
      fakeMigration('0002-b', { mode: 'background', up: track('0002-b') }),
      fakeMigration('0003-c', { up: track('0003-c') }),
      fakeMigration('0004-d', { mode: 'manual', up: track('0004-d') }),
      fakeMigration('0005-e', { up: track('0005-e') }),
    ])

    expect(ok).toBe(true)
    expect(calls).toEqual(['0003-c', '0005-e'])
    expect(out).toEqual([
      '[migrate] chat 0001-a ... skipped (already applied)',
      expect.stringMatching(
        /^\[migrate\] chat 0003-c \.\.\. applied in \d+ms$/,
      ),
      expect.stringMatching(
        /^\[migrate\] chat 0005-e \.\.\. applied in \d+ms$/,
      ),
    ])
  })

  it('thành công: ghi ledger đủ trường, nhả lock', async () => {
    const db = new FakeDb()

    await run(db, [fakeMigration('0001-a')])

    const doc = (await ledgerOf(db)).get('0001-a')
    expect(doc).toEqual({
      _id: '0001-a',
      description: 'mô tả 0001-a',
      mode: 'deploy',
      checksum: 'sum-0001-a',
      status: 'applied',
      startedAt: expect.any(Date),
      appliedAt: expect.any(Date),
      durationMs: expect.any(Number),
    })
    expect(Object.keys(doc!)).not.toContain('error')
    expect(lockDocs(db)).toEqual([])
  })

  it('lỗi: ghi failed kèm error, dừng ngay ở migration đó, vẫn nhả lock', async () => {
    const db = new FakeDb()
    const third = jest.fn(() => Promise.resolve())

    const { ok, out, err } = await run(db, [
      fakeMigration('0001-a'),
      fakeMigration('0002-b', {
        up: () => Promise.reject(new Error('nổ ở lô 3')),
      }),
      fakeMigration('0003-c', { up: third }),
    ])

    expect(ok).toBe(false)
    expect(third).not.toHaveBeenCalled()
    const ledger = await ledgerOf(db)
    expect(ledger.get('0001-a')?.status).toBe('applied')
    expect(ledger.get('0002-b')).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('nổ ở lô 3'),
      durationMs: expect.any(Number),
    })
    expect(ledger.has('0003-c')).toBe(false)
    expect(out[1]).toMatch(
      /^\[migrate\] chat 0002-b \.\.\. FAILED after \d+ms$/,
    )
    expect(err.join('\n')).toContain('nổ ở lô 3')
    expect(lockDocs(db)).toEqual([])
  })

  it('migration failed lần trước được chạy lại, thành công thì xoá error', async () => {
    const db = new FakeDb()
    db.collection(LEDGER_COLLECTION).seed(
      ledgerDoc('0001-a', { status: 'failed', error: 'lần trước lỗi' }),
    )
    const up = jest.fn(() => Promise.resolve())

    const { ok } = await run(db, [fakeMigration('0001-a', { up })])

    expect(ok).toBe(true)
    expect(up).toHaveBeenCalledTimes(1)
    const doc = (await ledgerOf(db)).get('0001-a')
    expect(doc?.status).toBe('applied')
    expect(Object.keys(doc!)).not.toContain('error')
  })

  it('migration đã applied bị sửa (checksum lệch) -> từ chối, không chạy gì', async () => {
    const db = new FakeDb()
    db.collection(LEDGER_COLLECTION).seed(
      ledgerDoc('0001-a', { checksum: 'checksum-cu' }),
    )
    const pending = jest.fn(() => Promise.resolve())

    const { ok, err } = await run(db, [
      fakeMigration('0001-a'),
      fakeMigration('0002-b', { up: pending }),
    ])

    expect(ok).toBe(false)
    expect(pending).not.toHaveBeenCalled()
    expect(err).toEqual([
      expect.stringContaining('[migrate] chat 0001-a REFUSED: file đã bị sửa'),
    ])
    expect((await ledgerOf(db)).has('0002-b')).toBe(false)
    expect(lockDocs(db)).toEqual([])
  })

  it('dry-run: ctx.dryRun = true, không ghi ledger, không lấy lock — DB y nguyên', async () => {
    const db = new FakeDb()
    db.collection('conversation').seed({ _id: 'c1', updatedAt: null })
    const before = db.snapshot()
    const seen: boolean[] = []
    const up = async (ctx: MigrationContext) => {
      seen.push(ctx.dryRun)
      if (!ctx.dryRun) {
        await ctx.db
          .collection('conversation')
          .updateMany({}, { $set: { updatedAt: new Date() } })
      }
    }

    const { ok, out } = await run(db, [fakeMigration('0001-a', { up })], {
      dryRun: true,
    })

    expect(ok).toBe(true)
    expect(seen).toEqual([true])
    expect(db.snapshot()).toEqual(before)
    expect(out).toEqual([
      expect.stringMatching(
        /^\[migrate\] chat 0001-a \.\.\. dry-run in \d+ms \(không ghi gì\)$/,
      ),
    ])
  })

  it('lock còn hạn của tiến trình khác -> chờ rồi báo rõ ai giữ, không chạy gì', async () => {
    const db = new FakeDb('chat-service')
    const held = {
      _id: 'lock',
      owner: 'deploy-khac:42:beef',
      command: 'up',
      acquiredAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    }
    db.collection(LOCK_COLLECTION).seed(held)
    const up = jest.fn(() => Promise.resolve())

    const { ok, err } = await run(db, [fakeMigration('0001-a', { up })])

    expect(ok).toBe(false)
    expect(up).not.toHaveBeenCalled()
    expect(err).toEqual([
      expect.stringContaining(
        'Lock migrate của chat-service đang bị giữ bởi deploy-khac:42:beef (lệnh up',
      ),
    ])
    expect(lockDocs(db)).toEqual([held])
  })

  it('lock đã hết hạn (tiến trình trước chết) -> lấy lại được, chạy, rồi nhả', async () => {
    const db = new FakeDb()
    db.collection(LOCK_COLLECTION).seed({
      _id: 'lock',
      owner: 'da-chet:1:dead',
      command: 'background',
      acquiredAt: new Date(Date.now() - 20 * 60_000),
      expiresAt: new Date(Date.now() - 10 * 60_000),
    })
    const up = jest.fn(() => Promise.resolve())

    const { ok } = await run(db, [fakeMigration('0001-a', { up })])

    expect(ok).toBe(true)
    expect(up).toHaveBeenCalledTimes(1)
    expect(lockDocs(db)).toEqual([])
  })

  it('hai runner cùng lúc trên một DB: chỉ một bên chạy, bên kia báo bận', async () => {
    const db = new FakeDb()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const slow = jest.fn(() => gate)
    const migrations = [fakeMigration('0001-a', { up: slow })]

    const first = run(db, migrations)
    await waitFor(() => slow.mock.calls.length === 1)
    expect(lockDocs(db)).toHaveLength(1)

    const second = await run(db, migrations, { lockWaitMs: 20 })
    release()

    expect(second.ok).toBe(false)
    expect(second.err[0]).toContain('đang bị giữ')
    expect((await first).ok).toBe(true)
    expect(slow).toHaveBeenCalledTimes(1)
    expect(lockDocs(db)).toEqual([])
  })

  it('chọn theo id: chạy được migration manual và ghi ledger', async () => {
    const db = new FakeDb()
    const manual = jest.fn(() => Promise.resolve())

    const { ok } = await run(
      db,
      [
        fakeMigration('0001-a'),
        fakeMigration('0002-b', { mode: 'manual', up: manual }),
      ],
      { selection: { id: '0002-b' }, command: 'run' },
    )

    expect(ok).toBe(true)
    expect(manual).toHaveBeenCalledTimes(1)
    const ledger = await ledgerOf(db)
    expect(ledger.get('0002-b')).toMatchObject({
      status: 'applied',
      mode: 'manual',
    })
    expect(ledger.has('0001-a')).toBe(false)
  })

  it('background bị dừng giữa chừng -> lần sau làm tiếp từ checkpoint lưu trong ledger', async () => {
    const db = new FakeDb()
    const ids = Array.from({ length: 5 }, (_, i) =>
      ObjectId.createFromTime(1_700_000_000 + i),
    )
    db.collection('items').seed(...ids.map((_id) => ({ _id })))
    const seen: string[] = []
    let failNext = true
    const migration = fakeMigration('0001-a', {
      mode: 'background',
      up: async (ctx) => {
        await ctx.eachBatch({ collection: 'items', batchSize: 2 }, (docs) => {
          if (seen.length === 2 && failNext) {
            failNext = false
            return Promise.reject(new Error('container bị stop'))
          }
          seen.push(...docs.map((doc) => String(doc._id)))
          return Promise.resolve()
        })
      },
    })
    const background = {
      selection: { mode: 'background' as const },
      command: 'background',
    }

    const first = await run(db, [migration], background)
    const failed = (await ledgerOf(db)).get('0001-a')
    const second = await run(db, [migration], background)

    expect(first.ok).toBe(false)
    expect(failed?.status).toBe('failed')
    expect(String((failed?.checkpoint as { items: ObjectId }).items)).toBe(
      String(ids[1]),
    )
    expect(second.ok).toBe(true)
    expect(seen).toEqual(ids.map(String))
    expect((await ledgerOf(db)).get('0001-a')?.status).toBe('applied')
  })

  it('SIGTERM giữa eachBatch -> ghi failed, nhả lock, không chạy migration sau', async () => {
    const db = new FakeDb()
    db.collection('items').seed({ _id: 1 }, { _id: 2 }, { _id: 3 })
    const controller = new AbortController()
    const next = jest.fn(() => Promise.resolve())

    const { ok } = await run(
      db,
      [
        fakeMigration('0001-a', {
          mode: 'background',
          up: async (ctx) => {
            await ctx.eachBatch({ collection: 'items', batchSize: 1 }, () => {
              controller.abort(new Error('Bị dừng bởi SIGTERM'))
              return Promise.resolve()
            })
          },
        }),
        fakeMigration('0002-b', { mode: 'background', up: next }),
      ],
      {
        selection: { mode: 'background' },
        command: 'background',
        signal: controller.signal,
      },
    )

    expect(ok).toBe(false)
    expect(next).not.toHaveBeenCalled()
    expect((await ledgerOf(db)).get('0001-a')).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('SIGTERM'),
      checkpoint: { items: 1 },
    })
    expect(lockDocs(db)).toEqual([])
  })
})
