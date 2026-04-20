import { Injectable } from '@nestjs/common';

@Injectable()
export class RecommendationService {
  getHello(): string {
    return 'Hello World!';
  }
}
