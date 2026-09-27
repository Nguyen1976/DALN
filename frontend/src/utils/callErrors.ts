export type CallSetupErrorCode =
  | "CALL_FORBIDDEN"
  | "CALLEE_OFFLINE"
  | "BUSY"
  | "CALLEE_BUSY"
  | "CLIENT_OUTDATED"
  | "MEDIA_UNAVAILABLE"
  | "MEDIA_UNCONFIGURED"
  | "UNKNOWN";

/** Lỗi thiết lập cuộc gọi từ phía gateway (không phải lỗi micro). */
export class CallSetupError extends Error {
  code: CallSetupErrorCode;
  constructor(code: CallSetupErrorCode) {
    super("Không thiết lập được cuộc gọi");
    this.name = "CallSetupError";
    this.code = code;
  }
}

/** Bao lâu chờ micro trước khi coi là hỏng. */
const MIC_ACQUIRE_TIMEOUT_MS = 15000;

export class MicrophoneTimeoutError extends Error {
  constructor() {
    super("Không truy cập được micro");
    this.name = "MicrophoneTimeoutError";
  }
}

/** Thông điệp cho người dùng ứng với từng lý do không lấy được micro. */
export function describeMicrophoneError(error: unknown): string {
  const name = (error as { name?: string })?.name;

  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Bạn đã từ chối quyền dùng micro. Hãy bật lại quyền cho trang này trong cài đặt trình duyệt rồi gọi lại.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "Không tìm thấy micro nào trên thiết bị này.";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "Micro đang được ứng dụng khác sử dụng. Hãy đóng ứng dụng đó rồi thử lại.";
  }
  if (name === "MicrophoneTimeoutError") {
    return "Không truy cập được micro sau 15 giây. Hãy kiểm tra quyền micro của trình duyệt rồi gọi lại.";
  }
  return "Không thể bắt đầu cuộc gọi. Vui lòng thử lại.";
}

/** Gộp lỗi thiết lập từ gateway lẫn lỗi micro cho luồng gọi/nhận. */
export function describeCallError(error: unknown): string {
  if (error instanceof CallSetupError) {
    switch (error.code) {
      case "CALL_FORBIDDEN":
        return "Bạn không thể gọi cho người này.";
      case "CALLEE_OFFLINE":
        return "Người nhận hiện không trực tuyến.";
      case "BUSY":
        return "Bạn đang trong một cuộc gọi khác.";
      case "CALLEE_BUSY":
        return "Người này đang bận trong cuộc gọi khác.";
      case "CLIENT_OUTDATED":
        return "Ứng dụng vừa được cập nhật, vui lòng tải lại trang.";
      case "MEDIA_UNAVAILABLE":
        return "Không thể bắt đầu cuộc gọi, thử lại sau.";
      case "MEDIA_UNCONFIGURED":
        return "Tính năng gọi chưa sẵn sàng. Vui lòng thử lại sau.";
      default:
        return "Không thể bắt đầu cuộc gọi. Vui lòng thử lại.";
    }
  }
  return describeMicrophoneError(error);
}

/**
 * Xin quyền micro (và camera nếu cần) trước khi vào phòng, có giới hạn 15 giây,
 * rồi trả thiết bị ngay. SDK RealtimeKit tự mở thiết bị khi vào phòng; bước này
 * chỉ để giữ nguyên các thông báo lỗi quyền/thiết bị rõ ràng như trước.
 */
export async function probeLocalMedia(withVideo: boolean): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const media = navigator.mediaDevices.getUserMedia({
    audio: true,
    video: withVideo,
  });
  try {
    const stream = await Promise.race([
      media,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          reject(new MicrophoneTimeoutError());
        }, MIC_ACQUIRE_TIMEOUT_MS);
      }),
    ]);
    stream.getTracks().forEach((track) => track.stop());
  } catch (error) {
    if (timedOut) {
      void media
        .then((late) => late.getTracks().forEach((track) => track.stop()))
        .catch(() => undefined);
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
