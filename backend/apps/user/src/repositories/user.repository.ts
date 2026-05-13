import { PrismaService } from 'apps/user/prisma/prisma.service'
import { Inject, Injectable } from '@nestjs/common'

@Injectable()
export class UserRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private toGeoPoint(location?: { lat: number; lon: number }) {
    if (!location) {
      console.log('[user.repository] toGeoPoint skipped: no location payload')
      return undefined
    }

    const geoPoint = {
      type: 'Point',
      coordinates: [location.lon, location.lat],
    }

    console.log('[user.repository] toGeoPoint converted', {
      input: location,
      output: geoPoint,
    })

    return geoPoint
  }

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

  async create(data: {
    email: string
    username: string
    password: string
    location?: {
      lat: number
      lon: number
    }
  }) {
    console.log('[user.repository] create user payload', {
      email: data.email,
      username: data.username,
      hasLocation: Boolean(data.location),
      location: data.location ?? null,
    })

    return await this.prisma.user.create({
      data: {
        email: data.email,
        fullName: '',
        password: data.password,
        username: data.username,
        isActive: false,
        location: this.toGeoPoint(data.location),
      },
    })
  }

  async updateRegisterInfoByEmail(data: {
    email: string
    username: string
    password: string
    location?: {
      lat: number
      lon: number
    }
  }) {
    console.log('[user.repository] update register info payload', {
      email: data.email,
      username: data.username,
      hasLocation: Boolean(data.location),
      location: data.location ?? null,
    })

    return await this.prisma.user.update({
      where: { email: data.email },
      data: {
        username: data.username,
        password: data.password,
        location: this.toGeoPoint(data.location),
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
    return await this.prisma.user.updateMany({
      where: { id: userId },
      data: {
        lastSeen,
      },
    })
  }

  async completeInterestOnboarding(userId: string, slugs: string[]) {
    return await this.prisma.user.update({
      where: { id: userId },
      data: {
        interests: slugs,
        hasCompletedInterestOnboarding: true,
      },
      select: {
        id: true,
        email: true,
        username: true,
        fullName: true,
        avatar: true,
        bio: true,
        interests: true,
        hasCompletedInterestOnboarding: true,
      },
    })
  }

  async findSessionFieldsById(userId: string) {
    return await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        username: true,
        fullName: true,
        avatar: true,
        bio: true,
        interests: true,
        hasCompletedInterestOnboarding: true,
      },
    })
  }
}
