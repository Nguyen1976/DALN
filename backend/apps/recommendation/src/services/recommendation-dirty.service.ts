import { Injectable, Logger } from '@nestjs/common'
import { RedisService } from '@app/redis'

/** Set chỉ mục user cần tính lại gợi ý. */
export const RCM_DIRTY_USERS_KEY = 'rcm:dirty:users'

/**
 * Theo dõi những user có dữ liệu ảnh hưởng tới gợi ý vừa thay đổi
 * (kết bạn, đổi hồ sơ/bio/sở thích, vào-rời nhóm).
 *
 * Cron hằng ngày trước đây duyệt TOÀN BỘ userSnapshot — mỗi user tốn 2 truy vấn
 * Neo4j + 1 vector search Qdrant + 1 truy vấn Mongo. Phần lớn là vô ích vì đa số
 * user không thay đổi gì so với hôm trước. Với set chỉ mục, chi phí gắn với số
 * thay đổi thật thay vì quy mô cơ sở dữ liệu.
 */
@Injectable()
export class RecommendationDirtyService {
  private readonly logger = new Logger(RecommendationDirtyService.name)

  constructor(private readonly redisService: RedisService) {}

  /** Đánh dấu cần tính lại. Không bao giờ ném lỗi ra luồng nghiệp vụ chính. */
  async markDirty(...userIds: (string | null | undefined)[]): Promise<void> {
    const ids = userIds.filter((id): id is string => Boolean(id))
    if (!ids.length) return

    try {
      await this.redisService.sadd(RCM_DIRTY_USERS_KEY, ...ids)
    } catch (error) {
      // Sót một lần đánh dấu chỉ làm gợi ý cũ thêm một chu kỳ — không đáng để
      // làm hỏng luồng xử lý sự kiện gốc. Job đối soát hằng tuần sẽ bắt lại.
      this.logger.warn(
        `Không đánh dấu được dirty cho ${ids.join(',')}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }

  /** Lấy nguyên tử tối đa `count` user ra khỏi hàng đợi. */
  async take(count: number): Promise<string[]> {
    return this.redisService.spop(RCM_DIRTY_USERS_KEY, count)
  }

  /** Trả user về hàng đợi khi xử lý thất bại. */
  async requeue(userIds: string[]): Promise<void> {
    if (!userIds.length) return
    await this.redisService.sadd(RCM_DIRTY_USERS_KEY, ...userIds)
  }
}
