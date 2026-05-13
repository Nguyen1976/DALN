import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { RecommendationService } from '../../recommendation.service'

@Injectable()
export class RecommendationCron {
  private readonly logger = new Logger(RecommendationCron.name)

  constructor(private readonly recommendationService: RecommendationService) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleCron() {
    this.logger.log('Start daily recommendation refresh')
    await this.recommendationService.recommendation()
    this.logger.log('Finished daily recommendation refresh')
  }
}
