import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common'
import { PrismaClient } from '../src/generated/client'

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnApplicationShutdown
{
  async onModuleInit() {
    await this.$connect()
  }

  // Phase cuối khi tắt máy: drain partition (onModuleDestroy) và lần flush
  // cuối của BatchWriter (beforeApplicationShutdown) còn cần DB.
  async onApplicationShutdown() {
    await this.$disconnect()
  }
}
