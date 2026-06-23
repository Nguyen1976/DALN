import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { socket } from "@/lib/socket";
import {
  markConversationRead,
  selectConversationById,
} from "@/redux/slices/conversationSlice";
import { clearTypingUsers } from "@/redux/slices/typingIndicatorSlice";
import { selectUser } from "@/redux/slices/userSlice";
import { SOCKET_EVENTS } from "@/lib/socket.events";
import type { AppDispatch, RootState } from "@/redux/store";

export const useConversationRoom = (conversationId?: string) => {
  const dispatch = useDispatch<AppDispatch>();
  const conversation = useSelector((state: RootState) =>
    conversationId ? selectConversationById(state, conversationId) : null,
  );
  const user = useSelector(selectUser);

  const isObjectId = (value?: string | null) =>
    typeof value === "string" && /^[a-f\d]{24}$/i.test(value);

  useEffect(() => {
    if (!conversationId) return;

    const handleConnect = () => {
      socket.emit("conversation:join", { conversationId });
      dispatch(markConversationRead({ conversationId }));

      const lastMessageId =
        conversation?.lastMessageId || conversation?.lastMessage?.id;

      if (
        lastMessageId &&
        isObjectId(lastMessageId) &&
        conversation?.lastMessageSenderId !== user.id
      ) {
        socket.emit(SOCKET_EVENTS.CHAT.MESSAGE_READ, {
          conversationId,
          lastMessageId,
        });
      }
    };

    if (socket.connected) {
      handleConnect();
    } else {
      socket.on("connect", handleConnect);
    }

    return () => {
      socket.off("connect", handleConnect);
      socket.emit("conversation:leave", { conversationId });
      dispatch(clearTypingUsers(conversationId));
    };
  }, [
    conversation?.lastMessage?.id,
    conversation?.lastMessageId,
    conversation?.lastMessageSenderId,
    conversationId,
    dispatch,
    user.id,
  ]);
};
