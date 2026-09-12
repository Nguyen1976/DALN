export const QUEUE_RMQ = {
  CHAT_USER_UPDATE_STATUS_MAKE_FRIEND: 'chat_queue_user_updateStatusMakeFriend',
  NOTIFICATION_USER_CREATED: 'notification_queue_user_created',
  NOTIFICATION_USER_REGISTER_OTP: 'notification_queue_user_register_otp',
  NOTIFICATION_USER_MAKE_FRIEND: 'notification_queue_user_makeFriend',
  NOTIFICATION_USER_UPDATE_STATUS_MAKE_FRIEND:
    'notification_queue_user_updateStatusMakeFriend',
  CHAT_USER_UPDATED: 'chat_queue_user_updated',
  REALTIME_EMIT_EVENT: 'realtime_queue_emit_event',
  CHAT_SEND_MESSAGE: 'chat_queue_send_message',
  USER_ONLINE: 'user_online_queue',
  USER_OFFLINE: 'user_offline_queue',
  USER_NEO4J_CREATED: 'user_neo4j_queue_created',
  USER_NEO4J_UPDATE_STATUS_MAKE_FRIEND:
    'user_neo4j_queue_update_status_make_friend',
  CHAT_UPDATE_MESSAGE_READ: 'chat_queue_update_message_read',
  CHAT_CALL_ENDED: 'chat_queue_call_ended',
  RECOMMENDATION_USER_CREATED: 'recommendation_queue_user_created',
  RECOMMENDATION_USER_UPDATED: 'recommendation_queue_user_updated',
  RECOMMENDATION_USER_INTERESTS_UPDATED:
    'recommendation_queue_user_interests_updated',
  RECOMMENDATION_USER_UPDATE_STATUS_MAKE_FRIEND:
    'recommendation_queue_user_update_status_make_friend',
  RECOMMENDATION_USER_JOINED_GROUP: 'recommendation_queue_user_joined_group',
  RECOMMENDATION_USER_LEFT_GROUP: 'recommendation_queue_user_left_group',
  SAGA_ORCHESTRATOR_TRIGGER: 'saga_orchestrator_trigger',
  SAGA_ORCHESTRATOR_REPLY: 'saga_orchestrator_reply',
  SAGA_CHAT_CREATE_CONVERSATION: 'saga_chat_create_conversation',
  SAGA_CHAT_DELETE_CONVERSATION: 'saga_chat_delete_conversation',
  SAGA_NOTIFICATION_NOTIFY_ACCEPTED: 'saga_notification_notify_accepted',
  SAGA_USER_REVERT_FRIENDSHIP: 'saga_user_revert_friendship',
}
