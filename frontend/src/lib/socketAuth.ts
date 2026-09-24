import { socket } from "@/lib/socket";
import { SOCKET_EVENTS } from "@/lib/socket.events";
import { refreshSession } from "@/utils/authorizeAxios";

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
 *   ACCESS_TOKEN_EXPIRED / ACCESS_TOKEN_MISSING / TOKEN_INVALID
 *     -> access token hết hạn hoặc đã bị trình duyệt xoá, nhưng phiên có thể
 *        vẫn sống: gọi /user/refresh rồi nối lại. Không cứu được thì chính lời
 *        gọi đó nhận 401 và interceptor lo phần đăng xuất.
 *   SESSION_CHECK_UNAVAILABLE
 *     -> hạ tầng lỗi, không phải phiên chết: thử lại theo backoff.
 *   SESSION_REVOKED
 *     -> phiên bị thu hồi thật (đăng xuất, đổi mật khẩu, token bị dùng lại).
 *        Ngừng hẳn: thử lại chỉ là đập vào server.
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

/**
 * Mã lỗi mà thử lại cũng vô ích.
 *
 * Cố ý CHỈ có SESSION_REVOKED. Các mã còn lại — kể cả TOKEN_INVALID — đều có
 * thể cứu được bằng một lần làm mới, vì phiên vẫn còn sống ở server; đóng cửa
 * sớm với chúng là bắt người dùng F5 vô cớ.
 */
const FATAL_CODES = new Set(["SESSION_REVOKED"]);

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
      // Đúng endpoint làm mới, và dùng chung single-flight với interceptor HTTP
      // nên một lần socket hồi phục không phát thêm lời gọi refresh song song.
      await refreshSession();
    } catch {
      // Hết đường cứu; interceptor đã lo phần đăng xuất.
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
