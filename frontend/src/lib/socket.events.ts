/**
 * Socket Events Constants - Shared between Frontend and Backend
 * These should match backend/libs/constant/websocket/socket.events.ts
 */

export const SOCKET_EVENTS = {
  CONNECTION: "user_online",
  DISCONNECTION: "user_offline",

  CHAT: {
    NEW_MESSAGE: "chat.new_message",
    MESSAGE_CREATE: "message:create",
    MESSAGE_NEW: "message:new",
    MESSAGE_ACK: "message:ack",
    MESSAGE_ERROR: "message:error",
    MESSAGE_SYSTEM: "message:system",
    MESSAGE_REVOKED: "message:revoked",
    POLL_UPDATED: "poll:updated",
    POLL_CLOSED: "poll:closed",
    CONVERSATION_MEMBER_ADDED: "conversation:member_added",
    CONVERSATION_MEMBER_REMOVED: "conversation:member_removed",
    CONVERSATION_MEMBER_LEFT: "conversation:member_left",
    CONVERSATION_UPDATE: "conversation:update",
    NEW_CONVERSATION: "chat.new_conversation",
    NEW_MEMBER_ADDED: "chat.new_member_added",
    USER_TYPING: "user:typing",
    MESSAGE_READ: "message:read",
    USER_READ_BATCH: "user:read_batch",
  },

  USER: {
    UPDATE_FRIEND_REQUEST_STATUS: "user.update_friend_request_status",
    NEW_FRIEND_REQUEST: "user.new_friend_request",
    ONLINE_STATUS_CHANGED: "user.online_status_changed",
    OFFLINE_STATUS_CHANGED: "user.offline_status_changed",
  },

  NOTIFICATION: {
    NEW_NOTIFICATION: "notification.new_notification",
  },

  /** Lỗi xác thực ở tầng socket — phải khớp với backend. */
  AUTH: {
    ERROR: "auth:error",
  },

  CALL: {
    ICE_CONFIG: "call.ice_config",
    INCOMING_CALL: "call.incoming_call",
    CALL_ACCEPTED: "call.accepted",
    CALL_REJECTED: "call.rejected",
    CALL_ENDED: "call.ended",
    CLAIMED: "call.claimed",
    ICE_CANDIDATE: "call.ice_candidate",
    MEDIA_STATE: "call.media_state",
  },

  // Gọi nhóm (hội thoại GROUP) qua SFU LiveKit. 1-1 (DIRECT) vẫn dùng CALL.
  GROUP_CALL: {
    START: "group_call.start",
    INCOMING: "group_call.incoming",
    ACCEPT: "group_call.accept",
    DECLINE: "group_call.decline",
    LEAVE: "group_call.leave",
    STATE: "group_call.state",
    QUERY_STATE: "group_call.query_state",
    ENDED: "group_call.ended",
  },
};
