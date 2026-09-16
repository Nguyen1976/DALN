import { Inject, Injectable, Logger } from '@nestjs/common'
import { Member } from '../http/chat-http.dto'
import { PrismaService } from 'apps/chat/prisma/prisma.service'
import { conversationType } from 'apps/chat/src/generated'
import { RedisService } from '@app/redis'
import { buildPeerFields } from '../domain/peer-fields'

type CachedMember = {
  userId: string
  role: string | null
  username: string | null
  fullName: string | null
  avatar: string | null
  joinedAt: string | null
}

/** Danh sách thành viên của một cuộc trò chuyện. */
const membersKey = (conversationId: string) => `conv:members:${conversationId}`

/**
 * TTL an toàn. Mọi thay đổi thành viên đều invalidate tường minh, TTL chỉ là
 * lưới đỡ cho trường hợp có đường ghi nào đó bị bỏ sót.
 */
const MEMBERS_TTL_SECONDS = 300

/**
 * Trần số tin đếm lại khi đọc. Giao diện chỉ hiện tới "5+", đếm chính xác hơn
 * mức này là tốn công vô ích.
 */
const UNREAD_RECOUNT_CAP = 99

/** ObjectId hex -> chữ thường; không phải ObjectId hợp lệ -> null. */
function normalizeObjectId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const id = value.toLowerCase()
  return /^[a-f\d]{24}$/.test(id) ? id : null
}

@Injectable()
export class ConversationMemberRepository {
  private readonly logger = new Logger(ConversationMemberRepository.name)

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  // role chữ thường / unreadCount thiếu của dữ liệu cũ do migrations/chat/0002,
  // 0003 chuẩn hoá một lần lúc deploy — repository không còn backfill runtime.
  private readonly activeMemberFilter = {
    isActive: true,
  }

  /** Xoá cache thành viên của một hoặc nhiều cuộc trò chuyện. */
  async invalidateMembersCache(...conversationIds: string[]): Promise<void> {
    const ids = conversationIds.filter(Boolean)
    if (!ids.length) return
    try {
      await this.redisService.delMany(ids.map(membersKey))
    } catch (error) {
      // Cache hỏng không được làm hỏng nghiệp vụ; TTL sẽ tự dọn.
      this.logger.warn(
        `invalidateMembersCache thất bại: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }

  /**
   * Xoá cache mọi cuộc trò chuyện mà user tham gia.
   * Chỉ dùng khi hồ sơ user đổi (avatar/fullName được phi chuẩn hoá vào
   * conversationMember) — thao tác hiếm nên một query tra cứu là chấp nhận được.
   */
  private async invalidateMembersCacheByUserId(userId: string): Promise<void> {
    const rows = await this.prisma.conversationMember.findMany({
      where: { userId },
      select: { conversationId: true },
    })
    await this.invalidateMembersCache(...rows.map((r) => r.conversationId))
  }

  async createMany(
    conversationId: string,
    members: Member[],
    createrId: string,
    type: conversationType,
  ) {
    const result = await this.prisma.conversationMember.createMany({
      data: members.map((member: Member) => ({
        ...member,
        conversationId,
        userId: member.userId,
        role:
          type === conversationType.GROUP && createrId === member.userId
            ? 'OWNER'
            : 'MEMBER',
        isActive: true,
        unreadCount: 0,
        lastReadMessageId: null,
        lastMessageAt: new Date(),
        // DIRECT: phi chuẩn hoá đối phương để danh sách hội thoại khỏi phải
        // include toàn bộ members. GROUP: toàn null, nhóm dùng groupName.
        ...buildPeerFields(String(type), member.userId, members),
      })),
    })

    await this.invalidateMembersCache(conversationId)
    return result
  }

  /**
   * Danh sách thành viên — có cache Redis.
   *
   * Đây là điểm nóng nhất của hệ thống: sendMessage() gọi nó cho MỌI tin nhắn
   * để kiểm tra người gửi có trong nhóm và lấy thông tin hiển thị. Ở peak
   * 1000 msg/s là 1000 read Mongo/giây, trong khi thành phần nhóm gần như
   * không đổi. Cache cắt gần trọn lượng đọc đó.
   */
  async findByConversationId(conversationId: string) {
    const key = membersKey(conversationId)

    try {
      const cached = await this.redisService.get(key)
      if (cached) {
        const rows = JSON.parse(cached) as CachedMember[]
        return rows.map((row) => ({
          ...row,
          joinedAt: row.joinedAt ? new Date(row.joinedAt) : null,
        }))
      }
    } catch (error) {
      // Redis lỗi hoặc JSON hỏng -> rơi xuống đọc Mongo, không ném ra ngoài.
      this.logger.warn(
        `Đọc cache thành viên thất bại (${conversationId}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }

    const members = await this.prisma.conversationMember.findMany({
      where: {
        conversationId,
        ...this.activeMemberFilter,
      },
      select: {
        userId: true,
        role: true,
        username: true,
        fullName: true,
        avatar: true,
        joinedAt: true,
      },
    })

    try {
      await this.redisService.setEx(
        key,
        JSON.stringify(members),
        MEMBERS_TTL_SECONDS,
      )
    } catch {
      /* ghi cache thất bại thì bỏ qua, lần sau thử lại */
    }

    return members
  }

  async updateLastMessageAt(conversationId: string, lastMessageAt: Date) {
    return await this.prisma.conversationMember.updateMany({
      where: {
        conversationId,
      },
      data: {
        lastMessageAt: lastMessageAt,
      },
    })
  }

  /**
   * Điều kiện "marker đọc đứng TRƯỚC `messageId`, hoặc chưa có marker".
   *
   * Prisma MongoDB phân biệt field null và field KHÔNG tồn tại: `{ field: null }`
   * được dịch thành `$eq null AND $ne $$REMOVE`, `lt` cũng kèm `$ne $$REMOVE`,
   * nên cả hai đều bỏ qua document thiếu field. Dòng tạo qua createMany có
   * `lastReadMessageId: null`, dòng tạo qua create() trong addMembers thì không
   * có field này (trên dev: 33/68 dòng) — phải thêm `isSet: false`.
   */
  private markerBefore(messageId: string) {
    return {
      OR: [
        { lastReadMessageId: null },
        { lastReadMessageId: { isSet: false } },
        { lastReadMessageId: { lt: messageId } },
      ],
    }
  }

  /**
   * Cộng `unreadCount` cho mọi thành viên trừ người gửi — do cron gọi.
   *
   * `newestMessageId` là id tin mới nhất của người gửi trong lượt cộng này. Có
   * nó thì BỎ QUA người đã đọc tới tin đó: họ đang mở hội thoại và đã đọc ngay
   * (unread về 0) trước khi cron kịp chạy, cộng nữa là ra số ảo. Không có (dữ
   * liệu Redis từ bản cũ) hoặc id hỏng thì giữ hành vi cũ: cộng cho tất cả.
   */
  async updateUnreadCount(
    conversationId: string,
    senderId: string,
    unreadCount: number,
    newestMessageId?: string | null,
  ) {
    const newest = normalizeObjectId(newestMessageId)
    return await this.prisma.conversationMember.updateMany({
      where: {
        conversationId,
        userId: {
          not: senderId,
        },
        ...this.activeMemberFilter,
        ...(newest ? this.markerBefore(newest) : {}),
      },
      data: {
        unreadCount: {
          increment: unreadCount,
        },
      },
    })
  }

  async findByConversationIdAndUserIds(
    conversationId: string,
    userIds: string[],
  ) {
    return await this.prisma.conversationMember.findMany({
      where: {
        conversationId,
        userId: { in: userIds },
        ...this.activeMemberFilter,
      },
      select: { userId: true },
    })
  }

  async findByConversationIdAndUserId(conversationId: string, userId: string) {
    return await this.prisma.conversationMember.findFirst({
      where: {
        conversationId,
        userId,
        ...this.activeMemberFilter,
      },
    })
  }

  async addMembers(
    conversationId: string,
    members: Array<{
      userId: string
      username?: string
      fullName?: string
      avatar?: string
    }>,
  ) {
    let changedCount = 0

    for (const member of members) {
      const existing = await this.prisma.conversationMember.findFirst({
        where: {
          conversationId,
          userId: member.userId,
        },
        select: {
          isActive: true,
        },
      })

      const updated = await this.prisma.conversationMember.updateMany({
        where: {
          conversationId,
          userId: member.userId,
        },
        data: {
          role: 'MEMBER',
          isActive: true,
          username: member.username || null,
          fullName: member.fullName || null,
          avatar: member.avatar || null,
          lastMessageAt: new Date(),
        },
      })

      if (updated.count > 0) {
        if (!existing?.isActive) {
          changedCount += 1
        }
        continue
      }

      await this.prisma.conversationMember.create({
        data: {
          conversationId,
          userId: member.userId,
          username: member.username || null,
          fullName: member.fullName || null,
          avatar: member.avatar || null,
          role: 'MEMBER',
          isActive: true,
          unreadCount: 0,
          lastMessageAt: new Date(),
        },
      })

      changedCount += 1
    }

    await this.invalidateMembersCache(conversationId)
    return changedCount
  }

  /**
   * Ghi nhận user đã đọc tới `lastReadMessageId` và tính lại unreadCount.
   *
   * Trả `{ count }` = số dòng có marker tiến lên (0 hoặc 1), cùng hình dạng
   * BatchPayload như trước để bên gọi không phải đổi.
   */
  async updateLastRead(
    conversationId: string,
    userId: string,
    lastReadMessageId: string,
  ) {
    const messageId = normalizeObjectId(lastReadMessageId)
    if (!messageId) return { count: 0 }

    // Tin phải thuộc CHÍNH hội thoại này. Id đến từ client: trước đây một id
    // giả thật lớn đẩy được marker lên "tương lai" và chặn mọi lần đọc sau đó.
    const message = await this.prisma.message.findFirst({
      where: { id: messageId, conversationId },
      select: { createdAt: true },
    })
    if (!message) return { count: 0 }

    const member = await this.prisma.conversationMember.findFirst({
      where: { conversationId, userId, ...this.activeMemberFilter },
      select: { lastReadMessageId: true },
    })
    if (!member) return { count: 0 }

    // A read marker may only ever move forward. The client emits one read per
    // change to its message list, and those arrive out of order often enough
    // to matter — a late event carrying an older id used to overwrite a newer
    // one, so the sender's "đã xem" marker silently rolled back to an earlier
    // message (or disappeared). Mongo ObjectIds start with a timestamp and sort
    // in creation order, so comparing them is enough to tell newer from older.
    //
    // Điều kiện nằm TRONG updateMany nên kiểm-rồi-ghi là một thao tác nguyên tử
    // phía Mongo. Trước đây findFirst rồi mới update: hai lần đọc đồng thời
    // (consumer prefetch 300) có thể để id cũ ghi đè id mới.
    const moved = await this.prisma.conversationMember.updateMany({
      where: {
        conversationId,
        userId,
        ...this.activeMemberFilter,
        ...this.markerBefore(messageId),
      },
      data: { lastReadMessageId: messageId, lastReadAt: new Date() },
    })

    // Luôn đếm lại từ dữ liệu thật, kể cả khi marker không đổi, để dòng đang
    // kẹt số ảo tự lành ở lần đọc kế tiếp. Trước đây nhánh "id cũ hơn hoặc
    // bằng" thoát sớm, nên +1 cron cộng muộn cho tin đã đọc không bao giờ về 0.
    const stored = normalizeObjectId(member.lastReadMessageId)
    const effective = stored && stored > messageId ? stored : messageId

    // Chặn dưới bằng createdAt để truy vấn bám index (conversationId,
    // createdAt, _id): lọc riêng theo _id quét gấp 5 lần số key index trên
    // prod. Tin sau `effective` đều tạo sau tin vừa đọc nên không loại nhầm.
    const unread = await this.prisma.message.findMany({
      where: {
        conversationId,
        senderId: { not: userId },
        id: { gt: effective },
        createdAt: { gte: message.createdAt },
      },
      select: { id: true },
      // Sắp theo đúng thứ tự của index. Không có orderBy, Prisma tự thêm
      // `$sort: { _id: 1 }` và Mongo có thể chọn index _id để khỏi sort — quét
      // mọi tin mới hơn marker của TOÀN BỘ collection thay vì một hội thoại.
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: UNREAD_RECOUNT_CAP,
    })

    // Chỉ ghi khi marker vẫn đúng là `effective`: lần đọc đồng thời nào đã đẩy
    // marker xa hơn thì con số của lần đó mới đúng, bản này bỏ qua.
    await this.prisma.conversationMember.updateMany({
      where: {
        conversationId,
        userId,
        ...this.activeMemberFilter,
        lastReadMessageId: effective,
      },
      data: { unreadCount: unread.length },
    })

    return { count: moved.count }
  }

  async clearHistoryForMember(
    conversationId: string,
    userId: string,
    clearedHistoryAt: Date,
  ) {
    return await this.prisma.conversationMember.updateMany({
      where: {
        conversationId,
        userId,
      },
      data: {
        clearedHistoryAt,
        unreadCount: 0,
        lastReadAt: clearedHistoryAt,
        lastReadMessageId: null,
      },
    })
  }

  async updateByUserId(
    userId: string,
    data: {
      avatar?: string
      fullName?: string
    },
  ) {
    const result = await this.prisma.conversationMember.updateMany({
      where: {
        userId,
      },
      data: {
        ...(data.avatar !== undefined ? { avatar: data.avatar } : {}),
        ...(data.fullName !== undefined ? { fullName: data.fullName } : {}),
      },
    })

    // Đối phương của người khác chính là user này -> phải cập nhật cả bản phi
    // chuẩn hoá `peer*` trên dòng membership của họ, nếu không danh sách hội
    // thoại của họ sẽ hiện tên/avatar cũ mãi (danh sách không đọc `members`
    // nữa nên không có đường tự sửa).
    await this.prisma.conversationMember.updateMany({
      where: { peerUserId: userId },
      data: {
        ...(data.avatar !== undefined ? { peerAvatar: data.avatar } : {}),
        ...(data.fullName !== undefined ? { peerFullName: data.fullName } : {}),
      },
    })

    // avatar/fullName nằm trong bản cache -> phải dọn mọi cuộc trò chuyện của
    // user này. Đổi hồ sơ là thao tác hiếm nên một query tra cứu là xứng đáng.
    await this.invalidateMembersCacheByUserId(userId)
    return result
  }

  async removeMember(conversationId: string, userId: string) {
    const existing = await this.prisma.conversationMember.findFirst({
      where: {
        conversationId,
        userId,
      },
      select: {
        isActive: true,
      },
    })

    if (!existing?.isActive) {
      return false
    }

    await this.prisma.conversationMember.updateMany({
      where: {
        conversationId,
        userId,
      },
      data: {
        isActive: false,
      },
    })

    await this.invalidateMembersCache(conversationId)
    return true
  }

  // async findUserProfileById(userId: string) {
  //   return await this.prisma.user.findUnique({
  //     where: {
  //       id: userId,
  //     },
  //     select: {
  //       username: true,
  //       fullName: true,
  //       avatar: true,
  //     },
  //   })
  // }

  async promoteToOwner(conversationId: string, userId: string) {
    const result = await this.prisma.conversationMember.updateMany({
      where: {
        conversationId,
        userId,
        ...this.activeMemberFilter,
      },
      data: {
        role: 'OWNER',
      },
    })

    await this.invalidateMembersCache(conversationId)
    return result
  }

  async promoteToAdmin(conversationId: string, userId: string) {
    const result = await this.prisma.conversationMember.updateMany({
      where: {
        conversationId,
        userId,
        ...this.activeMemberFilter,
      },
      data: {
        role: 'ADMIN',
      },
    })

    await this.invalidateMembersCache(conversationId)
    return result
  }
}
