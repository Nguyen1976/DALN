import { Body, Controller, Get, Post } from '@nestjs/common'
import {
  InternalOnly,
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

  // Ba endpoint dưới đây không thuộc về người dùng cuối: chúng được service
  // khác gọi liên dịch vụ (embed-and-save) hoặc do vận hành kích hoạt
  // (train/evaluate). Trước đây để @WithoutLogin() nên mở thẳng ra internet
  // qua Kong — vừa là lỗ hổng, vừa cho phép bất kỳ ai ghim CPU service này.
  @Post('embed-and-save')
  @InternalOnly()
  embedAndSave(@Body() body: EmbedAndSaveDto) {
    return this.embeddingService.embedAndSave(body.users)
  }

  @Post('model/train')
  @InternalOnly()
  async trainModel() {
    const job = await this.modelTrainingService.enqueueTraining('train')
    return { jobId: job.id, status: 'queued' }
  }

  @Post('model/evaluate')
  @InternalOnly()
  async evaluateModel() {
    const job = await this.modelTrainingService.enqueueTraining('evaluate')
    return { jobId: job.id, status: 'queued' }
  }
}
