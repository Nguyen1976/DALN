import { Module } from '@nestjs/common';
import { RecommendationController } from './recommendation.controller';
import { RecommendationService } from './recommendation.service';

@Module({
  imports: [],
  controllers: [RecommendationController],
  providers: [RecommendationService],
})
export class RecommendationModule {}
