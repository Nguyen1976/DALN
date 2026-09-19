import { NestFactory } from '@nestjs/core'
import { ChatModule } from './chat.module'
import { ValidationPipe } from '@nestjs/common'
import { AppHttpExceptionFilter, validationExceptionFactory } from '@app/common'
import cookieParser from 'cookie-parser'
async function bootstrap() {
  const app = await NestFactory.create(ChatModule)
  // Deploy gửi SIGTERM: chạy onModuleDestroy (MessageBatchWriter ghi nốt lô tin nhắn
  // đang đệm, OutboxRelay dừng, Prisma ngắt kết nối) rồi mới thoát.
  app.enableShutdownHooks()

  app.use(cookieParser())
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      exceptionFactory: validationExceptionFactory,
    }),
  )
  app.useGlobalFilters(new AppHttpExceptionFilter())
  app.enableCors({
    origin: true,
    credentials: true,
  })

  await app.listen(process.env.PORT ?? 3003)
}
bootstrap()
