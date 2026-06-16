import { useCallback, useEffect, useMemo, useState } from "react";
import { useDispatch } from "react-redux";
import { toast } from "sonner";
import { closePollAPI, createPollAPI, submitPollVoteAPI } from "@/apis";
import { socket } from "@/lib/socket";
import { SOCKET_EVENTS } from "@/lib/socket.events";
import {
  addMessage,
  updateMessagePoll,
  type Message,
  type PollData,
} from "@/redux/slices/messageSlice";
import { updateNewMessage } from "@/redux/slices/conversationSlice";
import type { AppDispatch } from "@/redux/store";

interface PollStats {
  totalVoters: number;
  totalVotes: number;
}

interface UseChatPollOptions {
  conversationId?: string;
  messages: Message[];
}

export function useChatPoll({ conversationId, messages }: UseChatPollOptions) {
  const dispatch = useDispatch<AppDispatch>();

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
  const [pollStats, setPollStats] = useState<Record<string, PollStats>>({});

  const activePollMessage = messages.find(
    (message) => message.id === activePollMessageId,
  );
  const activePoll = activePollMessage?.poll;

  const normalizedCreateOptions = useMemo(
    () => pollOptions.map((option) => option.trim()).filter(Boolean),
    [pollOptions],
  );

  const duplicateOptionMap = useMemo(() => {
    const map = new Map<string, number>();
    normalizedCreateOptions.forEach((option) => {
      const key = option.toLowerCase();
      map.set(key, (map.get(key) || 0) + 1);
    });
    return map;
  }, [normalizedCreateOptions]);

  const hasDuplicateOptions = useMemo(
    () =>
      Array.from(duplicateOptionMap.values()).some((count) => count > 1),
    [duplicateOptionMap],
  );

  const canCreatePoll =
    Boolean(pollQuestion.trim()) &&
    normalizedCreateOptions.length >= 2 &&
    !hasDuplicateOptions;

  const activePollTotalVotes = activePoll
    ? (pollStats[activePoll.id]?.totalVotes ??
      activePoll.options.reduce((sum, option) => sum + option.count, 0))
    : 0;

  const activePollTotalVoters = activePoll
    ? (pollStats[activePoll.id]?.totalVoters ?? 0)
    : 0;

  useEffect(() => {
    if (!activePoll) return;
    setSelectedVoteOptionIds(pollVoteSelections[activePoll.id] || []);
  }, [activePoll, pollVoteSelections]);

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
            [result.poll.id]: { totalVoters: 0, totalVotes: 0 },
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

    const optimisticPoll: PollData = {
      ...activePoll,
      options: optimisticOptions,
    };

    dispatch(
      updateMessagePoll({
        conversationId: activePollMessage.conversationId,
        messageId: activePollMessage.id,
        poll: optimisticPoll,
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
          poll: { ...activePoll, options: previousOptions },
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
      const result = await closePollAPI({ pollId: activePoll.id });

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

  return {
    showCreatePollDialog,
    setShowCreatePollDialog,
    showPollDetailDialog,
    setShowPollDetailDialog,
    showClosePollConfirmDialog,
    setShowClosePollConfirmDialog,
    pollQuestion,
    setPollQuestion,
    pollOptions,
    setPollOptions,
    isMultipleChoicePoll,
    setIsMultipleChoicePoll,
    activePollMessage,
    activePoll,
    selectedVoteOptionIds,
    pollVoteSelections,
    duplicateOptionMap,
    canCreatePoll,
    activePollTotalVotes,
    activePollTotalVoters,
    handleOpenCreatePollDialog,
    handleCreatePoll,
    handleOpenPoll,
    handleToggleVoteOption,
    handleSubmitPollVote,
    handleClosePoll,
  };
}
