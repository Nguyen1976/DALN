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
  Trash2,
  Plus,
  X,
  Settings,
  Lock,
  ListChecks,
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
  revokeMessage as revokeMessageAction,
  deleteMessageForMe as deleteMessageForMeAction,
  clearConversationMessages,
  updateMessagePoll,
  type Message,
} from "@/redux/slices/messageSlice";
import { clearConversationSeenStatus } from "@/redux/slices/seenStatusSlice";
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
  closePollAPI,
  createPollAPI,
  createMessageUploadUrlAPI,
  clearConversationHistoryAPI,
  deleteMessageForMeAPI,
  getConversationByIdAPI,
  revokeMessageAPI,
  submitPollVoteAPI,
  uploadFileToSignedUrl,
  type MessageMediaInput,
} from "@/apis";
import { useConversationRoom } from "@/hooks/useConversationRoom";
import { useTypingIndicator } from "@/hooks/useTypingIndicator";
import { SOCKET_EVENTS } from "@/lib/socket.events";
import { TypingIndicator } from "@/components/TypingIndicator";
import { toast } from "sonner";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";

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
  const [showClearHistoryDialog, setShowClearHistoryDialog] = useState(false);
  const [showCreatePollDialog, setShowCreatePollDialog] = useState(false);
  const [showPollDetailDialog, setShowPollDetailDialog] = useState(false);
  const [showClosePollConfirmDialog, setShowClosePollConfirmDialog] =
    useState(false);
  const [pollQuestion, setPollQuestion] = useState("");
  const [pollOptions, setPollOptions] = useState<string[]>(["", ""]);
  const [isMultipleChoicePoll, setIsMultipleChoicePoll] = useState(true);
  const [activePollMessageId, setActivePollMessageId] = useState<string | null>(
    null,
  );
  const [selectedVoteOptionIds, setSelectedVoteOptionIds] = useState<string[]>(
    [],
  );
  const [pollVoteSelections, setPollVoteSelections] = useState<
    Record<string, string[]>
  >({});
  const [pollStats, setPollStats] = useState<
    Record<string, { totalVoters: number; totalVotes: number }>
  >({});
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

  const activePollMessage = messages.find(
    (message) => message.id === activePollMessageId,
  );
  const activePoll = activePollMessage?.poll;
  const activePollTotalVotes = activePoll
    ? (pollStats[activePoll.id]?.totalVotes ??
      activePoll.options.reduce((sum, option) => sum + option.count, 0))
    : 0;
  const activePollTotalVoters = activePoll
    ? (pollStats[activePoll.id]?.totalVoters ?? 0)
    : 0;

  const normalizedCreateOptions = pollOptions
    .map((option) => option.trim())
    .filter(Boolean);
  const duplicateOptionMap = new Map<string, number>();
  normalizedCreateOptions.forEach((option) => {
    const key = option.toLowerCase();
    duplicateOptionMap.set(key, (duplicateOptionMap.get(key) || 0) + 1);
  });
  const hasDuplicateOptions = Array.from(duplicateOptionMap.values()).some(
    (count) => count > 1,
  );
  const canCreatePoll =
    Boolean(pollQuestion.trim()) &&
    normalizedCreateOptions.length >= 2 &&
    !hasDuplicateOptions;

  useEffect(() => {
    if (!activePoll) return;
    setSelectedVoteOptionIds(pollVoteSelections[activePoll.id] || []);
  }, [activePoll, pollVoteSelections]);

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
      setShowClearHistoryDialog(false);
      toast.success("Đã xóa toàn bộ lịch sử trò chuyện");
    } catch {
      toast.error("Không thể xóa lịch sử trò chuyện");
    }
  }, [conversationId, dispatch]);

  const handleOpenCreatePollDialog = useCallback(() => {
    setPollQuestion("");
    setPollOptions(["", ""]);
    setIsMultipleChoicePoll(true);
    setShowCreatePollDialog(true);
  }, []);

  const handleCreatePoll = useCallback(async () => {
    if (!conversationId || !canCreatePoll) return;

    try {
      const result = await createPollAPI({
        conversationId,
        question: pollQuestion.trim(),
        options: normalizedCreateOptions,
        isMultipleChoice: isMultipleChoicePoll,
      });

      if (result?.message) {
        dispatch(addMessage(result.message as Message));
        dispatch(
          updateNewMessage({
            conversationId,
            lastMessage: result.message as Message,
          }),
        );

        if (result.poll?.id) {
          setPollStats((prev) => ({
            ...prev,
            [result.poll.id]: {
              totalVoters: 0,
              totalVotes: 0,
            },
          }));
        }
      }

      setShowCreatePollDialog(false);
      toast.success("Tạo bình chọn thành công");
    } catch {
      toast.error("Không thể tạo bình chọn");
    }
  }, [
    canCreatePoll,
    conversationId,
    dispatch,
    isMultipleChoicePoll,
    normalizedCreateOptions,
    pollQuestion,
  ]);

  const handleOpenPoll = useCallback(
    (message: Message) => {
      if (!message.poll) return;
      setActivePollMessageId(message.id);
      setSelectedVoteOptionIds(pollVoteSelections[message.poll.id] || []);
      setShowPollDetailDialog(true);
    },
    [pollVoteSelections],
  );

  const handleToggleVoteOption = useCallback(
    (optionId: string) => {
      if (!activePoll || activePoll.isClosed) return;

      setSelectedVoteOptionIds((prev) => {
        if (activePoll.isMultipleChoice) {
          return prev.includes(optionId)
            ? prev.filter((id) => id !== optionId)
            : [...prev, optionId];
        }

        if (prev.includes(optionId)) return [];
        return [optionId];
      });
    },
    [activePoll],
  );

  const handleSubmitPollVote = useCallback(async () => {
    if (!activePoll || !activePollMessage || selectedVoteOptionIds.length < 1) {
      return;
    }

    const previousOptions = activePoll.options;
    const previousSelection = pollVoteSelections[activePoll.id] || [];
    const previousStats = pollStats[activePoll.id] || {
      totalVoters: 0,
      totalVotes: previousOptions.reduce(
        (sum, option) => sum + option.count,
        0,
      ),
    };

    const previousSet = new Set(previousSelection);
    const nextSet = new Set(selectedVoteOptionIds);

    const optimisticOptions = previousOptions.map((option) => {
      const wasSelected = previousSet.has(option.id);
      const isSelected = nextSet.has(option.id);
      if (wasSelected === isSelected) return option;

      return {
        ...option,
        count: Math.max(0, option.count + (isSelected ? 1 : -1)),
      };
    });

    dispatch(
      updateMessagePoll({
        conversationId: activePollMessage.conversationId,
        messageId: activePollMessage.id,
        poll: {
          ...activePoll,
          options: optimisticOptions,
        },
      }),
    );

    const optimisticTotalVotes = optimisticOptions.reduce(
      (sum, option) => sum + option.count,
      0,
    );
    const optimisticTotalVoters = Math.max(
      0,
      previousStats.totalVoters + (previousSelection.length ? 0 : 1),
    );

    setPollVoteSelections((prev) => ({
      ...prev,
      [activePoll.id]: selectedVoteOptionIds,
    }));
    setPollStats((prev) => ({
      ...prev,
      [activePoll.id]: {
        totalVoters: optimisticTotalVoters,
        totalVotes: optimisticTotalVotes,
      },
    }));

    try {
      const result = await submitPollVoteAPI({
        pollId: activePoll.id,
        optionIds: selectedVoteOptionIds,
      });

      dispatch(
        updateMessagePoll({
          conversationId: result.conversationId,
          messageId: result.messageId,
          poll: {
            ...activePoll,
            isClosed: result.isClosed,
            closedAt: result.closedAt || null,
            options: result.options,
          },
        }),
      );

      setPollVoteSelections((prev) => ({
        ...prev,
        [activePoll.id]: result.userVoteOptionIds || selectedVoteOptionIds,
      }));
      setPollStats((prev) => ({
        ...prev,
        [activePoll.id]: {
          totalVoters:
            result.totalVoters || prev[activePoll.id]?.totalVoters || 0,
          totalVotes: result.options.reduce(
            (sum, option) => sum + option.count,
            0,
          ),
        },
      }));

      toast.success("Đã cập nhật bình chọn");
    } catch {
      dispatch(
        updateMessagePoll({
          conversationId: activePollMessage.conversationId,
          messageId: activePollMessage.id,
          poll: {
            ...activePoll,
            options: previousOptions,
          },
        }),
      );
      setPollVoteSelections((prev) => ({
        ...prev,
        [activePoll.id]: previousSelection,
      }));
      setPollStats((prev) => ({
        ...prev,
        [activePoll.id]: previousStats,
      }));
      toast.error("Không thể gửi bình chọn");
    }
  }, [
    activePoll,
    activePollMessage,
    dispatch,
    pollStats,
    pollVoteSelections,
    selectedVoteOptionIds,
  ]);

  const handleClosePoll = useCallback(async () => {
    if (!activePoll || !activePollMessage) return;

    try {
      const result = await closePollAPI({
        pollId: activePoll.id,
      });

      dispatch(
        updateMessagePoll({
          conversationId: result.conversationId,
          messageId: result.messageId,
          poll: {
            ...activePoll,
            isClosed: true,
            closedAt: result.closedAt || new Date().toISOString(),
          },
        }),
      );
      setShowClosePollConfirmDialog(false);
      toast.success("Đã đóng bình chọn");
    } catch {
      toast.error("Không thể đóng bình chọn");
    }
  }, [activePoll, activePollMessage, dispatch]);

  useEffect(() => {
    const handlePollUpdated = (payload: {
      pollId: string;
      totalVoters: number;
      options: Array<{ id: string; text: string; count: number }>;
    }) => {
      if (!payload?.pollId) return;

      setPollStats((prev) => ({
        ...prev,
        [payload.pollId]: {
          totalVoters: payload.totalVoters || 0,
          totalVotes: (payload.options || []).reduce(
            (sum, option) => sum + Number(option.count || 0),
            0,
          ),
        },
      }));
    };

    const handlePollClosed = (payload: {
      pollId: string;
      options: Array<{ id: string; text: string; count: number }>;
    }) => {
      if (!payload?.pollId) return;

      setPollStats((prev) => {
        const current = prev[payload.pollId] || {
          totalVoters: 0,
          totalVotes: 0,
        };

        return {
          ...prev,
          [payload.pollId]: {
            totalVoters: current.totalVoters,
            totalVotes: (payload.options || []).reduce(
              (sum, option) => sum + Number(option.count || 0),
              0,
            ),
          },
        };
      });
    };

    socket.on(SOCKET_EVENTS.CHAT.POLL_UPDATED, handlePollUpdated);
    socket.on(SOCKET_EVENTS.CHAT.POLL_CLOSED, handlePollClosed);

    return () => {
      socket.off(SOCKET_EVENTS.CHAT.POLL_UPDATED, handlePollUpdated);
      socket.off(SOCKET_EVENTS.CHAT.POLL_CLOSED, handlePollClosed);
    };
  }, []);

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

  const getMimeTypeFromFile = (file: File): string => {
    if (file.type) return file.type;

    const fileName = file.name.toLowerCase();
    if (fileName.endsWith(".java")) return "text/plain";
    if (fileName.endsWith(".txt")) return "text/plain";
    if (fileName.endsWith(".md")) return "text/plain";
    if (fileName.endsWith(".json")) return "application/json";
    if (fileName.endsWith(".csv")) return "text/plain";
    if (fileName.endsWith(".py")) return "text/plain";
    if (fileName.endsWith(".js") || fileName.endsWith(".jsx"))
      return "text/plain";
    if (fileName.endsWith(".ts") || fileName.endsWith(".tsx"))
      return "text/plain";

    return "application/octet-stream";
  };

  const handleUploadMedia = useCallback(
    async (file: File) => {
      if (!canSendMessage) return;
      if (!conversationId) return;

      const mediaType = getMessageTypeFromFile(file);
      const mimeType = getMimeTypeFromFile(file);
      const clientMessageId = `temp-media-${Date.now()}`;

      const tempMedia: MessageMediaInput = {
        mediaType,
        objectKey: "",
        url: URL.createObjectURL(file),
        mimeType,
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

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="hover:bg-bg-box-message-incoming text-gray-400 hover:text-text"
              >
                <MoreVertical className="w-5 h-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64 bg-popover">
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={onToggleProfile}>
                  Xem chi tiết đoạn chat
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => setShowClearHistoryDialog(true)}
                >
                  <Trash2 className="h-4 w-4" />
                  Xóa toàn bộ lịch sử
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
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
          onRevokeMessage={handleRevokeMessage}
          onDeleteMessageForMe={handleDeleteMessageForMe}
          onOpenPoll={handleOpenPoll}
          pollVoteSelections={pollVoteSelections}
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

        <Button
          variant="ghost"
          size="icon"
          disabled={!canSendMessage}
          onClick={handleOpenCreatePollDialog}
          className="hover:bg-bg-box-message-incoming text-gray-400 hover:text-text"
        >
          <ListChecks className="w-5 h-5" />
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

      <Dialog
        open={showClearHistoryDialog}
        onOpenChange={setShowClearHistoryDialog}
      >
        <DialogContent className="bg-background text-foreground">
          <DialogHeader>
            <DialogTitle>Xóa toàn bộ lịch sử trò chuyện?</DialogTitle>
            <DialogDescription>
              Hành động này chỉ ẩn lịch sử ở phía bạn. Người khác vẫn nhìn thấy
              tin nhắn bình thường.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowClearHistoryDialog(false)}
            >
              Hủy
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleClearHistory()}
            >
              Xóa lịch sử
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={showCreatePollDialog}
        onOpenChange={setShowCreatePollDialog}
      >
        <DialogContent className="max-w-2xl bg-background text-foreground">
          <DialogHeader>
            <DialogTitle className="text-2xl font-semibold">
              Tạo bình chọn
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-5">
            <div>
              <label className="mb-2 block text-base font-medium text-foreground">
                Chủ đề bình chọn
              </label>
              <div className="rounded-xl border border-input bg-background p-3">
                <textarea
                  value={pollQuestion}
                  onChange={(event) =>
                    setPollQuestion(event.target.value.slice(0, 200))
                  }
                  placeholder="Đặt câu hỏi bình chọn"
                  className="h-28 w-full resize-none bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground"
                />
                <div className="text-right text-sm text-muted-foreground">
                  {pollQuestion.length}/200
                </div>
              </div>
            </div>

            <div>
              <label className="mb-2 block text-base font-medium text-foreground">
                Các lựa chọn
              </label>
              <div className="space-y-2">
                {pollOptions.map((option, index) => {
                  const key = option.trim().toLowerCase();
                  const isDuplicate =
                    Boolean(key) && (duplicateOptionMap.get(key) || 0) > 1;

                  return (
                    <div key={`poll-option-${index}`}>
                      <div className="flex items-center gap-2 rounded-xl border border-input bg-background px-3 py-2">
                        <input
                          value={option}
                          onChange={(event) => {
                            const nextOptions = [...pollOptions];
                            nextOptions[index] = event.target.value;
                            setPollOptions(nextOptions);
                          }}
                          placeholder={`Lựa chọn ${index + 1}`}
                          className="h-9 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground"
                        />
                        {pollOptions.length > 2 && (
                          <button
                            type="button"
                            onClick={() => {
                              setPollOptions((prev) =>
                                prev.filter(
                                  (_, itemIndex) => itemIndex !== index,
                                ),
                              );
                            }}
                            className="rounded-md p-1 text-muted-foreground hover:bg-accent"
                          >
                            <X className="h-5 w-5" />
                          </button>
                        )}
                      </div>
                      {isDuplicate && (
                        <p className="mt-1 text-sm text-destructive">
                          Phương án được thêm đã tồn tại
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => setPollOptions((prev) => [...prev, ""])}
                className="mt-3 inline-flex items-center gap-2 text-base font-semibold text-primary hover:text-primary/80"
              >
                <Plus className="h-5 w-5" />
                Thêm lựa chọn
              </button>
            </div>

            <div className="flex items-center justify-between rounded-xl border border-border bg-muted/40 px-4 py-3">
              <div className="inline-flex items-center gap-2 text-sm text-foreground">
                <Settings className="h-4 w-4" />
                Chọn nhiều phương án
              </div>
              <Checkbox
                checked={isMultipleChoicePoll}
                onCheckedChange={(checked) =>
                  setIsMultipleChoicePoll(Boolean(checked))
                }
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowCreatePollDialog(false)}
            >
              Hủy
            </Button>
            <Button
              disabled={!canCreatePoll}
              onClick={() => void handleCreatePoll()}
            >
              Tạo bình chọn
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={showPollDetailDialog}
        onOpenChange={setShowPollDetailDialog}
      >
        <DialogContent className="max-w-2xl bg-background text-foreground">
          <DialogHeader>
            <DialogTitle className="text-2xl font-semibold">
              Bình chọn
            </DialogTitle>
            <DialogDescription className="text-base text-foreground">
              {activePoll?.question}
            </DialogDescription>
          </DialogHeader>

          {activePoll && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-muted-foreground">
                <ListChecks className="h-4 w-4" />
                <span className="text-sm">
                  {activePoll.isMultipleChoice
                    ? "Chọn nhiều phương án"
                    : "Chọn một phương án"}
                </span>
                {activePoll.isClosed && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-sm">
                    <Lock className="h-4 w-4" /> Bình chọn đã đóng
                  </span>
                )}
              </div>

              <div className="text-sm font-medium text-primary">
                {activePollTotalVoters} người bình chọn, {activePollTotalVotes}{" "}
                lượt bình chọn
              </div>

              <div className="space-y-2">
                {activePoll.options.map((option) => {
                  const isSelected = selectedVoteOptionIds.includes(option.id);

                  return (
                    <button
                      key={option.id}
                      type="button"
                      disabled={activePoll.isClosed}
                      onClick={() => handleToggleVoteOption(option.id)}
                      className="flex w-full items-center gap-3"
                    >
                      <div
                        className={`h-5 w-5 rounded-full border ${
                          isSelected
                            ? "border-primary bg-primary"
                            : "border-border"
                        }`}
                      />
                      <div
                        className={`flex-1 rounded-xl border px-4 py-2 text-left text-sm ${
                          isSelected
                            ? "border-primary/40 bg-primary/15 text-foreground"
                            : "border-border bg-muted text-foreground"
                        }`}
                      >
                        {option.text}
                      </div>
                      <span className="w-6 text-right text-base font-medium text-foreground">
                        {option.count}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <DialogFooter className="sm:justify-between">
            <Button
              variant="outline"
              className="text-destructive border-destructive/40 hover:bg-destructive/10"
              onClick={() => {
                if (!activePollMessage?.poll || !activePollMessage?.senderId) {
                  return;
                }

                if (activePollMessage.senderId !== user.id) {
                  return;
                }

                setShowClosePollConfirmDialog(true);
              }}
              disabled={
                !activePoll ||
                activePoll.isClosed ||
                activePollMessage?.senderId !== user.id
              }
            >
              <Settings className="h-4 w-4" />
              Đóng bình chọn
            </Button>

            {activePoll?.isClosed ? (
              <Button onClick={() => setShowPollDetailDialog(false)}>
                Đóng
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={() => setShowPollDetailDialog(false)}
                >
                  Hủy
                </Button>
                <Button
                  onClick={() => void handleSubmitPollVote()}
                  disabled={selectedVoteOptionIds.length < 1}
                >
                  Xác nhận
                </Button>
              </div>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={showClosePollConfirmDialog}
        onOpenChange={setShowClosePollConfirmDialog}
      >
        <DialogContent className="max-w-xl bg-background text-foreground">
          <DialogHeader>
            <DialogTitle className="text-xl">Khóa bình chọn?</DialogTitle>
            <DialogDescription>
              Sau khi khóa, bạn và các thành viên khác sẽ không thể tiếp tục
              tham gia bình chọn.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Không</Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={() => void handleClosePoll()}
            >
              Khóa bình chọn
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
