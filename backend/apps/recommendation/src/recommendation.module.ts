import { Module } from '@nestjs/common'
import { RecommendationController } from './recommendation.controller'
import { RecommendationService } from './recommendation.service'
import { Neo4jModule } from '@app/neo4j'
import { ConfigModule } from '@nestjs/config/dist/config.module'
import { PrismaService } from '../prisma/prisma.service'
import { PrismaModule } from '../prisma/prisma.module'
import { QdrantModule } from '@app/qdrant/qdrant.module'
import { UtilModule } from '@app/util'

@Module({
  imports: [
    PrismaModule,
    Neo4jModule,
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: process.cwd() + '/apps/recommendation/.env',
    }),
    QdrantModule,
    UtilModule,
  ],
  controllers: [RecommendationController],
  providers: [RecommendationService],
})
export class RecommendationModule {}
