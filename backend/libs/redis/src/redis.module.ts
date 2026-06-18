// libs/redis/redis.module.ts
import { DynamicModule, Module, Global } from '@nestjs/common'
import { createRedisClient, type RedisConnectionOptions } from './redis.config'
import { RedisService } from './redis.service'

type RedisModuleOptions = RedisConnectionOptions

@Global()
@Module({})
export class RedisModule {
  static forRoot(
    optionsFactory: () => RedisModuleOptions,
    token: string = 'REDIS_CLIENT',
  ): DynamicModule {
    return {
      module: RedisModule,
      providers: [
        {
          provide: token,
          useFactory: () => createRedisClient(optionsFactory()),
        },
        RedisService,
      ],
      exports: [token, RedisService],
    }
  }
}
