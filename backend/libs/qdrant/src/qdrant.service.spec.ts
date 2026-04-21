import { Test, TestingModule } from '@nestjs/testing';
import { QdrantService } from './qdrant.service';

describe('QdrantService', () => {
  let service: QdrantService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [QdrantService],
    }).compile();

    service = module.get<QdrantService>(QdrantService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
