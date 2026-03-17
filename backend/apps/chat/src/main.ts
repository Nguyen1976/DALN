import { NestFactory } from '@nestjs/core'
import { ChatModule } from './chat.module'
import { ValidationPipe } from '@nestjs/common'
import { GrpcToHttpExceptionFilter, ResponseInterceptor } from '@app/common'
import cookieParser from 'cookie-parser'

async function bootstrap() {
  const app = await NestFactory.create(ChatModule)

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

  await app.listen(process.env.PORT ?? 3003)
}
bootstrap()
