import { useMemo } from "react";
import { cn } from "@/lib/utils";
import type { Message } from "@/redux/slices/messageSlice";
import { selectUser } from "@/redux/slices/userSlice";
import {
  formatDateTime,
  formatDayDivider,
  formatFullDateTime,
  isNewDay,
} from "@/utils/formatDateTime";
import { useSelector } from "react-redux";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import {
  AlertCircle,
  Reply,
  BarChart3,
  Check,
  ChevronRight,
  Loader2,
  MoreVertical,
  RotateCcw,
  Trash2,
  User,
} from "@/components/icons";
import { SeenStatus } from "@/components/SeenStatus";
import {
  buildMentionSegments,
  resolveMentionsInText,
  type MentionMember,
} from "@/utils/mention";

function MentionText({
  text,
  message,
  members,
  selfId,
  isMine = false,
}: {
  text: string;
  message: Message;
  members: MentionMember[];
  selfId: string;
  isMine?: boolean;
}) {
  // Tin mới mang sẵn `mentions` (server resolve, nhãn đúng như trong text). Tin
  // CŨ chưa có thì suy lại từ danh sách thành viên — nhờ vậy tên tiếng Việt có
  // dấu / có khoảng trắng cũng tô đúng, và `@chữ` không phải mention thì KHÔNG
  // bị tô nhầm như bản regex trước đây.
  const mentions = useMemo(() => {
    if (message.mentions?.length) return message.mentions;
    if (!message.mentionUserIds?.length) return [];
    return resolveMentionsInText(text, members, "");
  }, [message.mentions, message.mentionUserIds, text, members]);

  const segments = useMemo(
    () => buildMentionSegments(text, mentions),
    [text, mentions],
  );

  if (!mentions.length) return <>{text}</>;

  return (
    <>
      {segments.map((segment, index) => {
        if (!segment.mention) return <span key={index}>{segment.text}</span>;
        // Nhắc CHÍNH MÌNH thì nổi hẳn lên (như Messenger/Zalo), nhắc người khác
        // chỉ cần khác màu là đủ.
        const isMe =
          "all" in segment.mention || segment.mention.userId === selfId;
        return (
          <span
            key={index}
            className={cn(
              "rounded px-0.5 font-semibold",
              isMe
                ? "bg-brand/20 text-brand"
                : isMine
                  ? "text-mention-out"
                  : "text-mention-in",
            )}
          >
            {segment.text}
          </span>
        );
      })}
    </>
  );
}

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import FileAttachmentPreview from "./FileAttachmentPreview";
import CallLogMessage from "./CallLogMessage";
import QuotedMessagePreview from "./QuotedMessagePreview";
import { parseLegacyCallInfo } from "@/utils/callLog";

const MessageComponent = ({
  messages,
  highlightMessageId,
  seenMessages = {},
  onRevokeMessage,
  onDeleteMessageForMe,
  onOpenPoll,
  onRetryMessage,
  onDiscardMessage,
  onReplyMessage,
  onJumpToMessage,
  isGroup = false,
  members = [],
}: {
  messages: Message[];
  /** Sender names are only shown in group threads. */
  isGroup?: boolean;
  highlightMessageId?: string | null;
  seenMessages?: Record<
    string,
    { userId: string; username?: string; avatar?: string }[]
  >;
  onRevokeMessage?: (message: Message) => void;
  onDeleteMessageForMe?: (message: Message) => void;
  onOpenPoll?: (message: Message) => void;
  onRetryMessage?: (message: Message) => void;
  onDiscardMessage?: (message: Message) => void;
  onReplyMessage?: (message: Message) => void;
  onJumpToMessage?: (messageId: string) => void;
  /** Dùng để tô đúng mention của tin CŨ (chưa có `mentions` kèm theo). */
  members?: MentionMember[];
}) => {
  const user = useSelector(selectUser);

  const resolveMediaKind = (media: {
    mediaType?: string;
    mimeType?: string;
  }): "IMAGE" | "VIDEO" | "FILE" => {
    const mediaType = String(media.mediaType || "").toUpperCase();
    const mimeType = String(media.mimeType || "").toLowerCase();

    if (mediaType.includes("IMAGE") || mimeType.startsWith("image/")) {
      return "IMAGE";
    }

    if (mediaType.includes("VIDEO") || mimeType.startsWith("video/")) {
      return "VIDEO";
    }

    return "FILE";
  };

  return (
    <>
      {messages.map((message, index) => {
        // The optimistic copy is swapped for the server id on ack; keying on
        // the client id keeps the row mounted, so it animates in only once.
        const rowKey = message.clientMessageId || message.id;
        const prevMessage = messages[index - 1];
        const nextMessage = messages[index + 1];

        const isMine = message.senderId === user.id;

        // A day divider also breaks the visual grouping — the first message
        // after a new day always shows its avatar and sender again.
        const startsNewDay = isNewDay(message.createdAt, prevMessage?.createdAt);
        const nextStartsNewDay = isNewDay(
          nextMessage?.createdAt,
          message.createdAt,
        );

        const isSameAsPrev =
          prevMessage?.senderId === message.senderId && !startsNewDay;
        const isSameAsNext =
          nextMessage?.senderId === message.senderId && !nextStartsNewDay;

        const showAvatar = !isSameAsPrev;
        const isRevoked = Boolean(message.isRevoked);
        const canRevoke =
          isMine &&
          !message.id.startsWith("temp-") &&
          message.status !== "pending" &&
          message.type !== "POLL";
        const isPoll = message.type === "POLL" && Boolean(message.poll);
        const senderName = message.senderMember?.username;
        // Ảnh/video hiển thị TRẦN (ngoài bong bóng); tệp vẫn là thẻ card nên
        // ở lại trong bong bóng cùng với chữ.
        const visualMedias = (message.medias || []).filter(
          (media) => resolveMediaKind(media) !== "FILE",
        );
        const fileMedias = (message.medias || []).filter(
          (media) => resolveMediaKind(media) === "FILE",
        );
        const showBareMedia = !isRevoked && visualMedias.length > 0;
        const isMediaGrid = visualMedias.length > 1;
        // Bong bóng chỉ tồn tại khi còn thứ gì đó cần nền: chữ, tệp, hoặc lời
        // báo thu hồi. Tin chỉ có ảnh thì bức ảnh chính là tin nhắn.
        const showBubble =
          !showBareMedia ||
          isRevoked ||
          Boolean(message.content) ||
          fileMedias.length > 0;
        const showSenderLabel = Boolean(
          !isMine && isGroup && showAvatar && senderName,
        );
        const selectedPollOptions = message.poll?.myOptionIds ?? [];

        const dayDivider = startsNewDay ? (
          <div className="my-4 flex items-center gap-3" role="separator">
            <span className="h-px flex-1 bg-border" />
            <span className="rounded-full bg-muted px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {formatDayDivider(message.createdAt)}
            </span>
            <span className="h-px flex-1 bg-border" />
          </div>
        ) : null;

        if (isPoll && message.poll) {
          const totalVotes = message.poll.options.reduce(
            (sum, option) => sum + option.count,
            0,
          );

          return (
            <div key={rowKey}>
              {dayDivider}
              <div
                id={`message-${message.id}`}
                className={cn(
                  "mb-3 mt-4 scroll-mt-24 rounded-2xl transition-colors duration-300",
                  highlightMessageId === message.id && "bg-accent",
                )}
              >
                <div className="mx-auto w-full max-w-md px-1">
                  <div
                    className={cn(
                      "overflow-hidden rounded-2xl border bg-card shadow-sm",
                      message.poll.isClosed
                        ? "border-border"
                        : "border-primary/30",
                    )}
                  >
                    <div className="space-y-3 p-4">
                      <div className="flex items-start gap-2.5">
                        <span
                          aria-hidden="true"
                          className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground"
                        >
                          <BarChart3 className="size-4" />
                        </span>
                        <div className="min-w-0 space-y-0.5">
                          <h4 className="text-sm font-semibold leading-snug text-foreground">
                            {message.poll.question}
                          </h4>
                          <p className="text-xs text-muted-foreground">
                            {message.poll.isClosed
                              ? "Bình chọn đã đóng"
                              : message.poll.isMultipleChoice
                                ? "Chọn nhiều phương án"
                                : "Chọn một phương án"}
                            {" · "}
                            {totalVotes} lượt bình chọn
                          </p>
                        </div>
                      </div>

                      <ul className="space-y-1.5">
                        {message.poll.options.map((option) => {
                          const isSelected = selectedPollOptions.includes(
                            option.id,
                          );
                          const share = totalVotes
                            ? Math.round((option.count / totalVotes) * 100)
                            : 0;

                          return (
                            <li
                              key={option.id}
                              className={cn(
                                "relative overflow-hidden rounded-lg border px-3 py-2 text-sm",
                                isSelected
                                  ? "border-primary/50 bg-accent"
                                  : "border-border bg-muted/60",
                              )}
                            >
                              {/* Result bar: proportion is also stated as a
                                  percentage so it never relies on width alone. */}
                              <span
                                aria-hidden="true"
                                // scaleX, not width: the bar grows smoothly
                                // when votes come in, without relayout.
                                className="absolute inset-0 origin-left animate-grow-x bg-primary/12 transition-transform duration-(--motion-slow) ease-out"
                                style={{ transform: `scaleX(${share / 100})` }}
                              />
                              <span className="relative flex items-center justify-between gap-2">
                                <span className="flex min-w-0 items-center gap-1.5">
                                  {isSelected && (
                                    <Check
                                      className="size-3.5 shrink-0 text-brand"
                                      aria-hidden="true"
                                    />
                                  )}
                                  <span className="truncate font-medium">
                                    {option.text}
                                  </span>
                                </span>
                                <span className="shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">
                                  {option.count}
                                  <span className="sr-only"> lượt chọn</span>
                                  {totalVotes > 0 && ` · ${share}%`}
                                </span>
                              </span>
                            </li>
                          );
                        })}
                      </ul>

                      <button
                        type="button"
                        onClick={() => onOpenPoll?.(message)}
                        className="inline-flex w-full items-center justify-center gap-1 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground transition-colors duration-(--motion-fast) hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      >
                        {message.poll.isClosed
                          ? "Xem lựa chọn"
                          : selectedPollOptions.length > 0
                            ? "Đổi lựa chọn"
                            : "Bình chọn"}
                        <ChevronRight className="size-4" aria-hidden="true" />
                      </button>
                    </div>

                    <div className="border-t border-border bg-muted/40 px-4 py-2">
                      <time
                        dateTime={message.createdAt}
                        title={formatFullDateTime(message.createdAt)}
                        className="text-[11px] text-muted-foreground"
                      >
                        {formatDateTime(message.createdAt)}
                      </time>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        }


        // Tin tổng kết cuộc gọi → thẻ căn như MỘT TIN NHẮN (Messenger/Zalo):
        // người gọi bên phải, người kia bên trái + avatar; có nút gọi lại / tham
        // gia lại. Tin mới dùng callInfo; tin CŨ (chỉ có text) suy từ văn bản để
        // lịch sử cũ cũng hiển thị đẹp thay vì chữ hệ thống trơn.
        const callInfo =
          message.type === "CALL" && message.callInfo
            ? message.callInfo
            : message.isSystem
              ? parseLegacyCallInfo(message.content)
              : null;
        if (callInfo) {
          return (
            <div key={rowKey}>
              {dayDivider}
              <div
                id={`message-${message.id}`}
                className={cn(
                  "scroll-mt-24 transition-colors duration-300",
                  highlightMessageId === message.id && "rounded-lg bg-accent",
                )}
              >
                <CallLogMessage
                  conversationId={message.conversationId}
                  callInfo={callInfo}
                  isMine={isMine}
                  senderName={senderName}
                  senderAvatar={message.senderMember?.avatar}
                  time={
                    <time
                      dateTime={message.createdAt}
                      title={formatFullDateTime(message.createdAt)}
                    >
                      {formatDateTime(message.createdAt)}
                    </time>
                  }
                />
              </div>
            </div>
          );
        }

        // System records — someone joined or left — are not things anyone typed.
        if (message.isSystem) {
          return (
            <div key={rowKey}>
              {dayDivider}
              <div
                id={`message-${message.id}`}
                className={cn(
                  "my-3 flex scroll-mt-24 justify-center transition-colors duration-300",
                  highlightMessageId === message.id && "rounded-lg bg-accent",
                )}
              >
                <p className="max-w-[85%] rounded-full bg-muted px-3 py-1 text-center text-xs leading-relaxed text-muted-foreground">
                  <MentionText text={message.content} message={message} members={members} selfId={user.id} />
                  <time
                    dateTime={message.createdAt}
                    title={formatFullDateTime(message.createdAt)}
                    className="ml-1.5 tabular-nums opacity-70"
                  >
                    {formatDateTime(message.createdAt)}
                  </time>
                </p>
              </div>
            </div>
          );
        }

        return (
          <div key={rowKey}>
            {dayDivider}
            <div
              id={`message-${message.id}`}
              className={cn(
                "scroll-mt-24 rounded-lg transition-colors duration-300",
                isSameAsNext ? "mb-0.5" : "mb-2",
                highlightMessageId === message.id && "bg-accent",
              )}
            >
              <div
                className={cn(
                  "flex items-end gap-2",
                  isMine ? "justify-end" : "justify-start",
                )}
              >
                {!isMine &&
                  (showAvatar ? (
                    <Avatar className="size-8 border border-border">
                      <AvatarImage
                        src={message.senderMember?.avatar}
                        alt={senderName ? `Ảnh đại diện ${senderName}` : ""}
                      />
                      <AvatarFallback>
                        {senderName ? (
                          senderName[0]
                        ) : (
                          <User className="size-4" aria-hidden="true" />
                        )}
                      </AvatarFallback>
                    </Avatar>
                  ) : (
                    <div className="size-8 shrink-0" aria-hidden="true" />
                  ))}

                <div
                  className={cn(
                    "group relative flex max-w-[min(30rem,78%)] flex-col text-sm leading-relaxed",
                    isMine ? "items-end" : "items-start",
                    // Grows out of its own side of the conversation.
                    "animate-bubble-in",
                    isMine ? "origin-bottom-right" : "origin-bottom-left",
                  )}
                >
                  {/* Với ảnh trần thì không còn bong bóng để lồng tên người gửi
                      và khối trích dẫn vào, nên chúng nổi lên thành tầng riêng
                      ngay phía trên ảnh. */}
                  {showSenderLabel && !showBubble && (
                    <p className="mb-0.5 px-1 text-xs font-semibold text-brand">
                      {senderName}
                    </p>
                  )}

                  {message.replyTo && showBareMedia && (
                    <div className="mb-1 w-full">
                      <QuotedMessagePreview
                        replyTo={message.replyTo}
                        isMine={isMine}
                        selfId={user.id}
                        standalone
                        onJump={onJumpToMessage}
                      />
                    </div>
                  )}

                  {/* Ảnh và video hiển thị TRẦN: không nền, không padding — bức
                      ảnh chính là tin nhắn. Chỉ còn viền 1px rất mờ để ảnh nền
                      trắng không lẫn vào khung chat sáng. Hai ảnh trở lên thì
                      xếp lưới, vì xếp dọc nguyên khổ biến một tin năm ảnh thành
                      một bức tường phải cuộn. */}
                  {showBareMedia && (
                    <div
                      className={cn(
                        "w-full",
                        isMediaGrid && "grid gap-1",
                        visualMedias.length === 2 && "grid-cols-2",
                        visualMedias.length > 2 && "grid-cols-2 sm:grid-cols-3",
                      )}
                    >
                      {visualMedias.map((media, mediaIndex) => {
                        const mediaKind = resolveMediaKind(media);
                        const frame = isMediaGrid
                          ? "h-32 w-full rounded-lg"
                          : "max-h-80 w-full max-w-72 rounded-2xl";

                        if (mediaKind === "IMAGE") {
                          return (
                            <img
                              key={`${message.id}-${mediaIndex}`}
                              src={media.url}
                              alt={
                                media.fileName
                                  ? `Ảnh: ${media.fileName}`
                                  : `Ảnh do ${senderName || "người dùng"} gửi`
                              }
                              loading="lazy"
                              decoding="async"
                              // Reserving a box keeps the thread from jumping
                              // when the image finally decodes.
                              className={cn(
                                frame,
                                "border border-border/50 bg-muted object-cover",
                              )}
                            />
                          );
                        }

                        return (
                          <video
                            key={`${message.id}-${mediaIndex}`}
                            src={media.url}
                            controls
                            preload="metadata"
                            className={cn(
                              frame,
                              "border border-border/50 bg-muted object-cover",
                            )}
                          />
                        );
                      })}
                    </div>
                  )}

                  {showBubble && (
                    <div
                      className={cn(
                        "px-3.5 py-2 shadow-bubble",
                        showBareMedia && "mt-1",
                        isMine
                          ? "bg-bubble-out text-bubble-out-foreground"
                          : "bg-bubble-in text-bubble-in-foreground",
                        // Corner shaping follows the run of messages so a group
                        // reads as one block instead of separate pills.
                        "rounded-2xl",
                        isMine
                          ? cn(
                              isSameAsPrev && !showBareMedia && "rounded-tr-md",
                              isSameAsNext && "rounded-br-md",
                            )
                          : cn(
                              isSameAsPrev && !showBareMedia && "rounded-tl-md",
                              isSameAsNext && "rounded-bl-md",
                            ),
                      )}
                    >
                      {showSenderLabel && (
                        <p className="mb-0.5 text-xs font-semibold text-brand">
                          {senderName}
                        </p>
                      )}

                      {/* Quoted message. Clicking it jumps to the original so a
                          reply in a busy thread can be traced back. */}
                      {message.replyTo && !showBareMedia && (
                        <QuotedMessagePreview
                          replyTo={message.replyTo}
                          isMine={isMine}
                          selfId={user.id}
                          onJump={onJumpToMessage}
                        />
                      )}

                      {!isRevoked &&
                        fileMedias.map((media, mediaIndex) => (
                          <FileAttachmentPreview
                            key={`${message.id}-file-${mediaIndex}`}
                            url={media.url}
                            mimeType={media.mimeType}
                            size={media.size}
                            fileName={media.fileName}
                          />
                        ))}

                      {isRevoked ? (
                        <p
                          className={cn(
                            "italic",
                            isMine
                              ? "text-bubble-out-foreground/75"
                              : "text-muted-foreground",
                          )}
                        >
                          Tin nhắn đã bị thu hồi
                        </p>
                      ) : message.content ? (
                        <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">
                          <MentionText text={message.content} message={message} members={members} selfId={user.id} isMine={isMine} />
                        </p>
                      ) : null}

                      {/* Timestamp on the last message of each run. */}
                      {!isSameAsNext && (
                        <time
                          dateTime={message.createdAt}
                          title={formatFullDateTime(message.createdAt)}
                          className={cn(
                            "mt-1 block text-[11px] tabular-nums",
                            isMine
                              ? "text-bubble-out-foreground/80"
                              : "text-muted-foreground",
                          )}
                        >
                          {formatDateTime(message.createdAt)}
                        </time>
                      )}
                    </div>
                  )}

                  {/* Ảnh trần không có bong bóng để đặt giờ vào, nên giờ nằm
                      ngay dưới ảnh. */}
                  {!showBubble && !isSameAsNext && (
                    <time
                      dateTime={message.createdAt}
                      title={formatFullDateTime(message.createdAt)}
                      className="mt-1 block px-1 text-[11px] tabular-nums text-muted-foreground"
                    >
                      {formatDateTime(message.createdAt)}
                    </time>
                  )}

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        aria-label="Tuỳ chọn tin nhắn"
                        className={cn(
                          "absolute top-1 inline-flex size-8 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-sm",
                          "transition-opacity duration-(--motion-fast)",
                          // Hover is not the only way in: keyboard focus and an
                          // open menu reveal it too, and on touch (no hover) it
                          // is always visible.
                          "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100",
                          "[@media(hover:none)]:opacity-100",
                          isMine ? "-left-9" : "-right-9",
                        )}
                      >
                        <MoreVertical className="size-4" aria-hidden="true" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align={isMine ? "end" : "start"}
                      className="w-56"
                    >
                      {!isRevoked && !message.id.startsWith("temp-") && (
                        <DropdownMenuItem
                          onClick={() => onReplyMessage?.(message)}
                        >
                          <Reply className="size-4" />
                          Trả lời
                        </DropdownMenuItem>
                      )}

                      {canRevoke && (
                        <>
                          <DropdownMenuGroup>
                            <DropdownMenuItem
                              onClick={() => onRevokeMessage?.(message)}
                            >
                              <RotateCcw className="size-4" aria-hidden="true" />
                              Thu hồi với mọi người
                            </DropdownMenuItem>
                          </DropdownMenuGroup>
                          <DropdownMenuSeparator />
                        </>
                      )}

                      <DropdownMenuGroup>
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => onDeleteMessageForMe?.(message)}
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                          Xoá chỉ ở phía tôi
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              {/* Send status. The store has always tracked pending/sent/failed
                  but nothing rendered it: a message that never left the device
                  looked exactly like one that arrived. */}
              {isMine && message.status === "pending" && (
                <div className="mr-1 mt-1 flex items-center justify-end gap-1.5 text-[11px] text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                  <span>Đang gửi…</span>
                </div>
              )}

              {isMine && message.status === "failed" && (
                <div
                  role="alert"
                  className="mr-1 mt-1 flex animate-fade-in flex-wrap items-center justify-end gap-2 text-[11px] text-destructive-text"
                >
                  <span className="flex items-center gap-1">
                    <AlertCircle className="size-3" aria-hidden="true" />
                    Chưa gửi được
                  </span>
                  <button
                    type="button"
                    onClick={() => onRetryMessage?.(message)}
                    className="rounded px-1.5 py-0.5 font-medium underline underline-offset-2 hover:bg-destructive/10 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                  >
                    Gửi lại
                  </button>
                  <button
                    type="button"
                    onClick={() => onDiscardMessage?.(message)}
                    className="rounded px-1.5 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                  >
                    Xoá
                  </button>
                </div>
              )}

              {isMine && !isSameAsNext && message.status !== "pending" && message.status !== "failed" && (
                <SeenStatus seenUsers={seenMessages[message.id] || []} />
              )}
            </div>
          </div>
        );
      })}
    </>
  );
};

export default MessageComponent;
