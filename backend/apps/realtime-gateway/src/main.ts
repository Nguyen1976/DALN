import { NestFactory } from '@nestjs/core'
import { RealtimeGatewayModule } from './realtime-gateway.module'
import { RedisIoAdapter } from './realtime/redis.adapter'
async function bootstrap() {
  const app = await NestFactory.create(RealtimeGatewayModule)
  const redisIoAdapter = new RedisIoAdapter(app)
  await redisIoAdapter.connectToRedis()

  // Yêu cầu NestJS dùng Adapter này cho toàn bộ Websocket
  app.useWebSocketAdapter(redisIoAdapter)
  await app.listen(process.env.port ?? 3001)
}
bootstrap()
