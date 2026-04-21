import { Body, Controller, Get } from '@nestjs/common';
import { RecommendationService } from './recommendation.service';

@Controller()
export class RecommendationController {
  constructor(private readonly recommendationService: RecommendationService) {}

  @Get()
  getHello(@Body() { userId }: { userId: string }) {
    return this.recommendationService.getHello(userId);
  }


}
