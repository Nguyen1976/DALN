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
  discardMessage,
  failMessage,
  retryMessage,
  type Message,
} from "@/redux/slices/messageSlice";
import type { UserState } from "@/redux/slices/userSlice";
import type { AppDispatch } from "@/redux/store";
import { getMessageTypeFromFile, getMimeTypeFromFile } from "@/utils/chatMedia";
import { showErrorToast } from "@/utils/toastError";
import { createClientMessageId } from "@/utils/clientId";

interface UseChatComposerOptions {
  conversationId?: string;
  user: UserState;
  canSendMessage: boolean;
  conversation?: Conversation;
  effectiveConversation?: Conversation;
  stopTyping: () => void;
  bottomRef: RefObject<HTMLDivElement | null>;
}

/** Bao lâu không nhận được xác nhận thì coi là gửi hỏng. */
const ACK_TIMEOUT_MS = 12000;

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

  /**
   * Ship a text message and make sure it never sits in limbo.
   *
   * A bare `socket.emit` while the connection is down is buffered silently:
   * the bubble stayed on "đang gửi" for ever with nothing telling the user it
   * had not left the device. Offline is failed immediately, and an ack that
   * never arrives fails the message after a bounded wait so the retry control
   * can appear.
   */
  const emitMessage = useCallback(
    ({
      conversationId: cid,
      content,
      clientMessageId,
    }: {
      conversationId: string;
      content: string;
      clientMessageId: string;
    }) => {
      if (!socket.connected) {
        dispatch(failMessage({ conversationId: cid, clientMessageId }));
        return;
      }

      socket.emit("message:create", {
        conversationId: cid,
        type: "TEXT",
        content,
        clientMessageId,
        media: [],
      });

      window.setTimeout(() => {
        // `failMessage` is a no-op once the ack has flipped the message to
        // "sent", so this only bites when nothing came back.
        dispatch(failMessage({ conversationId: cid, clientMessageId }));
      }, ACK_TIMEOUT_MS);
    },
    [dispatch],
  );

  const handleRetryMessage = useCallback(
    (message: Message) => {
      if (!conversationId) return;
      const clientMessageId = message.clientMessageId || message.id;
      dispatch(retryMessage({ conversationId, clientMessageId }));
      emitMessage({
        conversationId,
        content: message.text || "",
        clientMessageId,
      });
    },
    [conversationId, dispatch, emitMessage],
  );

  const handleDiscardMessage = useCallback(
    (message: Message) => {
      if (!conversationId) return;
      dispatch(
        discardMessage({
          conversationId,
          clientMessageId: message.clientMessageId || message.id,
        }),
      );
    },
    [conversationId, dispatch],
  );

  const handleSendMessage = useCallback(() => {
    if (!canSendMessage || msg.trim() === "" || !conversationId) return;

    const clientMessageId = createClientMessageId("temp-id");
    const tempMessage = createTempMessage({
      id: clientMessageId,
      type: "TEXT",
      text: msg,
      clientMessageId,
    });

    dispatch(addMessage(tempMessage));
    dispatch(updateNewMessage({ conversationId, lastMessage: tempMessage }));
    ensureConversationInStore(tempMessage);

    emitMessage({ conversationId, content: msg, clientMessageId });

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
    emitMessage,
    ensureConversationInStore,
    msg,
    stopTyping,
  ]);

  const handleUploadMedia = useCallback(
    async (file: File) => {
      if (!canSendMessage || !conversationId) return;

      const mediaType = getMessageTypeFromFile(file);
      const mimeType = getMimeTypeFromFile(file);
      const clientMessageId = createClientMessageId("temp-media");

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
    handleRetryMessage,
    handleDiscardMessage,
  };
}
