import { MailerService } from '@app/mailer'
import { RedisService } from '@app/redis'
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import {
  NotificationPreferenceRepository,
  NotificationRepository,
} from './repositories'
import { NotificationEventsPublisher } from './rmq/publishers/notification-events.publisher'
import type {
  ChatMentionPayload,
  UserCreatedPayload,
  UserMakeFriendPayload,
  SessionRevokedPayload,
  UserPasswordChangedPayload,
  UserPasswordResetPayload,
  UserRegisterOtpPayload,
  UserUpdateStatusMakeFriendPayload,
} from 'libs/constant/rmq/payload'
import { SOCKET_EVENTS } from 'libs/constant/websocket/socket.events'
import type { notification, userNotificationPreference } from './generated'
import {
  channelsFrom,
  NOTIFICATION_TYPES,
  type NotificationChannelToggle,
  type NotificationTypeName,
} from './notification-types'
import {
  buildKeysetCursor,
  parseKeysetCursor,
  toPage,
  type Page,
} from '@app/util'
import type { UpdateNotificationPreferencesDto } from './notification.dto'

type NotificationPreferenceDocument = {
  global: {
    enabled: boolean
    channels: NotificationChannelToggle
  }
  overrides: Record<string, NotificationChannelToggle>
  digest: {
    enabled: boolean
    minUnread: number
    cooldownMinutes: number
    lastDigestAt: string | null
  }
  version: number
  updatedAt?: string
}

const DEFAULT_CHANNELS: NotificationChannelToggle = {
  IN_APP: true,
  EMAIL: true,
  REALTIME: true,
}

/** A stored preference; its JSON columns may lack anything older builds wrote. */
type StoredPreference = Pick<
  userNotificationPreference,
  'globalSettings' | 'overrides' | 'digestSettings' | 'version' | 'updatedAt'
>

const DEFAULT_DIGEST_SETTINGS = {
  enabled: true,
  minUnread: 5,
  cooldownMinutes: 1,
  lastDigestAt: null,
}

@Injectable()
export class NotificationService implements OnModuleInit, OnModuleDestroy {
  private digestSweepTimer: NodeJS.Timeout | null = null
  private isDigestSweepRunning = false

  constructor(
    private readonly mailerService: MailerService,
    private readonly redisService: RedisService,
    private readonly notificationRepo: NotificationRepository,
    private readonly preferenceRepo: NotificationPreferenceRepository,
    private readonly notificationEventsPublisher: NotificationEventsPublisher,
  ) {}

  onModuleInit() {
    // Sweep periodically so digest countdown works without waiting for new events.
    this.digestSweepTimer = setInterval(() => {
      void this.runDigestSweep()
    }, 15_000)
  }

  onModuleDestroy() {
    if (this.digestSweepTimer) {
      clearInterval(this.digestSweepTimer)
      this.digestSweepTimer = null
    }
  }

  async handleUserRegistered(data: UserCreatedPayload) {
    await this.mailerService.sendUserConfirmation(data)
    await this.ensureUserPreference(data.userId)
  }

  async handleUserRegisterOtp(data: UserRegisterOtpPayload) {
    await this.mailerService.sendRegistrationOtp(data)
  }

  /**
   * Mail bảo mật, không phải thông báo: không đi qua `deliver()` và không đọc
   * cài đặt kênh. Người dùng tắt email thông báo vẫn phải nhận được liên kết
   * đặt lại mật khẩu, nếu không họ mất luôn đường vào tài khoản.
   */
  async handleUserPasswordReset(data: UserPasswordResetPayload) {
    await this.mailerService.sendPasswordReset(data)
  }

  async handleUserPasswordChanged(data: UserPasswordChangedPayload) {
    await this.mailerService.sendPasswordChanged(data)
  }

  /**
   * Chỉ gửi mail khi lý do là token bị dùng lại.
   *
   * Đăng xuất bình thường, đăng xuất mọi nơi hay đổi mật khẩu đều là việc
   * người dùng tự làm và đã có phản hồi ngay trên giao diện — gửi mail cho
   * chúng là dạy người dùng bỏ qua email của hệ thống, để rồi bỏ qua đúng cái
   * cảnh báo thật.
   */
  async handleSessionRevoked(data: SessionRevokedPayload) {
    if (data.reason !== 'token-reuse' || !data.recipient) return

    await this.mailerService.sendSessionRevoked({
      email: data.recipient.email,
      username: data.recipient.username,
      revokedAt: data.revokedAt ?? new Date().toISOString(),
    })
  }

  async handleMakeFriend(data: UserMakeFriendPayload) {
    const { channels } = await this.deliver({
      userId: data.inviteeId,
      message: `${data.inviterName} đã gửi lời mời kết bạn cho bạn.`,
      type: 'FRIEND_REQUEST_SENT',
      friendRequestId: data.friendRequestId,
    })

    // Someone away from the app hears about it by mail, unless they switched
    // mail off: the "Tắt email thông báo" link in it leads to these switches.
    if (channels.email && !(await this.redisService.isOnline(data.inviteeId))) {
      await this.mailerService.sendMakeFriendNotification({
        senderName: data.inviterName,
        friendEmail: data.inviteeEmail,
        receiverName: data.inviteeName,
        friendRequestId: data.friendRequestId,
      })
    }
  }

  async handleUpdateStatusMakeFriend(data: UserUpdateStatusMakeFriendPayload) {
    // Thông báo cho trường hợp ACCEPTED đã được saga orchestration đảm nhiệm
    // (NotificationSagaSubscriber.notifyAccepted). Ở đây chỉ xử lý REJECTED để
    // tránh gửi thông báo trùng.
    if (data.status === 'ACCEPTED') {
      return
    }
    await this.deliver({
      userId: data.inviterId,
      message: `Lời mời kết bạn của ${data.inviteeName} đã được từ chối.`,
      type: 'FRIEND_REQUEST_REJECTED',
    })
  }

  /**
   * Có người nhắc (@) mình trong một cuộc trò chuyện. Badge trong khung chat chỉ
   * thấy khi đang mở app, nên vẫn cần một thông báo thật để không bỏ lỡ.
   */
  async handleChatMention(data: ChatMentionPayload) {
    for (const userId of data.userIds || []) {
      if (!userId || userId === data.senderId) continue
      await this.deliver({
        userId,
        message: data.preview
          ? `${data.senderName} đã nhắc đến bạn: ${data.preview}`
          : `${data.senderName} đã nhắc đến bạn trong một cuộc trò chuyện.`,
        type: 'MENTIONED_IN_CONVERSATION',
      })
    }
  }

  /** Where a notification of `type` may go for `userId`. */
  async channelsFor(userId: string, type: NotificationTypeName) {
    return channelsFrom(await this.ensureUserPreference(userId), type)
  }

  /**
   * Store a notification and push it to an open app, as far as the
   * recipient's settings allow. The channels are returned for the caller's
   * own delivery (mail).
   */
  private async deliver(input: {
    userId: string
    message: string
    type: NotificationTypeName
    friendRequestId?: string
  }) {
    const channels = await this.channelsFor(input.userId, input.type)
    if (!channels.inApp) return { channels, created: null }

    const created = await this.notificationRepo.create(input)
    if (channels.realtime && (await this.redisService.isOnline(input.userId))) {
      this.notificationEventsPublisher.emitToUsers(
        [input.userId],
        SOCKET_EVENTS.NOTIFICATION.NEW_NOTIFICATION,
        created,
      )
    }
    return { channels, created }
  }

  private async runDigestSweep() {
    if (this.isDigestSweepRunning) return
    this.isDigestSweepRunning = true

    try {
      // 1 query duy nhất: chỉ những user THỰC SỰ có thông báo chưa đọc.
      // Hệ thống rảnh -> mảng rỗng -> thoát ngay, không đụng tới bảng
      // preference lẫn Redis.
      const candidates = await this.notificationRepo.findDigestCandidates()
      if (!candidates.length) return

      const preferences = await this.preferenceRepo.findManyByUserIds(
        candidates.map((c) => c.userId),
      )
      const prefByUser = new Map<string, NotificationPreferenceDocument>(
        preferences.map((pref) => [
          pref.userId,
          this.normalizePreference(pref),
        ]),
      )

      const now = new Date()
      const due = candidates.filter(({ userId, unreadCount }) => {
        const pref = prefByUser.get(userId)
        if (!pref) return false

        const { digest } = pref
        if (!digest.enabled) return false
        if (unreadCount < digest.minUnread) return false
        if (!digest.lastDigestAt) return true

        const elapsed = now.getTime() - new Date(digest.lastDigestAt).getTime()
        return elapsed >= digest.cooldownMinutes * 60 * 1000
      })
      if (!due.length) return

      // 2 round-trip cho toàn bộ danh sách, thay vì 1+K cho mỗi user.
      const onlineByUser = await this.redisService.isOnlineBatch(
        due.map((d) => d.userId),
      )

      for (const { userId, unreadCount } of due) {
        const pref = prefByUser.get(userId)!
        const channels = channelsFrom(pref, 'SYSTEM_NOTIFICATION')
        if (!channels.inApp) continue

        const created = await this.notificationRepo.create({
          userId,
          message: `Bạn có ${unreadCount} thông báo chưa đọc.`,
          type: 'SYSTEM_NOTIFICATION',
          digestEligible: false,
        })

        // The stored row, id included: the bell dedupes and marks read by id.
        if (channels.realtime && onlineByUser.get(userId)) {
          this.notificationEventsPublisher.emitToUsers(
            [userId],
            SOCKET_EVENTS.NOTIFICATION.NEW_NOTIFICATION,
            created,
          )
        }

        await this.preferenceRepo.updateDigest(
          userId,
          {
            ...pref.digest,
            lastDigestAt: now.toISOString(),
          },
          pref.version + 1,
        )
      }
    } finally {
      this.isDigestSweepRunning = false
    }
  }

  private buildDefaultPreference(): NotificationPreferenceDocument {
    const overrides = NOTIFICATION_TYPES.reduce<
      Record<string, NotificationChannelToggle>
    >((acc, type) => {
      acc[type] = { ...DEFAULT_CHANNELS }
      return acc
    }, {})

    return {
      global: {
        enabled: true,
        channels: { ...DEFAULT_CHANNELS },
      },
      overrides,
      digest: { ...DEFAULT_DIGEST_SETTINGS },
      version: 1,
    }
  }

  private normalizePreference(
    raw: StoredPreference,
  ): NotificationPreferenceDocument {
    const defaults = this.buildDefaultPreference()
    const globalSettings = (raw.globalSettings ?? {}) as {
      enabled?: boolean
      channels?: Partial<NotificationChannelToggle>
    }
    const digestSettings = (raw.digestSettings ?? {}) as Partial<
      NotificationPreferenceDocument['digest']
    >
    const overrides = (raw.overrides ?? {}) as Record<
      string,
      Partial<NotificationChannelToggle>
    >

    return {
      global: {
        enabled: globalSettings.enabled ?? defaults.global.enabled,
        channels: {
          IN_APP:
            globalSettings?.channels?.IN_APP ?? defaults.global.channels.IN_APP,
          EMAIL:
            globalSettings?.channels?.EMAIL ?? defaults.global.channels.EMAIL,
          REALTIME:
            globalSettings?.channels?.REALTIME ??
            defaults.global.channels.REALTIME,
        },
      },
      // Only the types that exist: keys from older builds are dropped.
      overrides: Object.fromEntries(
        NOTIFICATION_TYPES.map((type) => [
          type,
          { ...DEFAULT_CHANNELS, ...overrides[type] },
        ]),
      ) as Record<NotificationTypeName, NotificationChannelToggle>,
      digest: {
        enabled: digestSettings.enabled ?? defaults.digest.enabled,
        minUnread: digestSettings.minUnread ?? defaults.digest.minUnread,
        cooldownMinutes:
          digestSettings.cooldownMinutes ?? defaults.digest.cooldownMinutes,
        lastDigestAt:
          digestSettings.lastDigestAt ?? defaults.digest.lastDigestAt,
      },
      version: raw.version || defaults.version,
      updatedAt: raw.updatedAt.toISOString(),
    }
  }

  async ensureUserPreference(userId: string) {
    const existing = await this.preferenceRepo.findByUserId(userId)

    if (existing) {
      return this.normalizePreference(existing)
    }

    const defaults = this.buildDefaultPreference()
    const created = await this.preferenceRepo.create({
      userId,
      globalSettings: defaults.global,
      overrides: defaults.overrides,
      digestSettings: defaults.digest,
    })

    return this.normalizePreference(created)
  }

  async getNotificationPreferences(userId: string) {
    return this.ensureUserPreference(userId)
  }

  async updateNotificationPreferences(
    userId: string,
    change: UpdateNotificationPreferencesDto,
  ) {
    const current = await this.ensureUserPreference(userId)

    // The DTO has checked the types; anything left out keeps its value.
    const global = {
      enabled: change.global?.enabled ?? current.global.enabled,
      channels: { ...current.global.channels, ...change.global?.channels },
    }
    const digest = {
      ...current.digest,
      enabled: change.digest?.enabled ?? current.digest.enabled,
      minUnread: change.digest?.minUnread ?? current.digest.minUnread,
      cooldownMinutes:
        change.digest?.cooldownMinutes ?? current.digest.cooldownMinutes,
    }

    const mergedOverrides = { ...current.overrides }
    for (const [type, value] of Object.entries(change.overrides ?? {})) {
      if (!(NOTIFICATION_TYPES as readonly string[]).includes(type)) continue
      mergedOverrides[type] = {
        IN_APP: value.IN_APP ?? mergedOverrides[type]?.IN_APP ?? true,
        EMAIL: value.EMAIL ?? mergedOverrides[type]?.EMAIL ?? true,
        REALTIME: value.REALTIME ?? mergedOverrides[type]?.REALTIME ?? true,
      }
    }

    const updated = await this.preferenceRepo.upsert({
      userId,
      globalSettings: global,
      overrides: mergedOverrides,
      digestSettings: digest,
      version: current.version + 1,
    })

    return this.normalizePreference(updated)
  }

  getUnreadCount(userId: string) {
    return this.notificationRepo.countUnread(userId)
  }

  getNotificationTypes() {
    return NOTIFICATION_TYPES
  }

  /** Newest first, by keyset: new arrivals do not shift later pages. */
  async getNotifications(
    userId: string,
    page: { limit: number; cursor?: string },
  ): Promise<Page<notification>> {
    return toPage(
      await this.notificationRepo.findManyByUser(
        userId,
        page.limit + 1,
        parseKeysetCursor(page.cursor),
      ),
      page.limit,
      (row) => buildKeysetCursor(row.createdAt, row.id),
    )
  }

  async markNotificationAsRead(userId: string, notificationId: string) {
    await this.notificationRepo.markOneRead(userId, notificationId)
  }

  async markAllNotificationsAsRead(userId: string) {
    await this.notificationRepo.markAllRead(userId)
  }
}
