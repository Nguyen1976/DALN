import { NestFactory } from '@nestjs/core'
import { UserModule } from './user.module'
import { ValidationPipe } from '@nestjs/common'
import { AppHttpExceptionFilter, ResponseInterceptor, validationExceptionFactory } from '@app/common'
import cookieParser from 'cookie-parser'

async function bootstrap() {
  const app = await NestFactory.create(UserModule)

  app.use(cookieParser())
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      exceptionFactory: validationExceptionFactory,
    }),
  )
  app.useGlobalFilters(new AppHttpExceptionFilter())
  app.useGlobalInterceptors(new ResponseInterceptor())
  app.enableCors({
    origin: true,
    credentials: true,
  })

  await app.listen(process.env.PORT ?? 3002)
}
bootstrap()
