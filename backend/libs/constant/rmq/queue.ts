export const QUEUE_RMQ = {
  NOTIFICATION_USER_CREATED: 'notification_queue_user_created',
  NOTIFICATION_CHAT_MENTION: 'notification_queue_chat_mention',
  NOTIFICATION_USER_REGISTER_OTP: 'notification_queue_user_register_otp',
  NOTIFICATION_USER_MAKE_FRIEND: 'notification_queue_user_makeFriend',
  NOTIFICATION_USER_UPDATE_STATUS_MAKE_FRIEND:
    'notification_queue_user_updateStatusMakeFriend',
  CHAT_USER_UPDATED: 'chat_queue_user_updated',
  REALTIME_EMIT_EVENT: 'realtime_queue_emit_event',
  CHAT_SEND_MESSAGE: 'chat_queue_send_message',
  USER_ONLINE: 'user_online_queue',
  USER_OFFLINE: 'user_offline_queue',
  CHAT_UPDATE_MESSAGE_READ: 'chat_queue_update_message_read',
  CHAT_CALL_ENDED: 'chat_queue_call_ended',
  RECOMMENDATION_USER_CREATED: 'recommendation_queue_user_created',
  RECOMMENDATION_USER_UPDATED: 'recommendation_queue_user_updated',
  RECOMMENDATION_USER_FRIENDSHIP_REVERTED:
    'recommendation_queue_user_friendshipReverted',
  RECOMMENDATION_USER_INTERESTS_UPDATED:
    'recommendation_queue_user_interests_updated',
  RECOMMENDATION_USER_UPDATE_STATUS_MAKE_FRIEND:
    'recommendation_queue_user_update_status_make_friend',
  RECOMMENDATION_USER_JOINED_GROUP: 'recommendation_queue_user_joined_group',
  RECOMMENDATION_USER_LEFT_GROUP: 'recommendation_queue_user_left_group',
}
