import { useCallback, useMemo, useState } from "react";
import { useDispatch } from "react-redux";
import { toast } from "sonner";
import { closePollAPI, createPollAPI, submitPollVoteAPI } from "@/apis";
import {
  addMessage,
  updateMessagePoll,
  type Message,
  type PollData,
} from "@/redux/slices/messageSlice";
import { updateNewMessage } from "@/redux/slices/conversationSlice";
import type { AppDispatch } from "@/redux/store";

interface UseChatPollOptions {
  conversationId?: string;
  messages: Message[];
}

const totalVotesOf = (poll: PollData) =>
  poll.options.reduce((sum, option) => sum + option.count, 0);

/**
 * Creating, voting on and closing polls. What a poll looks like — counts,
 * voters, your own vote — lives on its message in the store; votes by others
 * arrive there over the socket (see useProtectedRouteChatSockets).
 */
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
  /** The choice being made in the open dialog, before it is sent. */
  const [selectedVoteOptionIds, setSelectedVoteOptionIds] = useState<string[]>(
    [],
  );

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

  const activePollTotalVotes = activePoll ? totalVotesOf(activePoll) : 0;
  const activePollTotalVoters = activePoll?.totalVoters ?? 0;

  const handleOpenCreatePollDialog = useCallback(() => {
    setPollQuestion("");
    setPollOptions(["", ""]);
    setIsMultipleChoicePoll(true);
    setShowCreatePollDialog(true);
  }, []);

  const handleCreatePoll = useCallback(async () => {
    if (!conversationId || !canCreatePoll) return;

    try {
      const message = await createPollAPI({
        conversationId,
        question: pollQuestion.trim(),
        options: normalizedCreateOptions,
        isMultipleChoice: isMultipleChoicePoll,
      });
      dispatch(addMessage(message));
      dispatch(updateNewMessage({ conversationId, lastMessage: message }));

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

  const handleOpenPoll = useCallback((message: Message) => {
    if (!message.poll) return;
    setActivePollMessageId(message.id);
    setSelectedVoteOptionIds(message.poll.myOptionIds ?? []);
    setShowPollDetailDialog(true);
  }, []);

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

  /** Show the vote at once; the server's answer then replaces the guess. */
  const handleSubmitPollVote = useCallback(async () => {
    if (!activePoll || !activePollMessage || selectedVoteOptionIds.length < 1) {
      return;
    }

    const where = {
      conversationId: activePollMessage.conversationId,
      messageId: activePollMessage.id,
    };
    const previous = activePoll.myOptionIds ?? [];
    const before = new Set(previous);
    const after = new Set(selectedVoteOptionIds);
    dispatch(
      updateMessagePoll({
        ...where,
        poll: {
          ...activePoll,
          options: activePoll.options.map((option) =>
            before.has(option.id) === after.has(option.id)
              ? option
              : {
                  ...option,
                  count: Math.max(0, option.count + (after.has(option.id) ? 1 : -1)),
                },
          ),
          totalVoters: activePoll.totalVoters + (previous.length ? 0 : 1),
          myOptionIds: selectedVoteOptionIds,
        },
      }),
    );

    try {
      const result = await submitPollVoteAPI({
        pollId: activePoll.id,
        optionIds: selectedVoteOptionIds,
      });
      dispatch(updateMessagePoll(result));
      toast.success("Đã cập nhật bình chọn");
    } catch {
      dispatch(updateMessagePoll({ ...where, poll: activePoll }));
      toast.error("Không thể gửi bình chọn");
    }
  }, [activePoll, activePollMessage, dispatch, selectedVoteOptionIds]);

  const handleClosePoll = useCallback(async () => {
    if (!activePoll || !activePollMessage) return;

    try {
      dispatch(updateMessagePoll(await closePollAPI({ pollId: activePoll.id })));
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
