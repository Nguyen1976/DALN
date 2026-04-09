import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Phone,
  Video,
  MoreVertical,
  Paperclip,
  Smile,
  Send,
  CircleChevronDown,
} from "lucide-react";
import {
  addConversation,
  applyConversationUpdate,
  markConversationRead,
  updateNewMessage,
  type Conversation,
  type ConversationState,
} from "@/redux/slices/conversationSlice";
import { useDispatch, useSelector } from "react-redux";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AppDispatch, RootState } from "@/redux/store";
import { selectUser } from "@/redux/slices/userSlice";
import {
  failMessage,
  addMessage,
  getMessages,
  selectMessagePagination,
  selectMessage,
  type Message,
} from "@/redux/slices/messageSlice";
import { selectTypingUsersInConversation } from "@/redux/slices/typingIndicatorSlice";
import MessageComponent from "./Messages";
import EmojiPicker from "emoji-picker-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { socket } from "@/lib/socket";
import { useLocation } from "react-router";
import {
  createMessageUploadUrlAPI,
  getConversationByIdAPI,
  uploadFileToSignedUrl,
  type MessageMediaInput,
} from "@/apis";
import { useConversationRoom } from "@/hooks/useConversationRoom";
import { useTypingIndicator } from "@/hooks/useTypingIndicator";
import { SOCKET_EVENTS } from "@/lib/socket.events";
import { TypingIndicator } from "@/components/TypingIndicator";

interface ChatWindowProps {
  conversationId?: string;
  onToggleProfile: () => void;
  onVoiceCall: () => void;
  focusMessageId?: string | null;
  onFocusHandled?: () => void;
}

export default function ChatWindow({
  conversationId,
  onToggleProfile,
  onVoiceCall,
  focusMessageId,
  onFocusHandled,
}: ChatWindowProps) {
  const [msg, setMsg] = useState<string>("");

  const containerRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const topSentinelRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [highlightMessageId, setHighlightMessageId] = useState<string | null>(
    null,
  );
  const hydratedConversationRef = useRef<string | null>(null);

  const dispatch = useDispatch<AppDispatch>();
  const location = useLocation();

  const conversation = useSelector(
    (state: { conversations: ConversationState }) => {
      return state.conversations?.find((c) => c.id === conversationId);
    },
  );
  const pendingConversation = (
    location.state as { conversation?: Conversation } | null
  )?.conversation;
  const fallbackConversation =
    pendingConversation?.id === conversationId
      ? pendingConversation
      : undefined;
  const effectiveConversation = conversation || fallbackConversation;
  const user = useSelector(selectUser);
  const canSendMessage = effectiveConversation?.canSendMessage !== false;
  const membershipStatus = effectiveConversation?.membershipStatus || "ACTIVE";
  const canLoadMessages = membershipStatus === "ACTIVE";

  const conversationName =
    effectiveConversation?.type === "DIRECT"
      ? effectiveConversation.members?.find(
          (member) => member.userId !== user.id,
        )?.username ||
        effectiveConversation.groupName ||
        "Trò chuyện trực tiếp"
      : effectiveConversation?.groupName || "Nhóm chat";

  const conversationAvatar =
    effectiveConversation?.type === "DIRECT"
      ? effectiveConversation.members?.find(
          (member) => member.userId !== user.id,
        )?.avatar || ""
      : (effectiveConversation?.groupAvatar as string) || "";
  const messages = useSelector((state: RootState) =>
    selectMessage(state, conversationId),
  );
  const pagination = useSelector((state: RootState) =>
    selectMessagePagination(state, conversationId),
  );

  // Get typing users in this conversation
  const typingUsers = useSelector((state: RootState) =>
    selectTypingUsersInConversation(state, conversationId || ""),
  );

  // Get all seen status for this conversation
  const allSeenStatus = useSelector((state: RootState) => {
    const seenState = state.seenStatus as any;
    return conversationId && seenState?.seenByUser?.[conversationId]
      ? seenState.seenByUser[conversationId]
      : {};
  });

  // Make conversation members available for display
  const conversationMembers = effectiveConversation?.members || [];
  const memberNamesMap = new Map(
    conversationMembers.map((m) => [
      m.userId,
      m.username || m.fullName || "Unknown",
    ]),
  );
  const memberAvatarMap = new Map(
    conversationMembers.map((m) => [m.userId, m.avatar || ""]),
  );

  // Get typing user display names (filter out current user)
  const typingUserNames = typingUsers
    .filter((uid) => uid !== user.id)
    .map((uid) => memberNamesMap.get(uid) || "Unknown user");

  // Build seenMessages object for MessageComponent with proper typing
  const seenMessages: Record<
    string,
    { userId: string; username?: string; avatar?: string }[]
  > = {};
  Object.entries(allSeenStatus).forEach(
    ([messageId, seenUsers]: [string, any]) => {
      if (Array.isArray(seenUsers)) {
        seenMessages[messageId] = seenUsers.map((s: any) => ({
          userId: s.userId,
          username: memberNamesMap.get(s.userId),
          avatar: memberAvatarMap.get(s.userId),
        }));
      }
    },
  );

  // Setup conversation room join/leave
  useConversationRoom(conversationId);

  useEffect(() => {
    if (!conversationId) return;
    if (effectiveConversation?.members?.length) return;
    if (hydratedConversationRef.current === conversationId) return;

    hydratedConversationRef.current = conversationId;

    void (async () => {
      try {
        const response = await getConversationByIdAPI(conversationId);
        if (!response?.conversation) return;

        dispatch(
          applyConversationUpdate({
            conversation: response.conversation as Conversation,
          }),
        );
      } catch {
        hydratedConversationRef.current = null;
      }
    })();
  }, [conversationId, effectiveConversation?.members?.length, dispatch]);

  // Setup typing indicator
  const { handleTyping, stopTyping, handleInputFocus, handleInputBlur } =
    useTypingIndicator({
      conversationId: conversationId || "",
      enabled: canSendMessage && !!conversationId,
    });

  useEffect(() => {
    if (!isAtBottom) return;

    bottomRef.current?.scrollIntoView({
      behavior: "smooth",
    });
  }, [messages.length, isAtBottom]);

  useEffect(() => {
    if (!conversationId) return;
    if (!canLoadMessages) return;
    if (messages.length === 0) {
      dispatch(
        getMessages({
          conversationId,
          limit: 20,
          cursor: null,
        }),
      );
    }
  }, [dispatch, messages.length, conversationId, canLoadMessages]);

  const loadOlderMessages = useCallback(async () => {
    if (!conversationId) return;
    if (!canLoadMessages) return;
    if (!pagination.hasMore) return;
    if (!pagination.oldestCursor) return;
    if (isLoadingOlder) return;

    const container = containerRef.current;
    const previousHeight = container?.scrollHeight || 0;

    setIsLoadingOlder(true);
    try {
      await dispatch(
        getMessages({
          conversationId,
          limit: 20,
          cursor: pagination.oldestCursor,
        }),
      ).unwrap();
    } finally {
      requestAnimationFrame(() => {
        const current = containerRef.current;
        if (current) {
          const nextHeight = current.scrollHeight;
          current.scrollTop = nextHeight - previousHeight + current.scrollTop;
        }
      });
      setIsLoadingOlder(false);
    }
  }, [
    conversationId,
    dispatch,
    canLoadMessages,
    pagination.hasMore,
    pagination.oldestCursor,
    isLoadingOlder,
  ]);

  useEffect(() => {
    if (!canLoadMessages) return;
    const container = containerRef.current;
    const sentinel = topSentinelRef.current;

    if (!container || !sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (!first?.isIntersecting) return;
        void loadOlderMessages();
      },
      {
        root: container,
        rootMargin: "120px 0px 0px 0px",
        threshold: 0,
      },
    );

    observer.observe(sentinel);

    return () => {
      observer.disconnect();
    };
  }, [loadOlderMessages, conversationId, canLoadMessages]);

  useEffect(() => {
    if (!canLoadMessages) return;
    if (!focusMessageId || !conversationId) return;

    const targetElement = document.getElementById(`message-${focusMessageId}`);
    if (targetElement) {
      targetElement.scrollIntoView({ behavior: "smooth", block: "center" });
      setHighlightMessageId(focusMessageId);
      window.setTimeout(() => {
        setHighlightMessageId((prev) =>
          prev === focusMessageId ? null : prev,
        );
      }, 1800);
      onFocusHandled?.();
      return;
    }

    if (pagination.hasMore && !isLoadingOlder) {
      void loadOlderMessages();
    }
  }, [
    focusMessageId,
    conversationId,
    messages,
    pagination.hasMore,
    isLoadingOlder,
    loadOlderMessages,
    onFocusHandled,
    canLoadMessages,
  ]);

  useEffect(() => {
    if (!canLoadMessages) return;
    if (!conversationId) return;
    if (messages.length === 0) return;

    const lastMessage: Message = messages[messages.length - 1];

    // Chỉ đánh dấu read nếu message KHÔNG phải của mình
    if (lastMessage.senderId === user.id) return;

    // Emit socket event để báo cho server (Realtime Service) biết
    socket.emit(SOCKET_EVENTS.CHAT.MESSAGE_READ, {
      conversationId,
      lastMessageId: lastMessage.id,
    });

    dispatch(
      markConversationRead({
        conversationId,
      }),
    );
  }, [messages, conversationId, dispatch, user.id, canLoadMessages]);

  const handleSendMessage = useCallback(() => {
    if (!canSendMessage) return;
    if (msg.trim() === "" || !conversationId) return;

    const clientMessageId = "temp-id-" + Date.now();

    const tempMessage: Message = {
      id: clientMessageId,
      conversationId,
      senderId: user.id,
      text: msg,
      content: msg,
      type: "TEXT",
      clientMessageId,
      status: "pending",
      createdAt: new Date().toISOString(),
      senderMember: {
        userId: user.id,
        username: user.username,
        fullName: user.fullName,
        avatar: user.avatar || "",
      },
    };

    dispatch(addMessage(tempMessage));
    dispatch(updateNewMessage({ conversationId, lastMessage: tempMessage }));

    if (!conversation && effectiveConversation) {
      dispatch(
        addConversation({
          conversation: {
            ...effectiveConversation,
            lastMessage: tempMessage,
            updatedAt: tempMessage.createdAt,
          },
          userId: user.id,
        }),
      );
    }

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
    canSendMessage,
    msg,
    dispatch,
    conversationId,
    user.id,
    user.username,
    user.fullName,
    user.avatar,
    conversation,
    effectiveConversation,
    stopTyping,
  ]);

  const getMessageTypeFromFile = (file: File): "IMAGE" | "VIDEO" | "FILE" => {
    if (file.type.startsWith("image/")) return "IMAGE";
    if (file.type.startsWith("video/")) return "VIDEO";
    return "FILE";
  };

  const handleUploadMedia = useCallback(
    async (file: File) => {
      if (!canSendMessage) return;
      if (!conversationId) return;

      const mediaType = getMessageTypeFromFile(file);
      const clientMessageId = `temp-media-${Date.now()}`;

      const tempMedia: MessageMediaInput = {
        mediaType,
        objectKey: "",
        url: URL.createObjectURL(file),
        mimeType: file.type,
        size: String(file.size),
        width: undefined,
        height: undefined,
        duration: undefined,
        sortOrder: 0,
      };

      const tempMessage: Message = {
        id: clientMessageId,
        conversationId,
        senderId: user.id,
        text: msg,
        content: msg,
        type: mediaType,
        medias: [tempMedia],
        clientMessageId,
        status: "pending",
        createdAt: new Date().toISOString(),
        senderMember: {
          userId: user.id,
          username: user.username,
          fullName: user.fullName,
          avatar: user.avatar || "",
        },
      };

      dispatch(addMessage(tempMessage));
      dispatch(updateNewMessage({ conversationId, lastMessage: tempMessage }));

      if (!conversation && effectiveConversation) {
        dispatch(
          addConversation({
            conversation: {
              ...effectiveConversation,
              lastMessage: tempMessage,
              updatedAt: tempMessage.createdAt,
            },
            userId: user.id,
          }),
        );
      }

      try {
        const upload = await createMessageUploadUrlAPI({
          conversationId,
          type: mediaType,
          mimeType: file.type,
          fileName: file.name,
          size: String(file.size),
        });

        await uploadFileToSignedUrl(upload.uploadUrl, file, file.type);

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
              mimeType: file.type,
              size: String(file.size),
              sortOrder: 0,
            },
          ],
        });

        setMsg("");
      } catch (error) {
        console.error("upload media failed", error);
        dispatch(
          failMessage({
            conversationId,
            clientMessageId,
          }),
        );
      }
    },
    [
      canSendMessage,
      conversationId,
      user.id,
      user.username,
      user.fullName,
      user.avatar,
      msg,
      dispatch,
      conversation,
      effectiveConversation,
    ],
  );

  return (
    <div className="flex-1 flex flex-col bg-bg-box-chat">
      {/* Header */}
      <div className="h-16 bg-black-bland border-b border-bg-box-message-incoming flex items-center justify-between px-6">
        <button
          onClick={onToggleProfile}
          className="flex items-center gap-3 hover:opacity-80 transition-opacity"
        >
          <Avatar className="w-10 h-10">
            <AvatarImage
              src={conversationAvatar || "/placeholder.svg"}
              alt={conversationName || "Ảnh đại diện nhóm"}
            />
            <AvatarFallback>{conversationName?.[0]}</AvatarFallback>
          </Avatar>
          <div className="text-left">
            <div className="font-medium text-text">{conversationName}</div>
            <div className="text-xs text-gray-400">
              {effectiveConversation?.type === "DIRECT"
                ? "Trò chuyện trực tiếp"
                : "Nhóm"}
            </div>
          </div>
        </button>

        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={onVoiceCall}
            className="hover:bg-bg-box-message-incoming text-gray-400 hover:text-text"
          >
            <Phone className="w-5 h-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="hover:bg-bg-box-message-incoming text-gray-400 hover:text-text"
          >
            <Video className="w-5 h-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleProfile}
            className="hover:bg-bg-box-message-incoming text-gray-400 hover:text-text"
          >
            <MoreVertical className="w-5 h-5" />
          </Button>
        </div>
      </div>

      {/* Messages */}
      <div
        className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar"
        ref={containerRef}
        onScroll={() => {
          const el = containerRef.current;
          if (!el) return;

          const threshold = 120; // px
          const atBottom =
            el.scrollHeight - el.scrollTop - el.clientHeight < threshold;

          setIsAtBottom(atBottom);

          if (canLoadMessages && el.scrollTop <= 24) {
            void loadOlderMessages();
          }
        }}
      >
        <div ref={topSentinelRef} className="h-px w-full" />
        <MessageComponent
          messages={messages}
          highlightMessageId={highlightMessageId}
          seenMessages={seenMessages}
        />

        {/* Typing Indicator */}
        <TypingIndicator userNames={typingUserNames} />

        <div ref={bottomRef} />
      </div>

      {!canSendMessage && (
        <div className="px-6 py-2 text-sm text-amber-300 bg-amber-500/10 border-t border-amber-500/20">
          {membershipStatus === "REMOVED"
            ? "Bạn không còn trong nhóm này"
            : "Bạn đã rời khỏi nhóm này"}
        </div>
      )}

      {/* Input */}
      {!isAtBottom && (
        <button
          onClick={() =>
            bottomRef.current?.scrollIntoView({ behavior: "smooth" })
          }
          className="flex justify-center mx-auto bg-transparent"
        >
          <CircleChevronDown className="text-bg-box-message-out animate-bounce w-8 h-8" />
        </button>
      )}
      <div className="h-16 bg-black-bland border-t border-bg-box-message-incoming flex items-center gap-3 px-6">
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            void handleUploadMedia(file);
            e.currentTarget.value = "";
          }}
        />
        <Button
          variant="ghost"
          size="icon"
          onClick={() => fileInputRef.current?.click()}
          disabled={!canSendMessage}
          className="hover:bg-bg-box-message-incoming text-gray-400 hover:text-text"
        >
          <Paperclip className="w-5 h-5" />
        </Button>

        <input
          type="text"
          placeholder="Nhập tin nhắn..."
          disabled={!canSendMessage}
          className="flex-1 bg-transparent text-text placeholder:text-gray-500 outline-none text-sm"
          onChange={(e) => {
            setMsg(e.target.value);
            handleTyping(e.target.value); // Emit typing indicator
          }}
          value={msg}
          onFocus={handleInputFocus}
          onBlur={handleInputBlur}
          onKeyDown={(e) => {
            // Nếu đang trong quá trình gõ tiếng Việt (IME composition), không gửi
            if (e.nativeEvent.isComposing) return;

            if (e.key === "Enter" && !e.shiftKey) {
              // Thường Shift+Enter là xuống dòng
              e.preventDefault();
              handleSendMessage();
            }
          }}
        />

        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="
        text-gray-400 
        hover:text-text 
        hover:bg-bg-box-message-incoming
      "
            >
              <Smile className="w-5 h-5" />
            </Button>
          </PopoverTrigger>

          <PopoverContent
            side="top"
            align="end"
            className="p-0 border-none shadow-none bg-transparent"
          >
            <EmojiPicker
              height={360}
              width={300}
              searchDisabled={false}
              skinTonesDisabled
              previewConfig={{ showPreview: false }}
              onEmojiClick={(emoji) => {
                // TODO: insert emoji vào input
                setMsg((prev) => prev + emoji.emoji);
                //đóng popover sau khi chọn
              }}
            />
          </PopoverContent>
        </Popover>

        <Button
          size="icon"
          className="bg-bg-box-message-out hover:bg-purple-700 text-text rounded-full"
          onClick={handleSendMessage}
        >
          <Send className="w-5 h-5" />
        </Button>
      </div>
    </div>
  );
}
