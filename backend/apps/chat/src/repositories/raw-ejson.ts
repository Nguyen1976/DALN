/**
 * Lệnh thô qua `$runCommandRaw` không đi qua lớp map kiểu của Prisma: id và
 * ngày phải viết theo Extended JSON, nếu không Mongo so một chuỗi với một
 * ObjectId và lệnh lặng lẽ không khớp dòng nào. Mọi lệnh thô của chat dùng
 * chung các helper này.
 *
 * Vì sao có lệnh thô: trên MongoDB, Prisma chạy `updateMany` bằng một
 * transaction (đọc id rồi mới ghi), còn `where` thì bọc trong `$expr` — không
 * dùng được partial index. Đường nóng (gửi tin, đọc tin, cron) đi thẳng.
 */
export type RawRunner = {
  $runCommandRaw(command: Record<string, unknown>): Promise<unknown>
}

export const oid = (hex: string) => ({ $oid: hex })
export const date = (value: Date) => ({ $date: value.toISOString() })

export type RawUpdate = {
  q: Record<string, unknown>
  u: Record<string, unknown> | Record<string, unknown>[]
  multi?: boolean
}

type UpdateResult = { n?: number; nModified?: number }

/** Một lệnh `update` (một hoặc nhiều câu); trả về số dòng thật sự đổi. */
export async function rawUpdate(
  prisma: RawRunner,
  collection: string,
  updates: RawUpdate[],
): Promise<number> {
  if (!updates.length) return 0
  const result = (await prisma.$runCommandRaw({
    update: collection,
    updates,
    ordered: false,
  })) as UpdateResult
  return Number(result?.nModified ?? 0)
}
