import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { INTEREST_TAGS } from '../data/interest-tags.data'

@Injectable()
export class InterestTagSeedService implements OnModuleInit {
  private readonly logger = new Logger(InterestTagSeedService.name)

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.seedInterestTags()
  }

  async seedInterestTags() {
    this.logger.log('Seeding interest tags (idempotent)...')

    for (const tag of INTEREST_TAGS) {
      await this.prisma.interestTag.upsert({
        where: { slug: tag.slug },
        update: {
          label: tag.label,
          emoji: tag.emoji,
          category: tag.category,
          order: tag.order,
        },
        create: {
          slug: tag.slug,
          label: tag.label,
          emoji: tag.emoji,
          category: tag.category,
          order: tag.order,
          isActive: true,
        },
      })
    }

    this.logger.log(`Interest tags ready (${INTEREST_TAGS.length} tags)`)
  }
}
