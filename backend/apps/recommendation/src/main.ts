import { ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { AppHttpExceptionFilter } from '@app/common'
import cookieParser from 'cookie-parser'
import { RecommendationModule } from './recommendation.module'

async function bootstrap() {
  const app = await NestFactory.create(RecommendationModule)
  // Deploy gửi SIGTERM: đóng kết nối gọn rồi thoát, thay vì chờ Docker SIGKILL.
  app.enableShutdownHooks()

  app.use(cookieParser())
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  )
  app.useGlobalFilters(new AppHttpExceptionFilter())
  app.enableCors({
    origin: true,
    credentials: true,
  })

  const port = Number(process.env.PORT ?? process.env.port ?? 3005)
  await app.listen(port, '0.0.0.0')
}
void bootstrap()
