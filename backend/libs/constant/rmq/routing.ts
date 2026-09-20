export const ROUTING_RMQ = {
  USER_CREATED: 'user.created',
  USER_REGISTER_OTP: 'user.registerOtp',
  USER_MAKE_FRIEND: 'user.makeFriend',
  USER_UPDATE_STATUS_MAKE_FRIEND: 'user.updateStatusMakeFriend',
  USER_UPDATED: 'user.updated',
  /** A friendship undone by the accept saga's compensation. */
  USER_FRIENDSHIP_REVERTED: 'user.friendshipReverted',
  USER_INTERESTS_UPDATED: 'user.interests.updated',
  USER_JOINED_GROUP: 'user.joinedGroup',
  USER_LEFT_GROUP: 'user.leftGroup',
  EMIT_REALTIME_EVENT: 'realtime.emitEvent',
  SEND_MESSAGE: 'realtime.sendMessage',
  USER_OFFLINE: 'user.offline',
  USER_ONLINE: 'user.online',
  UPDATE_MESSAGE_READ: 'message.updateRead',
  CALL_ENDED: 'call.ended',
  CHAT_MENTION: 'chat.mention',
}
