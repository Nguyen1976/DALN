import { useCallback } from "react";
import { useDispatch } from "react-redux";
import { toast } from "sonner";
import {
  clearConversationHistoryAPI,
  deleteMessageForMeAPI,
  revokeMessageAPI,
} from "@/apis";
import {
  clearConversationMessages,
  deleteMessageForMe as deleteMessageForMeAction,
  revokeMessage as revokeMessageAction,
  type Message,
} from "@/redux/slices/messageSlice";
import {
  markConversationRead,
  updateNewMessage,
} from "@/redux/slices/conversationSlice";
import { clearConversationSeenStatus } from "@/redux/slices/seenStatusSlice";
import type { AppDispatch } from "@/redux/store";

interface UseChatMessageActionsOptions {
  conversationId?: string;
  messages: Message[];
}

export function useChatMessageActions({
  conversationId,
  messages,
}: UseChatMessageActionsOptions) {
  const dispatch = useDispatch<AppDispatch>();

  const handleRevokeMessage = useCallback(
    async (message: Message) => {
      if (!conversationId) return;

      const isTempMessage =
        message.id.startsWith("temp-") || message.status === "pending";

      if (isTempMessage) {
        toast.error("Không thể thu hồi tin nhắn chưa gửi xong");
        return;
      }

      try {
        const result = await revokeMessageAPI({
          conversationId,
          messageId: message.id,
        });

        dispatch(
          revokeMessageAction({
            conversationId,
            messageId: result?.message?.id || message.id,
          }),
        );

        if (messages[messages.length - 1]?.id === message.id) {
          dispatch(
            updateNewMessage({
              conversationId,
              lastMessage: {
                ...(result?.message || message),
                id: result?.message?.id || message.id,
                isRevoked: true,
                content: "",
                text: "Tin nhắn đã bị thu hồi",
              } as Message,
            }),
          );
        }

        toast.success("Đã thu hồi tin nhắn");
      } catch {
        toast.error("Không thể thu hồi tin nhắn");
      }
    },
    [conversationId, dispatch, messages],
  );

  const handleDeleteMessageForMe = useCallback(
    async (message: Message) => {
      if (!conversationId) return;

      try {
        const isTempMessage =
          message.id.startsWith("temp-") || message.status === "pending";
        const latestMessage = messages[messages.length - 1];

        if (!isTempMessage) {
          await deleteMessageForMeAPI({
            conversationId,
            messageId: message.id,
          });
        }

        dispatch(
          deleteMessageForMeAction({
            conversationId,
            messageId: message.id,
          }),
        );

        if (latestMessage?.id === message.id) {
          const nextLatest = messages[messages.length - 2];
          if (nextLatest) {
            dispatch(
              updateNewMessage({
                conversationId,
                lastMessage: nextLatest,
              }),
            );
          }
        }

        toast.success("Đã xóa tin nhắn ở phía bạn");
      } catch {
        toast.error("Không thể xóa tin nhắn");
      }
    },
    [conversationId, dispatch, messages],
  );

  const handleClearHistory = useCallback(async () => {
    if (!conversationId) return;

    try {
      await clearConversationHistoryAPI({ conversationId });
      dispatch(clearConversationMessages({ conversationId }));
      dispatch(clearConversationSeenStatus(conversationId));
      dispatch(markConversationRead({ conversationId }));
      toast.success("Đã xóa toàn bộ lịch sử trò chuyện");
      return true;
    } catch {
      toast.error("Không thể xóa lịch sử trò chuyện");
      return false;
    }
  }, [conversationId, dispatch]);

  return {
    handleRevokeMessage,
    handleDeleteMessageForMe,
    handleClearHistory,
  };
}
