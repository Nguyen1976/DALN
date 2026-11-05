import { randomUUID } from 'node:crypto'
import { Inject, Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { RedisService } from '@app/redis'
import { PrismaService } from 'apps/chat/prisma/prisma.service'
import { oid, type RawRunner } from '../../repositories/raw-ejson'

/** Số tin xoá mỗi lô: một `$in` nhỏ, mỗi lệnh chỉ chạm một phần index. */
export const PURGE_BATCH = 1000
const LOCK_KEY = 'lock:conversation-purge'
const LOCK_TTL_SECONDS = 60
/** Giữ khoá bằng token riêng của lượt này. */
const ACQUIRE_SCRIPT = `return redis.call('SET', KEYS[1], ARGV[1], 'NX', 'EX', ARGV[2])`
/** Chỉ nhả khoá còn đúng là của mình: lượt dọn dài quá TTL không được xoá khoá của instance khác. */
const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`

/**
 * Dọn tin của các hội thoại đã xoá (`deletedAt`), theo lô, không transaction.
 *
 * Xoá hội thoại chỉ ẩn nó ngay (ConversationRepository.deleteConversationById).
 * Cron này xoá dần: mỗi lô 1.000 tin cùng media, đánh dấu xoá-phía-mình, poll
 * và phiếu bầu của chúng. Hết tin thì xoá thành viên, quét lại một lượt (tin đã
 * giữ chỗ seq ngay trước lúc ẩn có thể ghi xong sau lô cuối), rồi mới xoá
 * document hội thoại — SAU CÙNG, vì chính `deletedAt` của nó là thứ đưa hội
 * thoại vào danh sách cần dọn: chết ở bất cứ bước nào, lượt sau vẫn thấy và làm
 * tiếp. Mọi bước chạy lại được.
 */
@Injectable()
export class ConversationPurgeCron {
  private readonly logger = new Logger(ConversationPurgeCron.name)

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  @Cron(CronExpression.EVERY_10_SECONDS)
  async handleCron() {
    await this.purge()
  }

  async purge(): Promise<void> {
    // Một instance mỗi lượt: hai instance cùng xoá một lô thì vô hại nhưng phí.
    const token = randomUUID()
    const acquired = await this.redisService.eval(
      ACQUIRE_SCRIPT,
      [LOCK_KEY],
      [token, LOCK_TTL_SECONDS],
    )
    if (!acquired) return
    try {
      const deleted = await this.prisma.conversation.findMany({
        where: { deletedAt: { isSet: true } },
        select: { id: true },
      })
      for (const { id } of deleted) {
        try {
          const removed = await this.purgeConversation(id)
          this.logger.log(`đã dọn hội thoại ${id}: ${removed} tin`)
        } catch (error) {
          this.logger.error(
            `dọn hội thoại ${id} dở dang, lượt sau làm tiếp: ${
              error instanceof Error ? error.message : String(error)
            }`,
          )
        }
      }
    } finally {
      await this.redisService.eval(RELEASE_SCRIPT, [LOCK_KEY], [token])
    }
  }

  private async purgeConversation(conversationId: string): Promise<number> {
    let removed = await this.purgeMessages(conversationId)
    await remove(this.prisma, 'conversationMember', {
      conversationId: oid(conversationId),
    })
    removed += await this.purgeMessages(conversationId)
    await remove(this.prisma, 'conversation', { _id: oid(conversationId) })
    return removed
  }

  private async purgeMessages(conversationId: string): Promise<number> {
    let removed = 0
    for (;;) {
      const batch = await this.prisma.message.findMany({
        where: { conversationId },
        select: { id: true, pollId: true },
        // Có orderBy theo index (conversationId, seq). Không có, Prisma tự
        // thêm `$sort: {_id: 1}` và Mongo đi index _id của CẢ collection: đo
        // được 5,15 triệu document đọc để xoá 100.000 tin.
        orderBy: { seq: 'asc' },
        take: PURGE_BATCH,
      })
      if (!batch.length) return removed
      const ids = batch.map((m) => oid(m.id))
      const pollIds = batch.flatMap((m) => (m.pollId ? [oid(m.pollId)] : []))
      await remove(this.prisma, 'messageMedia', { messageId: { $in: ids } })
      await remove(this.prisma, 'DeleteMessage', { messageId: { $in: ids } })
      if (pollIds.length) {
        await remove(this.prisma, 'pollVote', { pollId: { $in: pollIds } })
        await remove(this.prisma, 'poll', { _id: { $in: pollIds } })
      }
      // Tin xoá SAU các dòng con: chết ở giữa thì lô sau vẫn tìm lại được.
      await remove(this.prisma, 'message', { _id: { $in: ids } })
      removed += batch.length
    }
  }
}

async function remove(
  prisma: RawRunner,
  collection: string,
  q: Record<string, unknown>,
) {
  await prisma.$runCommandRaw({
    delete: collection,
    deletes: [{ q, limit: 0 }],
  })
}
