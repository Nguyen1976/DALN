import { Server, Socket } from 'socket.io'
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
import { Inject, Injectable } from '@nestjs/common'
import { SOCKET_EVENTS } from 'libs/constant/websocket/socket.events'
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq'
import { publishEvent, RabbitSubscribeWithRetry } from '@app/common/rmq'
import { EXCHANGE_RMQ } from 'libs/constant/rmq/exchange'
import { QUEUE_RMQ } from 'libs/constant/rmq/queue'
import { ROUTING_RMQ } from 'libs/constant/rmq/routing'
import { UserStatusStore } from './user-status.store'
import type { EmitToUserPayload } from 'libs/constant/rmq/payload'
import * as cookie from 'cookie'
import { resolveTokens } from '@app/common'
import { randomUUID } from 'crypto'
import { buildIceConfig } from './turn-credentials'
import { CallSession, CallSessionStore, isCallId } from './call-session.store'
import { CallBusyStore } from './call-busy.store'
import { fetchCallPeer } from './chat-call-peer.client'
import {
  conversationIdFromRoom,
  GroupCallMember,
  GroupCallSession,
  GroupCallStore,
  isGroupCallId,
} from './group-call.store'
import { fetchCallMembers, postGroupCallLog } from './chat-call-members.client'
import {
  buildGroupCallToken,
  getLivekitUrl,
  isLivekitConfigured,
} from './livekit-token'

/** Ack trả về cho client ở các sự kiện `call.*`. */
type CallAck =
  | ({ ok: true } & Record<string, unknown>)
  | { ok: false; code: string; message: string }

function callError(code: string, message: string): CallAck {
  return { ok: false, code, message }
}

//nếu k đặt tên cổng thì nó sẽ trùng với cổng của http
@Injectable()
@WebSocketGateway({
  cors: {
    origin: '*',
  },
  namespace: 'realtime',
  credentials: true,
  pingInterval: 40000,
  pingTimeout: 10000,
})
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server

  private userStatusStore: UserStatusStore
  private callSessionStore: CallSessionStore
  private groupCallStore: GroupCallStore
  private callBusyStore: CallBusyStore
  /** Hẹn huỷ phòng nhóm chưa ai vào (theo callId). Chỉ sống trong process này. */
  private readonly groupPendingTimers = new Map<string, NodeJS.Timeout>()
  private readonly groupPendingMs = 35000
  // Không còn timer 25s cho mỗi socket: `pong` của Socket.IO (pingInterval
  // 40s, pingTimeout 10s -> tối đa 50s giữa hai lần) đã gia hạn TTL 90s của
  // key socket, dư 1,8 lần biên an toàn. Timer server-side còn có hại: nó gia
  // hạn cho cả kết nối đã chết, kéo dài trạng thái online giả.
  private readonly packetListeners = new Map<string, (packet: any) => void>()
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
    client: Socket,
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

  private forceStopAllTypingForSocket(client: Socket, userId: string) {
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
    client: Socket,
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
    private redisClient: any,
    private readonly amqpConnection: AmqpConnection,
  ) {
    this.userStatusStore = new UserStatusStore(this.redisClient)
    this.callSessionStore = new CallSessionStore(this.redisClient)
    this.groupCallStore = new GroupCallStore(this.redisClient)
    this.callBusyStore = new CallBusyStore(this.redisClient)
  }

  //default function
  async handleConnection(client: Socket) {
    try {
      const rawCookie = client.handshake.headers.cookie
      const parsed = rawCookie ? cookie.parse(rawCookie) : {}

      // Dùng CHUNG hàm phân giải với AuthGuard. Trước đây chỗ này chỉ verify
      // accessToken và không đụng tới refreshToken — dù nó nằm sẵn trong cùng
      // handshake header. Access hết hạn (tab mở > 15 phút) là socket bị ngắt,
      // mà Socket.IO KHÔNG tự nối lại sau `io server disconnect`, nên realtime
      // chết hẳn tới khi người dùng tải lại trang.
      //
      // Socket là kết nối dài hạn nên chấp nhận cả refreshToken là hợp lý: nó
      // vốn đã được trình duyệt gửi kèm mọi request (cookie path=/), nên không
      // hề mở rộng bề mặt lộ lọt.
      const resolved = resolveTokens(
        this.jwtService,
        parsed.accessToken,
        parsed.refreshToken,
      )

      if (!resolved.ok || !resolved.payload?.userId) {
        this.rejectConnection(
          client,
          resolved.ok ? 'TOKEN_INVALID' : resolved.code,
        )
        return
      }

      const userId = resolved.payload.userId
      client.data.userId = userId

      const prevOnline = await this.userStatusStore.isOnline(userId)

      // 🔥 Join room theo user
      client.join(`user:${userId}`)

      // 🔥 Lưu Redis + TTL
      await this.userStatusStore.addConnection(userId, client.id)

      const packetListener = async (packet) => {
        if (packet.type === 'pong') {
          await this.userStatusStore.touchConnection(userId, client.id)
        }
      }

      client.conn.on('packet', packetListener)
      this.packetListeners.set(client.id, packetListener)

      if (!prevOnline) {
        //delete lastSeen vì user đã online trở lại
        await this.redisClient.del(`user:${userId}:lastSeen`)

        publishEvent(
          this.amqpConnection,
          EXCHANGE_RMQ.REALTIME_EVENTS,
          ROUTING_RMQ.USER_ONLINE,
          { userId },
        )
      }
    } catch {
      client.disconnect()
    }
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
  private rejectConnection(client: Socket, code: string) {
    try {
      client.emit(SOCKET_EVENTS.AUTH.ERROR, { code })
    } catch {
      /* socket có thể đã đứt — không có gì để làm thêm */
    }
    // Cho event kịp gửi trước khi đóng transport.
    setTimeout(() => client.disconnect(true), 50)
  }

  async handleDisconnect(client: Socket) {
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
      const lastSeen = new Date().toISOString()
      await this.redisClient.set(
        `user:${userId}:lastSeen`,
        lastSeen,
        'EX',
        60 * 60 * 24 * 7,
      ) // lưu lastSeen trong 7 ngày

      publishEvent(
        this.amqpConnection,
        EXCHANGE_RMQ.REALTIME_EVENTS,
        ROUTING_RMQ.USER_OFFLINE,
        { userId, lastSeen },
      )
    }
  }

  @SubscribeMessage('pong')
  async handleHeartbeat(@ConnectedSocket() client: Socket) {
    const userId = client.data.userId
    if (!userId) return
    await this.userStatusStore.touchConnection(userId, client.id)
  }

  /**
   * Khi người dùng vào xem một conversation, join room để nhận typing/read events
   */
  @SubscribeMessage('conversation:join')
  async handleJoinConversation(
    @MessageBody() data: any,
    @ConnectedSocket() client: Socket,
  ) {
    const { conversationId } = data
    if (!conversationId) return

    client.join(`conversation:${conversationId}`)
  }

  /**
   * Khi người dùng rời khỏi conversation
   */
  @SubscribeMessage('conversation:leave')
  async handleLeaveConversation(
    @MessageBody() data: any,
    @ConnectedSocket() client: Socket,
  ) {
    const userId = client.data.userId
    const { conversationId } = data
    if (!conversationId || !userId) return

    const typingConversations = this.typingConversationsBySocket.get(client.id)
    if (typingConversations?.has(conversationId)) {
      this.emitTypingStopToRoom(client, userId, conversationId)
      typingConversations.delete(conversationId)

      if (typingConversations.size === 0) {
        this.typingConversationsBySocket.delete(client.id)
      }
    }

    client.leave(`conversation:${conversationId}`)
  }

  async checkUserOnline(userId: string): Promise<boolean> {
    return this.userStatusStore.isOnline(userId)
  }

  @RabbitSubscribeWithRetry({
    exchange: EXCHANGE_RMQ.REALTIME_EVENTS,
    routingKey: ROUTING_RMQ.EMIT_REALTIME_EVENT,
    queue: QUEUE_RMQ.REALTIME_EMIT_EVENT,
  })
  async emitToUser({ userIds, event, data }: EmitToUserPayload) {
    for (const userId of userIds) {
      this.server.to(`user:${userId}`).emit(event, data)
    }
  }

  @SubscribeMessage(SOCKET_EVENTS.CHAT.MESSAGE_CREATE)
  async handleCreateMessage(
    @MessageBody() data: any,
    @ConnectedSocket() client: Socket,
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

    publishEvent(
      this.amqpConnection,
      EXCHANGE_RMQ.REALTIME_EVENTS,
      ROUTING_RMQ.SEND_MESSAGE,
      {
        conversationId: data.conversationId,
        senderId: client.data.userId,
        text: data.content,
        replyToMessageId: data.replyToMessageId,
        tempMessageId: data.clientMessageId,
        clientMessageId: data.clientMessageId,
        type: data.type,
        medias: data.media || data.medias || [],
      },
    )
  }

  /**
   * TYPING INDICATOR
   * Khi người dùng gõ, emit typing event với { conversationId, status: 'start' | 'stop' }
   * Broadcast tới các thành viên khác trong room
   */
  @SubscribeMessage(SOCKET_EVENTS.CHAT.USER_TYPING)
  async handleUserTyping(
    @MessageBody() data: any,
    @ConnectedSocket() client: Socket,
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

    const { conversationId, status } = data
    if (!conversationId || !status || !['start', 'stop'].includes(status)) {
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
  async handleMessageRead(
    @MessageBody() data: any,
    @ConnectedSocket() client: Socket,
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

    const { conversationId, lastMessageId } = data
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
    publishEvent(
      this.amqpConnection,
      EXCHANGE_RMQ.REALTIME_EVENTS,
      ROUTING_RMQ.UPDATE_MESSAGE_READ,
      {
        conversationId,
        userId,
        lastReadMessageId: lastMessageId,
      },
    )
  }

  private emitToUserSockets(
    userIds: string[],
    event: string,
    data: Record<string, unknown>,
  ) {
    for (const userId of userIds) {
      this.server.to(`user:${userId}`).emit(event, data)
    }
  }

  /**
   * Cấp STUN/TURN cho trình duyệt ngay trước khi gọi.
   *
   * Trả qua ack chứ không broadcast: mật khẩu TURN gắn với một người dùng và
   * chỉ sống một giờ, không có lý do gì để nó đi tới socket khác.
   */
  @SubscribeMessage(SOCKET_EVENTS.CALL.ICE_CONFIG)
  async handleIceConfig(@ConnectedSocket() client: Socket): Promise<CallAck> {
    const userId = client.data.userId
    if (!userId) {
      return callError('UNAUTHORIZED', 'Unauthorized socket client')
    }

    return { ok: true, ...buildIceConfig(userId) }
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
    @MessageBody() data: any,
    @ConnectedSocket() client: Socket,
  ): Promise<CallAck> {
    const callerId = client.data.userId
    if (!callerId) {
      return callError('UNAUTHORIZED', 'Unauthorized socket client')
    }

    const offer = data?.offer
    const conversationId =
      typeof data?.conversationId === 'string' ? data.conversationId.trim() : ''

    if (!offer || !conversationId) {
      return callError(
        'INVALID_PAYLOAD',
        'offer and conversationId are required',
      )
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

    // Mặc định audio để tương thích client cũ chưa gửi callType. cameraEnabled là
    // trạng thái từng người, không đổi callType (một người tắt camera ≠ audio call).
    const callType = data?.callType === 'video' ? 'video' : 'audio'

    const session: CallSession = {
      callId: randomUUID(),
      callerId,
      calleeId: peer.peerId,
      conversationId,
      status: 'ringing',
      callType,
      startedAt: Date.now(),
    }

    // Busy: người gọi phải đang rảnh, và người nhận không kẹt cuộc gọi khác.
    // Chốt ở server để nhiều tab / cuộc gọi chồng chéo không tranh phiên.
    if (!(await this.callBusyStore.acquire(callerId, session.callId))) {
      return callError('BUSY', 'You are already in a call')
    }
    if (await this.callBusyStore.isBusy(session.calleeId, session.callId)) {
      await this.callBusyStore.release(callerId, session.callId)
      return callError('CALLEE_BUSY', 'The other person is in another call')
    }

    await this.callSessionStore.create(session)

    this.emitToUserSockets(
      [session.calleeId],
      SOCKET_EVENTS.CALL.INCOMING_CALL,
      {
        callId: session.callId,
        callerId,
        conversationId,
        callType,
        offer,
      },
    )

    return {
      ok: true,
      callId: session.callId,
      calleeId: session.calleeId,
      callType,
    }
  }

  @SubscribeMessage(SOCKET_EVENTS.CALL.CALL_ACCEPTED)
  async handleCallAccepted(
    @MessageBody() data: any,
    @ConnectedSocket() client: Socket,
  ): Promise<CallAck> {
    const userId = client.data.userId
    if (!userId) {
      return callError('UNAUTHORIZED', 'Unauthorized socket client')
    }

    if (!data?.answer) {
      return callError('INVALID_PAYLOAD', 'answer is required')
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
    // Đã kết nối: gia hạn khoá bận của cả hai lên TTL dài.
    await this.callBusyStore.refresh(userId, session.callId)
    await this.callBusyStore.refresh(session.callerId, session.callId)

    await this.callSessionStore.markConnected(session)

    // Báo các tab KHÁC của người nhận đóng màn hình chuông. Dùng broadcast để
    // LOẠI TRỪ chính socket vừa bắt máy — nếu không, tab đang nghe cũng nhận
    // claimed rồi tự đóng modal và huỷ luôn cuộc gọi vừa chấp nhận.
    client.broadcast.to(`user:${userId}`).emit(SOCKET_EVENTS.CALL.CLAIMED, {
      callId: session.callId,
    })

    this.emitToUserSockets(
      [session.callerId],
      SOCKET_EVENTS.CALL.CALL_ACCEPTED,
      {
        callId: session.callId,
        answer: data.answer,
        answererId: userId,
      },
    )

    return { ok: true, callId: session.callId }
  }

  @SubscribeMessage(SOCKET_EVENTS.CALL.CALL_REJECTED)
  async handleCallRejected(
    @MessageBody() data: any,
    @ConnectedSocket() client: Socket,
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
    }

    await this.releaseDirectBusy(session)

    return { ok: true, callId: session.callId }
  }

  @SubscribeMessage(SOCKET_EVENTS.CALL.CALL_ENDED)
  async handleCallEnded(
    @MessageBody() data: any,
    @ConnectedSocket() client: Socket,
  ): Promise<CallAck> {
    const enderId = client.data.userId
    if (!enderId) {
      return callError('UNAUTHORIZED', 'Unauthorized socket client')
    }

    const loaded = await this.loadCallSession(data?.callId, enderId)
    if (!loaded.ok) return loaded.ack

    const { session } = loaded
    const reason = String(data?.reason || '')

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

    publishEvent(
      this.amqpConnection,
      EXCHANGE_RMQ.REALTIME_EVENTS,
      ROUTING_RMQ.CALL_ENDED,
      payload,
    )
  }

  /** Mở khoá bận cho cả người gọi lẫn người nhận của một phiên 1-1. */
  private async releaseDirectBusy(session: CallSession): Promise<void> {
    await this.callBusyStore.release(session.callerId, session.callId)
    await this.callBusyStore.release(session.calleeId, session.callId)
  }

  @SubscribeMessage(SOCKET_EVENTS.CALL.ICE_CANDIDATE)
  async handleIceCandidate(
    @MessageBody() data: any,
    @ConnectedSocket() client: Socket,
  ): Promise<CallAck> {
    const senderId = client.data.userId
    if (!senderId) {
      return callError('UNAUTHORIZED', 'Unauthorized socket client')
    }

    if (!data?.candidate) {
      return callError('INVALID_PAYLOAD', 'candidate is required')
    }

    const loaded = await this.loadCallSession(data?.callId, senderId)
    if (!loaded.ok) return loaded.ack

    const { session } = loaded

    // Chuyển tiếp ICE candidate cho đối phương của đúng phiên này.
    this.emitToUserSockets(
      [CallSessionStore.peerOf(session, senderId)],
      SOCKET_EVENTS.CALL.ICE_CANDIDATE,
      {
        callId: session.callId,
        senderId,
        candidate: data.candidate,
      },
    )

    return { ok: true, callId: session.callId }
  }

  /**
   * Chuyển tiếp trạng thái camera/micro của một bên cho bên kia (1-1). Đây là
   * NGUỒN SỰ THẬT để hiển thị avatar/khung video, thay vì dựa vào sự kiện `mute`
   * của RTP track (replaceTrack(null) không phát `mute` đáng tin) — khiến bên kia
   * thấy khung hình đứng hình khi tắt camera.
   */
  @SubscribeMessage(SOCKET_EVENTS.CALL.MEDIA_STATE)
  async handleCallMediaState(
    @MessageBody() data: any,
    @ConnectedSocket() client: Socket,
  ): Promise<CallAck> {
    const senderId = client.data.userId
    if (!senderId) {
      return callError('UNAUTHORIZED', 'Unauthorized socket client')
    }

    const loaded = await this.loadCallSession(data?.callId, senderId)
    if (!loaded.ok) return loaded.ack

    const { session } = loaded

    this.emitToUserSockets(
      [CallSessionStore.peerOf(session, senderId)],
      SOCKET_EVENTS.CALL.MEDIA_STATE,
      {
        callId: session.callId,
        senderId,
        cameraEnabled: data?.cameraEnabled === true,
        micEnabled: data?.micEnabled !== false,
      },
    )

    return { ok: true, callId: session.callId }
  }

  // ── Gọi nhóm (GROUP) qua SFU LiveKit ────────────────────────────────────
  //
  // Song song với cụm CALL.* 1-1 ở trên nhưng khác bản chất: LiveKit làm SFU nên
  // gateway không chuyển tiếp SDP/ICE — nó chỉ phân quyền, ký token vào phòng, và
  // giữ trạng thái "ai đang trong cuộc" (nguồn sự thật cuối là webhook LiveKit).

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
    @MessageBody() data: any,
    @ConnectedSocket() client: Socket,
  ): Promise<CallAck> {
    const callerId = client.data.userId
    if (!callerId) {
      return callError('UNAUTHORIZED', 'Unauthorized socket client')
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

    // Kiểm cấu hình LiveKit trước khi tạo phiên, để không để lại phòng mồ côi khi
    // chưa dựng LiveKit (buildGroupCallToken sẽ không null nếu đã cấu hình).
    if (!isLivekitConfigured()) {
      return callError(
        'LIVEKIT_UNCONFIGURED',
        'Group calling is not configured',
      )
    }

    const callType: 'audio' | 'video' =
      data?.callType === 'video' ? 'video' : 'audio'
    const callerName =
      lookup.members.find((member) => member.id === callerId)?.username ||
      callerId

    // Phòng đã mở giữ nguyên callType của nó: bấm "video" khi đang có phòng audio
    // sẽ vào phòng audio (không tự nâng cấp) — token cấp theo session.callType.
    const session = await this.groupCallStore.getOrCreate({
      conversationId,
      startedBy: callerId,
      members: lookup.members,
      callType,
    })

    const token = await buildGroupCallToken({
      userId: callerId,
      username: callerName,
      roomName: session.roomName,
      callType: session.callType,
    })
    if (!token) {
      return callError(
        'LIVEKIT_UNCONFIGURED',
        'Group calling is not configured',
      )
    }

    // Hẹn huỷ nếu không ai vào phòng: phòng nhóm tạo TRƯỚC khi có ai connect
    // LiveKit, nên nếu tất cả bỏ chuông sẽ không có room_finished — timer này dọn
    // phiên treo (và chuông) sau ~35s. participant_joined sẽ huỷ timer.
    this.scheduleGroupPendingCancel(session)

    // Người gọi phải rảnh; đang kẹt cuộc khác thì không đổ chuông (phòng vừa mở
    // sẽ tự huỷ theo timer trên). Idempotent khi mở lại chính phòng này.
    if (
      !(await this.callBusyStore.acquire(callerId, session.callId, 4 * 60 * 60))
    ) {
      return callError('BUSY', 'You are already in a call')
    }

    // Đổ chuông các thành viên khác. Ai offline thì room `user:<id>` rỗng nên
    // emit là no-op — không cần lọc trước.
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
      url: getLivekitUrl(),
      token,
      // coturn làm TURN cho LiveKit (thiết kế mục 04 ①) — xem group_call.accept.
      iceServers: buildIceConfig(callerId).iceServers,
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
    @MessageBody() data: any,
    @ConnectedSocket() client: Socket,
  ): Promise<CallAck> {
    const userId = client.data.userId
    if (!userId) {
      return callError('UNAUTHORIZED', 'Unauthorized socket client')
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

    const token = await buildGroupCallToken({
      userId,
      username,
      roomName: session.roomName,
      callType: session.callType,
    })
    if (!token) {
      return callError(
        'LIVEKIT_UNCONFIGURED',
        'Group calling is not configured',
      )
    }

    return {
      ok: true,
      url: getLivekitUrl(),
      token,
      callType: session.callType,
      // coturn làm TURN cho LiveKit (thiết kế mục 04 ①): client sau NAT chặt/UDP
      // bị chặn vẫn tới được SFU qua relay. Additive — không ép relay, đường trực
      // tiếp vẫn ưu tiên.
      iceServers: buildIceConfig(userId).iceServers,
    }
  }

  /**
   * Từ chối cuộc gọi nhóm. Không kết thúc phòng (người khác vẫn có thể nói) —
   * chỉ phát lại state để các client đồng bộ danh sách người đang trong cuộc.
   */
  @SubscribeMessage(SOCKET_EVENTS.GROUP_CALL.DECLINE)
  async handleGroupCallDecline(
    @MessageBody() data: any,
    @ConnectedSocket() client: Socket,
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
   * Rời phòng gọi nhóm. Client tự ngắt khỏi LiveKit; đây chỉ là cập nhật lạc
   * quan — webhook `participant_left` mới là nguồn sự thật cuối và cũng idempotent.
   */
  @SubscribeMessage(SOCKET_EVENTS.GROUP_CALL.LEAVE)
  async handleGroupCallLeave(
    @MessageBody() data: any,
    @ConnectedSocket() client: Socket,
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
    if (updated) this.emitGroupCallState(updated)

    await this.callBusyStore.release(userId, session.callId)

    return { ok: true }
  }

  // ── Webhook LiveKit (gọi từ controller sau khi verify chữ ký) ────────────

  /**
   * Áp một sự kiện webhook LiveKit vào phiên. Controller đã verify chữ ký; ở đây
   * chỉ còn xử lý nghiệp vụ. Nhận dạng cấu trúc (không phụ thuộc kiểu của SDK) để
   * gateway không phải import livekit-server-sdk.
   */
  async applyLivekitWebhook(event: {
    event?: string
    room?: { name?: string; numParticipants?: number }
    participant?: { identity?: string; name?: string }
  }): Promise<void> {
    const roomName = event?.room?.name
    if (!roomName) return

    switch (event.event) {
      case 'participant_joined': {
        const identity = event.participant?.identity
        if (!identity) return
        await this.handleGroupParticipantJoined(roomName, {
          id: identity,
          username: event.participant?.name || identity,
        })
        return
      }
      case 'participant_left': {
        const identity = event.participant?.identity
        if (!identity) return
        await this.handleGroupParticipantLeft(roomName, identity)
        return
      }
      case 'room_finished': {
        await this.handleGroupRoomFinished(roomName)
        return
      }
      default:
        return
    }
  }

  private async handleGroupParticipantJoined(
    roomName: string,
    member: GroupCallMember,
  ): Promise<void> {
    const conversationId = conversationIdFromRoom(roomName)
    if (!conversationId) return

    const session = await this.groupCallStore.addParticipant(
      conversationId,
      member,
    )
    if (session) {
      // Có người vào thật -> phòng không còn "treo chưa ai vào", huỷ timer huỷ-phiên.
      this.clearGroupPending(session.callId)
      this.emitGroupCallState(session)
    }
  }

  private async handleGroupParticipantLeft(
    roomName: string,
    userId: string,
  ): Promise<void> {
    const conversationId = conversationIdFromRoom(roomName)
    if (!conversationId) return

    const session = await this.groupCallStore.removeParticipant(
      conversationId,
      userId,
    )
    if (session) this.emitGroupCallState(session)
  }

  /**
   * Phòng đóng: ghi tin hệ thống tổng kết, báo `group_call.ended`, dọn phiên.
   * `participantCount` = số người từng vào (không phải số còn lại lúc đóng, vốn 0).
   */
  private async handleGroupRoomFinished(roomName: string): Promise<void> {
    const conversationId = conversationIdFromRoom(roomName)
    if (!conversationId) return

    // finish() đóng phiên đúng MỘT lần và dọn sạch key: webhook room_finished tới
    // trùng/đảo thứ tự thì lần sau trả null -> không ghi log nhóm hai lần.
    const session = await this.groupCallStore.finish(conversationId)
    if (!session) return

    this.clearGroupPending(session.callId)

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
    })

    // Mở khoá bận cho mọi người từng vào phòng.
    for (const uid of session.seen) {
      await this.callBusyStore.release(uid, session.callId)
    }

    this.emitToUserSockets(
      session.members.map((member) => member.id),
      SOCKET_EVENTS.GROUP_CALL.ENDED,
      { callId: session.callId, conversationId },
    )
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
