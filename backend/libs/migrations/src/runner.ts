import type { Db } from 'mongodb'
import type { LoadedMigration } from './discovery'
import { createEachBatch } from './each-batch'
import {
  createCheckpoint,
  describeError,
  markApplied,
  markFailed,
  markRunning,
  readLedger,
} from './ledger'
import {
  acquireLock,
  DEFAULT_LOCK_TTL_MS,
  defaultSleep,
  LockBusyError,
  type HeldLock,
} from './lock'
import type { LedgerDoc, MigrationContext, MigrationMode } from './types'

/**
 * - applied: đã chạy, file không đổi.
 * - pending: chưa chạy bao giờ.
 * - failed / running: lần trước lỗi hoặc dừng giữa chừng -> chạy lại.
 * - changed: đã chạy nhưng file bị sửa sau đó -> từ chối chạy.
 */
export type MigrationState =
  | 'applied'
  | 'pending'
  | 'failed'
  | 'running'
  | 'changed'

export interface StatusEntry {
  migration: LoadedMigration
  state: MigrationState
  ledger?: LedgerDoc
}

export interface ServiceStatus {
  entries: StatusEntry[]
  /** Có trong ledger nhưng không còn file. */
  orphans: LedgerDoc[]
}

export function computeStatus(
  migrations: LoadedMigration[],
  ledger: Map<string, LedgerDoc>,
): ServiceStatus {
  const entries = migrations.map((migration): StatusEntry => {
    const doc = ledger.get(migration.id)
    if (!doc) return { migration, state: 'pending' }
    if (doc.status === 'applied') {
      return {
        migration,
        ledger: doc,
        state: doc.checksum === migration.checksum ? 'applied' : 'changed',
      }
    }
    return { migration, ledger: doc, state: doc.status }
  })
  const ids = new Set(migrations.map((migration) => migration.id))
  const orphans = [...ledger.values()].filter((doc) => !ids.has(doc._id))
  return { entries, orphans }
}

export function isPending(state: MigrationState): boolean {
  return state === 'pending' || state === 'failed' || state === 'running'
}

export function changedMessage(service: string, entry: StatusEntry): string {
  const was = entry.ledger?.checksum.slice(0, 12) ?? '?'
  const now = entry.migration.checksum.slice(0, 12)
  return (
    `[migrate] ${service} ${entry.migration.id} REFUSED: file đã bị sửa sau ` +
    `khi chạy (checksum ledger ${was}… ≠ file ${now}…). Không được sửa ` +
    `migration đã chạy — hoàn tác thay đổi trong file đó và viết một ` +
    `migration mới. Không chạy migration nào.`
  )
}

export type Selection = { mode: MigrationMode } | { id: string }

export interface RunServiceOptions {
  db: Db
  service: string
  migrations: LoadedMigration[]
  selection: Selection
  dryRun: boolean
  /** Ghi vào lock để biết ai đang giữ. */
  command: string
  out: (line: string) => void
  err: (line: string) => void
  lockTtlMs?: number
  lockWaitMs?: number
  lockPollMs?: number
  signal?: AbortSignal
  sleep?: (ms: number) => Promise<void>
}

/**
 * Chạy các migration được chọn của MỘT service, theo thứ tự tên file, dừng
 * ở lỗi đầu tiên. Trả false nếu có lỗi (lock bận, checksum lệch, migration
 * ném lỗi) — bên gọi thoát với mã 1.
 *
 * Dry-run không lấy lock và không ghi ledger: không ghi gì vào DB cả.
 */
export async function runService(options: RunServiceOptions): Promise<boolean> {
  const { db, service, dryRun, out, err, selection } = options
  const tag = `[migrate] ${service}`
  const sleep = options.sleep ?? defaultSleep
  const ttlMs = options.lockTtlMs ?? DEFAULT_LOCK_TTL_MS

  // Gộp tín hiệu huỷ từ ngoài (SIGTERM) với tín hiệu nội bộ (mất lock).
  const abort = new AbortController()
  const forward = () => abort.abort(options.signal?.reason)
  if (options.signal?.aborted) forward()
  else options.signal?.addEventListener('abort', forward, { once: true })

  let lock: HeldLock | undefined
  if (!dryRun) {
    try {
      lock = await acquireLock(db, {
        command: options.command,
        ttlMs,
        waitMs: options.lockWaitMs,
        pollMs: options.lockPollMs,
        sleep,
      })
    } catch (error) {
      options.signal?.removeEventListener('abort', forward)
      if (error instanceof LockBusyError) {
        err(`${tag}: ${error.message}`)
        return false
      }
      throw error
    }
  }

  // Gia hạn lock định kỳ để backfill dài hơn TTL không bị tiến trình khác
  // chiếm mất; TTL chỉ để dọn lock của tiến trình đã chết.
  const heldLock = lock
  const heartbeat = heldLock
    ? setInterval(
        () => {
          heldLock.refresh().then(
            (held) => {
              if (!held) {
                abort.abort(
                  new Error('Mất lock migrate (hết hạn và bị lấy mất) — dừng'),
                )
              }
            },
            (error: unknown) =>
              err(`${tag}: gia hạn lock lỗi: ${describeError(error)}`),
          )
        },
        Math.max(1000, Math.floor(ttlMs / 3)),
      )
    : undefined
  heartbeat?.unref()

  try {
    const { entries } = computeStatus(options.migrations, await readLedger(db))

    const changed = entries.filter((entry) => entry.state === 'changed')
    if (changed.length) {
      for (const entry of changed) err(changedMessage(service, entry))
      return false
    }

    const targets =
      'id' in selection
        ? entries.filter((entry) => entry.migration.id === selection.id)
        : entries.filter((entry) => entry.migration.mode === selection.mode)
    if (targets.length === 0) {
      const what = 'id' in selection ? selection.id : `mode ${selection.mode}`
      out(`${tag}: không có migration nào (${what})`)
      return true
    }

    for (const entry of targets) {
      const { migration } = entry
      const line = `${tag} ${migration.id} ...`

      if (entry.state === 'applied') {
        out(`${line} skipped (already applied)`)
        continue
      }
      if (abort.signal.aborted) {
        err(`${tag}: bị dừng trước ${migration.id} — chưa chạy`)
        return false
      }
      if (entry.state === 'running') {
        out(
          `${tag} ${migration.id}: lần chạy trước dừng giữa chừng — chạy lại (tiếp từ checkpoint nếu có)`,
        )
      }

      const started = Date.now()
      if (!dryRun) await markRunning(db, migration, new Date(started))
      const checkpoint = createCheckpoint(db, migration.id, dryRun)
      const ctx: MigrationContext = {
        db,
        service,
        dryRun,
        log: (msg) => out(`${tag} ${migration.id} | ${msg}`),
        checkpoint,
        eachBatch: createEachBatch({
          db,
          checkpoint,
          sleep,
          signal: abort.signal,
        }),
      }

      try {
        await migration.up(ctx)
      } catch (error) {
        const ms = Date.now() - started
        if (!dryRun) await markFailed(db, migration.id, error, ms)
        out(`${line} FAILED after ${ms}ms`)
        err(`${tag} ${migration.id}: ${describeError(error)}`)
        return false
      }

      const ms = Date.now() - started
      if (dryRun) {
        out(`${line} dry-run in ${ms}ms (không ghi gì)`)
        continue
      }
      await markApplied(db, migration.id, new Date(), ms)
      out(`${line} applied in ${ms}ms`)
    }
    return true
  } finally {
    if (heartbeat) clearInterval(heartbeat)
    options.signal?.removeEventListener('abort', forward)
    if (lock) {
      await lock
        .release()
        .catch((error: unknown) =>
          err(`${tag}: nhả lock lỗi (sẽ tự hết hạn): ${describeError(error)}`),
        )
    }
  }
}
