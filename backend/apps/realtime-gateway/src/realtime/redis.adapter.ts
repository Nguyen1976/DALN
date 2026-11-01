// redis.adapter.ts
import { IoAdapter } from '@nestjs/platform-socket.io'
import type { Server, ServerOptions } from 'socket.io'
import { createShardedAdapter } from '@socket.io/redis-adapter'
import { createClient } from 'redis'

export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor:
    | ReturnType<typeof createShardedAdapter>
    | undefined

  async connectToRedis(): Promise<void> {
    // Tạo 2 client kết nối đến Redis: 1 cái để hét (Pub), 1 cái để nghe (Sub)
    const redisUrl =
      process.env.REDIS_URL ||
      `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`
    const pubClient = createClient({ url: redisUrl })
    const subClient = pubClient.duplicate()

    await Promise.all([pubClient.connect(), subClient.connect()])

    // Sharded (Redis 7 SPUBLISH/SSUBSCRIBE), chế độ dynamic: mỗi room một kênh,
    // gateway chỉ subscribe kênh của room có socket của nó. Adapter thường phát
    // MỌI emit tới MỌI gateway — chạy N gateway là mỗi emit tốn N lần.
    this.adapterConstructor = createShardedAdapter(pubClient, subClient, {
      subscriptionMode: 'dynamic',
    })
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    if (!this.adapterConstructor) {
      throw new Error('RedisIoAdapter: connectToRedis() must run first')
    }
    const server = super.createIOServer(port, options) as Server
    // Yêu cầu Socket.IO sử dụng Redis Adapter này
    server.adapter(this.adapterConstructor)
    return server
  }
}
