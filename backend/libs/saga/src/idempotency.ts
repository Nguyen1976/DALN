import { isUniqueConstraintError } from './prisma-error'
import type { TransactionalPrisma, TxClient } from './types'

class AlreadyProcessedError extends Error {
  constructor() {
    super('SAGA_MESSAGE_ALREADY_PROCESSED')
    this.name = 'AlreadyProcessedError'
  }
}

export interface ConsumeResult<T> {
  /** true nếu message được xử lý lần này; false nếu đã xử lý trước đó (trùng). */
  processed: boolean
  result?: T
}

export interface ConsumeOptions {
  messageId: string
  consumer: string
  sagaId?: string
}

/**
 * Xử lý message đúng MỘT LẦN duy nhất theo cơ chế Unique Constraint
 * (Chèn mù & Bắt Exception):
 *
 *  1. Mở transaction.
 *  2. INSERT bản ghi inbox(messageId) NGAY ĐẦU TIÊN ("chèn mù").
 *     - Nếu trùng messageId -> DB ném P2002 -> coi như đã xử lý -> bỏ qua.
 *  3. Nếu insert thành công -> chạy handler(tx) (business write + ghi outbox)
 *     trong cùng transaction.
 *  4. Commit. Nếu handler lỗi -> rollback cả inbox lẫn business -> message sẽ
 *     được redeliver và thử lại sạch sẽ.
 *
 * Nhờ unique index trên messageId, khi tải cao 2 message trùng tới đồng thời thì
 * DB đảm bảo chỉ 1 transaction commit được, transaction còn lại chắc chắn rơi
 * vào catch (P2002) -> race condition được chặn 100% ở tầng DB.
 */
export async function consumeIdempotent<T>(
  prisma: TransactionalPrisma,
  options: ConsumeOptions,
  handler: (tx: TxClient) => Promise<T>,
): Promise<ConsumeResult<T>> {
  try {
    const result = await prisma.$transaction(async (tx) => {
      try {
        await tx.inboxMessage.create({
          data: {
            messageId: options.messageId,
            consumer: options.consumer,
            sagaId: options.sagaId ?? null,
          },
        })
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          throw new AlreadyProcessedError()
        }
        throw error
      }

      return handler(tx)
    })

    return { processed: true, result }
  } catch (error) {
    if (error instanceof AlreadyProcessedError) {
      return { processed: false }
    }
    throw error
  }
}
