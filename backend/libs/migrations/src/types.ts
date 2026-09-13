import type { Db, Document, Filter, WithId } from 'mongodb'

/**
 * Khi nào migration được chạy:
 * - `deploy` (mặc định): trong bước `migrate` của deploy, TRƯỚC khi app mới
 *   lên. Dành cho dữ liệu mà code mới cần có sẵn. Phải nhanh.
 * - `background`: sau khi app đã lên (`migrate:background`). Dành cho backfill
 *   dài: chạy theo lô bằng `ctx.eachBatch`, bị dừng thì lần sau chạy tiếp.
 * - `manual`: không bao giờ tự chạy, chỉ chạy bằng `migrate:run <id>`.
 */
export type MigrationMode = 'deploy' | 'background' | 'manual'

export const MIGRATION_MODES: readonly MigrationMode[] = [
  'deploy',
  'background',
  'manual',
]

export interface EachBatchOptions<T extends Document = Document> {
  /** Collection trong DB của chính service. */
  collection: string
  /** Chỉ lấy document khớp điều kiện. Mặc định: tất cả. */
  filter?: Filter<T>
  /** Số document mỗi lô. Mặc định 500. */
  batchSize?: number
  /** Nghỉ giữa hai lô (ms) để nhường tải cho app. Mặc định 0. */
  pauseMs?: number
  /** Projection của find — phải giữ lại `_id`. */
  projection?: Document
}

export interface EachBatchResult {
  batches: number
  docs: number
}

export interface MigrationCheckpoint {
  get(): Promise<unknown>
  set(value: unknown): Promise<void>
}

export interface MigrationContext {
  db: Db
  service: string
  dryRun: boolean
  // log/eachBatch khai báo dạng property (không phải method) để migration
  // destructure thoải mái: async up({ db, dryRun, log, eachBatch }).
  log: (msg: string) => void
  checkpoint: MigrationCheckpoint
  /**
   * Duyệt collection theo `_id` tăng dần, từng lô. Sau mỗi lô ghi `_id` cuối
   * vào checkpoint (theo tên collection), nên chạy lại sẽ tiếp từ lô kế tiếp.
   */
  eachBatch: <T extends Document = Document>(
    options: EachBatchOptions<T>,
    fn: (docs: WithId<T>[]) => Promise<void>,
  ) => Promise<EachBatchResult>
}

export interface Migration {
  /** Phải trùng tên file (bỏ `.ts`), vd `0003-init-unread-count`. */
  id: string
  description: string
  mode?: MigrationMode
  up(ctx: MigrationContext): Promise<void>
}

export type LedgerStatus = 'applied' | 'failed' | 'running'

/** Một document trong `_migrations` — mỗi DB service có ledger riêng. */
export interface LedgerDoc {
  _id: string
  description: string
  mode: MigrationMode
  /** sha256 nội dung file migration. */
  checksum: string
  status: LedgerStatus
  startedAt: Date
  appliedAt?: Date
  durationMs?: number
  error?: string
  checkpoint?: unknown
}

/** Document duy nhất `_id: 'lock'` trong `_migrations_lock`. */
export interface LockDoc {
  _id: string
  owner: string
  command: string
  acquiredAt: Date
  expiresAt: Date
}
