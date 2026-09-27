import type { Server } from 'socket.io'
import type Redis from 'ioredis'
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets'
import { JwtService } from '@nestjs/jwt'
import { Inject, Injectable, Logger } from '@nestjs/common'
import { SOCKET_EVENTS } from 'libs/constant/websocket/socket.events'
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq'
import { publishEvent, RabbitSubscribeWithRetry } from '@app/common/rmq'
import { EXCHANGE_RMQ } from 'libs/constant/rmq/exchange'
import { QUEUE_RMQ } from 'libs/constant/rmq/queue'
import { ROUTING_RMQ } from 'libs/constant/rmq/routing'
import { UserStatusStore } from './user-status.store'
import type {
  EmitToUserPayload,
  MessageSendPayload,
  SessionRevokedPayload,
} from 'libs/constant/rmq/payload'
import {
  allowedOrigins,
  readCookie,
  resolveAccessToken,
  SessionStore,
} from '@app/common'
import { randomUUID } from 'crypto'
import { CallSession, CallSessionStore, isCallId } from './call-session.store'
import { CallBusyStore } from './call-busy.store'
import {
  GroupCallMember,
  GroupCallSession,
  GroupCallStore,
  isGroupCallId,
} from './group-call.store'
import {
  fetchCallMembers,
  fetchCallPeer,
  postGroupCallLog,
} from './chat.client'
import { RealtimeKitService } from './realtimekit.service'
import { presetFor, RtkGrant, userIdFromCustomId } from './realtimekit.types'
import type { RtkWebhookEvent } from './rtk-webhook'
import type {
  CallBody,
  ClientSocket,
  ConversationBody,
  CreateMessageBody,
  MessageReadBody,
  TypingBody,
} from './socket.types'

/** Ack trả về cho client ở các sự kiện `call.*`. */
export type CallAck =
  | ({ ok: true } & Record<string, unknown>)
  | { ok: false; code: string; message: string }

/** Đọc `sid` từ `socket.data` của một socket lấy qua `fetchSockets()`. */
function sidOf(socket: { data?: unknown }): string | undefined {
  const data = socket.data
  if (!data || typeof data !== 'object') return undefined
  const sid = (data as Record<string, unknown>).sid
  return typeof sid === 'string' ? sid : undefined
}

function callError(code: string, message: string): CallAck {
  return { ok: false, code, message }
}

/**
 * Client chạy JS trước khi chuyển sang RealtimeKit: vẫn gửi SDP, hoặc chưa gửi
 * `v: 2`. Trả CLIENT_OUTDATED để nó nhắc người dùng tải lại trang, thay vì kẹt ở
 * một luồng media mà server không còn phục vụ.
 */
export function isLegacyCallPayload(data: CallBody | undefined): boolean {
  if (!data) return true
  return data.v !== 2 || data.offer !== undefined || data.answer !== undefined
}

/** Grant để lưu vào Redis: bỏ authToken (token chỉ đi trong ack). */
function grantOf(grant: RtkGrant & { authToken?: string }): RtkGrant {
  return {
    meetingId: grant.meetingId,
    participantId: grant.participantId,
    customParticipantId: grant.customParticipantId,
  }
}

//nếu k đặt tên cổng thì nó sẽ trùng với cổng của http
@Injectable()
@WebSocketGateway({
  // `origin: '*'` cộng với handshake xác thực bằng cookie là một cặp sai: mọi
  // trang đều mở được socket kèm cookie của người dùng. `credentials` cũng
  // từng nằm ở tầng ngoài, nơi Socket.IO không đọc tới.
  cors: {
    origin: allowedOrigins(),
    credentials: true,
  },
  namespace: 'realtime',
  pingInterval: 40000,
  pingTimeout: 10000,
})
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server

  private readonly logger = new Logger(RealtimeGateway.name)

  private userStatusStore: UserStatusStore
  private callSessionStore: CallSessionStore
  private groupCallStore: GroupCallStore
  private callBusyStore: CallBusyStore
  /** Hẹn huỷ phòng nhóm chưa ai vào (theo callId). Chỉ sống trong process này. */
  private readonly groupPendingTimers = new Map<string, NodeJS.Timeout>()
  private readonly groupPendingMs = 35000
  /** Phòng nhóm trống (người cuối vừa rời): chờ ai đó rớt mạng vào lại. */
  private readonly groupEmptyTimers = new Map<string, NodeJS.Timeout>()
  private readonly groupEmptyMs = 15000
  // Không còn timer 25s cho mỗi socket: `pong` của Socket.IO (pingInterval
  // 40s, pingTimeout 10s -> tối đa 50s giữa hai lần) đã gia hạn TTL 90s của
  // key socket, dư 1,8 lần biên an toàn. Timer server-side còn có hại: nó gia
  // hạn cho cả kết nối đã chết, kéo dài trạng thái online giả.
  private readonly packetListeners = new Map<
    string,
    (packet: { type: string }) => void
  >()
  private readonly typingConversationsBySocket = new Map<string, Set<string>>()
  private readonly readBatchByConversation = new Map<
    string,
    {
      timer: NodeJS.Timeout
      users: Map<string, string>
    }
  >()
  private readonly readBatchWindowMs = 1000

  private emitTypingStopToRoom(
    client: ClientSocket,
    userId: string,
    conversationId: string,
  ) {
    client.broadcast
      .to(`conversation:${conversationId}`)
      .emit(SOCKET_EVENTS.CHAT.USER_TYPING, {
        conversationId,
        userId,
        status: 'stop',
      })
  }

  private forceStopAllTypingForSocket(client: ClientSocket, userId: string) {
    const typingConversations = this.typingConversationsBySocket.get(client.id)
    if (!typingConversations || typingConversations.size === 0) {
      this.typingConversationsBySocket.delete(client.id)
      return
    }

    for (const conversationId of typingConversations) {
      this.emitTypingStopToRoom(client, userId, conversationId)
    }

    this.typingConversationsBySocket.delete(client.id)
  }

  private queueReadBroadcast(
    client: ClientSocket,
    conversationId: string,
    userId: string,
    lastReadMessageId: string,
  ) {
    const current = this.readBatchByConversation.get(conversationId)

    if (!current) {
      const users = new Map<string, string>()
      users.set(userId, lastReadMessageId)

      const timer = setTimeout(() => {
        const pending = this.readBatchByConversation.get(conversationId)
        if (!pending) return

        const usersPayload = Array.from(pending.users.entries()).map(
          ([uid, msgId]) => ({
            userId: uid,
            lastReadMessageId: msgId,
          }),
        )

        client.broadcast
          .to(`conversation:${conversationId}`)
          .emit(SOCKET_EVENTS.CHAT.USER_READ_BATCH, {
            conversationId,
            users: usersPayload,
          })

        this.readBatchByConversation.delete(conversationId)
      }, this.readBatchWindowMs)

      this.readBatchByConversation.set(conversationId, {
        timer,
        users,
      })
      return
    }

    current.users.set(userId, lastReadMessageId)
  }

  constructor(
    private jwtService: JwtService,
    @Inject('REDIS_CLIENT')
    private readonly redisClient: Redis,
    private readonly amqpConnection: AmqpConnection,
    private readonly sessions: SessionStore,
    private readonly rtk: RealtimeKitService,
  ) {
    this.userStatusStore = new UserStatusStore(this.redisClient)
    this.callSessionStore = new CallSessionStore(this.redisClient)
    this.groupCallStore = new GroupCallStore(this.redisClient)
    this.callBusyStore = new CallBusyStore(this.redisClient)
  }

  //default function
  async handleConnection(client: ClientSocket) {
    try {
      const rawCookie = client.handshake.headers.cookie

      // Dùng CHUNG hàm phân giải với AuthGuard, và chỉ chấp nhận access token.
      //
      // Chỗ này từng nhận cả refreshToken để socket sống qua mốc 15 phút. Giờ
      // không còn cần: refresh token không phải JWT nữa, và cookie của nó cũng
      // không còn được gửi tới đây (path=/user). Client nào bị từ chối vì
      // ACCESS_TOKEN_EXPIRED thì gọi POST /user/refresh rồi nối lại — đúng
      // đường mà HTTP đang đi.
      const resolved = resolveAccessToken(
        this.jwtService,
        readCookie(rawCookie, 'accessToken'),
      )

      if (!resolved.ok) {
        this.rejectConnection(client, resolved.code)
        return
      }

      const userId = resolved.payload.userId
      const sid = resolved.payload.sid

      // Chữ ký hợp lệ chưa đủ: phiên có thể đã bị thu hồi từ một thiết bị khác
      // trong khi token này còn hạn. Redis lỗi thì từ chối — fail-closed, và
      // client sẽ thử lại theo backoff đã có.
      let alive: boolean
      try {
        alive = await this.sessions.isAlive(sid)
      } catch (error) {
        this.logger.error(`không kiểm tra được phiên ${sid}`, error)
        this.rejectConnection(client, 'SESSION_CHECK_UNAVAILABLE')
        return
      }

      if (!alive) {
        this.rejectConnection(client, 'SESSION_REVOKED')
        return
      }

      client.data.userId = userId
      client.data.sid = sid

      const prevOnline = await this.userStatusStore.isOnline(userId)

      // 🔥 Join room theo user
      await client.join(`user:${userId}`)

      // 🔥 Lưu Redis + TTL
      await this.userStatusStore.addConnection(userId, client.id)

      const packetListener = (packet: { type: string }) => {
        if (packet.type !== 'pong') return
        this.userStatusStore
          .touchConnection(userId, client.id)
          .catch((error: unknown) =>
            this.logger.warn(`touch ${client.id} failed`, error),
          )
      }

      client.conn.on('packet', packetListener)
      this.packetListeners.set(client.id, packetListener)

      if (!prevOnline) {
        this.publish(ROUTING_RMQ.USER_ONLINE, { userId })
      }
    } catch {
      client.disconnect()
    }
  }

  /**
   * Hand an event to the other services. Fire-and-forget: a socket handler
   * has nothing to roll back, so a broker failure is logged, not thrown.
   */
  private publish(routingKey: string, payload: unknown) {
    publishEvent(
      this.amqpConnection,
      EXCHANGE_RMQ.REALTIME_EVENTS,
      routingKey,
      payload,
    ).catch((error: unknown) =>
      this.logger.error(`publish ${routingKey} failed`, error),
    )
  }

  /**
   * Từ chối kết nối KÈM mã lý do, rồi mới ngắt.
   *
   * Client cần phân biệt: hết hạn thì làm mới cookie qua HTTP rồi nối lại,
   * còn hỏng/thu hồi thì phải đăng xuất. Trước đây mọi trường hợp đều là một
   * `client.disconnect()` trần trụi nên client không có cách nào biết.
   *
   * `volatile: false` + emit trước disconnect để gói tin kịp ra khỏi hàng đợi.
   */
  private rejectConnection(client: ClientSocket, code: string) {
    try {
      client.emit(SOCKET_EVENTS.AUTH.ERROR, { code })
    } catch {
      /* socket có thể đã đứt — không có gì để làm thêm */
    }
    // Cho event kịp gửi trước khi đóng transport.
    setTimeout(() => client.disconnect(true), 50)
  }

  async handleDisconnect(client: ClientSocket) {
    const userId = client.data.userId
    if (!userId) return

    this.forceStopAllTypingForSocket(client, userId)

    this.readBatchByConversation.forEach((batch, conversationId) => {
      if (batch.users.has(userId)) {
        batch.users.delete(userId)
      }

      if (batch.users.size === 0) {
        clearTimeout(batch.timer)
        this.readBatchByConversation.delete(conversationId)
      }
    })

    const packetListener = this.packetListeners.get(client.id)
    if (packetListener) {
      client.conn.off('packet', packetListener)
      this.packetListeners.delete(client.id)
    }

    await this.userStatusStore.removeConnection(userId, client.id)

    const stillOnline = await this.userStatusStore.isOnline(userId)

    if (!stillOnline) {
      //trường hợp này là trường hợp user offline thật sự, chứ k phải do lỗi kết nối mạng hay tắt máy đột ngột mà chưa kịp remove connection
      // The user service stores it on the account (USER_OFFLINE).
      const lastSeen = new Date().toISOString()

      this.publish(ROUTING_RMQ.USER_OFFLINE, { userId, lastSeen })
    }
  }

  @SubscribeMessage('pong')
  async handleHeartbeat(@ConnectedSocket() client: ClientSocket) {
    const userId = client.data.userId
    if (!userId) return
    await this.userStatusStore.touchConnection(userId, client.id)
  }

  /**
   * Khi người dùng vào xem một conversation, join room để nhận typing/read events
   */
  @SubscribeMessage('conversation:join')
  async handleJoinConversation(
    @MessageBody() data: ConversationBody | undefined,
    @ConnectedSocket() client: ClientSocket,
  ) {
    const conversationId = data?.conversationId
    if (!conversationId) return

    await client.join(`conversation:${conversationId}`)
  }

  /**
   * Khi người dùng rời khỏi conversation
   */
  @SubscribeMessage('conversation:leave')
  async handleLeaveConversation(
    @MessageBody() data: ConversationBody | undefined,
    @ConnectedSocket() client: ClientSocket,
  ) {
    const userId = client.data.userId
    const conversationId = data?.conversationId
    if (!conversationId || !userId) return

    const typingConversations = this.typingConversationsBySocket.get(client.id)
    if (typingConversations?.has(conversationId)) {
      this.emitTypingStopToRoom(client, userId, conversationId)
      typingConversations.delete(conversationId)

      if (typingConversations.size === 0) {
        this.typingConversationsBySocket.delete(client.id)
      }
    }

    await client.leave(`conversation:${conversationId}`)
  }

  @RabbitSubscribeWithRetry({
    exchange: EXCHANGE_RMQ.REALTIME_EVENTS,
    routingKey: ROUTING_RMQ.EMIT_REALTIME_EVENT,
    queue: QUEUE_RMQ.REALTIME_EMIT_EVENT,
  })
  emitToUser({ userIds, event, data }: EmitToUserPayload) {
    this.emitToUserSockets(userIds, event, data)
  }

  /**
   * Phiên vừa bị thu hồi -> ngắt đúng những socket thuộc phiên đó.
   *
   * Không có đường này thì thu hồi chỉ có hiệu lực với HTTP: socket được xác
   * thực MỘT LẦN lúc handshake rồi sống mãi, nên người vừa bị đăng xuất vẫn
   * nhận tin nhắn cho tới khi transport tự đứt.
   */
  @RabbitSubscribeWithRetry({
    exchange: EXCHANGE_RMQ.USER_EVENTS,
    routingKey: ROUTING_RMQ.AUTH_SESSION_REVOKED,
    queue: QUEUE_RMQ.REALTIME_AUTH_SESSION_REVOKED,
  })
  async handleSessionRevoked({ userId, sids }: SessionRevokedPayload) {
    const revoked = new Set(sids ?? [])
    const sockets = await this.server.in(`user:${userId}`).fetchSockets()

    for (const socket of sockets) {
      // Lọc theo sid để đăng xuất một thiết bị không đá các thiết bị khác.
      // Socket không có sid là bản cũ trước khi deploy — cũng ngắt luôn.
      const sid = sidOf(socket)
      if (sid && revoked.size && !revoked.has(sid)) continue

      // Gửi mã lý do TRƯỚC khi đóng: client cần phân biệt "phải đăng nhập lại"
      // với "token hết hạn, làm mới rồi nối lại".
      socket.emit(SOCKET_EVENTS.AUTH.ERROR, { code: 'SESSION_REVOKED' })
      setTimeout(() => socket.disconnect(true), 50)
    }
  }

  @SubscribeMessage(SOCKET_EVENTS.CHAT.MESSAGE_CREATE)
  handleCreateMessage(
    @MessageBody() data: CreateMessageBody | undefined,
    @ConnectedSocket() client: ClientSocket,
  ) {
    if (!client.data.userId) {
      client.emit(SOCKET_EVENTS.CHAT.MESSAGE_ERROR, {
        conversationId: data?.conversationId,
        clientMessageId: data?.clientMessageId,
        code: 'UNAUTHORIZED',
        message: 'Unauthorized socket client',
        retryable: false,
      })
      return
    }

    if (!data?.conversationId || !data?.clientMessageId) {
      client.emit(SOCKET_EVENTS.CHAT.MESSAGE_ERROR, {
        conversationId: data?.conversationId,
        clientMessageId: data?.clientMessageId,
        code: 'INVALID_PAYLOAD',
        message: 'conversationId and clientMessageId are required',
        retryable: false,
      })
      return
    }

    const message: MessageSendPayload = {
      conversationId: data.conversationId,
      senderId: client.data.userId,
      content: data.content,
      replyToMessageId: data.replyToMessageId,
      clientMessageId: data.clientMessageId,
      type: data.type,
      medias: data.medias ?? [],
    }
    this.publish(ROUTING_RMQ.SEND_MESSAGE, message)
  }

  /**
   * TYPING INDICATOR
   * Khi người dùng gõ, emit typing event với { conversationId, status: 'start' | 'stop' }
   * Broadcast tới các thành viên khác trong room
   */
  @SubscribeMessage(SOCKET_EVENTS.CHAT.USER_TYPING)
  handleUserTyping(
    @MessageBody() data: TypingBody | undefined,
    @ConnectedSocket() client: ClientSocket,
  ) {
    const userId = client.data.userId
    if (!userId) {
      client.emit(SOCKET_EVENTS.CHAT.MESSAGE_ERROR, {
        code: 'UNAUTHORIZED',
        message: 'Unauthorized socket client',
        retryable: false,
      })
      return
    }

    const { conversationId, status } = data ?? {}
    if (!conversationId || (status !== 'start' && status !== 'stop')) {
      client.emit(SOCKET_EVENTS.CHAT.MESSAGE_ERROR, {
        code: 'INVALID_PAYLOAD',
        message: 'conversationId and status (start/stop) are required',
        retryable: false,
      })
      return
    }

    // Broadcast to other users in the conversation room
    // Gửi tới tất cả users trong conversation, ngoại trừ sender
    const typingConversations =
      this.typingConversationsBySocket.get(client.id) || new Set<string>()

    if (status === 'start') {
      typingConversations.add(conversationId)
      this.typingConversationsBySocket.set(client.id, typingConversations)
    } else {
      typingConversations.delete(conversationId)
      if (typingConversations.size === 0) {
        this.typingConversationsBySocket.delete(client.id)
      } else {
        this.typingConversationsBySocket.set(client.id, typingConversations)
      }
    }

    client.broadcast
      .to(`conversation:${conversationId}`)
      .emit(SOCKET_EVENTS.CHAT.USER_TYPING, {
        conversationId,
        userId,
        status,
      })
  }

  /**
   * SEEN STATUS (ĐÃ XEM)
   * Khi người dùng mở hội thoại, emit message_read event với { conversationId, lastMessageId }
   * 1. Broadcast tới các thành viên khác để cập nhật UI
   * 2. Gửi async message tới Chat Service để cập nhật MongoDB
   */
  @SubscribeMessage(SOCKET_EVENTS.CHAT.MESSAGE_READ)
  handleMessageRead(
    @MessageBody() data: MessageReadBody | undefined,
    @ConnectedSocket() client: ClientSocket,
  ) {
    const userId = client.data.userId
    if (!userId) {
      client.emit(SOCKET_EVENTS.CHAT.MESSAGE_ERROR, {
        code: 'UNAUTHORIZED',
        message: 'Unauthorized socket client',
        retryable: false,
      })
      return
    }

    const { conversationId, lastMessageId } = data ?? {}
    if (!conversationId || !lastMessageId) {
      client.emit(SOCKET_EVENTS.CHAT.MESSAGE_ERROR, {
        code: 'INVALID_PAYLOAD',
        message: 'conversationId and lastMessageId are required',
        retryable: false,
      })
      return
    }

    // 1️⃣ Batch broadcast user_read để giảm số lượng event dồn dập
    this.queueReadBroadcast(client, conversationId, userId, lastMessageId)

    // 2️⃣ Gửi async message tới Chat Service để cập nhật MongoDB
    this.publish(ROUTING_RMQ.UPDATE_MESSAGE_READ, {
      conversationId,
      userId,
      lastReadMessageId: lastMessageId,
    })
  }

  private emitToUserSockets(userIds: string[], event: string, data: unknown) {
    for (const userId of userIds) {
      this.server.to(`user:${userId}`).emit(event, data)
    }
  }

  /**
   * Nạp phiên cuộc gọi và kiểm người gửi có thuộc phiên không.
   *
   * Mọi sự kiện `call.*` sau lúc đổ chuông đều đi qua đây: không có chốt này
   * thì chỉ cần đoán đúng một callId là chen được vào cuộc gọi của người khác.
   */
  private async loadCallSession(
    callId: unknown,
    userId: string,
  ): Promise<{ ok: true; session: CallSession } | { ok: false; ack: CallAck }> {
    if (!isCallId(callId)) {
      return {
        ok: false,
        ack: callError('INVALID_PAYLOAD', 'callId is required'),
      }
    }

    const session = await this.callSessionStore.get(callId)
    if (!session) {
      // Hết TTL, hoặc bên kia đã đóng trước — không còn gì để chuyển tiếp.
      return {
        ok: false,
        ack: callError('CALL_NOT_FOUND', 'Call session no longer exists'),
      }
    }

    if (!CallSessionStore.isParticipant(session, userId)) {
      return {
        ok: false,
        ack: callError('CALL_FORBIDDEN', 'Not a participant of this call'),
      }
    }

    return { ok: true, session }
  }

  /**
   * Bắt đầu cuộc gọi: gateway tự tìm người nhận rồi mới đổ chuông.
   *
   * `targetUserId` của client bị bỏ qua hoàn toàn. Trước đây nó được tin tưởng,
   * nên một người lạ chỉ cần biết userId là làm người khác đổ chuông được. Giờ
   * chat service mới là bên quyết định ai nhận, và chỉ trả lời khi hội thoại là
   * DIRECT và người gọi thật sự là thành viên.
   */
  @SubscribeMessage(SOCKET_EVENTS.CALL.INCOMING_CALL)
  async handleIncomingCall(
    @MessageBody() data: CallBody | undefined,
    @ConnectedSocket() client: ClientSocket,
  ): Promise<CallAck> {
    const callerId = client.data.userId
    if (!callerId) {
      return callError('UNAUTHORIZED', 'Unauthorized socket client')
    }

    if (isLegacyCallPayload(data)) {
      return callError('CLIENT_OUTDATED', 'Client is outdated, reload the page')
    }

    const conversationId =
      typeof data?.conversationId === 'string' ? data.conversationId.trim() : ''
    if (!conversationId) {
      return callError('INVALID_PAYLOAD', 'conversationId is required')
    }

    if (!this.rtk.isConfigured()) {
      return callError('MEDIA_UNCONFIGURED', 'Calling is not configured')
    }

    const peer = await fetchCallPeer(conversationId, callerId)
    if (!peer.ok) {
      return callError(
        peer.code,
        peer.code === 'CALL_FORBIDDEN'
          ? 'Not allowed to call in this conversation'
          : 'Could not verify the call peer',
      )
    }

    // Mặc định audio. cameraEnabled là trạng thái từng người, không đổi callType
    // (một người tắt camera ≠ audio call).
    const callType = data?.callType === 'video' ? 'video' : 'audio'
    const callId = randomUUID()

    // Busy: người gọi phải đang rảnh, và người nhận không kẹt cuộc gọi khác.
    // Chốt ở server để nhiều tab / cuộc gọi chồng chéo không tranh phiên.
    if (!(await this.callBusyStore.acquire(callerId, callId))) {
      return callError('BUSY', 'You are already in a call')
    }
    if (await this.callBusyStore.isBusy(peer.peerId, callId)) {
      await this.callBusyStore.release(callerId, callId)
      return callError('CALLEE_BUSY', 'The other person is in another call')
    }

    // Người gọi vào phòng RealtimeKit ngay (đứng chờ trong lúc đổ chuông), nên
    // cấp media TRƯỚC khi đổ chuông; lỗi thì nhả khoá, không để ai kẹt "bận".
    let grant: RtkGrant & { authToken: string }
    try {
      grant = await this.rtk.addParticipant(conversationId, {
        userId: callerId,
        name: callerId,
        preset: presetFor('direct', callType),
      })
    } catch (error) {
      this.logger.warn(`cấp media cho cuộc gọi ${callId} thất bại`, error)
      await this.callBusyStore.release(callerId, callId)
      return callError('MEDIA_UNAVAILABLE', 'Could not start the call')
    }

    const session: CallSession = {
      callId,
      callerId,
      calleeId: peer.peerId,
      conversationId,
      status: 'ringing',
      callType,
      startedAt: Date.now(),
      rtkGrants: [grantOf(grant)],
    }
    await this.callSessionStore.create(session)

    this.emitToUserSockets(
      [session.calleeId],
      SOCKET_EVENTS.CALL.INCOMING_CALL,
      { callId, callerId, conversationId, callType },
    )

    return {
      ok: true,
      callId,
      calleeId: session.calleeId,
      callType,
      authToken: grant.authToken,
    }
  }

  @SubscribeMessage(SOCKET_EVENTS.CALL.CALL_ACCEPTED)
  async handleCallAccepted(
    @MessageBody() data: CallBody | undefined,
    @ConnectedSocket() client: ClientSocket,
  ): Promise<CallAck> {
    const userId = client.data.userId
    if (!userId) {
      return callError('UNAUTHORIZED', 'Unauthorized socket client')
    }

    if (isLegacyCallPayload(data)) {
      return callError('CLIENT_OUTDATED', 'Client is outdated, reload the page')
    }

    const loaded = await this.loadCallSession(data?.callId, userId)
    if (!loaded.ok) return loaded.ack

    const { session } = loaded
    // Chỉ người được gọi mới nghe máy được; người gọi tự "chấp nhận" cuộc gọi
    // của chính mình là vô nghĩa và sẽ làm sai mốc tính thời lượng.
    if (session.calleeId !== userId) {
      return callError('CALL_FORBIDDEN', 'Only the callee can accept a call')
    }

    // Chống hai tab của người nhận cùng bắt máy: chỉ socket thắng claim mới relay
    // answer về người gọi. Tab thua đóng chuông, không tạo phiên WebRTC thứ hai.
    if (!(await this.callSessionStore.claimAccept(session.callId, client.id))) {
      return callError(
        'CALL_CLAIMED',
        'Call already answered on another device',
      )
    }

    // Người nhận phải rảnh (có thể vừa vào cuộc gọi khác giữa lúc đổ chuông).
    if (!(await this.callBusyStore.acquire(userId, session.callId))) {
      return callError('BUSY', 'You are already in a call')
    }

    let grant: RtkGrant & { authToken: string }
    try {
      grant = await this.rtk.addParticipant(session.conversationId, {
        userId,
        name: userId,
        preset: presetFor('direct', session.callType),
      })
    } catch (error) {
      this.logger.warn(
        `cấp media khi nghe máy ${session.callId} thất bại`,
        error,
      )
      await this.callBusyStore.release(userId, session.callId)
      await this.callSessionStore.releaseAccept(session.callId)
      return callError('MEDIA_UNAVAILABLE', 'Could not start the call')
    }

    // Đã kết nối: gia hạn khoá bận của cả hai lên TTL dài.
    await this.callBusyStore.refresh(userId, session.callId)
    await this.callBusyStore.refresh(session.callerId, session.callId)

    await this.callSessionStore.markConnected({
      ...session,
      rtkGrants: [...(session.rtkGrants ?? []), grantOf(grant)],
    })

    // Báo các tab KHÁC của người nhận đóng màn hình chuông. Dùng broadcast để
    // LOẠI TRỪ chính socket vừa bắt máy — nếu không, tab đang nghe cũng nhận
    // claimed rồi tự đóng modal và huỷ luôn cuộc gọi vừa chấp nhận.
    client.broadcast.to(`user:${userId}`).emit(SOCKET_EVENTS.CALL.CLAIMED, {
      callId: session.callId,
    })

    this.emitToUserSockets(
      [session.callerId],
      SOCKET_EVENTS.CALL.CALL_ACCEPTED,
      { callId: session.callId, answererId: userId },
    )

    return { ok: true, callId: session.callId, authToken: grant.authToken }
  }

  @SubscribeMessage(SOCKET_EVENTS.CALL.CALL_REJECTED)
  async handleCallRejected(
    @MessageBody() data: CallBody | undefined,
    @ConnectedSocket() client: ClientSocket,
  ): Promise<CallAck> {
    const userId = client.data.userId
    if (!userId) {
      return callError('UNAUTHORIZED', 'Unauthorized socket client')
    }

    const loaded = await this.loadCallSession(data?.callId, userId)
    if (!loaded.ok) return loaded.ack

    const { session } = loaded
    if (session.calleeId !== userId) {
      return callError('CALL_FORBIDDEN', 'Only the callee can reject a call')
    }

    this.emitToUserSockets(
      [session.callerId],
      SOCKET_EVENTS.CALL.CALL_REJECTED,
      {
        callId: session.callId,
        rejecterId: userId,
      },
    )

    if (await this.callSessionStore.end(session.callId)) {
      this.recordCallOutcome({
        conversationId: session.conversationId,
        callerId: session.callerId,
        calleeId: session.calleeId,
        actorId: userId,
        outcome: 'REJECTED',
        callType: session.callType,
      })
      void this.rtk.revoke(session.rtkGrants ?? [])
    }

    await this.releaseDirectBusy(session)

    return { ok: true, callId: session.callId }
  }

  @SubscribeMessage(SOCKET_EVENTS.CALL.CALL_ENDED)
  async handleCallEnded(
    @MessageBody() data: CallBody | undefined,
    @ConnectedSocket() client: ClientSocket,
  ): Promise<CallAck> {
    const enderId = client.data.userId
    if (!enderId) {
      return callError('UNAUTHORIZED', 'Unauthorized socket client')
    }

    const loaded = await this.loadCallSession(data?.callId, enderId)
    if (!loaded.ok) return loaded.ack

    const { session } = loaded
    const reason = typeof data?.reason === 'string' ? data.reason : ''

    this.emitToUserSockets(
      [CallSessionStore.peerOf(session, enderId)],
      SOCKET_EVENTS.CALL.CALL_ENDED,
      {
        callId: session.callId,
        enderId,
        reason: data?.reason,
      },
    )

    // Mở khoá bận cho cả hai bên (idempotent, an toàn kể cả bên kia đã kết thúc).
    await this.releaseDirectBusy(session)

    // Cả hai bên đều phát `call.ended` khi cúp máy. Trước đây việc chống trùng
    // dựa vào "chỉ bên gọi mới ghi", kéo theo phải tin `callerId` từ client.
    // Giờ chốt là DEL của Redis: đúng một lời gọi nhận được true.
    if (!(await this.callSessionStore.end(session.callId))) {
      return { ok: true, callId: session.callId }
    }

    void this.rtk.revoke(session.rtkGrants ?? [])

    this.recordCallOutcome({
      conversationId: session.conversationId,
      callerId: session.callerId,
      calleeId: session.calleeId,
      actorId: enderId,
      outcome: this.resolveCallOutcome(session, reason),
      callType: session.callType,
      // Thời lượng tính từ mốc nghe máy của server, không lấy con số client gửi
      // lên: đồng hồ ở frontend có thể chạy trước cả khi ICE thông.
      durationSeconds: session.connectedAt
        ? Math.max(0, Math.round((Date.now() - session.connectedAt) / 1000))
        : 0,
    })

    return { ok: true, callId: session.callId }
  }

  private resolveCallOutcome(
    session: CallSession,
    reason: string,
  ): 'COMPLETED' | 'REJECTED' | 'MISSED' | 'UNREACHABLE' {
    if (reason === 'no_answer') return 'MISSED'
    // Frontend gửi lý do này khi ICE hỏng hoặc quá 15 giây ở trạng thái
    // "đang kết nối" — cuộc gọi có tín hiệu nhưng không bao giờ có tiếng.
    if (reason === 'unreachable') return 'UNREACHABLE'
    // Chưa từng nghe máy mà đã kết thúc (người gọi tự huỷ lúc đang đổ chuông)
    // là cuộc gọi nhỡ, không phải cuộc gọi hoàn tất dài 0 giây.
    if (!session.connectedAt) return 'MISSED'
    return 'COMPLETED'
  }

  /**
   * Hand a finished call to the chat service so it lands in the thread.
   *
   * Calls left no trace at all before this: no record of who called, when, or
   * whether it was answered. Published rather than written here — the gateway
   * owns sockets, the chat service owns messages.
   */
  private recordCallOutcome(payload: {
    conversationId?: string
    callerId: string
    calleeId: string
    actorId?: string
    outcome: 'COMPLETED' | 'REJECTED' | 'MISSED' | 'UNREACHABLE'
    callType?: 'audio' | 'video'
    durationSeconds?: number
  }) {
    if (!payload.conversationId) return

    this.publish(ROUTING_RMQ.CALL_ENDED, payload)
  }

  /** Mở khoá bận cho cả người gọi lẫn người nhận của một phiên 1-1. */
  private async releaseDirectBusy(session: CallSession): Promise<void> {
    await this.callBusyStore.release(session.callerId, session.callId)
    await this.callBusyStore.release(session.calleeId, session.callId)
  }

  // ── Gọi nhóm (GROUP) qua Cloudflare RealtimeKit ─────────────────────────
  //
  // Gateway không chuyển tiếp media: nó phân quyền, cấp người tham gia
  // RealtimeKit, và giữ "ai đang trong cuộc" (nguồn sự thật cuối là webhook).

  /**
   * Hỏi một hội thoại nhóm có phòng gọi đang mở không (banner "Tham gia" khi mở
   * hội thoại — mục DISCOVERY của thiết kế). Chỉ thành viên mới hỏi được; server
   * là nguồn sự thật về phòng còn sống (dựa vào phiên Redis, không đoán từ tên).
   */
  @SubscribeMessage(SOCKET_EVENTS.GROUP_CALL.QUERY_STATE)
  async handleGroupCallQueryState(
    @MessageBody() data: CallBody | undefined,
    @ConnectedSocket() client: ClientSocket,
  ): Promise<CallAck> {
    const userId = client.data.userId
    if (!userId) {
      return callError('UNAUTHORIZED', 'Unauthorized socket client')
    }
    const conversationId =
      typeof data?.conversationId === 'string' ? data.conversationId.trim() : ''
    if (!conversationId) {
      return callError('INVALID_PAYLOAD', 'conversationId is required')
    }

    const session =
      await this.groupCallStore.getByConversationId(conversationId)
    if (!session || !GroupCallStore.isMember(session, userId)) {
      return { ok: true, active: null }
    }

    const participants = GroupCallStore.participantList(session)
    if (participants.length === 0) {
      return { ok: true, active: null }
    }

    return {
      ok: true,
      active: {
        callId: session.callId,
        conversationId: session.conversationId,
        roomName: session.roomName,
        callType: session.callType,
        participantCount: participants.length,
      },
    }
  }

  /** Phát `group_call.state` tới mọi thành viên hội thoại đã lưu trong phiên. */
  private emitGroupCallState(session: GroupCallSession) {
    this.emitToUserSockets(
      session.members.map((member) => member.id),
      SOCKET_EVENTS.GROUP_CALL.STATE,
      {
        callId: session.callId,
        conversationId: session.conversationId,
        participants: GroupCallStore.participantList(session),
      },
    )
  }

  /**
   * Mở (hoặc vào lại) phòng gọi nhóm.
   *
   * Chat service chốt quyền: chỉ trả thành viên khi người gọi thuộc hội thoại.
   * Gateway tự tìm người nhận từ danh sách đó rồi đổ chuông — client không tự
   * chỉ định ai nhận được, hệt như đã siết ở cuộc gọi 1-1.
   */
  @SubscribeMessage(SOCKET_EVENTS.GROUP_CALL.START)
  async handleGroupCallStart(
    @MessageBody() data: CallBody | undefined,
    @ConnectedSocket() client: ClientSocket,
  ): Promise<CallAck> {
    const callerId = client.data.userId
    if (!callerId) {
      return callError('UNAUTHORIZED', 'Unauthorized socket client')
    }

    if (isLegacyCallPayload(data)) {
      return callError('CLIENT_OUTDATED', 'Client is outdated, reload the page')
    }

    const conversationId =
      typeof data?.conversationId === 'string' ? data.conversationId.trim() : ''
    if (!conversationId) {
      return callError('INVALID_PAYLOAD', 'conversationId is required')
    }

    const lookup = await fetchCallMembers(conversationId, callerId)
    if (!lookup.ok) {
      return lookup.code === 'FORBIDDEN'
        ? callError('NOT_MEMBER', 'Not a member of this conversation')
        : callError('INTERNAL', 'Could not verify conversation members')
    }

    // Fail-closed: chỉ mở gọi nhóm cho hội thoại GROUP. Chat luôn trả `type`;
    // thiếu type (cấu hình sai/không khớp) cũng bị chặn thay vì cho qua như trước
    // — client tự gửi group_call.start cho DIRECT không còn được cấp phòng.
    if (lookup.type !== 'GROUP') {
      return callError(
        'NOT_GROUP',
        'Group call is only for group conversations',
      )
    }

    if (!this.rtk.isConfigured()) {
      return callError('MEDIA_UNCONFIGURED', 'Calling is not configured')
    }

    const callType: 'audio' | 'video' =
      data?.callType === 'video' ? 'video' : 'audio'
    const callerName =
      lookup.members.find((member) => member.id === callerId)?.username ||
      callerId

    // Phòng đã mở giữ nguyên callType của nó: bấm "video" khi đang có phòng audio
    // sẽ vào phòng audio (không tự nâng cấp) — preset cấp theo session.callType.
    const session = await this.groupCallStore.getOrCreate({
      conversationId,
      startedBy: callerId,
      members: lookup.members,
      callType,
    })

    // Hẹn huỷ nếu không ai vào phòng (35s): chạy cả khi các bước dưới thất bại,
    // để phòng vừa mở không treo lại. participantJoined sẽ huỷ timer.
    this.scheduleGroupPendingCancel(session)

    if (
      !(await this.callBusyStore.acquire(callerId, session.callId, 4 * 60 * 60))
    ) {
      return callError('BUSY', 'You are already in a call')
    }

    let grant: RtkGrant & { authToken: string }
    try {
      grant = await this.rtk.addParticipant(conversationId, {
        userId: callerId,
        name: callerName,
        preset: presetFor('group', session.callType),
      })
    } catch (error) {
      this.logger.warn(
        `cấp media cho cuộc gọi nhóm ${session.callId} thất bại`,
        error,
      )
      await this.callBusyStore.release(callerId, session.callId)
      return callError('MEDIA_UNAVAILABLE', 'Could not start the call')
    }
    await this.groupCallStore.addGrant(conversationId, grantOf(grant))

    this.emitToUserSockets(
      lookup.members
        .filter((member) => member.id !== callerId)
        .map((member) => member.id),
      SOCKET_EVENTS.GROUP_CALL.INCOMING,
      {
        callId: session.callId,
        conversationId,
        roomName: session.roomName,
        callType: session.callType,
        from: { id: callerId, username: callerName },
      },
    )

    return {
      ok: true,
      callId: session.callId,
      roomName: session.roomName,
      callType: session.callType,
      authToken: grant.authToken,
    }
  }

  /**
   * Chấp nhận cuộc gọi nhóm: cấp token vào phòng.
   *
   * Phân quyền dựa vào danh sách thành viên đã lưu lúc mở phòng — người gửi phải
   * thuộc phiên, đúng nguyên tắc "mọi sự kiện sau đổ chuông chỉ mang callId".
   */
  @SubscribeMessage(SOCKET_EVENTS.GROUP_CALL.ACCEPT)
  async handleGroupCallAccept(
    @MessageBody() data: CallBody | undefined,
    @ConnectedSocket() client: ClientSocket,
  ): Promise<CallAck> {
    const userId = client.data.userId
    if (!userId) {
      return callError('UNAUTHORIZED', 'Unauthorized socket client')
    }

    if (isLegacyCallPayload(data)) {
      return callError('CLIENT_OUTDATED', 'Client is outdated, reload the page')
    }

    if (!isGroupCallId(data?.callId)) {
      return callError('INVALID_PAYLOAD', 'callId is required')
    }

    const session = await this.groupCallStore.getByCallId(data.callId)
    if (!session) {
      return callError('CALL_NOT_FOUND', 'Group call no longer exists')
    }

    if (!GroupCallStore.isMember(session, userId)) {
      return callError('NOT_MEMBER', 'Not a member of this conversation')
    }

    // Revalidate quyền HIỆN TẠI thay vì tin snapshot lúc mở phòng: người đã bị
    // loại khỏi nhóm sau khi phòng mở không được dùng token của phiên cũ để vào.
    const current = await fetchCallMembers(session.conversationId, userId)
    if (
      !current.ok ||
      !current.members.some((member) => member.id === userId)
    ) {
      return callError('NOT_MEMBER', 'No longer a member of this conversation')
    }

    // Người nhận phải rảnh (không kẹt cuộc gọi khác).
    if (
      !(await this.callBusyStore.acquire(userId, session.callId, 4 * 60 * 60))
    ) {
      return callError('BUSY', 'You are already in a call')
    }

    const username =
      session.members.find((member) => member.id === userId)?.username || userId

    let grant: RtkGrant & { authToken: string }
    try {
      grant = await this.rtk.addParticipant(session.conversationId, {
        userId,
        name: username,
        preset: presetFor('group', session.callType),
      })
    } catch (error) {
      this.logger.warn(
        `cấp media khi vào nhóm ${session.callId} thất bại`,
        error,
      )
      await this.callBusyStore.release(userId, session.callId)
      return callError('MEDIA_UNAVAILABLE', 'Could not join the call')
    }
    await this.groupCallStore.addGrant(session.conversationId, grantOf(grant))

    return {
      ok: true,
      callType: session.callType,
      authToken: grant.authToken,
    }
  }

  /**
   * Từ chối cuộc gọi nhóm. Không kết thúc phòng (người khác vẫn có thể nói) —
   * chỉ phát lại state để các client đồng bộ danh sách người đang trong cuộc.
   */
  @SubscribeMessage(SOCKET_EVENTS.GROUP_CALL.DECLINE)
  async handleGroupCallDecline(
    @MessageBody() data: CallBody | undefined,
    @ConnectedSocket() client: ClientSocket,
  ): Promise<CallAck> {
    const userId = client.data.userId
    if (!userId) {
      return callError('UNAUTHORIZED', 'Unauthorized socket client')
    }

    if (!isGroupCallId(data?.callId)) {
      return callError('INVALID_PAYLOAD', 'callId is required')
    }

    const session = await this.groupCallStore.getByCallId(data.callId)
    if (!session || !GroupCallStore.isMember(session, userId)) {
      return { ok: true }
    }

    this.emitGroupCallState(session)
    return { ok: true }
  }

  /**
   * Rời phòng gọi nhóm. Client tự rời phòng RealtimeKit; đây chỉ là cập nhật lạc
   * quan — webhook `participantLeft` mới là nguồn sự thật cuối và cũng idempotent.
   */
  @SubscribeMessage(SOCKET_EVENTS.GROUP_CALL.LEAVE)
  async handleGroupCallLeave(
    @MessageBody() data: CallBody | undefined,
    @ConnectedSocket() client: ClientSocket,
  ): Promise<CallAck> {
    const userId = client.data.userId
    if (!userId) {
      return callError('UNAUTHORIZED', 'Unauthorized socket client')
    }

    if (!isGroupCallId(data?.callId)) {
      return callError('INVALID_PAYLOAD', 'callId is required')
    }

    const session = await this.groupCallStore.getByCallId(data.callId)
    if (!session || !GroupCallStore.isMember(session, userId)) {
      return { ok: true }
    }

    const updated = await this.groupCallStore.removeParticipant(
      session.conversationId,
      userId,
    )
    if (updated) {
      this.emitGroupCallState(updated)
      if (GroupCallStore.participantList(updated).length === 0) {
        this.scheduleGroupEmptyFinish(updated)
      }
    }

    await this.callBusyStore.release(userId, session.callId)

    return { ok: true }
  }

  // ── Webhook RealtimeKit (controller đã xác thực chữ ký) ─────────────────

  /**
   * Áp một sự kiện webhook RealtimeKit vào phiên gọi nhóm. Chỉ phòng của cuộc gọi
   * NHÓM đang mở mới được xử lý: phòng 1-1 có vòng đời riêng qua socket, phòng lạ
   * thì bỏ qua. `customParticipantId` phải thuộc danh sách thành viên của phiên.
   */
  async applyRtkWebhook(event: RtkWebhookEvent): Promise<void> {
    const conversationId = await this.rtk.conversationOfMeeting(event.meetingId)
    if (!conversationId) return
    const session =
      await this.groupCallStore.getByConversationId(conversationId)
    if (!session) return

    switch (event.event) {
      case 'meeting.participantJoined': {
        const member = this.memberOf(session, event.customParticipantId)
        if (!member) return
        const updated = await this.groupCallStore.addParticipant(
          conversationId,
          member,
        )
        if (!updated) return
        this.clearGroupPending(session.callId)
        this.clearGroupEmpty(session.callId)
        this.emitGroupCallState(updated)
        return
      }
      case 'meeting.participantLeft': {
        const member = this.memberOf(session, event.customParticipantId)
        if (!member) return
        const updated = await this.groupCallStore.removeParticipant(
          conversationId,
          member.id,
        )
        if (!updated) return
        this.emitGroupCallState(updated)
        if (GroupCallStore.participantList(updated).length === 0) {
          this.scheduleGroupEmptyFinish(updated)
        }
        return
      }
      case 'meeting.ended': {
        await this.finishGroupCall(conversationId)
        return
      }
      default:
        return
    }
  }

  private memberOf(
    session: GroupCallSession,
    customParticipantId?: string,
  ): GroupCallMember | null {
    const userId = userIdFromCustomId(customParticipantId)
    if (!userId) return null
    return session.members.find((member) => member.id === userId) ?? null
  }

  /**
   * Kết thúc cuộc gọi nhóm: ghi tin tổng kết, mở khoá bận, báo `group_call.ended`,
   * thu hồi media. `finish()` là latch — bộ đếm phòng trống và `meeting.ended` có
   * thể cùng tới, chỉ lần đầu làm việc.
   */
  private async finishGroupCall(conversationId: string): Promise<void> {
    const session = await this.groupCallStore.finish(conversationId)
    if (!session) return

    this.clearGroupPending(session.callId)
    this.clearGroupEmpty(session.callId)

    const durationSeconds = Math.max(
      0,
      Math.round((Date.now() - session.startedAt) / 1000),
    )

    await postGroupCallLog({
      conversationId,
      participantCount: session.seen.length,
      durationSeconds,
      callId: session.callId,
      callType: session.callType,
      startedBy: session.startedBy,
    })

    for (const uid of session.seen) {
      await this.callBusyStore.release(uid, session.callId)
    }

    this.emitToUserSockets(
      session.members.map((member) => member.id),
      SOCKET_EVENTS.GROUP_CALL.ENDED,
      { callId: session.callId, conversationId },
    )

    void this.rtk.revoke(session.rtkGrants)
  }

  private scheduleGroupEmptyFinish(session: GroupCallSession): void {
    this.clearGroupEmpty(session.callId)
    const timer = setTimeout(() => {
      this.groupEmptyTimers.delete(session.callId)
      void (async () => {
        const current = await this.groupCallStore.getByCallId(session.callId)
        if (!current) return
        if (GroupCallStore.participantList(current).length > 0) return
        await this.finishGroupCall(session.conversationId)
      })().catch((error: unknown) =>
        this.logger.error(`kết thúc phòng trống ${session.callId} lỗi`, error),
      )
    }, this.groupEmptyMs)
    if (typeof timer.unref === 'function') timer.unref()
    this.groupEmptyTimers.set(session.callId, timer)
  }

  private clearGroupEmpty(callId: string): void {
    const timer = this.groupEmptyTimers.get(callId)
    if (timer) clearTimeout(timer)
    this.groupEmptyTimers.delete(callId)
  }

  // ── Hẹn huỷ phòng nhóm chưa ai vào ───────────────────────────────────────

  private scheduleGroupPendingCancel(session: GroupCallSession): void {
    const existing = this.groupPendingTimers.get(session.callId)
    if (existing) clearTimeout(existing)
    const timer = setTimeout(() => {
      this.cancelGroupIfEmpty(session.conversationId, session.callId).catch(
        () => undefined,
      )
    }, this.groupPendingMs)
    // Không giữ process sống chỉ vì timer này.
    if (typeof timer.unref === 'function') timer.unref()
    this.groupPendingTimers.set(session.callId, timer)
  }

  private clearGroupPending(callId: string): void {
    const timer = this.groupPendingTimers.get(callId)
    if (timer) clearTimeout(timer)
    this.groupPendingTimers.delete(callId)
  }

  /**
   * Sau deadline: nếu vẫn chưa ai thực sự vào phòng (không có participant từ
   * webhook), huỷ phiên và báo `ended` để tắt chuông. Không ghi log (0 người =
   * không phải một cuộc gọi đã diễn ra).
   */
  private async cancelGroupIfEmpty(
    conversationId: string,
    callId: string,
  ): Promise<void> {
    this.groupPendingTimers.delete(callId)
    const session = await this.groupCallStore.getByCallId(callId)
    if (!session) return
    if (GroupCallStore.participantList(session).length > 0) return

    await this.groupCallStore.delete(conversationId)
    void this.rtk.revoke(session.rtkGrants)
    await this.callBusyStore.release(session.startedBy, session.callId)
    for (const uid of session.seen) {
      await this.callBusyStore.release(uid, session.callId)
    }

    this.emitToUserSockets(
      session.members.map((member) => member.id),
      SOCKET_EVENTS.GROUP_CALL.ENDED,
      { callId: session.callId, conversationId, reason: 'no_answer' },
    )
  }
}
