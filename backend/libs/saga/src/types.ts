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
}

export interface PrismaDelegateLike {
  create(args: unknown): Promise<unknown>
  findMany(args: unknown): Promise<unknown[]>
  update(args: unknown): Promise<unknown>
}

export interface OutboxCapablePrisma {
  outboxEvent: PrismaDelegateLike
}

// Client tối thiểu cho transaction tương tác (interactive transaction).
export interface TransactionalPrisma {
  $transaction<T>(fn: (tx: TxClient) => Promise<T>): Promise<T>
}

// Bên trong transaction: cần tạo bản ghi inbox + (tuỳ chọn) ghi outbox.
export interface TxClient {
  inboxMessage: { create(args: unknown): Promise<unknown> }
  outboxEvent: { create(args: unknown): Promise<unknown> }
  [model: string]: unknown
}

export interface OutboxEventInput {
  messageId: string
  exchange: string
  routingKey: string
  payload: unknown
}
