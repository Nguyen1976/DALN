import { NestFactory } from '@nestjs/core'
import { NotificationModule } from './notification.module'
import { ValidationPipe } from '@nestjs/common'
import { AppHttpExceptionFilter } from '@app/common'
import cookieParser from 'cookie-parser'

async function bootstrap() {
  const app = await NestFactory.create(NotificationModule)
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

  await app.listen(process.env.PORT ?? 3004)
}

bootstrap()
