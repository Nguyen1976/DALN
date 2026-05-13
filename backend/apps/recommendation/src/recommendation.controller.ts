import { Controller, Get } from '@nestjs/common'
import {
  RequireLogin,
  UserInfo,
  WithoutLogin,
} from '@app/common/common.decorator'
import { RecommendationService } from './recommendation.service'
import { InterestTagService } from './services/interest-tag.service'

@Controller('recommendation')
export class RecommendationController {
  constructor(
    private readonly recommendationService: RecommendationService,
    private readonly interestTagService: InterestTagService,
  ) {}

  @Get('interest-tags')
  @WithoutLogin()
  listInterestTags() {
    return this.interestTagService.listActive()
  }

  @Get('me')
  @RequireLogin()
  async getMyRecommendationsMe(@UserInfo() user: any) {
    return this.recommendationService.getRecommendationForUser(user.userId)
  }

  @Get()
  @RequireLogin()
  async getMyRecommendationsRoot(@UserInfo() user: any) {
    return this.recommendationService.getRecommendationForUser(user.userId)
  }
}
