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
  private readonly socketTouchIntervalMs = 25_000
  private readonly socketTouchTimers = new Map<string, NodeJS.Timeout>()
  private readonly packetListeners = new Map<string, (packet: any) => void>()

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
      if (!rawCookie) {
        client.disconnect()
        return
      }

      const parsed = cookie.parse(rawCookie)
      const accessToken = parsed.accessToken

      if (!accessToken) {
        client.disconnect()
        return
      }

      const payload = this.jwtService.verify(accessToken)
      const userId = payload?.userId
      if (!userId) {
        client.disconnect()
        return
      }

      client.data.userId = userId

      const prevOnline = await this.userStatusStore.isOnline(userId)

      // 🔥 Join room theo user
      client.join(`user:${userId}`)

      // 🔥 Lưu Redis + TTL
      await this.userStatusStore.addConnection(userId, client.id)

      const touchConnection = async () => {
        await this.userStatusStore.touchConnection(userId, client.id)
      }

      const packetListener = async (packet) => {
        if (packet.type === 'pong') {
          await touchConnection()
        }
      }

      client.conn.on('packet', packetListener)
      this.packetListeners.set(client.id, packetListener)

      const timer = setInterval(() => {
        void touchConnection()
      }, this.socketTouchIntervalMs)
      this.socketTouchTimers.set(client.id, timer)

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

  async handleDisconnect(client: Socket) {
    const userId = client.data.userId
    if (!userId) return

    const timer = this.socketTouchTimers.get(client.id)
    if (timer) {
      clearInterval(timer)
      this.socketTouchTimers.delete(client.id)
    }

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
}
