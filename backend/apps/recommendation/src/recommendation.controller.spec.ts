import { Test, TestingModule } from '@nestjs/testing'
import { RecommendationController } from './recommendation.controller'
import { RecommendationService } from './recommendation.service'
import { InterestTagService } from './services/interest-tag.service'
import { EmbeddingService } from './services/embedding.service'
import { ModelTrainingService } from './services/model-training.service'

describe('RecommendationController', () => {
  let recommendationController: RecommendationController

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [RecommendationController],
      providers: [
        {
          provide: RecommendationService,
          useValue: { getRecommendationForUser: jest.fn() },
        },
        {
          provide: InterestTagService,
          useValue: { listActive: jest.fn().mockReturnValue([]) },
        },
        {
          provide: EmbeddingService,
          useValue: { embedAndSave: jest.fn() },
        },
        {
          provide: ModelTrainingService,
          useValue: { train: jest.fn(), evaluate: jest.fn() },
        },
      ],
    }).compile()

    recommendationController = app.get<RecommendationController>(
      RecommendationController,
    )
  })

  it('should be defined', () => {
    expect(recommendationController).toBeDefined()
  })
})
