import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Phone,
  Video,
  MoreVertical,
  Paperclip,
  Smile,
  Send,
  ChevronDown,
  Trash2,
  Plus,
  X,
  Settings,
  Lock,
  ListChecks,
  ArrowLeft,
} from "lucide-react";
import { useSelector } from "react-redux";
import { useRef, useState } from "react";
import type { RootState } from "@/redux/store";
import {
  selectMessagePagination,
  selectMessage,
} from "@/redux/slices/messageSlice";
import MessageComponent from "./Messages";
import EmojiPicker from "emoji-picker-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useConversationRoom } from "@/hooks/useConversationRoom";
import { useTypingIndicator } from "@/hooks/useTypingIndicator";
import { useChatConversationContext } from "@/hooks/chat/useChatConversationContext";
import { useChatMessageActions } from "@/hooks/chat/useChatMessageActions";
import { useChatPoll } from "@/hooks/chat/useChatPoll";
import { useChatComposer } from "@/hooks/chat/useChatComposer";
import { useChatMessagesScroll } from "@/hooks/chat/useChatMessagesScroll";
import { TypingIndicator } from "@/components/TypingIndicator";
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
  onBack?: () => void;
  focusMessageId?: string | null;
  onFocusHandled?: () => void;
}

export default function ChatWindow({
  conversationId,
  onToggleProfile,
  onVoiceCall,
  onBack,
  focusMessageId,
  onFocusHandled,
}: ChatWindowProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [showClearHistoryDialog, setShowClearHistoryDialog] = useState(false);

  const {
    user,
    effectiveConversation,
    canSendMessage,
    membershipStatus,
    canLoadMessages,
    conversationName,
    conversationAvatar,
    typingUserNames,
    seenMessages,
    conversation,
  } = useChatConversationContext(conversationId);

  const messages = useSelector((state: RootState) =>
    selectMessage(state, conversationId),
  );
  const pagination = useSelector((state: RootState) =>
    selectMessagePagination(state, conversationId),
  );

  const {
    containerRef,
    bottomRef,
    topSentinelRef,
    isAtBottom,
    highlightMessageId,
    handleScroll,
    scrollToBottom,
  } = useChatMessagesScroll({
    conversationId,
    messages,
    pagination,
    canLoadMessages,
    userId: user.id,
    focusMessageId,
    onFocusHandled,
  });

  const { handleTyping, stopTyping, handleInputFocus, handleInputBlur } =
    useTypingIndicator({
      conversationId: conversationId || "",
      enabled: canSendMessage && !!conversationId,
    });

  const { msg, setMsg, handleSendMessage, handleUploadMedia } = useChatComposer({
    conversationId,
    user,
    canSendMessage,
    conversation,
    effectiveConversation,
    stopTyping,
    bottomRef,
  });

  const { handleRevokeMessage, handleDeleteMessageForMe, handleClearHistory } =
    useChatMessageActions({ conversationId, messages });

  const poll = useChatPoll({ conversationId, messages });

  useConversationRoom(conversationId);

  const onConfirmClearHistory = async () => {
    const success = await handleClearHistory();
    if (success) setShowClearHistoryDialog(false);
  };

  return (
    <div className="relative flex min-w-0 flex-1 flex-col bg-bg-box-chat">
      <div className="flex h-16 shrink-0 items-center justify-between gap-2 border-b border-border bg-sidebar px-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-1">
          {onBack && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onBack}
              aria-label="Quay lại danh sách"
              className="shrink-0 text-muted-foreground hover:text-foreground md:hidden"
            >
              <ArrowLeft className="size-5" />
            </Button>
          )}
          <button
            onClick={onToggleProfile}
            className="flex min-w-0 items-center gap-3 rounded-lg p-1 text-left transition-opacity hover:opacity-80"
          >
            <Avatar className="size-10 shrink-0">
              <AvatarImage
                src={conversationAvatar || "/placeholder.svg"}
                alt={conversationName || "Ảnh đại diện nhóm"}
              />
              <AvatarFallback>{conversationName?.[0]}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="truncate font-medium text-foreground">
                {conversationName}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {effectiveConversation?.type === "DIRECT"
                  ? "Trò chuyện trực tiếp"
                  : "Nhóm"}
              </div>
            </div>
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={onVoiceCall}
            aria-label="Gọi thoại"
            className="text-muted-foreground hover:text-foreground"
          >
            <Phone className="size-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Gọi video"
            className="hidden text-muted-foreground hover:text-foreground sm:inline-flex"
          >
            <Video className="size-5" />
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Tùy chọn cuộc trò chuyện"
                className="text-muted-foreground hover:text-foreground"
              >
                <MoreVertical className="size-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
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

      <div
        className="custom-scrollbar flex-1 space-y-4 overflow-y-auto p-4 sm:p-6"
        ref={containerRef}
        onScroll={handleScroll}
      >
        <div ref={topSentinelRef} className="h-px w-full" />
        <MessageComponent
          messages={messages}
          highlightMessageId={highlightMessageId}
          seenMessages={seenMessages}
          onRevokeMessage={handleRevokeMessage}
          onDeleteMessageForMe={handleDeleteMessageForMe}
          onOpenPoll={poll.handleOpenPoll}
          pollVoteSelections={poll.pollVoteSelections}
        />
        <TypingIndicator userNames={typingUserNames} />
        <div ref={bottomRef} />
      </div>

      {!isAtBottom && (
        <button
          type="button"
          aria-label="Cuộn xuống tin nhắn mới nhất"
          onClick={scrollToBottom}
          className="absolute bottom-20 left-1/2 z-10 flex size-10 -translate-x-1/2 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-lg transition-colors hover:bg-accent"
        >
          <ChevronDown className="size-5" />
        </button>
      )}

      {!canSendMessage && (
        <div className="border-t border-warning/30 bg-warning/10 px-6 py-2 text-sm text-warning-foreground">
          {membershipStatus === "REMOVED"
            ? "Bạn không còn trong nhóm này"
            : "Bạn đã rời khỏi nhóm này"}
        </div>
      )}

      <div className="shrink-0 border-t border-border bg-sidebar p-3 sm:px-4">
        <div className="flex items-center gap-1 rounded-2xl border border-border bg-background px-2 py-1.5">
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
            aria-label="Đính kèm tệp"
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            <Paperclip className="size-5" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            disabled={!canSendMessage}
            onClick={poll.handleOpenCreatePollDialog}
            aria-label="Tạo bình chọn"
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            <ListChecks className="size-5" />
          </Button>

          <input
            type="text"
            placeholder="Nhập tin nhắn..."
            disabled={!canSendMessage}
            aria-label="Nhập tin nhắn"
            className="min-w-0 flex-1 bg-transparent px-1 text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
            onChange={(e) => {
              setMsg(e.target.value);
              handleTyping(e.target.value);
            }}
            value={msg}
            onFocus={handleInputFocus}
            onBlur={handleInputBlur}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === "Enter" && !e.shiftKey) {
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
                aria-label="Chèn biểu tượng cảm xúc"
                className="shrink-0 text-muted-foreground hover:text-foreground"
              >
                <Smile className="size-5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              side="top"
              align="end"
              className="border-none bg-transparent p-0 shadow-none"
            >
              <EmojiPicker
                height={360}
                width={300}
                searchDisabled={false}
                skinTonesDisabled
                previewConfig={{ showPreview: false }}
                onEmojiClick={(emoji) => {
                  setMsg((prev) => prev + emoji.emoji);
                }}
              />
            </PopoverContent>
          </Popover>

          <Button
            size="icon"
            disabled={!canSendMessage || msg.trim() === ""}
            aria-label="Gửi tin nhắn"
            className="shrink-0 rounded-full"
            onClick={handleSendMessage}
          >
            <Send className="size-5" />
          </Button>
        </div>
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
              onClick={() => void onConfirmClearHistory()}
            >
              Xóa lịch sử
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={poll.showCreatePollDialog}
        onOpenChange={poll.setShowCreatePollDialog}
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
                  value={poll.pollQuestion}
                  onChange={(event) =>
                    poll.setPollQuestion(event.target.value.slice(0, 200))
                  }
                  placeholder="Đặt câu hỏi bình chọn"
                  className="h-28 w-full resize-none bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground"
                />
                <div className="text-right text-sm text-muted-foreground">
                  {poll.pollQuestion.length}/200
                </div>
              </div>
            </div>

            <div>
              <label className="mb-2 block text-base font-medium text-foreground">
                Các lựa chọn
              </label>
              <div className="space-y-2">
                {poll.pollOptions.map((option, index) => {
                  const key = option.trim().toLowerCase();
                  const isDuplicate =
                    Boolean(key) && (poll.duplicateOptionMap.get(key) || 0) > 1;

                  return (
                    <div key={`poll-option-${index}`}>
                      <div className="flex items-center gap-2 rounded-xl border border-input bg-background px-3 py-2">
                        <input
                          value={option}
                          onChange={(event) => {
                            const nextOptions = [...poll.pollOptions];
                            nextOptions[index] = event.target.value;
                            poll.setPollOptions(nextOptions);
                          }}
                          placeholder={`Lựa chọn ${index + 1}`}
                          className="h-9 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground"
                        />
                        {poll.pollOptions.length > 2 && (
                          <button
                            type="button"
                            onClick={() => {
                              poll.setPollOptions((prev) =>
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
                onClick={() => poll.setPollOptions((prev) => [...prev, ""])}
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
                checked={poll.isMultipleChoicePoll}
                onCheckedChange={(checked) =>
                  poll.setIsMultipleChoicePoll(Boolean(checked))
                }
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => poll.setShowCreatePollDialog(false)}
            >
              Hủy
            </Button>
            <Button
              disabled={!poll.canCreatePoll}
              onClick={() => void poll.handleCreatePoll()}
            >
              Tạo bình chọn
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={poll.showPollDetailDialog}
        onOpenChange={poll.setShowPollDetailDialog}
      >
        <DialogContent className="max-w-2xl bg-background text-foreground">
          <DialogHeader>
            <DialogTitle className="text-2xl font-semibold">
              Bình chọn
            </DialogTitle>
            <DialogDescription className="text-base text-foreground">
              {poll.activePoll?.question}
            </DialogDescription>
          </DialogHeader>

          {poll.activePoll && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-muted-foreground">
                <ListChecks className="h-4 w-4" />
                <span className="text-sm">
                  {poll.activePoll.isMultipleChoice
                    ? "Chọn nhiều phương án"
                    : "Chọn một phương án"}
                </span>
                {poll.activePoll.isClosed && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-sm">
                    <Lock className="h-4 w-4" /> Bình chọn đã đóng
                  </span>
                )}
              </div>

              <div className="text-sm font-medium text-primary">
                {poll.activePollTotalVoters} người bình chọn,{" "}
                {poll.activePollTotalVotes} lượt bình chọn
              </div>

              <div className="space-y-2">
                {poll.activePoll.options.map((option) => {
                  const isSelected = poll.selectedVoteOptionIds.includes(
                    option.id,
                  );

                  return (
                    <button
                      key={option.id}
                      type="button"
                      disabled={poll.activePoll?.isClosed}
                      onClick={() => poll.handleToggleVoteOption(option.id)}
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
              onClick={() => poll.setShowClosePollConfirmDialog(true)}
              disabled={
                !poll.activePoll ||
                poll.activePoll.isClosed ||
                poll.activePollMessage?.senderId !== user.id
              }
            >
              <Settings className="h-4 w-4" />
              Đóng bình chọn
            </Button>

            {poll.activePoll?.isClosed ? (
              <Button onClick={() => poll.setShowPollDetailDialog(false)}>
                Đóng
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={() => poll.setShowPollDetailDialog(false)}
                >
                  Hủy
                </Button>
                <Button
                  onClick={() => void poll.handleSubmitPollVote()}
                  disabled={poll.selectedVoteOptionIds.length < 1}
                >
                  Xác nhận
                </Button>
              </div>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={poll.showClosePollConfirmDialog}
        onOpenChange={poll.setShowClosePollConfirmDialog}
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
              onClick={() => void poll.handleClosePoll()}
            >
              Khóa bình chọn
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
