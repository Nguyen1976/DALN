/**
 * Truy vấn `message` cần đi qua partial index, viết bằng lệnh `find` thô.
 *
 * Prisma trên MongoDB bọc mọi điều kiện `where` trong `$expr`. `$expr` dùng được
 * index thường nhưng KHÔNG dùng được partial index: đo trên 3,3 triệu tin, tra
 * tin trùng qua Prisma quét cả collection (3,34 triệu document, 4,8 s), cùng truy
 * vấn viết thô kèm điều kiện lọc của index đọc đúng 1 document (0 ms). Planner
 * chỉ chọn partial index khi truy vấn nêu lại điều kiện lọc của nó, nên mỗi hàm
 * dưới đây lặp lại đúng điều kiện đó.
 */
type RawRunner = {
  $runCommandRaw(command: Record<string, unknown>): Promise<unknown>
}

type Oid = { $oid: string }
type EjsonDate = { $date: string }
type FindResult = { cursor: { firstBatch: Record<string, unknown>[] } }

export type StoredKey = {
  id: string
  senderId: string
  clientMessageId: string
  createdAt: Date
  updatedAt: Date
  seq: number | null
}

/** Phần của một tin đã lưu mà batch writer cần để trả về cho người gửi. */
export type StoredRow = {
  id: string
  seq: number | null
  createdAt: Date
  updatedAt: Date
}

const oid = (value: unknown) => (value as Oid).$oid
const date = (value: unknown) => new Date((value as EjsonDate).$date)

async function find(
  prisma: RawRunner,
  filter: Record<string, unknown>,
  projection: Record<string, unknown>,
  limit: number,
) {
  const result = (await prisma.$runCommandRaw({
    find: 'message',
    filter,
    projection,
    limit,
    singleBatch: true,
  })) as FindResult
  return result.cursor.firstBatch
}

/** Bản đã lưu của các tin theo (senderId, clientMessageId) — index message_sender_client_id. */
export async function findStoredBySenderClientIds(
  prisma: RawRunner,
  keys: { senderId: string; clientMessageId: string }[],
): Promise<StoredKey[]> {
  if (!keys.length) return []
  const rows = await find(
    prisma,
    {
      $or: keys.map((key) => ({
        senderId: { $oid: key.senderId },
        clientMessageId: key.clientMessageId,
      })),
      clientMessageId: { $type: 'string' },
    },
    { senderId: 1, clientMessageId: 1, createdAt: 1, updatedAt: 1, seq: 1 },
    keys.length,
  )
  return rows.map((row) => ({
    id: oid(row._id),
    senderId: oid(row.senderId),
    clientMessageId: row.clientMessageId as string,
    createdAt: date(row.createdAt),
    updatedAt: date(row.updatedAt),
    seq: typeof row.seq === 'number' ? row.seq : null,
  }))
}

/** Các tin đã lưu theo `_id` (index _id). */
export async function findStoredByIds(
  prisma: RawRunner,
  ids: string[],
): Promise<StoredRow[]> {
  if (!ids.length) return []
  const rows = await find(
    prisma,
    { _id: { $in: ids.map((id) => ({ $oid: id })) } },
    { seq: 1, createdAt: 1, updatedAt: 1 },
    ids.length,
  )
  return rows.map((row) => ({
    id: oid(row._id),
    seq: typeof row.seq === 'number' ? row.seq : null,
    createdAt: date(row.createdAt),
    updatedAt: date(row.updatedAt),
  }))
}

/** Id của tin mang poll — index message_poll_id (partial: chỉ tin có pollId). */
export async function findIdByPollId(
  prisma: RawRunner,
  pollId: string,
): Promise<string | null> {
  const [row] = await find(prisma, { pollId: { $oid: pollId } }, { _id: 1 }, 1)
  return row ? oid(row._id) : null
}
