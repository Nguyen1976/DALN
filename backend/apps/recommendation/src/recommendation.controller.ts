import { Controller, Get } from '@nestjs/common'
import { RequireLogin, UserInfo } from '@app/common/common.decorator'
import { RecommendationService } from './recommendation.service'

@Controller('recommendation')
export class RecommendationController {
  constructor(private readonly recommendationService: RecommendationService) {}

  @Get()
  @RequireLogin()
  async getMyRecommendations(@UserInfo() user: any) {
    return this.recommendationService.getRecommendationForUser(user.userId)
  }
}
