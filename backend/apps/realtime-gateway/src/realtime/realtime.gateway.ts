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
import { AmqpConnection, RabbitSubscribe } from '@golevelup/nestjs-rabbitmq'
import { EXCHANGE_RMQ } from 'libs/constant/rmq/exchange'
import { QUEUE_RMQ } from 'libs/constant/rmq/queue'
import { ROUTING_RMQ } from 'libs/constant/rmq/routing'
import { UserStatusStore } from './user-status.store'
import type { EmitToUserPayload } from 'libs/constant/rmq/payload'
import * as cookie from 'cookie'
import { resolveTokens } from '@app/common'

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
        this.rejectConnection(client, resolved.ok ? 'TOKEN_INVALID' : resolved.code)
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

        this.amqpConnection.publish(
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

      this.amqpConnection.publish(
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

  @RabbitSubscribe({
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

    this.amqpConnection.publish(
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
    this.amqpConnection.publish(
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

  @SubscribeMessage(SOCKET_EVENTS.CALL.INCOMING_CALL)
  async handleIncomingCall(
    @MessageBody() data: any,
    @ConnectedSocket() client: Socket,
  ) {
    const callerId = client.data.userId
    const offer = data?.offer
    const targetUserId = data?.targetUserId
    const conversationId = data?.conversationId

    if (!callerId || !offer || !targetUserId) {
      client.emit(SOCKET_EVENTS.CHAT.MESSAGE_ERROR, {
        code: 'INVALID_PAYLOAD',
        message: 'callerId, offer, and targetUserId are required',
        retryable: false,
      })
      return
    }

    this.emitToUserSockets([targetUserId], SOCKET_EVENTS.CALL.INCOMING_CALL, {
      callerId,
      offer,
      conversationId,
    })
  }

  @SubscribeMessage(SOCKET_EVENTS.CALL.CALL_ACCEPTED)
  async handleCallAccepted(
    @MessageBody() data: any,
    @ConnectedSocket() client: Socket,
  ) {
    const targetUserId = client.data.userId
    const answer = data?.answer
    const callerId = data?.callerId

    if (!targetUserId || !answer || !callerId) {
      client.emit(SOCKET_EVENTS.CHAT.MESSAGE_ERROR, {
        code: 'INVALID_PAYLOAD',
        message: 'targetUserId, answer, and callerId are required',
        retryable: false,
      })
      return
    }

    // Gửi answer tới callerId
    this.emitToUserSockets([callerId], SOCKET_EVENTS.CALL.CALL_ACCEPTED, {
      answer: data.answer,
      answererId: client.data.userId,
    })
  }

  @SubscribeMessage(SOCKET_EVENTS.CALL.CALL_REJECTED)
  async handleCallRejected(
    @MessageBody() data: any,
    @ConnectedSocket() client: Socket,
  ) {
    const targetUserId = client.data.userId
    const callerId = data?.callerId

    if (!targetUserId || !callerId) {
      client.emit(SOCKET_EVENTS.CHAT.MESSAGE_ERROR, {
        code: 'INVALID_PAYLOAD',
        message: 'targetUserId and callerId are required',
        retryable: false,
      })
      return
    }

    // Gửi thông báo từ chối tới callerId
    this.emitToUserSockets([callerId], SOCKET_EVENTS.CALL.CALL_REJECTED, {
      rejecterId: client.data.userId,
    })

    this.recordCallOutcome({
      conversationId: data?.conversationId,
      callerId,
      calleeId: targetUserId,
      actorId: targetUserId,
      outcome: 'REJECTED',
    })
  }

  @SubscribeMessage(SOCKET_EVENTS.CALL.CALL_ENDED)
  async handleCallEnded(
    @MessageBody() data: any,
    @ConnectedSocket() client: Socket,
  ) {
    const enderId = client.data.userId
    const peerUserId = data?.targetUserId ?? data?.callerId

    if (!enderId || !peerUserId) {
      client.emit(SOCKET_EVENTS.CHAT.MESSAGE_ERROR, {
        code: 'INVALID_PAYLOAD',
        message: 'targetUserId is required',
        retryable: false,
      })
      return
    }

    this.emitToUserSockets([peerUserId], SOCKET_EVENTS.CALL.CALL_ENDED, {
      enderId,
      reason: data?.reason,
    })

    // Chỉ bên GỌI mới ghi nhận, nếu không mỗi lần kết thúc sẽ có hai tin nhắn
    // hệ thống — cả hai phía đều phát sự kiện này.
    const callerId = data?.callerId ?? enderId
    const isCaller = !data?.callerId || data.callerId === enderId
    if (isCaller) {
      const reason = String(data?.reason || '')
      this.recordCallOutcome({
        conversationId: data?.conversationId,
        callerId,
        calleeId: peerUserId,
        actorId: enderId,
        outcome:
          reason === 'no_answer'
            ? 'MISSED'
            : reason === 'unreachable'
              ? 'UNREACHABLE'
              : 'COMPLETED',
        durationSeconds: Number(data?.durationSeconds) || 0,
      })
    }
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
    durationSeconds?: number
  }) {
    if (!payload.conversationId) return

    this.amqpConnection.publish(
      EXCHANGE_RMQ.REALTIME_EVENTS,
      ROUTING_RMQ.CALL_ENDED,
      payload,
    )
  }
  @SubscribeMessage(SOCKET_EVENTS.CALL.ICE_CANDIDATE)
  async handleIceCandidate(
    @MessageBody() data: any,
    @ConnectedSocket() client: Socket,
  ) {
    const senderId = client.data.userId
    const targetUserId = data?.targetUserId
    const candidate = data?.candidate

    if (!senderId || !targetUserId || !candidate) {
      return // Có thể emit lỗi tương tự như trên
    }

    // Chuyển tiếp ICE candidate cho đối phương
    this.emitToUserSockets([targetUserId], SOCKET_EVENTS.CALL.ICE_CANDIDATE, {
      senderId,
      candidate,
    })
  }
}
