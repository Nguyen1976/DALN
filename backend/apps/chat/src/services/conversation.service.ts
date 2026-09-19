import { Inject, Injectable, Logger } from '@nestjs/common'
import type { UserUpdatedPayload } from 'libs/constant/rmq/payload'
import { S3StorageService } from '@app/storage-s3/s3-storage.service'
import {
  ConversationRepository,
  ConversationMemberRepository,
} from '../repositories'
import { ChatErrors } from '../errors/chat.errors'
import { ChatEventsPublisher } from '../rmq/publishers/chat-events.publisher'
import { conversationType } from '../generated'
import { MessageMediaService } from './message-media.service'
import {
  buildKeysetCursor,
  isObjectId,
  parseKeysetCursor,
  toPage,
} from '@app/util'
import { UserDirectoryClient } from '../clients/user-directory.client'
import { requireGroupManager } from './group-access'

export interface CreateGroupData {
  groupName: string
  /** Everyone to add besides the owner (the owner is added automatically). */
  memberIds: string[]
  avatar?: { buffer: Buffer; filename: string }
}

export interface DeleteConversationRequest {
  conversationId: string
  userId: string
}

export interface CallPeerRequest {
  conversationId: string
  userId: string
}

export interface CallMembersRequest {
  conversationId: string
  userId: string
}

@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name)

  constructor(
    private readonly conversationRepo: ConversationRepository,
    private readonly memberRepo: ConversationMemberRepository,
    private readonly eventsPublisher: ChatEventsPublisher,
    private readonly messageMediaService: MessageMediaService,
    @Inject(S3StorageService)
    private readonly s3StorageService: S3StorageService,
    private readonly userDirectory: UserDirectoryClient,
  ) {}

  /**
   * A new group owned by `ownerId`. Members come as ids only: names and
   * avatars are taken from the user service, so the owner's own snapshot is
   * complete (the token carries no profile) and nothing a client sends ends
   * up stored as someone's profile.
   */
  async createGroup(ownerId: string, data: CreateGroupData) {
    const otherIds = [...new Set(data.memberIds)].filter((id) => id !== ownerId)
    if (otherIds.length < 2) {
      ChatErrors.conversationNotEnoughMembers()
    }

    const profiles = await this.userDirectory.getProfiles([ownerId, ...otherIds])
    if (profiles.length !== otherIds.length + 1) {
      ChatErrors.invalidMemberAction('Có người dùng không tồn tại')
    }

    let avatarUrl = ''
    if (data.avatar) {
      const mime =
        this.messageMediaService.getMimeType(data.avatar.filename) ||
        'application/octet-stream'
      avatarUrl = await this.s3StorageService.upload({
        buffer: data.avatar.buffer,
        mime,
        folder: 'avatars',
        ext: data.avatar.filename.split('.').pop() || 'bin',
      })
    }

    const conversation = await this.conversationRepo.create({
      type: conversationType.GROUP,
      groupName: data.groupName,
      groupAvatar: avatarUrl,
      memberCount: profiles.length,
    })
    await this.memberRepo.createMany(conversation.id, profiles, {
      type: 'GROUP',
      ownerId,
    })

    const res = await this.conversationRepo.findByIdWithMembers(conversation.id)

    // The others learn about the group over the socket; the owner gets it in
    // the HTTP answer.
    this.eventsPublisher.publishConversationCreated({
      ...res,
      memberIds: otherIds,
    })
    for (const profile of profiles) {
      this.eventsPublisher.publishUserJoinedGroup({
        userId: profile.userId,
        conversationId: conversation.id,
        groupName: conversation.groupName ?? undefined,
        createdAt: new Date().toISOString(),
      })
    }

    return res
  }

  async deleteConversation(dto: DeleteConversationRequest) {
    await requireGroupManager(
      this.conversationRepo,
      this.memberRepo,
      dto.conversationId,
      dto.userId,
    )

    await this.conversationRepo.deleteConversationById(dto.conversationId)
  }

  /** The caller's conversations, most recent first (the membership's order). */
  async getConversations(
    userId: string,
    page: { limit: number; cursor?: string },
  ) {
    const rows = await this.conversationRepo.findByUserIdPaginated(
      userId,
      parseKeysetCursor(page.cursor),
      page.limit + 1,
    )
    const { items, nextCursor } = toPage(rows, page.limit, (row) =>
      row.lastMessageAt ? buildKeysetCursor(row.lastMessageAt, row.id) : null,
    )
    return { items, nextCursor }
  }

  /** Groups by name; the one screen that searches only lists groups. */
  async searchConversations(userId: string, keyword: string) {
    const safeKeyword = keyword?.trim()
    if (!safeKeyword) {
      return []
    }
    return this.conversationRepo.searchGroups(userId, safeKeyword)
  }

  /** The query only matches conversations the caller is an active member of. */
  async getConversationByFriendId(friendId: string, userId: string) {
    const conversation = await this.conversationRepo.findConversationByFriendId(
      friendId,
      userId,
    )
    if (!conversation) {
      ChatErrors.conversationNotFound()
    }
    return conversation
  }

  async getConversationById(conversationId: string, userId: string) {
    const conversation =
      await this.conversationRepo.findByIdWithMembers(conversationId)

    if (!conversation) {
      ChatErrors.conversationNotFound()
    }

    const isMember = conversation.members.find((m) => m.userId === userId)
    if (!isMember) {
      ChatErrors.userNotMember()
    }

    return conversation
  }

  /**
   * Xác thực quyền gọi thoại 1-1 cho gateway realtime: trả về đối phương của
   * `userId` trong cuộc trò chuyện DIRECT.
   *
   * Dùng findById + findByConversationId thay cho findByIdWithMembers: chỉ cần
   * `type` và danh sách thành viên, trong khi findByIdWithMembers kéo thêm tin
   * nhắn cuối cùng kèm media/poll. findByConversationId lại có cache Redis mà
   * đường gửi tin nhắn đã hâm sẵn, nên gần như không chạm Mongo.
   */
  async getCallPeer(dto: CallPeerRequest): Promise<{ peerId: string }> {
    const conversationId = dto?.conversationId?.trim()
    const userId = dto?.userId?.trim()

    if (!conversationId || !userId) {
      ChatErrors.invalidCallPeerQuery()
    }

    if (!isObjectId(conversationId)) {
      ChatErrors.callPeerNotAllowed()
    }

    const conversation = await this.conversationRepo.findById(conversationId)

    // Không tồn tại và "là nhóm" dùng chung một lỗi: gateway không cần phân
    // biệt, còn người gọi thì không dò được id nào có thật.
    if (!conversation || conversation.type !== conversationType.DIRECT) {
      ChatErrors.callPeerNotAllowed()
    }

    const members = await this.memberRepo.findByConversationId(conversationId)

    if (!members.some((member) => member.userId === userId)) {
      ChatErrors.callPeerNotAllowed()
    }

    // DIRECT chỉ có hai người; nếu đối phương đã rời (isActive=false) thì không
    // còn ai để gọi.
    const peer = members.find((member) => member.userId !== userId)

    if (!peer) {
      ChatErrors.callPeerNotAllowed()
    }

    return { peerId: peer.userId }
  }

  /**
   * Danh sách thành viên ACTIVE của một hội thoại cho gateway realtime dựng
   * phiên gọi nhóm audio. Không giới hạn `type` như getCallPeer: gọi nhóm chạy
   * trên hội thoại GROUP, còn việc chặn gọi nhóm trong DIRECT là chuyện của
   * gateway.
   *
   * Trả `{ id, username }` cho mỗi thành viên; username lấy từ bản phi chuẩn hoá
   * trên membership (như findByConversationId phục vụ mọi API tên thành viên
   * khác), lùi về fullName rồi userId để gateway luôn có tên đặt cho LiveKit.
   */
  async getCallMembers(
    dto: CallMembersRequest,
  ): Promise<{
    members: { id: string; username: string }[]
    type: conversationType
  }> {
    const conversationId = dto?.conversationId?.trim()
    const userId = dto?.userId?.trim()

    if (!conversationId || !userId) {
      ChatErrors.invalidCallMembersQuery()
    }

    // Chặn ObjectId hỏng ngay tại cửa: Prisma/Mongo ném lỗi hạ tầng (-> 500) khi
    // gặp id sai định dạng.
    if (!isObjectId(conversationId)) {
      ChatErrors.invalidCallMembersQuery()
    }

    const conversation = await this.conversationRepo.findById(conversationId)

    // Không tồn tại và "không phải thành viên" dùng chung một lỗi 403 để bên gọi
    // không dò được id nào có thật.
    if (!conversation) {
      ChatErrors.callMembersNotAllowed()
    }

    const members = await this.memberRepo.findByConversationId(conversationId)

    if (!members.some((member) => member.userId === userId)) {
      ChatErrors.callMembersNotAllowed()
    }

    return {
      members: members.map((member) => ({
        id: member.userId,
        username: member.username || member.fullName || member.userId,
      })),
      type: conversation.type,
    }
  }

  async handleUserUpdated(data: UserUpdatedPayload) {
    await this.memberRepo.updateByUserId(data.userId, {
      avatar: data.avatar,
      fullName: data.fullName,
    })
  }
}
