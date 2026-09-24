import { NestFactory } from '@nestjs/core'
import { UserModule } from './user.module'
import { ValidationPipe } from '@nestjs/common'
import {
  AppHttpExceptionFilter,
  validationExceptionFactory,
  corsOptions,
  securityHeaders,
} from '@app/common'
import { NestExpressApplication } from '@nestjs/platform-express'
import cookieParser from 'cookie-parser'

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(UserModule)
  // Deploy gửi SIGTERM: đóng kết nối gọn rồi thoát, thay vì chờ Docker SIGKILL.
  app.enableShutdownHooks()

  // Chuỗi proxy thật: client → nginx (thêm IP client vào X-Forwarded-For) →
  // Kong (thêm IP nginx) → service. Không bật thì req.ip là IP container của
  // Kong cho MỌI request, và hạn mức theo IP sẽ khoá toàn bộ người dùng chung
  // một xô. Chạy trực tiếp lúc dev không có X-Forwarded-For nên vẫn đúng.
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

  await app.listen(process.env.PORT ?? 3002)
}
void bootstrap()
