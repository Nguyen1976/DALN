import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { ChatModule } from './chat.module'
import { ValidationPipe } from '@nestjs/common'
import {
  AppHttpExceptionFilter,
  validationExceptionFactory,
  corsOptions,
  securityHeaders,
} from '@app/common'
import cookieParser from 'cookie-parser'
async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(ChatModule)
  // Deploy gửi SIGTERM: chạy onModuleDestroy (MessageBatchWriter ghi nốt lô tin nhắn
  // đang đệm, OutboxRelay dừng, Prisma ngắt kết nối) rồi mới thoát.
  app.enableShutdownHooks()

  // Chuỗi proxy thật: client → nginx → Kong → service. Không bật thì req.ip là
  // IP container của Kong cho MỌI request, và mọi hạn mức theo IP sẽ khoá toàn
  // bộ người dùng chung một xô.
  app.set('trust proxy', 2)

  app.use(securityHeaders())
  app.use(cookieParser())
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      exceptionFactory: validationExceptionFactory,
    }),
  )
  app.useGlobalFilters(new AppHttpExceptionFilter())
  app.enableCors(corsOptions())

  await app.listen(process.env.PORT ?? 3003)
}
void bootstrap()
