import type { Db, Document, Filter } from 'mongodb'
import type { MigrationCheckpoint, MigrationContext } from './types'

export interface EachBatchDeps {
  db: Db
  checkpoint: MigrationCheckpoint
  sleep: (ms: number) => Promise<void>
  /** Bị huỷ (SIGTERM, mất lock) thì dừng trước lô kế tiếp. */
  signal?: AbortSignal
}

type CheckpointState = Record<string, unknown>

function asState(value: unknown): CheckpointState {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as CheckpointState) }
    : {}
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return
  throw signal.reason instanceof Error
    ? signal.reason
    : new Error('Bị huỷ giữa chừng')
}

/**
 * Tạo `ctx.eachBatch`. Duyệt theo `_id` tăng dần bằng `_id > id cuối` (không
 * dùng skip), nên document bị sửa trong lúc chạy không làm lệch lô. Checkpoint
 * lưu `{ [collection]: _id cuối }`, nhờ vậy một migration duyệt được nhiều
 * collection mà không giẫm chân nhau.
 */
export function createEachBatch(
  deps: EachBatchDeps,
): MigrationContext['eachBatch'] {
  return async (options, fn) => {
    const {
      collection,
      filter = {},
      batchSize = 500,
      pauseMs = 0,
      projection,
    } = options
    if (!Number.isInteger(batchSize) || batchSize < 1) {
      throw new Error(`eachBatch: batchSize phải là số nguyên >= 1`)
    }

    const coll = deps.db.collection(collection)
    let state = asState(await deps.checkpoint.get())
    let lastId = state[collection]
    let batches = 0
    let docs = 0

    for (;;) {
      throwIfAborted(deps.signal)

      // Filter<T> generic không ghép được với điều kiện _id; bên trong chỉ cần
      // object thuần gửi thẳng xuống driver.
      const base = filter as unknown as Document
      const query: Document =
        lastId === undefined ? base : { $and: [base, { _id: { $gt: lastId } }] }
      const batch = await coll
        .find(query as Filter<Document>, projection ? { projection } : {})
        .sort({ _id: 1 })
        .limit(batchSize)
        .toArray()
      if (batch.length === 0) break

      const tail = batch[batch.length - 1]._id as unknown
      if (tail === undefined) {
        throw new Error('eachBatch: projection phải giữ lại _id')
      }

      await fn(batch as Parameters<typeof fn>[0])

      lastId = tail
      state = { ...state, [collection]: lastId }
      await deps.checkpoint.set(state)
      batches += 1
      docs += batch.length

      if (batch.length < batchSize) break
      if (pauseMs > 0) await deps.sleep(pauseMs)
    }

    return { batches, docs }
  }
}
