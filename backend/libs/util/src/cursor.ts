/**
 * Keyset cursors that survive ties.
 *
 * Ordering by a timestamp alone and paging with `createdAt < cursor` silently
 * drops every row that shares the boundary timestamp but did not fit on the
 * previous page. Messages written in the same millisecond by the batch writer,
 * or conversations stamped together by the friendship saga, hit this all the
 * time. The cursor therefore carries the row id as a tie-breaker, and the
 * query orders by (timestamp desc, id desc) to match.
 *
 * Wire format: `<ISO timestamp>|<id>`. A bare timestamp is still accepted so
 * older clients keep working.
 */
export interface KeysetCursor {
  at: Date
  id: string | null
}

export function parseKeysetCursor(raw?: string | null): KeysetCursor | null {
  if (!raw) return null

  const [timestamp, id] = String(raw).split('|')
  const at = new Date(timestamp)
  if (Number.isNaN(at.getTime())) return null

  return { at, id: id || null }
}

export function buildKeysetCursor(at: Date | string, id: string): string {
  const iso = at instanceof Date ? at.toISOString() : new Date(at).toISOString()
  return `${iso}|${id}`
}

/**
 * `where` fragment selecting rows strictly *older* than the cursor under a
 * (field desc, id desc) ordering.
 */
export function olderThanCursor(field: string, cursor: KeysetCursor | null) {
  if (!cursor) return {}
  if (!cursor.id) return { [field]: { lt: cursor.at } }

  return {
    OR: [
      { [field]: { lt: cursor.at } },
      { [field]: cursor.at, id: { lt: cursor.id } },
    ],
  }
}
