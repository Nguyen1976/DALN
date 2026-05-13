import { Injectable, OnModuleInit } from '@nestjs/common'
import { QdrantClient } from '@qdrant/js-client-rest'

@Injectable()
export class QdrantService implements OnModuleInit {
  private client!: QdrantClient
  private readonly COLLECTION_NAME = 'user_bios'

  async onModuleInit() {
    this.client = new QdrantClient({ host: 'localhost', port: 6333 })
    try {
      await this.createCollection()
    } catch (error) {
      console.error(
        '[QdrantService] Skipping collection init (Qdrant unreachable). Recommendation will start in degraded mode.',
        error,
      )
    }
  }

  // Tạo "Bảng" (Collection) để chứa Vector
  async createCollection() {
    const collections = await this.client.getCollections()
    const exists = collections.collections.some(
      (c) => c.name === this.COLLECTION_NAME,
    )

    if (!exists) {
      await this.client.createCollection(this.COLLECTION_NAME, {
        vectors: {
          size: 384, // Khớp với model paraphrase-multilingual...
          distance: 'Cosine', // Thuật toán so sánh
        },
      })
    }
  }

  // Đẩy dữ liệu vào (Thực hiện khi User cập nhật Bio)
  async upsertVector(userId: string, vector: number[], payload: any) {
    return this.client.upsert(this.COLLECTION_NAME, {
      wait: true,
      points: [
        {
          id: userId, // Dùng ID của Mongo/Prisma
          vector: vector,
          payload: payload, // Lưu thêm thông tin tĩnh như username, age...
        },
      ],
    })
  }

  async recommendSimilar(
    qdrantId: string,
    limit = 200,
    excludeIds: string[] = [],
  ) {
    return this.client.recommend(this.COLLECTION_NAME, {
      positive: [qdrantId],
      filter: {
        // Loại bỏ những người đã là bạn bè và chính bản thân mình
        must_not: [
          {
            key: 'mongoId', // Trường lưu ID gốc của MongoDB trong payload
            match: {
              any: excludeIds,
            },
          },
        ],
      },
      limit: limit,
      with_payload: true,
    })
  }

  // Lấy vectors của nhiều users (để tính bio_cosine, bio_dot, bio_l2)
  async getVectorsBatch(userIds: string[]) {
    if (!userIds.length) return []
    try {
      return await this.client.retrieve(this.COLLECTION_NAME, {
        ids: userIds.map((id) => id),
        with_payload: true,
        with_vector: true,
      })
    } catch (error) {
      console.error('Error retrieving vectors from Qdrant:', error)
      return []
    }
  }
}
