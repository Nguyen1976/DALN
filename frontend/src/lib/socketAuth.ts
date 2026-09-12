import { socket } from "@/lib/socket";
import { SOCKET_EVENTS } from "@/lib/socket.events";
import authorizeAxiosInstance from "@/utils/authorizeAxios";

/**
 * Hồi phục kết nối socket sau khi bị SERVER ngắt.
 *
 * Vì sao cần: `reconnectionAttempts: Infinity` trong socket.ts KHÔNG áp dụng
 * cho `io server disconnect` — Socket.IO coi việc server chủ động ngắt là quyết
 * định có chủ đích và không tự thử lại. Đo thực tế: sau khi bị ngắt, theo dõi
 * 9 giây không có một lần `reconnect_attempt` nào. Hệ quả là realtime chết hẳn
 * cho tới khi người dùng F5.
 *
 * Chiến lược theo mã lỗi server gửi kèm:
 *   ACCESS_TOKEN_MISSING / REFRESH_TOKEN_MISSING / TOKEN_INVALID
 *     -> gọi một request HTTP rẻ; AuthGuard sẽ tự làm mới cookie nếu còn cứu
 *        được, rồi nối lại. Không cứu được thì lần sau sẽ ra REFRESH_TOKEN_INVALID.
 *   REFRESH_TOKEN_INVALID
 *     -> phiên chấm dứt thật, ngừng thử lại. Request HTTP kế tiếp sẽ nhận 401
 *        và interceptor lo phần đăng xuất.
 */

type AuthErrorPayload = { code?: string };

/** Có giới hạn: phiên chết hẳn thì không đập liên tục vào server. */
const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 15000;

let attempts = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let lastAuthErrorCode: string | null = null;
let installed = false;

/** Mã lỗi mà thử lại cũng vô ích. */
const FATAL_CODES = new Set(["REFRESH_TOKEN_INVALID"]);

function clearRetry() {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

export function resetSocketAuthRetries() {
  attempts = 0;
  lastAuthErrorCode = null;
  clearRetry();
}

async function refreshSessionThenReconnect() {
  attempts += 1;
  const delay = Math.min(BASE_DELAY_MS * 2 ** (attempts - 1), MAX_DELAY_MS);

  clearRetry();
  retryTimer = setTimeout(async () => {
    try {
      // Chạm một endpoint cần đăng nhập: AuthGuard thấy access hết hạn sẽ
      // verify refresh và set cookie access mới. skipErrorToast để người dùng
      // không thấy toast lỗi cho một thao tác nền.
      await authorizeAxiosInstance.get("/user/me", { skipErrorToast: true });
    } catch {
      // 401 ở đây nghĩa là hết đường cứu; interceptor đã lo đăng xuất.
      return;
    }
    socket.connect();
  }, delay);
}

/** Gắn một lần duy nhất, ngay khi app khởi động. */
export function installSocketAuthRecovery() {
  if (installed) return;
  installed = true;

  socket.on(SOCKET_EVENTS.AUTH.ERROR, (payload: AuthErrorPayload) => {
    lastAuthErrorCode = payload?.code ?? null;
  });

  socket.on("connect", () => {
    resetSocketAuthRetries();
  });

  socket.on("disconnect", (reason: string) => {
    // Mất mạng/timeout: Socket.IO tự lo, không can thiệp.
    if (reason !== "io server disconnect") return;

    const code = lastAuthErrorCode;
    lastAuthErrorCode = null;

    if (code && FATAL_CODES.has(code)) return;
    if (attempts >= MAX_ATTEMPTS) return;

    void refreshSessionThenReconnect();
  });
}
