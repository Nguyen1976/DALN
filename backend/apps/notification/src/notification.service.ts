import { MailerService } from '@app/mailer'
import { RedisService } from '@app/redis'
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { NotificationType, Status } from '@prisma/client'
import {
  GetNotificationsRequest,
  GetNotificationsResponse,
  MarkAllNotificationsAsReadRequest,
  MarkAllNotificationsAsReadResponse,
  MarkNotificationAsReadRequest,
  MarkNotificationAsReadResponse,
} from 'interfaces/notification.grpc'
import {
  NotificationPreferenceRepository,
  NotificationRepository,
} from './repositories'
import { NotificationEventsPublisher } from './rmq/publishers/notification-events.publisher'
import type {
  UserCreatedPayload,
  UserMakeFriendPayload,
  UserUpdateStatusMakeFriendPayload,
} from 'libs/constant/rmq/payload'
import { SOCKET_EVENTS } from 'libs/constant/websocket/socket.events'

type NotificationChannelToggle = {
  IN_APP: boolean
  EMAIL: boolean
  REALTIME: boolean
}

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

const NOTIFICATION_TYPES = [
  'MESSAGE_RECEIVED',
  'FRIEND_REQUEST_SENT',
  'FRIEND_REQUEST_ACCEPTED',
  'FRIEND_REQUEST_REJECTED',
  'SYSTEM_NOTIFICATION',
  'USER_JOINED_GROUP',
  'USER_LEFT_GROUP',
  'USER_KICKED_FROM_GROUP',
  'USER_ADDED_TO_GROUP',
]

const DEFAULT_CHANNELS: NotificationChannelToggle = {
  IN_APP: true,
  EMAIL: true,
  REALTIME: true,
}

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
    await this.ensureUserPreference(data.id)
  }

  async handleMakeFriend(data: UserMakeFriendPayload) {
    const inviteeStatus = await this.redisService.isOnline(data.inviteeId)

    const notificationCreated = await this.createNotification({
      userId: data.inviteeId,
      message: `${data.inviterName} đã gửi lời mời kết bạn cho bạn.`,
      type: NotificationType.FRIEND_REQUEST,
      friendRequestId: data.friendRequestId,
    })

    if (!inviteeStatus) {
      //nếu offline thì gửi mail
      await this.mailerService.sendMakeFriendNotification({
        senderName: data.inviterName,
        friendEmail: data.inviteeEmail,
        receiverName: data.inviteeName,
      })
    } else {
      this.notificationEventsPublisher.emitToUsers(
        [notificationCreated?.userId],
        SOCKET_EVENTS.NOTIFICATION.NEW_NOTIFICATION,
        notificationCreated,
      )
    }
  }

  async handleUpdateStatusMakeFriend(data: UserUpdateStatusMakeFriendPayload) {
    const createdNotification = await this.createNotification({
      userId: data.inviterId,
      message: `Lời mời kết bạn của ${data.inviteeName} đã được ${
        data.status === Status.ACCEPTED ? 'chấp nhận' : 'từ chối'
      }.`,
      type: NotificationType.NORMAL_NOTIFICATION,
    })
    const inviterStatus = await this.redisService.isOnline(data.inviterId)

    if (inviterStatus) {
      this.notificationEventsPublisher.emitToUsers(
        [createdNotification?.userId],
        SOCKET_EVENTS.NOTIFICATION.NEW_NOTIFICATION,
        createdNotification,
      )
    }

    return
  }

  async createNotification(data: any) {
    const res = await this.notificationRepo.create({
      userId: data.userId,
      message: data.message,
      type: data.type as NotificationType,
      friendRequestId: data.friendRequestId || null,
      digestEligible: data.digestEligible ?? true,
    })

    return {
      ...res,
      createdAt: res.createdAt.toString(),
    }
  }

  private async runDigestSweep() {
    if (this.isDigestSweepRunning) return
    this.isDigestSweepRunning = true

    try {
      const preferences = await this.preferenceRepo.findAllForDigestSweep()

      for (const pref of preferences) {
        const normalized = this.normalizePreference(pref)
        if (!normalized.digest.enabled) continue

        const unreadCount =
          await this.notificationRepo.countUnreadDigestEligible(pref.userId)

        if (unreadCount < normalized.digest.minUnread) continue

        const now = new Date()
        const lastDigestAt = normalized.digest.lastDigestAt
          ? new Date(normalized.digest.lastDigestAt)
          : null

        if (lastDigestAt) {
          const cooldownMillis = normalized.digest.cooldownMinutes * 60 * 1000
          const elapsed = now.getTime() - lastDigestAt.getTime()
          if (elapsed < cooldownMillis) continue
        }

        await this.createNotification({
          userId: pref.userId,
          message: `Bạn có ${unreadCount} thông báo chưa đọc.`,
          type: NotificationType.SYSTEM_NOTIFICATION,
          digestEligible: false,
        })

        const online = await this.redisService.isOnline(pref.userId)
        if (online) {
          this.notificationEventsPublisher.emitToUsers(
            [pref.userId],
            SOCKET_EVENTS.NOTIFICATION.NEW_NOTIFICATION,
            {
              type: NotificationType.SYSTEM_NOTIFICATION,
              message: `Bạn có ${unreadCount} thông báo chưa đọc.`,
              createdAt: now.toISOString(),
            },
          )
        }

        await this.preferenceRepo.updateDigest(
          pref.userId,
          {
            ...normalized.digest,
            lastDigestAt: now.toISOString(),
          },
          normalized.version + 1,
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

  private normalizePreference(raw: any): NotificationPreferenceDocument {
    const defaults = this.buildDefaultPreference()
    const globalSettings = (raw?.globalSettings ?? {}) as any
    const digestSettings = (raw?.digestSettings ?? {}) as any
    const overrides = (raw?.overrides ?? {}) as Record<
      string,
      NotificationChannelToggle
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
      overrides: {
        ...defaults.overrides,
        ...overrides,
      },
      digest: {
        enabled: digestSettings.enabled ?? defaults.digest.enabled,
        minUnread: digestSettings.minUnread ?? defaults.digest.minUnread,
        cooldownMinutes:
          digestSettings.cooldownMinutes ?? defaults.digest.cooldownMinutes,
        lastDigestAt:
          digestSettings.lastDigestAt ?? defaults.digest.lastDigestAt,
      },
      version: raw?.version || defaults.version,
      updatedAt: raw?.updatedAt
        ? new Date(raw.updatedAt).toISOString()
        : undefined,
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

  async updateNotificationPreferences(userId: string, payload: any) {
    const current = await this.ensureUserPreference(userId)

    const global = payload?.global
      ? {
          enabled:
            typeof payload.global.enabled === 'boolean'
              ? payload.global.enabled
              : current.global.enabled,
          channels: {
            IN_APP:
              payload?.global?.channels?.IN_APP ??
              current.global.channels.IN_APP,
            EMAIL:
              payload?.global?.channels?.EMAIL ?? current.global.channels.EMAIL,
            REALTIME:
              payload?.global?.channels?.REALTIME ??
              current.global.channels.REALTIME,
          },
        }
      : current.global

    const digest = payload?.digest
      ? {
          enabled:
            typeof payload.digest.enabled === 'boolean'
              ? payload.digest.enabled
              : current.digest.enabled,
          minUnread:
            Number.isFinite(payload.digest.minUnread) &&
            payload.digest.minUnread > 0
              ? payload.digest.minUnread
              : current.digest.minUnread,
          cooldownMinutes:
            Number.isFinite(payload.digest.cooldownMinutes) &&
            payload.digest.cooldownMinutes > 0
              ? payload.digest.cooldownMinutes
              : current.digest.cooldownMinutes,
          lastDigestAt: current.digest.lastDigestAt,
        }
      : current.digest

    const incomingOverrides = (payload?.overrides || {}) as Record<
      string,
      Partial<NotificationChannelToggle>
    >
    const mergedOverrides = { ...current.overrides }

    for (const [type, value] of Object.entries(incomingOverrides)) {
      if (!NOTIFICATION_TYPES.includes(type)) continue
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

  async getUnreadCount(userId: string) {
    const unreadCount = await this.notificationRepo.countUnread(userId)

    return {
      unreadCount,
    }
  }

  getNotificationTypes() {
    return {
      types: NOTIFICATION_TYPES,
    }
  }

  async getNotifications(
    data: GetNotificationsRequest,
  ): Promise<GetNotificationsResponse> {
    const { userId, page, limit } = data

    const take = Number(limit) || 5
    const skip = ((Number(page) || 1) - 1) * take

    const notifications = await this.notificationRepo.findManyByUser(
      userId,
      skip,
      take,
    )

    return {
      notifications: notifications.map((n) => ({
        ...n,
        createdAt: n.createdAt.toString(),
      })),
    } as GetNotificationsResponse
  }

  async markNotificationAsRead(
    data: MarkNotificationAsReadRequest,
  ): Promise<MarkNotificationAsReadResponse> {
    const { userId, notificationId } = data

    await this.notificationRepo.markOneRead(userId, notificationId)

    return { success: true }
  }

  async markAllNotificationsAsRead(
    data: MarkAllNotificationsAsReadRequest,
  ): Promise<MarkAllNotificationsAsReadResponse> {
    const { userId } = data

    const result = await this.notificationRepo.markAllRead(userId)

    return {
      success: true,
      updatedCount: result.count,
    }
  }
}
