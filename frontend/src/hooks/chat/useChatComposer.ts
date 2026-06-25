import { useCallback, useState, type RefObject } from "react";
import { useDispatch } from "react-redux";
import {
  createMessageUploadUrlAPI,
  uploadFileToSignedUrl,
  type MessageMediaInput,
} from "@/apis";
import { socket } from "@/lib/socket";
import {
  addConversation,
  updateNewMessage,
  type Conversation,
} from "@/redux/slices/conversationSlice";
import {
  addMessage,
  failMessage,
  type Message,
} from "@/redux/slices/messageSlice";
import type { UserState } from "@/redux/slices/userSlice";
import type { AppDispatch } from "@/redux/store";
import { getMessageTypeFromFile, getMimeTypeFromFile } from "@/utils/chatMedia";
import { showErrorToast } from "@/utils/toastError";

interface UseChatComposerOptions {
  conversationId?: string;
  user: UserState;
  canSendMessage: boolean;
  conversation?: Conversation;
  effectiveConversation?: Conversation;
  stopTyping: () => void;
  bottomRef: RefObject<HTMLDivElement | null>;
}

export function useChatComposer({
  conversationId,
  user,
  canSendMessage,
  conversation,
  effectiveConversation,
  stopTyping,
  bottomRef,
}: UseChatComposerOptions) {
  const dispatch = useDispatch<AppDispatch>();
  const [msg, setMsg] = useState("");

  const ensureConversationInStore = useCallback(
    (lastMessage: Message) => {
      if (!conversationId || conversation || !effectiveConversation) return;

      dispatch(
        addConversation({
          conversation: {
            ...effectiveConversation,
            lastMessage,
            updatedAt: lastMessage.createdAt || effectiveConversation.updatedAt,
          },
        }),
      );
    },
    [conversation, conversationId, dispatch, effectiveConversation, user.id],
  );

  const createTempMessage = useCallback(
    (partial: Partial<Message> & Pick<Message, "id" | "type">): Message => ({
      id: partial.id,
      conversationId: conversationId || "",
      senderId: user.id,
      text: partial.text ?? "",
      type: partial.type,
      medias: partial.medias,
      clientMessageId: partial.clientMessageId,
      status: "pending",
      createdAt: new Date().toISOString(),
      senderMember: {
        userId: user.id,
        username: user.username,
        fullName: user.fullName,
        avatar: user.avatar || "",
      },
    }),
    [conversationId, user],
  );

  const handleSendMessage = useCallback(() => {
    if (!canSendMessage || msg.trim() === "" || !conversationId) return;

    const clientMessageId = `temp-id-${Date.now()}`;
    const tempMessage = createTempMessage({
      id: clientMessageId,
      type: "TEXT",
      text: msg,
      clientMessageId,
    });

    dispatch(addMessage(tempMessage));
    dispatch(updateNewMessage({ conversationId, lastMessage: tempMessage }));
    ensureConversationInStore(tempMessage);

    socket.emit("message:create", {
      conversationId,
      type: "TEXT",
      content: msg,
      clientMessageId,
      media: [],
    });

    stopTyping();
    setMsg("");

    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    });
  }, [
    bottomRef,
    canSendMessage,
    conversationId,
    createTempMessage,
    dispatch,
    ensureConversationInStore,
    msg,
    stopTyping,
  ]);

  const handleUploadMedia = useCallback(
    async (file: File) => {
      if (!canSendMessage || !conversationId) return;

      const mediaType = getMessageTypeFromFile(file);
      const mimeType = getMimeTypeFromFile(file);
      const clientMessageId = `temp-media-${Date.now()}`;

      const tempMedia: MessageMediaInput = {
        mediaType,
        objectKey: "",
        url: URL.createObjectURL(file),
        mimeType,
        size: String(file.size),
        fileName: file.name,
        sortOrder: 0,
      };

      const tempMessage = createTempMessage({
        id: clientMessageId,
        type: mediaType,
        text: msg,
        medias: [tempMedia],
        clientMessageId,
      });

      dispatch(addMessage(tempMessage));
      dispatch(updateNewMessage({ conversationId, lastMessage: tempMessage }));
      ensureConversationInStore(tempMessage);

      try {
        const upload = await createMessageUploadUrlAPI({
          conversationId,
          type: mediaType,
          mimeType,
          fileName: file.name,
          size: String(file.size),
        });

        await uploadFileToSignedUrl(upload.uploadUrl, file, mimeType);

        socket.emit("message:create", {
          conversationId,
          type: mediaType,
          content: msg.trim() || null,
          clientMessageId,
          media: [
            {
              mediaType,
              objectKey: upload.objectKey,
              url: upload.publicUrl,
              mimeType,
              size: String(file.size),
              fileName: file.name,
              sortOrder: 0,
            },
          ],
        });

        setMsg("");
      } catch (error) {
        showErrorToast(error, "Không thể tải tệp lên");
        dispatch(failMessage({ conversationId, clientMessageId }));
      }
    },
    [
      canSendMessage,
      conversationId,
      createTempMessage,
      dispatch,
      ensureConversationInStore,
      msg,
    ],
  );

  return {
    msg,
    setMsg,
    handleSendMessage,
    handleUploadMedia,
  };
}
