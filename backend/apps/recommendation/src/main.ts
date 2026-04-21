import { NestFactory } from '@nestjs/core';
import { RecommendationModule } from './recommendation.module';

async function bootstrap() {
  const app = await NestFactory.create(RecommendationModule);
  app.enableCors({
    origin: true,
    credentials: true,
  })
  await app.listen(process.env.port ?? 3005);
}
bootstrap();
