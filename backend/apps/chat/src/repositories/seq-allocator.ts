/**
 * Cấp số thứ tự `seq` cho tin trong một hội thoại.
 *
 * Bộ đếm nằm trên chính document `conversation` (`lastSeq`) và được giữ chỗ
 * bằng MỘT lệnh `findAndModify $inc` nguyên tử: đúng từ mọi instance chat và mọi
 * đường ghi (tin văn bản qua batch writer, media, poll, tin hệ thống, log cuộc
 * gọi), bền như chính DB. Batch writer giữ chỗ cả khoảng cho mọi tin của một hội
 * thoại trong lô, nên mỗi lô chỉ tốn một lệnh cho mỗi hội thoại.
 *
 * Được phép có lỗ: số đã giữ mà tin không được ghi (tin trùng, lỗi hẳn) thì bỏ.
 * Không cần transaction — unique index (conversationId, seq) chặn trùng.
 */
type RawRunner = {
  $runCommandRaw(command: Record<string, unknown>): Promise<unknown>
}

/**
 * Hội thoại không nhận tin: đã xoá (đang chờ dọn), không tồn tại, hoặc chưa
 * được migration 0008 đánh số. Ném lỗi thay vì cấp số từ 0 — một số sai đụng
 * unique index hoặc chen giữa các tin cũ, còn lỗi thì tin được trả về cho
 * client và không bao giờ nằm sai chỗ.
 */
export class ConversationNotReadyError extends Error {
  constructor(readonly conversationId: string) {
    super(
      `hội thoại ${conversationId} không nhận tin (đã xoá hoặc chưa đánh số)`,
    )
    this.name = 'ConversationNotReadyError'
  }
}

type FindAndModifyResult = { value: { lastSeq: number } | null }

/** Giữ chỗ `n` số liên tiếp; trả về số đầu tiên của khoảng. */
export async function reserveSeq(
  prisma: RawRunner,
  conversationId: string,
  n: number,
): Promise<number> {
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`reserveSeq: n phải là số nguyên dương, nhận ${n}`)
  }
  const result = (await prisma.$runCommandRaw({
    findAndModify: 'conversation',
    query: {
      _id: { $oid: conversationId },
      lastSeq: { $type: 'number' },
      deletedAt: null,
    },
    update: { $inc: { lastSeq: n } },
    new: true,
    fields: { lastSeq: 1 },
  })) as FindAndModifyResult
  if (!result?.value) throw new ConversationNotReadyError(conversationId)
  return result.value.lastSeq - n + 1
}
