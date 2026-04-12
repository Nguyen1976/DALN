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
    USER_READ: "user:read",
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
};
