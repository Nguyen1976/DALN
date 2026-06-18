import * as dotenv from 'dotenv'
import * as path from 'path'
import { PrismaClient } from '../src/generated'
import { INTEREST_TAGS } from '../src/data/interest-tags.data'

dotenv.config({ path: path.join(__dirname, '..', '.env') })

const prisma = new PrismaClient()

async function main() {
  console.log('Starting seed...')

  for (const tag of INTEREST_TAGS) {
    await prisma.interestTag.upsert({
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

    console.log(`Seeded: ${tag.slug} (${tag.label})`)
  }

  console.log('Seed completed!')
}

main()
  .catch((e) => {
    console.error('Seed failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
