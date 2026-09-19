import { Injectable, ServiceUnavailableException } from '@nestjs/common'
import { internalFetch, serviceUrl } from '@app/common/http/internal-fetch'
import type { MemberProfile } from 'libs/constant/member-profile'

/**
 * Names and avatars of users, asked of the user service that owns them.
 * Chat keeps a copy on each member row; taking it from here rather than from
 * the request means a client can no longer store whatever profile it likes,
 * and has nothing to assemble before creating a group.
 */
@Injectable()
export class UserDirectoryClient {
  private readonly baseUrl = serviceUrl('USER_SERVICE_URL', 'http://user:3002')

  async getProfiles(userIds: string[]): Promise<MemberProfile[]> {
    if (userIds.length === 0) return []
    try {
      return await internalFetch<MemberProfile[]>(
        `${this.baseUrl}/user/internal/profiles`,
        { method: 'POST', body: { ids: userIds } },
      )
    } catch {
      throw new ServiceUnavailableException(
        'Không lấy được thông tin người dùng, thử lại sau',
      )
    }
  }
}
