import { NestFactory } from '@nestjs/core'
import { NotificationModule } from './notification.module'
import { MicroserviceOptions, Transport } from '@nestjs/microservices'
import { NOTIFICATION_PACKAGE_NAME } from 'interfaces/notification.grpc'
import { PORT_GRPC } from 'libs/constant/grpc/port-grpc.constant'
import cookieParser from 'cookie-parser'
import { ValidationPipe } from '@nestjs/common'
import { GrpcToHttpExceptionFilter, ResponseInterceptor } from '@app/common'

async function bootstrap() {
  const app = await NestFactory.create(NotificationModule)

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

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.GRPC,
    options: {
      package: NOTIFICATION_PACKAGE_NAME,
      protoPath: './proto/notification.grpc.proto',
      url: `localhost:${PORT_GRPC.NOTIFICATION_GRPC_PORT}`,
    },
  })

  await app.startAllMicroservices()
  await app.listen(process.env.PORT ?? 3004)
}
bootstrap()
