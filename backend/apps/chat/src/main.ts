import { NestFactory } from '@nestjs/core'
import { ChatModule } from './chat.module'
import { MicroserviceOptions, Transport } from '@nestjs/microservices'
import { CHAT_PACKAGE_NAME } from 'interfaces/chat.grpc'
import { PORT_GRPC } from 'libs/constant/grpc/port-grpc.constant'
import cookieParser from 'cookie-parser'
import { ValidationPipe } from '@nestjs/common'
import { GrpcToHttpExceptionFilter, ResponseInterceptor } from '@app/common'

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

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.GRPC,
    options: {
      package: CHAT_PACKAGE_NAME,
      protoPath: './proto/chat.grpc.proto',
      url: `localhost:${PORT_GRPC.CHAT_GRPC_PORT}`,
    },
  })

  await app.startAllMicroservices()
  await app.listen(process.env.PORT ?? 3003)
}
bootstrap()
