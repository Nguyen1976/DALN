import { NestFactory } from '@nestjs/core'
import { raw } from 'express'
import { RealtimeGatewayModule } from './realtime-gateway.module'
import { RedisIoAdapter } from './realtime/redis.adapter'
async function bootstrap() {
  const app = await NestFactory.create(RealtimeGatewayModule)
  // Deploy gửi SIGTERM: đóng kết nối gọn rồi thoát, thay vì chờ Docker SIGKILL.
  app.enableShutdownHooks()

  // Webhook LiveKit cần body THÔ để verify chữ ký (LiveKit gửi
  // `application/webhook+json`, mà JSON parser mặc định của Nest bỏ qua
  // content-type này). Gắn raw parser CHỈ cho đúng path webhook — mọi route
  // khác và socket.io (transport riêng, không qua body parser) không ảnh hưởng.
  app.use('/livekit/webhook', raw({ type: () => true }))
  const redisIoAdapter = new RedisIoAdapter(app)
  await redisIoAdapter.connectToRedis()

  // Yêu cầu NestJS dùng Adapter này cho toàn bộ Websocket
  app.useWebSocketAdapter(redisIoAdapter)
  await app.listen(process.env.port ?? 3001)
}
bootstrap()
