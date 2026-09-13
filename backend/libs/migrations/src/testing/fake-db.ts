import { ObjectId, type Db } from 'mongodb'

// Bản giả trong bộ nhớ của MỘT phần nhỏ API Db/Collection mà lib migrations và
// các migration dùng. Không phải Mongo: chỉ đủ ngữ nghĩa cho test (so khớp
// filter, update thường + pipeline $set, upsert, E11000 trên _id).

export type FakeDoc = Record<string, unknown>

export class FakeDuplicateKeyError extends Error {
  readonly code = 11000
  constructor(id: unknown) {
    super(`E11000 duplicate key error: _id ${String(id)}`)
  }
}

export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date) &&
    !(value instanceof ObjectId)
  )
}

function isOperatorObject(value: unknown): value is Record<string, unknown> {
  return (
    isPlainObject(value) && Object.keys(value).some((k) => k.startsWith('$'))
  )
}

export function clone<T>(value: T): T {
  if (value instanceof Date) return new Date(value.getTime()) as T
  if (value instanceof ObjectId) return value
  if (Array.isArray(value)) {
    return (value as unknown[]).map((item) => clone(item)) as T
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, clone(item)]),
    ) as T
  }
  return value
}

function lookup(
  doc: FakeDoc,
  path: string,
): { exists: boolean; value: unknown } {
  let current: unknown = doc
  for (const key of path.split('.')) {
    if (!isPlainObject(current) || !(key in current)) {
      return { exists: false, value: undefined }
    }
    current = current[key]
  }
  return { exists: true, value: current }
}

function setPath(doc: FakeDoc, path: string, value: unknown): void {
  const keys = path.split('.')
  let current = doc
  for (const key of keys.slice(0, -1)) {
    if (!isPlainObject(current[key])) current[key] = {}
    current = current[key] as FakeDoc
  }
  current[keys[keys.length - 1]] = value
}

function unsetPath(doc: FakeDoc, path: string): void {
  const keys = path.split('.')
  let current: unknown = doc
  for (const key of keys.slice(0, -1)) {
    if (!isPlainObject(current)) return
    current = current[key]
  }
  if (isPlainObject(current)) delete current[keys[keys.length - 1]]
}

export function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof ObjectId || b instanceof ObjectId) {
    return a instanceof ObjectId && b instanceof ObjectId && a.equals(b)
  }
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime()
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, i) => sameValue(item, b[i]))
    )
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = Object.keys(a)
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => key in b && sameValue(a[key], b[key]))
    )
  }
  return a === b
}

function compare(a: unknown, b: unknown): number | null {
  if (a instanceof ObjectId && b instanceof ObjectId) {
    const x = a.toHexString()
    const y = b.toHexString()
    return x < y ? -1 : x > y ? 1 : 0
  }
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime()
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'string' && typeof b === 'string') {
    return a < b ? -1 : a > b ? 1 : 0
  }
  return null
}

type Found = { exists: boolean; value: unknown }

function equalsCondition(found: Found, expected: unknown): boolean {
  // Như Mongo: { f: null } khớp cả field bằng null lẫn field không tồn tại.
  if (expected === null) return !found.exists || found.value === null
  return found.exists && sameValue(found.value, expected)
}

function matchCondition(found: Found, condition: unknown): boolean {
  if (!isOperatorObject(condition)) return equalsCondition(found, condition)
  return Object.entries(condition).every(([op, arg]) => {
    switch (op) {
      case '$eq':
        return equalsCondition(found, arg)
      case '$ne':
        return !equalsCondition(found, arg)
      case '$exists':
        return found.exists === Boolean(arg)
      case '$in':
        return (arg as unknown[]).some((item) => equalsCondition(found, item))
      case '$gt':
      case '$gte':
      case '$lt':
      case '$lte': {
        if (!found.exists) return false
        const c = compare(found.value, arg)
        if (c === null) return false
        if (op === '$gt') return c > 0
        if (op === '$gte') return c >= 0
        if (op === '$lt') return c < 0
        return c <= 0
      }
      case '$type':
        if (!found.exists) return false
        if (arg === 'objectId') return found.value instanceof ObjectId
        if (arg === 'date') return found.value instanceof Date
        if (arg === 'string') return typeof found.value === 'string'
        throw new Error(`fake-db: $type ${String(arg)} chưa hỗ trợ`)
      default:
        throw new Error(`fake-db: toán tử ${op} chưa hỗ trợ`)
    }
  })
}

export function matches(doc: FakeDoc, filter: FakeDoc): boolean {
  return Object.entries(filter).every(([key, condition]) => {
    if (key === '$or') {
      return (condition as FakeDoc[]).some((sub) => matches(doc, sub))
    }
    if (key === '$and') {
      return (condition as FakeDoc[]).every((sub) => matches(doc, sub))
    }
    if (key.startsWith('$')) throw new Error(`fake-db: ${key} chưa hỗ trợ`)
    return matchCondition(lookup(doc, key), condition)
  })
}

/** Biểu thức aggregation tối thiểu cho update dạng pipeline. */
function evaluate(doc: FakeDoc, expr: unknown, now: Date): unknown {
  if (typeof expr === 'string') {
    if (expr === '$$NOW') return now
    if (expr.startsWith('$')) return lookup(doc, expr.slice(1)).value
    return expr
  }
  if (!isOperatorObject(expr)) return expr

  const [[op, arg]] = Object.entries(expr)
  switch (op) {
    case '$ifNull': {
      const [first, fallback] = arg as unknown[]
      const value = evaluate(doc, first, now)
      return value === null || value === undefined
        ? evaluate(doc, fallback, now)
        : value
    }
    case '$eq': {
      const [left, right] = arg as unknown[]
      return sameValue(evaluate(doc, left, now), evaluate(doc, right, now))
    }
    case '$switch': {
      const { branches, default: fallback } = arg as {
        branches: { case: unknown; then: unknown }[]
        default: unknown
      }
      for (const branch of branches) {
        if (evaluate(doc, branch.case, now) === true) {
          return evaluate(doc, branch.then, now)
        }
      }
      return evaluate(doc, fallback, now)
    }
    default:
      throw new Error(`fake-db: biểu thức ${op} chưa hỗ trợ`)
  }
}

type Update = FakeDoc | FakeDoc[]

function applyUpdate(doc: FakeDoc, update: Update, inserting: boolean): void {
  if (Array.isArray(update)) {
    const now = new Date()
    for (const stage of update) {
      const [[op, fields]] = Object.entries(stage)
      if (op !== '$set') throw new Error(`fake-db: stage ${op} chưa hỗ trợ`)
      const before = clone(doc)
      for (const [path, expr] of Object.entries(fields as FakeDoc)) {
        const value = evaluate(before, expr, now)
        if (value === undefined) unsetPath(doc, path)
        else setPath(doc, path, clone(value))
      }
    }
    return
  }

  for (const [op, fields] of Object.entries(update)) {
    for (const [path, value] of Object.entries(fields as FakeDoc)) {
      switch (op) {
        case '$set':
          setPath(doc, path, clone(value))
          break
        case '$setOnInsert':
          if (inserting) setPath(doc, path, clone(value))
          break
        case '$unset':
          unsetPath(doc, path)
          break
        case '$inc':
          setPath(
            doc,
            path,
            ((lookup(doc, path).value as number | undefined) ?? 0) +
              (value as number),
          )
          break
        default:
          throw new Error(`fake-db: update ${op} chưa hỗ trợ`)
      }
    }
  }
}

function project(doc: FakeDoc, projection?: FakeDoc): FakeDoc {
  if (!projection || Object.keys(projection).length === 0) return doc
  const fields = Object.entries(projection)
  const inclusive = fields.some(([key, on]) => key !== '_id' && Boolean(on))
  if (!inclusive) {
    const out = { ...doc }
    for (const [key] of fields) unsetPath(out, key)
    return out
  }
  const out: FakeDoc = {}
  if (projection._id !== 0 && '_id' in doc) out._id = doc._id
  for (const [key, on] of fields) {
    if (key === '_id' || !on) continue
    const found = lookup(doc, key)
    if (found.exists) setPath(out, key, found.value)
  }
  return out
}

function settle<T>(fn: () => T): Promise<T> {
  try {
    return Promise.resolve(fn())
  } catch (error) {
    return Promise.reject(error as Error)
  }
}

export class FakeCursor {
  private sortSpec: [string, number][] = []
  private limitCount = 0

  constructor(
    private readonly rows: () => FakeDoc[],
    private readonly projection?: FakeDoc,
  ) {}

  sort(spec: Record<string, number>): this {
    this.sortSpec = Object.entries(spec)
    return this
  }

  limit(n: number): this {
    this.limitCount = n
    return this
  }

  toArray(): Promise<FakeDoc[]> {
    let rows = [...this.rows()]
    if (this.sortSpec.length) {
      rows.sort((a, b) => {
        for (const [key, direction] of this.sortSpec) {
          const c = compare(lookup(a, key).value, lookup(b, key).value) ?? 0
          if (c !== 0) return c * direction
        }
        return 0
      })
    }
    if (this.limitCount > 0) rows = rows.slice(0, this.limitCount)
    return Promise.resolve(
      rows.map((row) => clone(project(row, this.projection))),
    )
  }
}

type UpdateResult = {
  acknowledged: true
  matchedCount: number
  modifiedCount: number
  upsertedCount: number
  upsertedId: unknown
}

type BulkOp = {
  updateOne?: { filter: FakeDoc; update: Update; upsert?: boolean }
  insertOne?: { document: FakeDoc }
}

export class FakeCollection {
  readonly docs: FakeDoc[] = []

  constructor(readonly collectionName: string) {}

  private matching(filter: FakeDoc = {}): FakeDoc[] {
    return this.docs.filter((doc) => matches(doc, filter))
  }

  private insert(doc: FakeDoc): FakeDoc {
    const row = clone(doc)
    if (!('_id' in row)) row._id = new ObjectId()
    if (this.docs.some((existing) => sameValue(existing._id, row._id))) {
      throw new FakeDuplicateKeyError(row._id)
    }
    this.docs.push(row)
    return row
  }

  /** Nạp dữ liệu mẫu (đồng bộ) cho test. */
  seed(...docs: object[]): FakeDoc[] {
    return docs.map((doc) => this.insert(doc as FakeDoc))
  }

  private updateOneNow(
    filter: FakeDoc,
    update: Update,
    upsert = false,
  ): UpdateResult & { row: FakeDoc | null } {
    const [row] = this.matching(filter)
    if (row) {
      const before = clone(row)
      applyUpdate(row, update, false)
      return {
        acknowledged: true,
        matchedCount: 1,
        modifiedCount: sameValue(before, row) ? 0 : 1,
        upsertedCount: 0,
        upsertedId: null,
        row,
      }
    }
    if (!upsert) {
      return {
        acknowledged: true,
        matchedCount: 0,
        modifiedCount: 0,
        upsertedCount: 0,
        upsertedId: null,
        row: null,
      }
    }
    // Upsert: document mới lấy các điều kiện bằng-giá-trị trong filter làm gốc.
    const base = Object.fromEntries(
      Object.entries(filter).filter(
        ([key, value]) => !key.startsWith('$') && !isOperatorObject(value),
      ),
    )
    applyUpdate(base, update, true)
    const inserted = this.insert(base)
    return {
      acknowledged: true,
      matchedCount: 0,
      modifiedCount: 0,
      upsertedCount: 1,
      upsertedId: inserted._id,
      row: inserted,
    }
  }

  find(filter: FakeDoc = {}, options: { projection?: FakeDoc } = {}) {
    return new FakeCursor(() => this.matching(filter), options.projection)
  }

  findOne(filter: FakeDoc = {}, options: { projection?: FakeDoc } = {}) {
    return settle(() => {
      const [row] = this.matching(filter)
      return row ? clone(project(row, options.projection)) : null
    })
  }

  countDocuments(filter: FakeDoc = {}) {
    return settle(() => this.matching(filter).length)
  }

  insertOne(doc: FakeDoc) {
    return settle(() => ({
      acknowledged: true,
      insertedId: this.insert(doc)._id,
    }))
  }

  updateOne(
    filter: FakeDoc,
    update: Update,
    options: { upsert?: boolean } = {},
  ): Promise<UpdateResult> {
    return settle(() => {
      const { row: _row, ...result } = this.updateOneNow(
        filter,
        update,
        options.upsert,
      )
      void _row
      return result
    })
  }

  updateMany(filter: FakeDoc, update: Update): Promise<UpdateResult> {
    return settle(() => {
      const rows = this.matching(filter)
      let modified = 0
      for (const row of rows) {
        const before = clone(row)
        applyUpdate(row, update, false)
        if (!sameValue(before, row)) modified += 1
      }
      return {
        acknowledged: true,
        matchedCount: rows.length,
        modifiedCount: modified,
        upsertedCount: 0,
        upsertedId: null,
      }
    })
  }

  findOneAndUpdate(
    filter: FakeDoc,
    update: Update,
    options: { upsert?: boolean } = {},
  ) {
    return settle(() => {
      const { row } = this.updateOneNow(filter, update, options.upsert)
      return row ? clone(row) : null
    })
  }

  deleteOne(filter: FakeDoc) {
    return settle(() => {
      const index = this.docs.findIndex((doc) => matches(doc, filter))
      if (index >= 0) this.docs.splice(index, 1)
      return { acknowledged: true, deletedCount: index >= 0 ? 1 : 0 }
    })
  }

  bulkWrite(ops: BulkOp[], options?: { ordered?: boolean }) {
    void options
    return settle(() => {
      const total = {
        insertedCount: 0,
        matchedCount: 0,
        modifiedCount: 0,
        upsertedCount: 0,
      }
      for (const op of ops) {
        if (op.insertOne) {
          this.insert(op.insertOne.document)
          total.insertedCount += 1
        } else if (op.updateOne) {
          const res = this.updateOneNow(
            op.updateOne.filter,
            op.updateOne.update,
            op.updateOne.upsert,
          )
          total.matchedCount += res.matchedCount
          total.modifiedCount += res.modifiedCount
          total.upsertedCount += res.upsertedCount
        } else {
          throw new Error('fake-db: bulkWrite chỉ hỗ trợ insertOne/updateOne')
        }
      }
      return total
    })
  }
}

export class FakeDb {
  private readonly collections = new Map<string, FakeCollection>()

  constructor(readonly databaseName = 'test-db') {}

  collection(name: string): FakeCollection {
    let coll = this.collections.get(name)
    if (!coll) {
      coll = new FakeCollection(name)
      this.collections.set(name, coll)
    }
    return coll
  }

  /** Ép kiểu để truyền vào code nhận `Db` của driver. */
  asDb(): Db {
    return this as unknown as Db
  }

  /**
   * Toàn bộ dữ liệu (bỏ collection rỗng — chỉ đọc cũng tạo collection rỗng
   * trong bản giả). "Không ghi gì" = snapshot trước và sau bằng nhau.
   */
  snapshot(): Record<string, FakeDoc[]> {
    return Object.fromEntries(
      [...this.collections]
        .filter(([, coll]) => coll.docs.length > 0)
        .map(([name, coll]) => [name, clone(coll.docs)]),
    )
  }
}
