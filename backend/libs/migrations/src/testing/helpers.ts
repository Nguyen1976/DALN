import type { LoadedMigration } from '../discovery'
import { createEachBatch } from '../each-batch'
import type {
  MigrationCheckpoint,
  MigrationContext,
  MigrationMode,
} from '../types'
import type { FakeDb } from './fake-db'

/** Migration dựng sẵn trong bộ nhớ (không cần file) cho test runner. */
export function fakeMigration(
  id: string,
  options: {
    mode?: MigrationMode
    checksum?: string
    up?: (ctx: MigrationContext) => Promise<void>
  } = {},
): LoadedMigration {
  return {
    id,
    file: `/virtual/${id}.ts`,
    description: `mô tả ${id}`,
    mode: options.mode ?? 'deploy',
    checksum: options.checksum ?? `sum-${id}`,
    up: options.up ?? (() => Promise.resolve()),
  }
}

export function memoryCheckpoint(initial?: unknown) {
  let value = initial
  return {
    get: jest.fn(() => Promise.resolve(value)),
    set: jest.fn((next: unknown) => {
      value = next
      return Promise.resolve()
    }),
    peek: () => value,
  }
}

/** ctx cho một migration chạy trên FakeDb, không qua runner/ledger/lock. */
export function makeContext(
  db: FakeDb,
  options: {
    dryRun?: boolean
    service?: string
    checkpoint?: MigrationCheckpoint
  } = {},
) {
  const logs: string[] = []
  const checkpoint = options.checkpoint ?? memoryCheckpoint()
  const sleep = jest.fn((ms: number) => {
    void ms
    return Promise.resolve()
  })
  const ctx: MigrationContext = {
    db: db.asDb(),
    service: options.service ?? 'test',
    dryRun: options.dryRun ?? false,
    log: (msg) => {
      logs.push(msg)
    },
    checkpoint,
    eachBatch: createEachBatch({ db: db.asDb(), checkpoint, sleep }),
  }
  return { ctx, logs, sleep, checkpoint }
}
