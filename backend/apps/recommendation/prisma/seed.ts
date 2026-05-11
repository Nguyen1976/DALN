import * as dotenv from 'dotenv'
import * as path from 'path'
import { PrismaClient } from '../src/generated'

// Load environment variables from .env file
dotenv.config({ path: path.join(__dirname, '..', '.env') })

const prisma = new PrismaClient()

const interestTags = [
  // Entertainment (7 tags)
  { slug: 'gaming', label: 'Gaming', emoji: '🎮', category: 'entertainment', order: 1 },
  { slug: 'movies', label: 'Phim ảnh', emoji: '🎬', category: 'entertainment', order: 2 },
  { slug: 'music', label: 'Âm nhạc', emoji: '🎵', category: 'entertainment', order: 3 },
  { slug: 'tv-shows', label: 'Phim truyền hình', emoji: '📺', category: 'entertainment', order: 4 },
  { slug: 'anime', label: 'Anime', emoji: '🎨', category: 'entertainment', order: 5 },
  { slug: 'podcasts', label: 'Podcast', emoji: '🎙️', category: 'entertainment', order: 6 },
  { slug: 'comics', label: 'Truyện tranh', emoji: '💭', category: 'entertainment', order: 7 },

  // Lifestyle (9 tags)
  { slug: 'travel', label: 'Du lịch', emoji: '✈️', category: 'lifestyle', order: 1 },
  { slug: 'cooking', label: 'Nấu ăn', emoji: '🍳', category: 'lifestyle', order: 2 },
  { slug: 'fitness', label: 'Thể dục', emoji: '💪', category: 'lifestyle', order: 3 },
  { slug: 'fashion', label: 'Thời trang', emoji: '👗', category: 'lifestyle', order: 4 },
  { slug: 'sports', label: 'Thể thao', emoji: '⚽', category: 'lifestyle', order: 5 },
  { slug: 'beauty', label: 'Làm đẹp', emoji: '💄', category: 'lifestyle', order: 6 },
  { slug: 'shopping', label: 'Mua sắm', emoji: '🛍️', category: 'lifestyle', order: 7 },
  { slug: 'health', label: 'Sức khỏe', emoji: '🏥', category: 'lifestyle', order: 8 },
  { slug: 'pets', label: 'Thú cưng', emoji: '🐕', category: 'lifestyle', order: 9 },

  // Technology (8 tags)
  { slug: 'tech', label: 'Công nghệ', emoji: '💻', category: 'tech', order: 1 },
  { slug: 'ai', label: 'Trí tuệ nhân tạo', emoji: '🤖', category: 'tech', order: 2 },
  { slug: 'programming', label: 'Lập trình', emoji: '👨‍💻', category: 'tech', order: 3 },
  { slug: 'gadgets', label: 'Thiết bị điện tử', emoji: '📱', category: 'tech', order: 4 },
  { slug: 'cybersecurity', label: 'An ninh mạng', emoji: '🔒', category: 'tech', order: 5 },
  { slug: 'data-science', label: 'Khoa học dữ liệu', emoji: '📊', category: 'tech', order: 6 },
  { slug: 'web-development', label: 'Phát triển web', emoji: '🌐', category: 'tech', order: 7 },
  { slug: 'startups', label: 'Khởi nghiệp', emoji: '🚀', category: 'tech', order: 8 },

  // Creative (8 tags)
  { slug: 'art', label: 'Nghệ thuật', emoji: '🎨', category: 'creative', order: 1 },
  { slug: 'photography', label: 'Nhiếp ảnh', emoji: '📸', category: 'creative', order: 2 },
  { slug: 'design', label: 'Thiết kế', emoji: '🖌️', category: 'creative', order: 3 },
  { slug: 'music-production', label: 'Sản xuất âm nhạc', emoji: '🎧', category: 'creative', order: 4 },
  { slug: 'writing', label: 'Viết lách', emoji: '✍️', category: 'creative', order: 5 },
  { slug: 'video-making', label: 'Làm video', emoji: '🎬', category: 'creative', order: 6 },
  { slug: 'dance', label: 'Nhảy múa', emoji: '💃', category: 'creative', order: 7 },
  { slug: 'crafting', label: 'Thủ công', emoji: '🧶', category: 'creative', order: 8 },

  // Education (8 tags)
  { slug: 'books', label: 'Sách', emoji: '📚', category: 'education', order: 1 },
  { slug: 'learning', label: 'Học tập', emoji: '🎓', category: 'education', order: 2 },
  { slug: 'languages', label: 'Ngôn ngữ', emoji: '🗣️', category: 'education', order: 3 },
  { slug: 'history', label: 'Lịch sử', emoji: '📖', category: 'education', order: 4 },
  { slug: 'science', label: 'Khoa học', emoji: '🔬', category: 'education', order: 5 },
  { slug: 'philosophy', label: 'Triết học', emoji: '🧠', category: 'education', order: 6 },
  { slug: 'self-improvement', label: 'Tự hoàn thiện', emoji: '⬆️', category: 'education', order: 7 },
  { slug: 'psychology', label: 'Tâm lý học', emoji: '💭', category: 'education', order: 8 },
]

async function main() {
  console.log('Starting seed...')

  for (const tag of interestTags) {
    const result = await prisma.interestTag.upsert({
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
