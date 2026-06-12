import { Body, Controller, Get, Post } from '@nestjs/common'
import {
  RequireLogin,
  UserInfo,
  WithoutLogin,
} from '@app/common/common.decorator'
import { RecommendationService } from './recommendation.service'
import { InterestTagService } from './services/interest-tag.service'
import { EmbeddingService } from './services/embedding.service'
import { ModelTrainingService } from './services/model-training.service'
import { EmbedAndSaveDto } from './dto/embed-and-save.dto'

@Controller('recommendation')
export class RecommendationController {
  constructor(
    private readonly recommendationService: RecommendationService,
    private readonly interestTagService: InterestTagService,
    private readonly embeddingService: EmbeddingService,
    private readonly modelTrainingService: ModelTrainingService,
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

  @Post('embed-and-save')
  @WithoutLogin()
  embedAndSave(@Body() body: EmbedAndSaveDto) {
    return this.embeddingService.embedAndSave(body.users)
  }

  @Post('model/train')
  @WithoutLogin()
  trainModel() {
    return this.modelTrainingService.train()
  }

  @Post('model/evaluate')
  @WithoutLogin()
  evaluateModel() {
    return this.modelTrainingService.evaluate()
  }
}
