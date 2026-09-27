import { NestFactory } from '@nestjs/core'
import { raw } from 'express'
import { corsOptions, securityHeaders } from '@app/common'
import { RealtimeGatewayModule } from './realtime-gateway.module'
import { RedisIoAdapter } from './realtime/redis.adapter'
async function bootstrap() {
  const app = await NestFactory.create(RealtimeGatewayModule)
  // Deploy gửi SIGTERM: đóng kết nối gọn rồi thoát, thay vì chờ Docker SIGKILL.
  app.enableShutdownHooks()

  // Webhook RealtimeKit cần body THÔ để xác thực chữ ký RSA trên đúng byte gốc.
  // Chỉ gắn raw parser cho đúng path này; `limit` chặn request khổng lồ.
  app.use('/realtime/rtk-webhook', raw({ type: () => true, limit: '256kb' }))
  app.use(securityHeaders())
  app.enableCors(corsOptions())
  const redisIoAdapter = new RedisIoAdapter(app)
  await redisIoAdapter.connectToRedis()

  // Yêu cầu NestJS dùng Adapter này cho toàn bộ Websocket
  app.useWebSocketAdapter(redisIoAdapter)
  await app.listen(process.env.port ?? 3001)
}
void bootstrap()
