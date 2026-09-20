import { v4 as uuid } from 'uuid'
import type { MemberProfile } from '../member-profile'

// ============================================================================
// Hợp đồng message cho Saga Orchestration (luồng chấp nhận kết bạn).
// Tất cả message saga đi qua exchange EXCHANGE_RMQ.SAGA_EVENTS (topic).
//
// Mô hình: Orchestration. saga-orchestrator điều phối các bước, mỗi participant
// phản hồi (REPLY) để orchestrator biết bước đó OK hay FAILED và quyết định
// đi tiếp hay chạy compensation (rollback).
// ============================================================================

export const SAGA_TYPE = {
  FRIENDSHIP_ACCEPT: 'FRIENDSHIP_ACCEPT',
} as const

export type SagaType = (typeof SAGA_TYPE)[keyof typeof SAGA_TYPE]

// Các bước trong saga chấp nhận kết bạn (gồm cả bước compensation để reply
// rollback có thể mang đúng step).
export const SAGA_STEP = {
  CREATE_CONVERSATION: 'CREATE_CONVERSATION',
  NOTIFY_ACCEPTED: 'NOTIFY_ACCEPTED',
  REVERT_FRIENDSHIP: 'REVERT_FRIENDSHIP',
  DELETE_CONVERSATION: 'DELETE_CONVERSATION',
} as const

export type SagaStep = (typeof SAGA_STEP)[keyof typeof SAGA_STEP]

export type SagaMessageKind = 'TRIGGER' | 'COMMAND' | 'REPLY' | 'COMPENSATE'
export type SagaReplyStatus = 'OK' | 'FAILED'

// Routing keys trên exchange saga.events
export const SAGA_ROUTING = {
  // User HTTP -> Orchestrator: bắt đầu saga
  FRIENDSHIP_ACCEPT_REQUESTED: 'saga.friendship.accept.requested',

  // Orchestrator -> participants (command)
  CMD_CREATE_CONVERSATION: 'saga.friendship.cmd.createConversation',
  CMD_NOTIFY_ACCEPTED: 'saga.friendship.cmd.notifyAccepted',

  // Orchestrator -> participants (compensation / rollback)
  CMP_REVERT_FRIENDSHIP: 'saga.friendship.cmp.revertFriendship',
  CMP_DELETE_CONVERSATION: 'saga.friendship.cmp.deleteConversation',

  // participants -> Orchestrator (reply chung, phân biệt bằng field step/status)
  REPLY: 'saga.friendship.reply',
} as const

// Tên queue (binding) trên exchange saga.events
export const SAGA_QUEUE = {
  ORCHESTRATOR_TRIGGER: 'saga_orchestrator_trigger',
  ORCHESTRATOR_REPLY: 'saga_orchestrator_reply',
  CHAT_CREATE_CONVERSATION: 'saga_chat_create_conversation',
  CHAT_DELETE_CONVERSATION: 'saga_chat_delete_conversation',
  NOTIFICATION_NOTIFY_ACCEPTED: 'saga_notification_notify_accepted',
  USER_REVERT_FRIENDSHIP: 'saga_user_revert_friendship',
} as const

// Định danh consumer (dùng cho bảng inbox idempotency)
export const SAGA_CONSUMER = {
  ORCHESTRATOR_TRIGGER: 'orchestrator:trigger',
  ORCHESTRATOR_REPLY: 'orchestrator:reply',
  CHAT_CREATE_CONVERSATION: 'chat:createConversation',
  CHAT_DELETE_CONVERSATION: 'chat:deleteConversation',
  NOTIFICATION_NOTIFY_ACCEPTED: 'notification:notifyAccepted',
  USER_REVERT_FRIENDSHIP: 'user:revertFriendship',
} as const

/** A person on the conversation the saga creates. */
export type SagaMember = MemberProfile

// Envelope chung cho mọi message saga.
export interface SagaEnvelope<T = unknown> {
  /** UUID — khóa idempotency phía consumer (bảng inbox unique messageId). */
  messageId: string
  /** Định danh tiến trình saga, vd "FRIENDSHIP_ACCEPT:{friendRequestId}". */
  sagaId: string
  sagaType: SagaType
  /** Bước nghiệp vụ liên quan (với REPLY là bước được phản hồi). */
  step: SagaStep
  kind: SagaMessageKind
  /** Chỉ có ở REPLY. */
  status?: SagaReplyStatus
  payload: T
  correlationId?: string
  occurredAt: string
  /** Mô tả lỗi khi status = FAILED. */
  error?: string
}

// ---- Payload từng loại message ----

export interface FriendshipAcceptTriggerPayload {
  inviterId: string
  inviteeId: string
  inviteeName: string
  friendRequestId: string
  members: SagaMember[]
}

export interface CreateConversationCommandPayload {
  inviterId: string
  inviteeId: string
  members: SagaMember[]
}

export interface CreateConversationReplyPayload {
  conversationId?: string
}

export interface NotifyAcceptedCommandPayload {
  inviterId: string
  inviteeId: string
  inviteeName: string
}

export interface RevertFriendshipCommandPayload {
  inviterId: string
  inviteeId: string
  friendRequestId: string
}

export interface DeleteConversationCommandPayload {
  conversationId: string
}

// ---- Helpers tạo envelope (dùng chung cho participants) ----

/** Tạo REPLY envelope từ message nguồn (command/compensate). */
export function buildReply(
  source: SagaEnvelope,
  status: SagaReplyStatus,
  payload: unknown = {},
  error?: string,
): SagaEnvelope {
  return {
    messageId: uuid(),
    sagaId: source.sagaId,
    sagaType: source.sagaType,
    step: source.step,
    kind: 'REPLY',
    status,
    payload,
    correlationId: source.correlationId,
    occurredAt: new Date().toISOString(),
    ...(error ? { error } : {}),
  }
}

/** A message that starts a saga (TRIGGER) or drives one of its steps. */
export function buildMessage<T>(
  kind: Exclude<SagaMessageKind, 'REPLY'>,
  sagaId: string,
  sagaType: SagaType,
  step: SagaStep,
  payload: T,
  correlationId?: string,
): SagaEnvelope<T> {
  return {
    messageId: uuid(),
    sagaId,
    sagaType,
    step,
    kind,
    payload,
    correlationId,
    occurredAt: new Date().toISOString(),
  }
}

/** Tạo TRIGGER envelope để bắt đầu một saga. */
export const buildTrigger = <T>(
  sagaId: string,
  sagaType: SagaType,
  step: SagaStep,
  payload: T,
  correlationId?: string,
) => buildMessage('TRIGGER', sagaId, sagaType, step, payload, correlationId)
