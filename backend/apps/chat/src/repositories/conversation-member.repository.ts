import { Inject, Injectable } from '@nestjs/common'
import { Member } from '../http/chat-http.dto'
import { PrismaService } from 'apps/chat/prisma/prisma.service'
import { conversationType } from 'apps/chat/src/generated'

@Injectable()
export class ConversationMemberRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private participantRoleBackfilled = false
  private unreadCountBackfilled = false
  private readonly activeMemberFilter = {
    isActive: true,
  }

  private async forceBackfillUnreadCount() {
    await this.prisma.$runCommandRaw({
      update: 'conversationMember',
      updates: [
        {
          q: {
            $or: [{ unreadCount: null }, { unreadCount: { $exists: false } }],
          },
          u: [
            {
              $set: {
                unreadCount: 0,
              },
            },
          ],
          multi: true,
        },
      ],
    })
  }

  private async ensureUnreadCountInitialized() {
    if (this.unreadCountBackfilled) return
    await this.forceBackfillUnreadCount()
    this.unreadCountBackfilled = true
  }

  private async forceBackfillParticipantRole() {
    await this.prisma.$runCommandRaw({
      update: 'conversationMember',
      updates: [
        {
          q: {
            $or: [
              { role: null },
              { role: { $exists: false } },
              { role: 'member' },
              { role: 'admin' },
              { role: 'owner' },
            ],
          },
          u: [
            {
              $set: {
                role: {
                  $switch: {
                    branches: [
                      { case: { $eq: ['$role', 'admin'] }, then: 'ADMIN' },
                      { case: { $eq: ['$role', 'owner'] }, then: 'OWNER' },
                      { case: { $eq: ['$role', 'member'] }, then: 'MEMBER' },
                    ],
                    default: 'MEMBER',
                  },
                },
              },
            },
          ],
          multi: true,
        },
      ],
    })
  }

  private async ensureParticipantRoleNormalized() {
    if (this.participantRoleBackfilled) return
    await this.forceBackfillParticipantRole()
    this.participantRoleBackfilled = true
  }

  private async withRoleRetry<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (error) {
      const message = String((error as any)?.message || '')
      const isParticipantRoleError =
        message.includes(
          "Value 'member' not found in enum 'participantRole'",
        ) ||
        message.includes("Value 'admin' not found in enum 'participantRole'") ||
        message.includes("Value 'owner' not found in enum 'participantRole'")

      if (!isParticipantRoleError) {
        throw error
      }

      await this.forceBackfillParticipantRole()
      return await fn()
    }
  }

  async createMany(
    conversationId: string,
    members: Member[],
    createrId: string,
    type: conversationType,
  ) {
    return await this.prisma.conversationMember.createMany({
      data: members.map((member: Member) => ({
        ...member,
        conversationId,
        userId: member.userId,
        role:
          type === conversationType.GROUP && createrId === member.userId
            ? 'ADMIN'
            : 'MEMBER',
        isActive: true,
        unreadCount: 0,
        lastReadMessageId: null,
        lastMessageAt: new Date(),
      })),
    })
  }

  async findByConversationId(conversationId: string) {
    await this.ensureParticipantRoleNormalized()
    await this.ensureUnreadCountInitialized()

    return await this.withRoleRetry(() =>
      this.prisma.conversationMember.findMany({
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
      }),
    )
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

  async increaseUnreadForOthers(conversationId: string, senderId: string) {
    return await this.prisma.conversationMember.updateMany({
      where: {
        conversationId,
        userId: {
          not: senderId,
        },
        ...this.activeMemberFilter,
      },
      data: {
        unreadCount: {
          increment: 1,
        },
      },
    })
  }

  async findByConversationIdAndUserIds(
    conversationId: string,
    userIds: string[],
  ) {
    await this.ensureParticipantRoleNormalized()
    await this.ensureUnreadCountInitialized()

    return await this.withRoleRetry(() =>
      this.prisma.conversationMember.findMany({
        where: {
          conversationId,
          userId: { in: userIds },
          ...this.activeMemberFilter,
        },
        select: { userId: true },
      }),
    )
  }

  async findByConversationIdAndUserId(conversationId: string, userId: string) {
    await this.ensureParticipantRoleNormalized()
    await this.ensureUnreadCountInitialized()

    return await this.withRoleRetry(() =>
      this.prisma.conversationMember.findFirst({
        where: {
          conversationId,
          userId,
          ...this.activeMemberFilter,
        },
      }),
    )
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
    for (const member of members) {
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

      if (updated.count > 0) continue

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
    }
  }

  async updateLastRead(
    conversationId: string,
    userId: string,
    lastReadMessageId: string,
  ) {
    await this.ensureUnreadCountInitialized()

    return await this.prisma.conversationMember.updateMany({
      where: {
        conversationId,
        userId,
      },
      data: {
        lastReadAt: new Date(),
        lastReadMessageId,
        unreadCount: 0,
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
    return await this.prisma.conversationMember.updateMany({
      where: {
        userId,
      },
      data: {
        ...(data.avatar !== undefined ? { avatar: data.avatar } : {}),
        ...(data.fullName !== undefined ? { fullName: data.fullName } : {}),
      },
    })
  }

  async removeMember(conversationId: string, userId: string) {
    return await this.prisma.conversationMember.updateMany({
      where: {
        conversationId,
        userId,
      },
      data: {
        isActive: false,
      },
    })
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

  async promoteToAdmin(conversationId: string, userId: string) {
    return await this.prisma.conversationMember.updateMany({
      where: {
        conversationId,
        userId,
        ...this.activeMemberFilter,
      },
      data: {
        role: 'ADMIN',
      },
    })
  }
}
