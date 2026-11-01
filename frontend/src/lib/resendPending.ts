import { socket } from "@/lib/socket";
import {
  failMessage,
  retryMessage,
  type MessageState,
} from "@/redux/slices/messageSlice";
import type { AppDispatch } from "@/redux/store";

/** Không có ACK sau bấy lâu thì coi như gửi lỗi, hiện nút "Gửi lại". */
export const ACK_TIMEOUT_MS = 12000;

/** Server báo bận (queue đầy): tự gửi lại sau từng khoảng này rồi mới bỏ cuộc. */
export const BUSY_RETRY_DELAYS_MS = [2000, 4000, 8000];

export function nextBusyDelay(attempt: number): number | null {
  return BUSY_RETRY_DELAYS_MS[attempt] ?? null;
}

export type PendingText = {
  conversationId: string;
  clientMessageId: string;
  content: string;
  replyToMessageId?: string;
};

/**
 * Tin văn bản đang chờ ACK. Gửi lại với CÙNG clientMessageId là an toàn: server
 * chặn trùng theo (người gửi, clientMessageId) và trả lại đúng bản đã lưu. Tin
 * có tệp đính kèm không tự gửi lại — người dùng bấm "Gửi lại".
 */
export function pendingTextMessages(state: MessageState): PendingText[] {
  return Object.values(state.messages)
    .flat()
    .filter(
      (m) => m.status === "pending" && !!m.clientMessageId && !m.medias?.length,
    )
    .map((m) => ({
      conversationId: m.conversationId,
      clientMessageId: m.clientMessageId!,
      content: m.content,
      replyToMessageId: m.replyToMessageId,
    }));
}

export function findTextMessage(
  state: MessageState,
  conversationId: string,
  clientMessageId: string,
): PendingText | null {
  const message = (state.messages[conversationId] ?? []).find(
    (m) => m.clientMessageId === clientMessageId && !m.medias?.length,
  );
  return message
    ? {
        conversationId,
        clientMessageId,
        content: message.content,
        replyToMessageId: message.replyToMessageId,
      }
    : null;
}

/**
 * Gửi một tin văn bản và đảm bảo nó không treo mãi: socket đang rớt thì báo lỗi
 * ngay, không có ACK sau ACK_TIMEOUT_MS thì báo lỗi để hiện nút gửi lại.
 */
export function sendTextMessage(dispatch: AppDispatch, message: PendingText) {
  const { conversationId, clientMessageId } = message;
  if (!socket.connected) {
    dispatch(failMessage({ conversationId, clientMessageId }));
    return;
  }

  dispatch(retryMessage({ conversationId, clientMessageId }));
  socket.emit("message:create", {
    conversationId,
    type: "TEXT",
    content: message.content,
    clientMessageId,
    replyToMessageId: message.replyToMessageId,
    medias: [],
  });

  window.setTimeout(() => {
    // `failMessage` không làm gì khi ACK đã chuyển tin sang "sent".
    dispatch(failMessage({ conversationId, clientMessageId }));
  }, ACK_TIMEOUT_MS);
}
