import { useCallback, useEffect, useState, type RefObject } from "react";
import { useDispatch, useSelector } from "react-redux";
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
  selectDraft,
  setDraft,
  type Message,
} from "@/redux/slices/messageSlice";
import type { UserState } from "@/redux/slices/userSlice";
import type { AppDispatch, RootState } from "@/redux/store";
import { getMessageTypeFromFile, getMimeTypeFromFile } from "@/utils/chatMedia";
import { validateUploadFile } from "@/utils/mediaLimits";
import { toast } from "sonner";
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

/** Số tệp tối đa trong một tin nhắn. */
const MAX_ATTACHMENTS = 10;

/** Một tệp đã chọn, đang chờ gửi. */
export interface PendingAttachment {
  id: string;
  file: File;
  kind: "IMAGE" | "VIDEO" | "FILE";
  /** Object URL dùng cho ảnh/video xem trước ngay trên trình duyệt. */
  previewUrl: string;
  progress: number;
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
  /**
   * The composer text lives in the store, keyed by conversation.
   *
   * Keeping it in component state meant leaving a thread — which unmounts
   * ChatWindow — threw away whatever was half-typed. Reading and writing the
   * store directly also avoids having to keep a local copy in sync. The
   * `message` slice is excluded from persistence, so drafts stay in memory and
   * are cleared on logout with the rest of the user's data.
   */
  const msg = useSelector((state: RootState) =>
    selectDraft(state, conversationId),
  );

  /**
   * Tin nhắn đang được trả lời, kèm cuộc trò chuyện mà nó thuộc về.
   *
   * Lưu kèm id cuộc trò chuyện để suy ra trực tiếp khi đổi phòng, thay vì
   * dùng một effect gọi setState — trích dẫn của phòng cũ tự hết hiệu lực.
   */
  const [replyDraft, setReplyDraft] = useState<{
    conversationId: string;
    message: Message;
  } | null>(null);

  const replyingTo =
    replyDraft && replyDraft.conversationId === conversationId
      ? replyDraft.message
      : null;

  const setReplyingTo = useCallback(
    (message: Message | null) => {
      if (!conversationId || !message) {
        setReplyDraft(null);
        return;
      }
      setReplyDraft({ conversationId, message });
    },
    [conversationId],
  );

  const setMsg = useCallback(
    (text: string) => {
      if (!conversationId) return;
      dispatch(setDraft({ conversationId, text }));
    },
    [conversationId, dispatch],
  );

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
      replyToMessageId,
    }: {
      conversationId: string;
      content: string;
      clientMessageId: string;
      replyToMessageId?: string;
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
        replyToMessageId,
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
        replyToMessageId: message.replyToMessageId,
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

  // ---------------------------------------------------------------------
  // Tệp đính kèm: chọn -> xem trước -> gửi
  // ---------------------------------------------------------------------

  /**
   * Files chosen but not yet sent.
   *
   * Attachments used to upload the instant they were picked: no chance to
   * check you grabbed the right file, no way to back out, and only one file
   * per message. They now queue here until the message is sent.
   */
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  const addFiles = useCallback(
    (files: File[]) => {
      if (!canSendMessage || !conversationId || !files.length) return;

      const accepted: PendingAttachment[] = [];
      const rejected: string[] = [];

      for (const file of files) {
        const problem = validateUploadFile(file);
        if (problem) {
          rejected.push(problem);
          continue;
        }
        accepted.push({
          id: createClientMessageId("att"),
          file,
          kind: getMessageTypeFromFile(file),
          // Object URLs, not data URLs: the thumbnail is ready immediately and
          // costs no memory beyond a handle. Revoked when the file is removed.
          previewUrl: URL.createObjectURL(file),
          progress: 0,
        });
      }

      // One bad file must not throw away the good ones picked alongside it.
      rejected.forEach((message) => toast.error(message));

      if (accepted.length) {
        setAttachments((prev) => {
          const room = MAX_ATTACHMENTS - prev.length;
          if (room <= 0) {
            toast.error(`Mỗi tin nhắn gửi tối đa ${MAX_ATTACHMENTS} tệp.`);
            accepted.forEach((a) => URL.revokeObjectURL(a.previewUrl));
            return prev;
          }
          if (accepted.length > room) {
            toast.error(`Mỗi tin nhắn gửi tối đa ${MAX_ATTACHMENTS} tệp; đã bỏ bớt ${accepted.length - room} tệp.`);
            accepted.slice(room).forEach((a) => URL.revokeObjectURL(a.previewUrl));
          }
          return [...prev, ...accepted.slice(0, room)];
        });
      }
    },
    [canSendMessage, conversationId],
  );

  // Rời trang giữa chừng sẽ mất tệp đang tải: hỏi lại trước khi thoát.
  useEffect(() => {
    if (!isUploading) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isUploading]);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => {
      const target = prev.find((a) => a.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((a) => a.id !== id);
    });
  }, []);

  const clearAttachments = useCallback(() => {
    setAttachments((prev) => {
      prev.forEach((a) => URL.revokeObjectURL(a.previewUrl));
      return [];
    });
  }, []);

  /** Uploads every queued file, then sends one message carrying all of them. */
  const sendWithAttachments = useCallback(
    async (pending: PendingAttachment[], text: string, quoted: Message | null) => {
      if (!conversationId) return;

      const clientMessageId = createClientMessageId("temp-media");
      const tempMedias: MessageMediaInput[] = pending.map((a, index) => ({
        mediaType: a.kind,
        objectKey: "",
        url: a.previewUrl,
        mimeType: getMimeTypeFromFile(a.file),
        size: String(a.file.size),
        fileName: a.file.name,
        sortOrder: index,
      }));

      const kinds = new Set(pending.map((a) => a.kind));
      const messageType = kinds.size === 1 ? [...kinds][0] : "FILE";

      const tempMessage = createTempMessage({
        id: clientMessageId,
        type: messageType,
        text,
        medias: tempMedias,
        clientMessageId,
        ...(quoted ? { replyToMessageId: quoted.id } : {}),
      });

      dispatch(addMessage(tempMessage));
      dispatch(updateNewMessage({ conversationId, lastMessage: tempMessage }));
      ensureConversationInStore(tempMessage);

      setIsUploading(true);
      try {
        const uploaded = await Promise.all(
          pending.map(async (attachment, index) => {
            const mimeType = getMimeTypeFromFile(attachment.file);
            const upload = await createMessageUploadUrlAPI({
              conversationId,
              type: attachment.kind,
              mimeType,
              fileName: attachment.file.name,
              size: String(attachment.file.size),
            });

            await uploadFileToSignedUrl(upload.uploadUrl, attachment.file, mimeType);
            setAttachments((prev) =>
              prev.map((a) => (a.id === attachment.id ? { ...a, progress: 100 } : a)),
            );

            return {
              mediaType: attachment.kind,
              objectKey: upload.objectKey,
              url: upload.publicUrl,
              mimeType,
              size: String(attachment.file.size),
              fileName: attachment.file.name,
              sortOrder: index,
            };
          }),
        );

        socket.emit("message:create", {
          conversationId,
          type: messageType,
          content: text.trim() || null,
          clientMessageId,
          replyToMessageId: quoted?.id,
          media: uploaded,
        });

        clearAttachments();
        setMsg("");
        setReplyingTo(null);
      } catch (error) {
        showErrorToast(error, "Không thể tải tệp lên");
        dispatch(failMessage({ conversationId, clientMessageId }));
      } finally {
        setIsUploading(false);
      }
    },
    [
      clearAttachments,
      conversationId,
      createTempMessage,
      dispatch,
      ensureConversationInStore,
      setMsg,
      setReplyingTo,
    ],
  );

  const handleSendMessage = useCallback(() => {
    if (!canSendMessage || !conversationId || isUploading) return;

    if (attachments.length) {
      void sendWithAttachments(attachments, msg, replyingTo);
      return;
    }

    if (msg.trim() === "") return;

    const clientMessageId = createClientMessageId("temp-id");
    const quoted = replyingTo;
    const tempMessage = createTempMessage({
      id: clientMessageId,
      type: "TEXT",
      text: msg,
      clientMessageId,
      // Hiển thị trích dẫn ngay ở bản tạm, không đợi máy chủ dựng lại.
      ...(quoted
        ? {
            replyToMessageId: quoted.id,
            replyTo: {
              id: quoted.id,
              senderId: quoted.senderId,
              senderName:
                quoted.senderMember?.fullName ||
                quoted.senderMember?.username ||
                "",
              text: quoted.text || "",
              type: String(quoted.type ?? "TEXT"),
              isRevoked: Boolean(quoted.isRevoked),
            },
          }
        : {}),
    });

    dispatch(addMessage(tempMessage));
    dispatch(updateNewMessage({ conversationId, lastMessage: tempMessage }));
    ensureConversationInStore(tempMessage);

    emitMessage({
      conversationId,
      content: msg,
      clientMessageId,
      replyToMessageId: quoted?.id,
    });

    stopTyping();
    setMsg("");
    setReplyingTo(null);

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
    attachments,
    isUploading,
    replyingTo,
    sendWithAttachments,
    setMsg,
    setReplyingTo,
    stopTyping,
  ]);

  return {
    msg,
    setMsg,
    handleSendMessage,
    handleRetryMessage,
    handleDiscardMessage,
    replyingTo,
    setReplyingTo,
    attachments,
    addFiles,
    removeAttachment,
    isUploading,
  };
}
