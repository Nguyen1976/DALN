import { Test, TestingModule } from '@nestjs/testing';
import { RecommendationController } from './recommendation.controller';
import { RecommendationService } from './recommendation.service';

describe('RecommendationController', () => {
  let recommendationController: RecommendationController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [RecommendationController],
      providers: [RecommendationService],
    }).compile();

    recommendationController = app.get<RecommendationController>(RecommendationController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(recommendationController.getHello()).toBe('Hello World!');
    });
  });
});
