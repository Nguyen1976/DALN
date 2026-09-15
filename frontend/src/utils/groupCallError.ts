/**
 * Chuyển mã lỗi ack của gateway (group_call.start / group_call.accept) thành
 * thông báo tiếng Việt cho người dùng. Mã: xem hợp đồng gọi nhóm.
 */
export function describeGroupCallError(code?: string): string {
  switch (code) {
    case "NOT_MEMBER":
      return "Bạn không còn trong nhóm này nên không thể gọi.";
    case "NOT_GROUP":
      return "Cuộc trò chuyện này không phải nhóm.";
    case "LIVEKIT_UNCONFIGURED":
      return "Tính năng gọi nhóm chưa sẵn sàng. Vui lòng thử lại sau.";
    case "CALL_NOT_FOUND":
      return "Cuộc gọi nhóm không còn tồn tại.";
    default:
      return "Không thể kết nối cuộc gọi nhóm. Vui lòng thử lại.";
  }
}
