import { NestFactory } from '@nestjs/core';
import { RecommendationModule } from './recommendation.module';

async function bootstrap() {
  const app = await NestFactory.create(RecommendationModule);
  await app.listen(process.env.port ?? 3000);
}
bootstrap();
