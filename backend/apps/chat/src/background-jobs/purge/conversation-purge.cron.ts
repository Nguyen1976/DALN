import { Inject, Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { RedisService } from '@app/redis'
import { PrismaService } from 'apps/chat/prisma/prisma.service'
import { oid, type RawRunner } from '../../repositories/raw-ejson'

/** Số tin xoá mỗi lô: một `$in` nhỏ, mỗi lệnh chỉ chạm một phần index. */
export const PURGE_BATCH = 1000
const LOCK_KEY = 'lock:conversation-purge'
const LOCK_TTL_SECONDS = 60

/**
 * Dọn tin của các hội thoại đã xoá (`deletedAt`), theo lô, không transaction.
 *
 * Xoá hội thoại chỉ ẩn nó ngay (ConversationRepository.deleteConversationById).
 * Cron này xoá dần: mỗi lô 1.000 tin cùng media, đánh dấu xoá-phía-mình, poll
 * và phiếu bầu của chúng. Hết tin thì xoá document hội thoại, quét lại một
 * lượt (tin đã giữ chỗ seq ngay trước lúc ẩn có thể ghi xong sau lô cuối), rồi
 * mới xoá thành viên. Mọi bước chạy lại được: chết giữa chừng thì lượt sau làm
 * tiếp từ chỗ còn lại.
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
    if (!(await this.redisService.claimOnce(LOCK_KEY, LOCK_TTL_SECONDS))) return
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
      await this.redisService.del(LOCK_KEY)
    }
  }

  private async purgeConversation(conversationId: string): Promise<number> {
    let removed = await this.purgeMessages(conversationId)
    await remove(this.prisma, 'conversation', { _id: oid(conversationId) })
    removed += await this.purgeMessages(conversationId)
    await remove(this.prisma, 'conversationMember', {
      conversationId: oid(conversationId),
    })
    return removed
  }

  private async purgeMessages(conversationId: string): Promise<number> {
    let removed = 0
    for (;;) {
      const batch = await this.prisma.message.findMany({
        where: { conversationId },
        select: { id: true, pollId: true },
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
