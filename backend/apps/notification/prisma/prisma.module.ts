import { Module, Global } from '@nestjs/common'
import { PrismaService } from './prisma.service'

@Global() // optional nếu muốn dùng toàn service mà không import lại
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
