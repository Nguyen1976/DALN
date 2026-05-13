import { ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { GrpcToHttpExceptionFilter, ResponseInterceptor } from '@app/common'
import cookieParser from 'cookie-parser'
import { RecommendationModule } from './recommendation.module'

async function bootstrap() {
  const app = await NestFactory.create(RecommendationModule)

  app.use(cookieParser())
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  )
  app.useGlobalFilters(new GrpcToHttpExceptionFilter())
  app.useGlobalInterceptors(new ResponseInterceptor())
  app.enableCors({
    origin: true,
    credentials: true,
  })

  const port = Number(process.env.PORT ?? process.env.port ?? 3005)
  await app.listen(port, '0.0.0.0')
}
bootstrap()
