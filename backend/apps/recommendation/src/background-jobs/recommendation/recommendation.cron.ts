import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { RecommendationService } from '../../recommendation.service'

@Injectable()
export class RecommendationCron {
  private readonly logger = new Logger(RecommendationCron.name)

  constructor(private readonly recommendationService: RecommendationService) {}

  /**
   * Chỉ tính lại cho những user có thay đổi (hàng đợi `rcm:dirty:users`),
   * thay vì quét toàn bộ userSnapshot như trước.
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleCron() {
    this.logger.log('Start daily recommendation refresh (incremental)')
    await this.recommendationService.recommendation()
    this.logger.log('Finished daily recommendation refresh')
  }

  /**
   * Lưới an toàn hằng tuần: đẩy toàn bộ user vào hàng đợi để đối soát, phòng
   * trường hợp đánh dấu theo sự kiện bị sót (mất message, service ngừng đúng
   * lúc). Chạy 2h sáng Chủ nhật, sau lượt cron hằng ngày.
   */
  @Cron('0 2 * * 0')
  async handleWeeklyFullRefresh() {
    this.logger.log('Start weekly full refresh enqueue')
    const total = await this.recommendationService.enqueueFullRefresh()
    this.logger.log(`Weekly full refresh: ${total} user đã vào hàng đợi`)
  }
}
