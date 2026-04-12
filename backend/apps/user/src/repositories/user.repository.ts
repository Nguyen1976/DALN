import { PrismaService } from 'apps/user/prisma/prisma.service'
import { Inject, Injectable } from '@nestjs/common'

@Injectable()
export class UserRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async findByEmail(email: string) {
    return await this.prisma.user.findUnique({
      where: { email },
    })
  }

  async findByUsername(username: string) {
    return await this.prisma.user.findUnique({
      where: { username },
    })
  }

  async findById(id: string) {
    return await this.prisma.user.findUnique({
      where: { id },
    })
  }

  async findByIdWithSelect(id: string) {
    return await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        fullName: true,
        username: true,
        email: true,
        bio: true,
        avatar: true,
      },
    })
  }

  async create(data: { email: string; username: string; password: string }) {
    return await this.prisma.user.create({
      data: {
        email: data.email,
        fullName: '',
        password: data.password,
        username: data.username,
        isActive: false,
      },
    })
  }

  async updateRegisterInfoByEmail(data: {
    email: string
    username: string
    password: string
  }) {
    return await this.prisma.user.update({
      where: { email: data.email },
      data: {
        username: data.username,
        password: data.password,
      },
    })
  }

  async activateByEmail(email: string) {
    return await this.prisma.user.update({
      where: { email },
      data: {
        isActive: true,
      },
    })
  }

  async findManyByIds(userIds: string[]) {
    return await this.prisma.user.findMany({
      where: {
        id: { in: userIds },
      },
      select: {
        id: true,
        email: true,
        username: true,
        avatar: true,
        fullName: true,
        lastSeen: true,
      },
    })
  }

  async findManyByIdsAndUsername(userIds: string[], keyword: string) {
    return await this.prisma.user.findMany({
      where: {
        id: { in: userIds },
        username: {
          startsWith: keyword,
          mode: 'insensitive',
        },
      },
      select: {
        id: true,
        email: true,
        username: true,
        avatar: true,
        fullName: true,
      },
    })
  }

  async updateProfile(
    userId: string,
    data: {
      fullName?: string
      bio?: string
      avatar?: string
    },
  ) {
    return await this.prisma.user.update({
      where: { id: userId },
      data: {
        fullName: data.fullName,
        bio: data.bio,
        avatar: data.avatar || undefined,
      },
    })
  }

  async updateLastSeen(userId: string, lastSeen: string | null) {
    return await this.prisma.user.update({
      where: { id: userId },
      data: {
        lastSeen,
      },
    })
  }
}
