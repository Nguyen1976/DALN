// Các interface "port" mô tả tối thiểu hình dạng Prisma client mà lib saga cần.
// Mỗi app trong monorepo có một Prisma client generated riêng, nên lib này KHÔNG
// import client cụ thể nào — chỉ dựa vào structural typing để dùng chung được.

export type OutboxStatusValue = 'NEW' | 'PUBLISHED' | 'FAILED' | 'DEAD'

export interface OutboxRecord {
  id: string
  messageId: string
  exchange: string
  routingKey: string
  payload: unknown
  status: OutboxStatusValue
  attempt: number
  maxAttempts: number
  nextAttemptAt: Date | null
  /**
   * Version schema của payload, publish thành header `x-event-version`.
   * Model OutboxEvent (Prisma) CHƯA có cột này nên hiện luôn undefined -> relay
   * dùng 1. Khi cần phát version 2: thêm `version Int @default(1)` vào model
   * OutboxEvent của từng service, rồi mới mở `version` trong OutboxEventInput.
   */
  version?: number | null
}

export interface PrismaDelegateLike {
  create(args: unknown): Promise<unknown>
  findMany(args: unknown): Promise<unknown[]>
  update(args: unknown): Promise<unknown>
}

export interface OutboxCapablePrisma {
  outboxEvent: PrismaDelegateLike
}

/** A transaction that can record which messages it has consumed. */
export interface InboxTx {
  inboxMessage: { create(args: unknown): Promise<unknown> }
}

/** A transaction that can queue an outgoing event. */
export interface OutboxTx {
  outboxEvent: { create(args: unknown): Promise<unknown> }
}

/**
 * A client that runs interactive transactions. `Tx` is the app's own
 * transaction client, so a handler gets its real models, fully typed.
 */
export interface TransactionalPrisma<Tx> {
  $transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>
}

export interface OutboxEventInput {
  messageId: string
  exchange: string
  routingKey: string
  payload: unknown
  // Cố ý CHƯA có `version`: ghi field schema không có, Prisma ném "Unknown
  // argument" và rollback luôn business write. Xem OutboxRecord.version.
}
