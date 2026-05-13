import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'

@Injectable()
export class InterestTagService {
  constructor(private readonly prisma: PrismaService) {}

  listActive() {
    return this.prisma.interestTag.findMany({
      where: { isActive: true },
      orderBy: [{ category: 'asc' }, { order: 'asc' }],
      select: {
        id: true,
        slug: true,
        label: true,
        emoji: true,
        category: true,
        order: true,
      },
    })
  }
}
