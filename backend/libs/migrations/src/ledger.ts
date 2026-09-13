import type { Collection, Db } from 'mongodb'
import type { LoadedMigration } from './discovery'
import type { LedgerDoc, MigrationCheckpoint } from './types'

export const LEDGER_COLLECTION = '_migrations'

const MAX_ERROR_LENGTH = 4000

export function ledgerOf(db: Db): Collection<LedgerDoc> {
  return db.collection<LedgerDoc>(LEDGER_COLLECTION)
}

export async function readLedger(db: Db): Promise<Map<string, LedgerDoc>> {
  const docs = await ledgerOf(db).find({}).toArray()
  return new Map(docs.map((doc) => [doc._id, doc]))
}

export function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? `${error.name}: ${error.message}`
  }
  return String(error)
}

/**
 * Đánh dấu bắt đầu chạy. Giữ nguyên `checkpoint` của lần trước (nếu có) để
 * eachBatch chạy tiếp từ đó; checksum ghi theo file hiện tại — migration chưa
 * applied thì được phép sửa rồi chạy lại.
 */
export async function markRunning(
  db: Db,
  migration: LoadedMigration,
  startedAt: Date,
): Promise<void> {
  await ledgerOf(db).updateOne(
    { _id: migration.id },
    {
      $set: {
        description: migration.description,
        mode: migration.mode,
        checksum: migration.checksum,
        status: 'running',
        startedAt,
      },
      $unset: { appliedAt: '', durationMs: '', error: '' },
    },
    { upsert: true },
  )
}

export async function markApplied(
  db: Db,
  id: string,
  appliedAt: Date,
  durationMs: number,
): Promise<void> {
  await ledgerOf(db).updateOne(
    { _id: id },
    { $set: { status: 'applied', appliedAt, durationMs } },
  )
}

export async function markFailed(
  db: Db,
  id: string,
  error: unknown,
  durationMs: number,
): Promise<void> {
  await ledgerOf(db).updateOne(
    { _id: id },
    {
      $set: {
        status: 'failed',
        error: describeError(error).slice(0, MAX_ERROR_LENGTH),
        durationMs,
      },
    },
  )
}

/**
 * Checkpoint lưu trong chính dòng ledger của migration. Dry-run: đọc giá trị
 * đã lưu nhưng chỉ ghi vào bộ nhớ, không chạm DB.
 */
export function createCheckpoint(
  db: Db,
  id: string,
  dryRun: boolean,
): MigrationCheckpoint {
  let inMemory = false
  let memory: unknown

  return {
    async get() {
      if (inMemory) return memory
      const doc = await ledgerOf(db).findOne(
        { _id: id },
        { projection: { checkpoint: 1 } },
      )
      return doc?.checkpoint
    },
    async set(value) {
      if (dryRun) {
        inMemory = true
        memory = value
        return
      }
      await ledgerOf(db).updateOne({ _id: id }, { $set: { checkpoint: value } })
    },
  }
}
