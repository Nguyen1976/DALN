import { Body, Controller, Get } from '@nestjs/common'
import { RecommendationService } from './recommendation.service'

@Controller()
export class RecommendationController {
  constructor(private readonly recommendationService: RecommendationService) {}

  @Get()
  recommendation() {
    try {
      return this.recommendationService.recommendation()
    } catch (error) {
      console.error('Error in recommendation controller:', error)
    }
  }
}
