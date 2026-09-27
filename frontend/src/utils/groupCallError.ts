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
    case "MEDIA_UNCONFIGURED":
      return "Tính năng gọi chưa sẵn sàng. Vui lòng thử lại sau.";
    case "MEDIA_UNAVAILABLE":
      return "Không thể bắt đầu cuộc gọi, thử lại sau.";
    case "CLIENT_OUTDATED":
      return "Ứng dụng vừa được cập nhật, vui lòng tải lại trang.";
    case "BUSY":
      return "Bạn đang trong một cuộc gọi khác.";
    case "CALL_NOT_FOUND":
      return "Cuộc gọi nhóm không còn tồn tại.";
    default:
      return "Không thể kết nối cuộc gọi nhóm. Vui lòng thử lại.";
  }
}
