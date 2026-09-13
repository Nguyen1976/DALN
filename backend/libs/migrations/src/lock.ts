import { randomBytes } from 'node:crypto'
import { hostname } from 'node:os'
import type { Db } from 'mongodb'
import type { LockDoc } from './types'

export const LOCK_COLLECTION = '_migrations_lock'
export const LOCK_ID = 'lock'
/** Tiến trình chết giữa chừng thì lock tự hết hạn sau chừng này. */
export const DEFAULT_LOCK_TTL_MS = 10 * 60_000
export const DEFAULT_LOCK_WAIT_MS = 30_000

export class LockBusyError extends Error {
  override name = 'LockBusyError'
}

export interface LockOptions {
  command: string
  ttlMs?: number
  /** Chờ tối đa bao lâu nếu lock đang bị giữ. */
  waitMs?: number
  pollMs?: number
  owner?: string
  sleep?: (ms: number) => Promise<void>
}

export interface HeldLock {
  owner: string
  /** Gia hạn. false = lock đã rơi vào tay tiến trình khác. */
  refresh(): Promise<boolean>
  release(): Promise<void>
}

export const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

export function newLockOwner(): string {
  return `${hostname()}:${process.pid}:${randomBytes(4).toString('hex')}`
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 11000
  )
}

/**
 * Lấy lock của một DB bằng MỘT findOneAndUpdate nguyên tử: chỉ khớp khi lock
 * đã hết hạn. Lock còn hạn thì filter không khớp, upsert cố chèn `_id: 'lock'`
 * lần nữa và Mongo ném E11000 -> nghĩa là đang có người giữ. Hai tiến trình
 * cùng tranh thì chỉ một bên thắng, không cần transaction.
 */
export async function acquireLock(
  db: Db,
  options: LockOptions,
): Promise<HeldLock> {
  const locks = db.collection<LockDoc>(LOCK_COLLECTION)
  const owner = options.owner ?? newLockOwner()
  const ttlMs = options.ttlMs ?? DEFAULT_LOCK_TTL_MS
  const waitMs = options.waitMs ?? DEFAULT_LOCK_WAIT_MS
  const pollMs = options.pollMs ?? 1000
  const sleep = options.sleep ?? defaultSleep
  const deadline = Date.now() + waitMs

  const tryTake = async (): Promise<boolean> => {
    const now = new Date()
    try {
      await locks.findOneAndUpdate(
        { _id: LOCK_ID, expiresAt: { $lte: now } },
        {
          $set: {
            owner,
            command: options.command,
            acquiredAt: now,
            expiresAt: new Date(now.getTime() + ttlMs),
          },
        },
        { upsert: true },
      )
      return true
    } catch (error) {
      if (isDuplicateKeyError(error)) return false
      throw error
    }
  }

  while (!(await tryTake())) {
    const left = deadline - Date.now()
    if (left <= 0) {
      const holder = await locks.findOne({ _id: LOCK_ID })
      throw new LockBusyError(describeBusy(db.databaseName, holder, waitMs))
    }
    await sleep(Math.min(pollMs, left))
  }

  return {
    owner,
    async refresh() {
      const res = await locks.updateOne(
        { _id: LOCK_ID, owner },
        { $set: { expiresAt: new Date(Date.now() + ttlMs) } },
      )
      return res.matchedCount > 0
    },
    async release() {
      await locks.deleteOne({ _id: LOCK_ID, owner })
    },
  }
}

function describeBusy(
  dbName: string,
  holder: LockDoc | null,
  waitMs: number,
): string {
  const waited = `${Math.round(waitMs / 1000)}s`
  if (!holder) {
    return `Không lấy được lock migrate của ${dbName} sau ${waited} — thử lại.`
  }
  return (
    `Lock migrate của ${dbName} đang bị giữ bởi ${holder.owner} ` +
    `(lệnh ${holder.command}, từ ${holder.acquiredAt.toISOString()}). ` +
    `Đã chờ ${waited}. Có một lần migrate khác đang chạy: chờ nó xong rồi thử ` +
    `lại. Nếu tiến trình đó đã chết, lock tự hết hạn lúc ` +
    `${holder.expiresAt.toISOString()}.`
  )
}
