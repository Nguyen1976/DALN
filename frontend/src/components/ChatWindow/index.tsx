import {
  Avatar,
  AvatarImage,
  AvatarFallback,
  AvatarWithPresence,
} from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { EmptyState, Spinner } from "@/components/ui/feedback";
import { FILE_INPUT_ACCEPT, formatFileSize } from "@/utils/mediaLimits";
import {
  Phone,
  Video,
  PanelRightClose,
  PanelRightOpen,
  Paperclip,
  Play,
  Smile,
  Send,
  ChevronDown,
  Plus,
  X,
  Settings,
  Lock,
  ListChecks,
  ArrowLeft,
  MessageSquareOff,
  FileText,
  Loader2,
  AtSign,
} from "@/components/icons";
import { useDispatch, useSelector } from "react-redux";
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
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useConversationRoom } from "@/hooks/useConversationRoom";
import { useGroupCallDiscovery } from "@/hooks/useGroupCallDiscovery";
import { useCall } from "@/contexts/callContext";
import { useTypingIndicator } from "@/hooks/useTypingIndicator";
import { useChatConversationContext } from "@/hooks/chat/useChatConversationContext";
import { useChatMessageActions } from "@/hooks/chat/useChatMessageActions";
import { useChatPoll } from "@/hooks/chat/useChatPoll";
import { useChatComposer } from "@/hooks/chat/useChatComposer";
import { useChatMessagesScroll } from "@/hooks/chat/useChatMessagesScroll";
import { useComposerDropZone } from "@/hooks/chat/useComposerDropZone";
import type { LightboxAnchor } from "@/components/MediaLightbox";
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
import { Checkbox } from "@/components/ui/checkbox";
import type { AppDispatch } from "@/redux/store";
import {
  clearConversationMentions,
  peerIdOf,
  type ConversationMember,
} from "@/redux/slices/conversationSlice";
import { clearConversationMentionsAPI } from "@/apis";
import {
  removeMentionFromText,
  resolveMentionsInText,
} from "@/utils/mention";
import { displayNameOf } from "@/utils/displayName";

interface ChatWindowProps {
  conversationId?: string;
  onToggleProfile: () => void;
  /** Whether the details panel is showing, so its toggle can say so. */
  profileOpen?: boolean;
  onVoiceCall: () => void;
  onVideoCall?: () => void;
  onBack?: () => void;
  focusMessageId?: string | null;
  onFocusHandled?: () => void;
  /** Mở trình xem ảnh cho media của một tin nhắn. */
  onOpenMedia?: (anchor: LightboxAnchor) => void;
}

export default function ChatWindow({
  conversationId,
  onToggleProfile,
  profileOpen = false,
  onVoiceCall,
  onVideoCall,
  onBack,
  focusMessageId,
  onFocusHandled,
  onOpenMedia,
}: ChatWindowProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const [internalJumpId, setInternalJumpId] = useState<string | null>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const dispatch = useDispatch<AppDispatch>();

  const {
    user,
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
    const peerId =
      conversation && peerIdOf(conversation, user.id);
    return peerId ? friends.find((friend) => friend.id === peerId) : undefined;
  }, [conversation, friends, user.id]);

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
    stopTyping,
    scrollToBottom,
  });

  // Kéo tệp thả vào bất kỳ đâu trong khung chat, và dán ảnh vào ô nhập.
  const { isDraggingFiles, onPasteFiles, dropZoneProps } = useComposerDropZone({
    enabled: canSendMessage && !isUploading,
    addFiles,
  });

  // Ảnh/video đầu tiên của tin đang trả lời, để thanh trích dẫn vẽ được nó.
  const replyQuoteThumbnail = useMemo(() => {
    const media = replyingTo?.medias?.[0];
    if (!media) return null;
    const isImage =
      media.mediaType === "IMAGE" || media.mimeType?.startsWith("image/");
    const isVideo =
      media.mediaType === "VIDEO" || media.mimeType?.startsWith("video/");
    if (isImage) return { src: media.url, isVideo: false };
    // Video chỉ vẽ được khi server đã sinh poster; không có thì thanh trích
    // dẫn về lại dạng chữ.
    if (isVideo && media.thumbnailUrl) {
      return { src: media.thumbnailUrl, isVideo: true };
    }
    return null;
  }, [replyingTo]);

  const { handleRevokeMessage, handleDeleteMessageForMe } =
    useChatMessageActions({ conversationId, messages });

  // Thu hồi với mọi người và xoá phía mình đều không hoàn tác được, mà trước
  // đây chạy ngay ở cú bấm đầu tiên trong menu tin nhắn.
  const [pendingMessageAction, setPendingMessageAction] = useState<{
    kind: "revoke" | "deleteForMe";
    message: Parameters<typeof handleRevokeMessage>[0];
  } | null>(null);

  const poll = useChatPoll({ conversationId, messages });
  const isGroupConversation = conversation?.type === "GROUP";
  /** Một mục trong danh sách gợi ý: một thành viên, hoặc "@all" cho cả nhóm. */
  type MentionOption =
    | { kind: "all"; label: string }
    | { kind: "member"; label: string; member: ConversationMember };

  // Gợi ý mở cho CẢ 1-1 lẫn nhóm (trước đây chỉ nhóm). Khớp đầu tên xếp trước
  // khớp giữa tên, nên gõ vài chữ là ra đúng người.
  const mentionCandidates = useMemo<MentionOption[]>(() => {
    if (mentionQuery === null) return [];
    const needle = mentionQuery.toLocaleLowerCase("vi").trim();

    const ranked = (conversation?.members || [])
      .filter((member) => member.userId !== user.id)
      .map((member) => {
        const name = (member.fullName || "").toLocaleLowerCase("vi");
        const uname = (member.username || "").toLocaleLowerCase("vi");
        if (!needle) return { member, rank: 2 };
        if (uname.startsWith(needle) || name.startsWith(needle))
          return { member, rank: 0 };
        if (uname.includes(needle) || name.includes(needle))
          return { member, rank: 1 };
        return null;
      })
      .filter((item): item is { member: ConversationMember; rank: number } =>
        Boolean(item),
      )
      .sort((a, b) => a.rank - b.rank)
      .slice(0, 8)
      .map<MentionOption>(({ member }) => ({
        kind: "member",
        label: member.username || member.fullName || "",
        member,
      }))
      .filter((option) => option.label.length > 0);

    // "@all" chỉ có nghĩa trong nhóm.
    const options: MentionOption[] = [];
    if (isGroupConversation && ("all".startsWith(needle) || !needle)) {
      options.push({ kind: "all", label: "all" });
    }
    return [...options, ...ranked];
  }, [
    conversation?.members,
    isGroupConversation,
    mentionQuery,
    user.id,
  ]);

  // Cho phép khoảng trắng trong từ khoá để gõ được HỌ TÊN đầy đủ; không khớp ai
  // thì danh sách rỗng và dropdown tự ẩn.
  const updateMentionQuery = (value: string, caret: number) => {
    const match = value.slice(0, caret).match(/(?:^|\s)@([^@\n]{0,40})$/);
    setMentionQuery(match ? match[1] : null);
    setMentionIndex(0);
  };

  const chooseMention = (option: MentionOption) => {
    const node = composerRef.current;
    if (!node) return;
    const caret = node.selectionStart;
    const match = msg.slice(0, caret).match(/(?:^|\s)@([^@\n]{0,40})$/);
    if (!match) return;
    const start = caret - match[0].length + (match[0].startsWith(" ") ? 1 : 0);
    // Chèn ĐÚNG tên (kể cả có dấu / có khoảng trắng) — server dò lại theo tên
    // thật nên không cần thay khoảng trắng bằng gạch dưới như trước.
    const token = `@${option.label}`;
    setMsg(`${msg.slice(0, start)}${token} ${msg.slice(caret)}`);
    setMentionQuery(null);
    requestAnimationFrame(() => {
      node.focus();
      node.setSelectionRange(start + token.length + 1, start + token.length + 1);
    });
  };

  // Ai ĐANG thật sự được nhắc, suy từ chính nội dung đang gõ. Nhờ vậy xoá chữ
  // "@Alice" đi là Alice hết được nhắc (trước đây id vẫn kẹt trong state nên
  // vẫn bị ping), và gõ tay cũng được tính.
  const activeMentions = useMemo(
    () =>
      resolveMentionsInText(
        msg,
        conversation?.members || [],
        user.id,
      ),
    [msg, conversation?.members, user.id],
  );

  const jumpToMention = async () => {
    const messageId = conversation?.lastMentionMessageId;
    if (!conversationId || !messageId) return;
    setInternalJumpId(messageId);
    dispatch(clearConversationMentions({ conversationId }));
    await clearConversationMentionsAPI(conversationId).catch(() => undefined);
  };

  // Discovery: phòng gọi nhóm đang mở của hội thoại này (banner "Tham gia").
  const activeGroupRoom = useGroupCallDiscovery(
    conversation?.id,
    isGroupConversation,
  );
  const { joinGroupRoom, hasActiveOutgoingCall } = useCall();

  useConversationRoom(conversationId);

  // Keep the textarea exactly as tall as its content, up to the max height.
  useEffect(() => {
    const node = composerRef.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, 128)}px`;
  }, [msg]);

  // A conversation that cannot be loaded needs to say so. Falling through to
  // the normal shell left an empty thread with no explanation.
  if (loadError && !conversation) {
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
    <div
      className="relative flex min-w-0 flex-1 flex-col chat-canvas"
      {...dropZoneProps}
    >
      {/* Vùng thả phủ cả khung chat, không chỉ ô nhập: ngắm trúng thanh soạn
          tin cao 40px là việc không cần bắt người dùng làm. Lớp phủ để
          pointer-events-none nên sự kiện drop vẫn rơi xuống div gốc. */}
      {isDraggingFiles && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-40 flex animate-fade-in items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
        >
          <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-primary bg-card/90 px-10 py-8 text-center shadow-lg">
            <span className="flex size-12 items-center justify-center rounded-full bg-primary/15 text-primary">
              <Paperclip className="size-6" />
            </span>
            <div>
              <p className="text-base font-semibold text-foreground">
                Thả để gửi
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Ảnh, video hoặc tệp đính kèm
              </p>
            </div>
          </div>
        </div>
      )}

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
            // ChatWindow stays mounted across conversations; keying the
            // identity block lets the new name and avatar fade in.
            key={conversationId}
            onClick={onToggleProfile}
            aria-label={`Xem chi tiết ${conversationName || "cuộc trò chuyện"}`}
            className="flex min-w-0 animate-fade-in items-center gap-3 rounded-xl p-1.5 text-left transition-colors duration-(--motion-fast) hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <AvatarWithPresence
              status={
                conversation?.type !== "DIRECT" || !peer
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
                {conversation?.type === "DIRECT"
                  ? peer
                    ? peer.status
                      ? "Đang hoạt động"
                      : peer.lastSeen
                        ? `Hoạt động ${formatRelativeTime(peer.lastSeen)}`
                        : "Ngoại tuyến"
                    : "Trò chuyện trực tiếp"
                  : `${conversation?.memberCount ?? 0} thành viên`}
              </div>
            </div>
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={onVoiceCall}
            /* DIRECT → gọi 1-1 P2P; GROUP → gọi nhóm audio qua SFU. Nhóm từng
               bị disable vì chưa hỗ trợ, nay bật lên. */
            title={isGroupConversation ? "Gọi nhóm" : "Gọi thoại"}
            aria-label={isGroupConversation ? "Gọi nhóm" : "Gọi thoại"}
            className="text-muted-foreground hover:text-foreground"
          >
            <Phone className="size-5" />
          </Button>
          {/* DIRECT → video 1-1 (WebRTC P2P). GROUP → video nhóm qua LiveKit SFU. */}
          <Button
            variant="ghost"
            size="icon"
            onClick={onVideoCall}
            title={isGroupConversation ? "Gọi video nhóm" : "Gọi video"}
            aria-label={isGroupConversation ? "Gọi video nhóm" : "Gọi video"}
            className="text-muted-foreground hover:text-foreground"
          >
            <Video className="size-5" />
          </Button>

          {/* Straight to the details panel; clearing the history lives in
              there, next to the rest of what you can do with this chat. */}
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleProfile}
            title="Thông tin cuộc trò chuyện"
            aria-label="Thông tin cuộc trò chuyện"
            aria-pressed={profileOpen}
            className={cn(
              "text-muted-foreground hover:text-foreground",
              profileOpen && "bg-accent text-accent-foreground",
            )}
          >
            {profileOpen ? (
              <PanelRightClose className="size-5" />
            ) : (
              <PanelRightOpen className="size-5" />
            )}
          </Button>
        </div>
      </div>

      {/* Discovery: hội thoại đang có phòng gọi nhóm mở → mời tham gia. Ẩn khi
          mình đã ở trong một cuộc gọi. */}
      {activeGroupRoom && !hasActiveOutgoingCall && (
        <div className="flex animate-fade-in items-center gap-3 border-b border-border bg-primary/10 px-4 py-2">
          <span className="relative flex size-2.5 shrink-0" aria-hidden="true">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-75" />
            <span className="relative inline-flex size-2.5 rounded-full bg-success" />
          </span>
          {activeGroupRoom.callType === "video" ? (
            <Video className="size-4 shrink-0 text-primary" aria-hidden="true" />
          ) : (
            <Phone className="size-4 shrink-0 text-primary" aria-hidden="true" />
          )}
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
            Đang có cuộc gọi{" "}
            {activeGroupRoom.callType === "video" ? "video " : ""}nhóm
          </span>
          <Button
            size="sm"
            className="shrink-0 rounded-full"
            onClick={() => joinGroupRoom(activeGroupRoom)}
          >
            Tham gia
          </Button>
        </div>
      )}

      <div
        // `relative` makes the list the containing block of absolutely
        // positioned descendants (the 1px `sr-only` labels in SeenStatus and
        // poll results). Without it they escaped the scroller, overflowed the
        // `overflow-hidden` app shell, and made the whole app scrollable.
        className="custom-scrollbar relative flex-1 overflow-y-auto px-3 py-4 sm:px-6"
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
          onRevokeMessage={(message) =>
            setPendingMessageAction({ kind: "revoke", message })
          }
          onDeleteMessageForMe={(message) =>
            setPendingMessageAction({ kind: "deleteForMe", message })
          }
          onOpenPoll={poll.handleOpenPoll}
          onRetryMessage={handleRetryMessage}
          onDiscardMessage={handleDiscardMessage}
          onReplyMessage={(message) => {
            setReplyingTo(message);
            composerRef.current?.focus();
          }}
          onJumpToMessage={setInternalJumpId}
          onOpenMedia={onOpenMedia}
          isGroup={isGroupConversation}
          members={conversation?.members || []}
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
          className="absolute bottom-24 right-4 z-10 flex size-10 animate-pop-in items-center justify-center rounded-full border border-border bg-card text-foreground shadow-md transition-[background-color,transform] duration-(--motion-fast) hover:bg-accent active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <ChevronDown className="size-5" aria-hidden="true" />
        </button>
      )}

      {(conversation?.unreadMentionCount ?? 0) > 0 && (
        <button
          type="button"
          aria-label={`Đi đến ${conversation?.unreadMentionCount} lượt nhắc bạn`}
          onClick={() => void jumpToMention()}
          className="absolute bottom-36 right-4 z-20 flex size-10 animate-pop-in items-center justify-center rounded-full bg-brand text-white shadow-lg transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <AtSign className="size-5" aria-hidden="true" />
          <span
            key={conversation?.unreadMentionCount}
            className="absolute -right-1 -top-1 min-w-5 animate-pop-in rounded-full bg-destructive px-1 text-[10px] font-bold leading-5">
            {conversation?.unreadMentionCount}
          </span>
        </button>
      )}

      {!canSendMessage && (
        <div
          role="status"
          className="flex animate-fade-in items-center justify-center gap-2 border-t border-border bg-muted px-6 py-3 text-sm text-muted-foreground"
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
          <div className="mb-2 animate-slide-in-up rounded-xl border border-border bg-card p-2">
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
                  className="relative flex w-40 shrink-0 animate-pop-in flex-col gap-1.5 rounded-lg border border-border bg-background p-2"
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
          <div className="mb-2 flex animate-slide-in-up items-stretch gap-2 rounded-xl border border-border bg-card px-3 py-2">
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
            {/* Cùng lý do như khối trích dẫn trong luồng chat: trả lời một bức
                ảnh thì phải thấy bức ảnh, không phải tên tệp. */}
            {!replyingTo.isRevoked && replyQuoteThumbnail && (
              <span className="relative size-10 shrink-0 self-center overflow-hidden rounded-md bg-muted">
                <img
                  src={replyQuoteThumbnail.src}
                  alt=""
                  aria-hidden="true"
                  className="size-full object-cover"
                />
                {replyQuoteThumbnail.isVideo && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-0 flex items-center justify-center bg-black/35 text-white"
                  >
                    <Play className="size-3.5 fill-current" />
                  </span>
                )}
              </span>
            )}
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

        <div className="flex items-end gap-1 rounded-2xl border border-border bg-card p-1.5 shadow-xs transition-[border-color,box-shadow] duration-(--motion-fast) focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/25">
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
          <div className="relative flex min-h-10 min-w-0 flex-1 items-center">
          {mentionCandidates.length > 0 && (
            <div role="listbox" aria-label="Chọn thành viên để nhắc" className="absolute bottom-full left-0 z-30 mb-2 animate-slide-in-up max-h-64 w-full min-w-64 overflow-y-auto rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-xl">
              {mentionCandidates.map((option, index) => (
                <button
                  key={option.kind === "all" ? "@all" : option.member.userId}
                  type="button"
                  role="option"
                  aria-selected={index === mentionIndex}
                  onMouseDown={(event) => { event.preventDefault(); chooseMention(option); }}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm ${index === mentionIndex ? "bg-accent" : "hover:bg-accent"}`}
                >
                  {option.kind === "all" ? (
                    <>
                      <span className="flex size-8 items-center justify-center rounded-full bg-brand/15 text-brand">
                        <AtSign className="size-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium">Cả nhóm</span>
                        <span className="block truncate text-xs text-muted-foreground">@all — nhắc mọi thành viên</span>
                      </span>
                    </>
                  ) : (
                    <>
                      <Avatar className="size-8"><AvatarImage src={option.member.avatar || ""} /><AvatarFallback>{(displayNameOf(option.member) || "T")[0]}</AvatarFallback></Avatar>
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{displayNameOf(option.member)}</span>
                        <span className="block truncate text-xs text-muted-foreground">@{option.label}</span>
                      </span>
                    </>
                  )}
                </button>
              ))}
            </div>
          )}
          {activeMentions.length > 0 && (
            <div className="absolute -top-7 left-1 flex max-w-full flex-wrap items-center gap-1">
              {activeMentions.map((mention) => (
                <button
                  key={"all" in mention ? "@all" : mention.userId}
                  type="button"
                  onClick={() => setMsg(removeMentionFromText(msg, mention.label))}
                  aria-label={`Bỏ nhắc @${mention.label}`}
                  title="Bỏ nhắc"
                  className="flex max-w-40 animate-pop-in items-center gap-1 rounded-full bg-brand/15 px-2 py-0.5 text-[11px] font-semibold text-brand transition-colors duration-(--motion-fast) hover:bg-brand/25"
                >
                  <span className="truncate">@{mention.label}</span>
                  <X className="size-3 shrink-0" />
                </button>
              ))}
            </div>
          )}
          <textarea
            ref={composerRef}
            rows={1}
            placeholder="Nhập tin nhắn…"
            disabled={!canSendMessage}
            aria-label="Nhập tin nhắn"
            className="custom-scrollbar block max-h-32 min-h-10 w-full resize-none bg-transparent px-2 py-2.5 text-sm leading-5 text-foreground outline-none placeholder:text-placeholder disabled:cursor-not-allowed"
            onChange={(e) => {
              setMsg(e.target.value);
              handleTyping(e.target.value);
              updateMentionQuery(e.target.value, e.target.selectionStart);
            }}
            value={msg}
            onPaste={onPasteFiles}
            onFocus={handleInputFocus}
            onBlur={handleInputBlur}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (mentionCandidates.length) {
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  setMentionIndex((current) => e.key === "ArrowDown" ? (current + 1) % mentionCandidates.length : (current - 1 + mentionCandidates.length) % mentionCandidates.length);
                  return;
                }
                if (e.key === "Enter") {
                  e.preventDefault();
                  chooseMention(mentionCandidates[mentionIndex]);
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setMentionQuery(null);
                  return;
                }
              }
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
          </div>

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
              <Loader2 className="size-4.5 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="size-4.5" />
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

      <ConfirmDialog
        open={pendingMessageAction !== null}
        onOpenChange={(open) => {
          if (!open) setPendingMessageAction(null);
        }}
        title={
          pendingMessageAction?.kind === "revoke"
            ? "Thu hồi tin nhắn này?"
            : "Xoá tin nhắn ở phía bạn?"
        }
        description={
          pendingMessageAction?.kind === "revoke"
            ? "Tin nhắn sẽ bị gỡ với mọi người trong cuộc trò chuyện. Thao tác này không thể hoàn tác."
            : "Tin nhắn chỉ biến mất ở phía bạn, người khác vẫn thấy. Thao tác này không thể hoàn tác."
        }
        confirmLabel={pendingMessageAction?.kind === "revoke" ? "Thu hồi" : "Xoá"}
        onConfirm={() => {
          const action = pendingMessageAction;
          setPendingMessageAction(null);
          if (!action) return;
          void (action.kind === "revoke"
            ? handleRevokeMessage(action.message)
            : handleDeleteMessageForMe(action.message));
        }}
      />

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
                    <div
                      key={`poll-option-${index}`}
                      className="animate-slide-in-up"
                    >
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
