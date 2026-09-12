import {
  Avatar,
  AvatarImage,
  AvatarFallback,
  AvatarWithPresence,
} from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { EmptyState, Spinner } from "@/components/ui/feedback";
import { FILE_INPUT_ACCEPT, formatFileSize } from "@/utils/mediaLimits";
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
  MessageSquareOff,
  FileText,
  Loader2,
} from "lucide-react";
import { useSelector } from "react-redux";
import { useEffect, useMemo, useRef, useState } from "react";
import type { RootState } from "@/redux/store";
import {
  selectMessagePagination,
  selectMessage,
} from "@/redux/slices/messageSlice";
import { selectFriend } from "@/redux/slices/friendSlice";
import { formatRelativeTime } from "@/utils/formatDateTime";
import MessageComponent from "./Messages";
import { MessageMapper } from "@/utils/messageMapper";
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
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const [showClearHistoryDialog, setShowClearHistoryDialog] = useState(false);
  const [internalJumpId, setInternalJumpId] = useState<string | null>(null);

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
    loadError,
  } = useChatConversationContext(conversationId);

  const friends = useSelector(selectFriend);

  // Header subtitle shows real presence for direct chats instead of the
  // static "Trò chuyện trực tiếp" label.
  const peer = useMemo(() => {
    if (effectiveConversation?.type !== "DIRECT") return undefined;
    const peerId = effectiveConversation?.members?.find(
      (member) => member.userId !== user.id,
    )?.userId;
    if (!peerId) return undefined;
    return friends.find((friend) => friend.id === peerId);
  }, [effectiveConversation, friends, user.id]);

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
    // Two sources ask to jump to a message: the shared-media panel (via props)
    // and tapping a quote inside a reply (local).
    focusMessageId: focusMessageId ?? internalJumpId,
    onFocusHandled: () => {
      setInternalJumpId(null);
      onFocusHandled?.();
    },
  });

  const { handleTyping, stopTyping, handleInputFocus, handleInputBlur } =
    useTypingIndicator({
      conversationId: conversationId || "",
      enabled: canSendMessage && !!conversationId,
    });

  const {
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
  } = useChatComposer({
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
  const isGroupConversation = effectiveConversation?.type === "GROUP";

  useConversationRoom(conversationId);

  // Keep the textarea exactly as tall as its content, up to the max height.
  useEffect(() => {
    const node = composerRef.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, 128)}px`;
  }, [msg]);

  const onConfirmClearHistory = async () => {
    const success = await handleClearHistory();
    if (success) setShowClearHistoryDialog(false);
  };

  // A conversation that cannot be loaded needs to say so. Falling through to
  // the normal shell left an empty thread with no explanation.
  if (loadError && !effectiveConversation) {
    return (
      <div className="chat-canvas flex min-w-0 flex-1 flex-col items-center justify-center px-6 text-center">
        <EmptyState
          icon={MessageSquareOff}
          title="Không mở được cuộc trò chuyện"
          description={loadError}
          action={
            onBack && (
              <Button variant="outline" onClick={onBack}>
                <ArrowLeft className="size-4" aria-hidden="true" />
                Quay lại danh sách
              </Button>
            )
          }
        />
      </div>
    );
  }

  return (
    <div className="relative flex min-w-0 flex-1 flex-col chat-canvas">
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
            aria-label={`Xem chi tiết ${conversationName || "cuộc trò chuyện"}`}
            className="flex min-w-0 items-center gap-3 rounded-xl p-1.5 text-left transition-colors duration-[--motion-fast] hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <AvatarWithPresence
              status={
                effectiveConversation?.type !== "DIRECT" || !peer
                  ? null
                  : peer.status
                    ? "online"
                    : "offline"
              }
              dotSize="sm"
            >
              <Avatar className="size-10">
                <AvatarImage
                  src={conversationAvatar || ""}
                  alt={`Ảnh đại diện ${conversationName || "cuộc trò chuyện"}`}
                />
                <AvatarFallback>{conversationName?.[0]}</AvatarFallback>
              </Avatar>
            </AvatarWithPresence>
            <div className="min-w-0">
              <div className="truncate font-semibold leading-tight text-foreground">
                {conversationName}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {effectiveConversation?.type === "DIRECT"
                  ? peer
                    ? peer.status
                      ? "Đang hoạt động"
                      : peer.lastSeen
                        ? `Hoạt động ${formatRelativeTime(peer.lastSeen)}`
                        : "Ngoại tuyến"
                    : "Trò chuyện trực tiếp"
                  : `${effectiveConversation?.memberCount ?? 0} thành viên`}
              </div>
            </div>
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={onVoiceCall}
            /* Voice call is 1:1 only — the button used to be live in group
               threads too, where pressing it could only fail. */
            disabled={isGroupConversation}
            title={
              isGroupConversation
                ? "Chưa hỗ trợ gọi thoại trong nhóm"
                : "Gọi thoại"
            }
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
        className="custom-scrollbar flex-1 overflow-y-auto px-3 py-4 sm:px-6"
        ref={containerRef}
        onScroll={handleScroll}
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
        aria-label={`Tin nhắn trong ${conversationName || "cuộc trò chuyện"}`}
      >
        <div ref={topSentinelRef} className="h-px w-full" />
        {/* Short threads sit at the bottom of the canvas instead of floating
            at the top with a wall of empty space beneath them. */}
        <div className="flex min-h-full flex-col justify-end">
        <MessageComponent
          messages={messages}
          highlightMessageId={highlightMessageId}
          seenMessages={seenMessages}
          onRevokeMessage={handleRevokeMessage}
          onDeleteMessageForMe={handleDeleteMessageForMe}
          onOpenPoll={poll.handleOpenPoll}
          pollVoteSelections={poll.pollVoteSelections}
          onRetryMessage={handleRetryMessage}
          onDiscardMessage={handleDiscardMessage}
          onReplyMessage={(message) => {
            setReplyingTo(message);
            composerRef.current?.focus();
          }}
          onJumpToMessage={setInternalJumpId}
          isGroup={isGroupConversation}
        />
        <TypingIndicator userNames={typingUserNames} />
        <div ref={bottomRef} />
        </div>
      </div>

      {!isAtBottom && (
        <button
          type="button"
          aria-label="Cuộn xuống tin nhắn mới nhất"
          onClick={scrollToBottom}
          className="absolute bottom-24 right-4 z-10 flex size-10 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-md transition-[background-color,transform] duration-[--motion-fast] hover:bg-accent active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <ChevronDown className="size-5" aria-hidden="true" />
        </button>
      )}

      {!canSendMessage && (
        <div
          role="status"
          className="flex items-center justify-center gap-2 border-t border-border bg-muted px-6 py-3 text-sm text-muted-foreground"
        >
          <Lock className="size-4 shrink-0" aria-hidden="true" />
          {membershipStatus === "REMOVED"
            ? "Bạn không còn trong nhóm này nên không thể gửi tin nhắn."
            : "Bạn đã rời khỏi nhóm này nên không thể gửi tin nhắn."}
        </div>
      )}

      <div className="shrink-0 border-t border-border bg-sidebar p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-4">
        {/* Attachment tray: what has been picked, before anything is sent.
            Files used to upload the moment they were chosen — no chance to
            check the right file was picked, and no way to drop one. */}
        {attachments.length > 0 && (
          <div className="mb-2 rounded-xl border border-border bg-card p-2">
            <div className="mb-1.5 flex items-center justify-between px-1">
              <p className="text-xs font-medium text-muted-foreground">
                {attachments.length} tệp đã chọn
              </p>
              {isUploading && (
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Spinner label="Đang tải tệp lên" />
                  Đang tải lên…
                </span>
              )}
            </div>
            <ul className="custom-scrollbar flex gap-2 overflow-x-auto pb-1">
              {attachments.map((attachment) => (
                <li
                  key={attachment.id}
                  className="relative flex w-40 shrink-0 flex-col gap-1.5 rounded-lg border border-border bg-background p-2"
                >
                  {attachment.kind === "IMAGE" ? (
                    <img
                      src={attachment.previewUrl}
                      alt={`Xem trước ${attachment.file.name}`}
                      className="h-20 w-full rounded-md object-cover"
                    />
                  ) : attachment.kind === "VIDEO" ? (
                    <video
                      src={attachment.previewUrl}
                      muted
                      className="h-20 w-full rounded-md bg-muted object-cover"
                    />
                  ) : (
                    <div className="flex h-20 w-full items-center justify-center rounded-md bg-muted text-muted-foreground">
                      <FileText className="size-7" aria-hidden="true" />
                    </div>
                  )}
                  <p
                    className="truncate text-xs font-medium text-foreground"
                    title={attachment.file.name}
                  >
                    {attachment.file.name}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {formatFileSize(attachment.file.size)}
                  </p>
                  <button
                    type="button"
                    onClick={() => removeAttachment(attachment.id)}
                    disabled={isUploading}
                    aria-label={`Gỡ tệp ${attachment.file.name}`}
                    className="absolute right-1 top-1 flex size-6 items-center justify-center rounded-md bg-background/85 text-muted-foreground backdrop-blur transition-colors hover:bg-destructive/15 hover:text-destructive-text focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:opacity-50"
                  >
                    <X className="size-3.5" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Quote bar: shows what is being replied to before the message goes
            out, and can be dismissed without losing the text already typed. */}
        {replyingTo && (
          <div className="mb-2 flex items-stretch gap-2 rounded-xl border border-border bg-card px-3 py-2">
            <span
              aria-hidden="true"
              className="w-0.5 shrink-0 rounded-full bg-primary"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-brand">
                Trả lời{" "}
                {replyingTo.senderId === user.id
                  ? "chính bạn"
                  : replyingTo.senderMember?.fullName ||
                    replyingTo.senderMember?.username ||
                    "người dùng"}
              </p>
              <p className="truncate text-sm text-muted-foreground">
                {replyingTo.isRevoked
                  ? "Tin nhắn đã bị thu hồi"
                  : MessageMapper.previewText(replyingTo)}
              </p>
            </div>
            <Button
              variant="ghost-muted"
              size="icon-sm"
              aria-label="Huỷ trả lời"
              onClick={() => setReplyingTo(null)}
              className="shrink-0 self-center"
            >
              <X className="size-4" />
            </Button>
          </div>
        )}

        <div className="flex items-end gap-1 rounded-2xl border border-border bg-card p-1.5 shadow-xs transition-[border-color,box-shadow] duration-[--motion-fast] focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/25">
          <input
            ref={fileInputRef}
            type="file"
            /* Filter in the picker itself so the user does not choose a file
               only to be told afterwards that it is not supported. */
            accept={FILE_INPUT_ACCEPT}
            multiple
            className="hidden"
            onChange={(e) => {
              const files = [...(e.target.files || [])];
              if (files.length) addFiles(files);
              e.currentTarget.value = "";
            }}
          />
          <Button
            variant="ghost-muted"
            size="icon"
            onClick={() => fileInputRef.current?.click()}
            disabled={!canSendMessage}
            aria-label="Đính kèm tệp"
            className="shrink-0 rounded-xl"
          >
            <Paperclip className="size-5" />
          </Button>

          {isGroupConversation && (
            <Button
              variant="ghost-muted"
              size="icon"
              disabled={!canSendMessage}
              onClick={poll.handleOpenCreatePollDialog}
              aria-label="Tạo bình chọn"
              className="shrink-0 rounded-xl"
            >
              <ListChecks className="size-5" />
            </Button>
          )}

          {/* Auto-growing textarea: long messages stay fully visible instead of
              scrolling inside a one-line input, capped so the thread keeps most
              of the viewport. Enter sends, Shift+Enter breaks the line. */}
          <textarea
            ref={composerRef}
            rows={1}
            placeholder="Nhập tin nhắn…"
            disabled={!canSendMessage}
            aria-label="Nhập tin nhắn"
            className="custom-scrollbar max-h-32 min-h-10 min-w-0 flex-1 resize-none bg-transparent px-2 py-2 text-sm leading-relaxed text-foreground outline-none placeholder:text-placeholder disabled:cursor-not-allowed"
            onChange={(e) => {
              setMsg(e.target.value);
              handleTyping(e.target.value);
            }}
            value={msg}
            onFocus={handleInputFocus}
            onBlur={handleInputBlur}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              // Escape drops the quote without touching what has been typed.
              if (e.key === "Escape" && replyingTo) {
                e.preventDefault();
                setReplyingTo(null);
                return;
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSendMessage();
              }
            }}
          />

          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost-muted"
                size="icon"
                disabled={!canSendMessage}
                aria-label="Chèn biểu tượng cảm xúc"
                className="shrink-0 rounded-xl"
              >
                <Smile className="size-5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              side="top"
              align="end"
              className="w-auto border-none bg-transparent p-0 shadow-none"
            >
              <EmojiPicker
                height={360}
                width={300}
                searchDisabled={false}
                skinTonesDisabled
                previewConfig={{ showPreview: false }}
                onEmojiClick={(emoji) => {
                  setMsg(msg + emoji.emoji);
                }}
              />
            </PopoverContent>
          </Popover>

          <Button
            size="icon"
            /* Attachments alone are a valid message — a caption is optional. */
            disabled={
              !canSendMessage ||
              isUploading ||
              (msg.trim() === "" && attachments.length === 0)
            }
            aria-label="Gửi tin nhắn"
            className="shrink-0 rounded-xl"
            onClick={handleSendMessage}
          >
            {isUploading ? (
              <Loader2 className="size-[18px] animate-spin" aria-hidden="true" />
            ) : (
              <Send className="size-[18px]" />
            )}
          </Button>
        </div>

        <p className="mt-1.5 hidden px-2 text-[11px] text-muted-foreground sm:block">
          <kbd className="rounded border border-border bg-muted px-1 font-sans">
            Enter
          </kbd>{" "}
          để gửi ·{" "}
          <kbd className="rounded border border-border bg-muted px-1 font-sans">
            Shift + Enter
          </kbd>{" "}
          để xuống dòng
        </p>
      </div>

      <Dialog
        open={showClearHistoryDialog}
        onOpenChange={setShowClearHistoryDialog}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Xóa toàn bộ lịch sử trò chuyện?</DialogTitle>
            <DialogDescription>
              Hành động này chỉ ẩn lịch sử ở phía bạn và không thể hoàn tác.
              Người khác vẫn nhìn thấy tin nhắn bình thường.
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
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              Tạo bình chọn
            </DialogTitle>
            <DialogDescription>
              Nhập câu hỏi và các lựa chọn để tạo bình chọn trong cuộc trò chuyện.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            <div>
              <label className="mb-2 block text-sm font-medium text-foreground">
                Chủ đề bình chọn
              </label>
              <div className="rounded-xl border border-input bg-background p-3">
                <textarea
                  value={poll.pollQuestion}
                  onChange={(event) =>
                    poll.setPollQuestion(event.target.value.slice(0, 200))
                  }
                  placeholder="Đặt câu hỏi bình chọn"
                  className="h-28 w-full resize-none bg-transparent text-sm text-foreground outline-none placeholder:text-placeholder"
                />
                <div className="text-right text-sm text-muted-foreground">
                  {poll.pollQuestion.length}/200
                </div>
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-foreground">
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
                          className="h-9 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-placeholder"
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
                className="mt-3 inline-flex items-center gap-2 rounded-lg text-sm font-semibold text-brand transition-colors hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
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
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              Bình chọn
            </DialogTitle>
            <DialogDescription>
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
                      <span className="w-6 text-right text-sm font-medium tabular-nums text-foreground">
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
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Khoá bình chọn?</DialogTitle>
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
