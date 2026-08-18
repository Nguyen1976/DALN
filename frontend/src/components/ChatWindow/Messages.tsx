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
  BarChart3,
  Check,
  ChevronRight,
  MoreVertical,
  RotateCcw,
  Trash2,
  User,
} from "lucide-react";
import { SeenStatus } from "@/components/SeenStatus";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import FileAttachmentPreview from "./FileAttachmentPreview";

const MessageComponent = ({
  messages,
  highlightMessageId,
  seenMessages = {},
  onRevokeMessage,
  onDeleteMessageForMe,
  onOpenPoll,
  pollVoteSelections,
  isGroup = false,
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
  pollVoteSelections?: Record<string, string[]>;
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
        const selectedPollOptions = message.poll
          ? pollVoteSelections?.[message.poll.id] || []
          : [];

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
            <div key={message.id}>
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
                                className="absolute inset-y-0 left-0 bg-primary/12"
                                style={{ width: `${share}%` }}
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
                        className="inline-flex w-full items-center justify-center gap-1 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground transition-colors duration-[--motion-fast] hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
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

        const senderName = message.senderMember?.username;

        return (
          <div key={message.id}>
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
                    "group relative max-w-[min(30rem,78%)] px-3.5 py-2 text-sm leading-relaxed shadow-bubble",
                    isMine
                      ? "bg-bubble-out text-bubble-out-foreground"
                      : "bg-bubble-in text-bubble-in-foreground",
                    // Corner shaping follows the run of messages so a group
                    // reads as one block instead of separate pills.
                    "rounded-2xl",
                    isMine
                      ? cn(isSameAsPrev && "rounded-tr-md", isSameAsNext && "rounded-br-md")
                      : cn(isSameAsPrev && "rounded-tl-md", isSameAsNext && "rounded-bl-md"),
                  )}
                >
                  {!isMine && isGroup && showAvatar && senderName && (
                    <p className="mb-0.5 text-xs font-semibold text-brand">
                      {senderName}
                    </p>
                  )}

                  {!isRevoked &&
                    message.medias?.map((media, mediaIndex) => {
                      const mediaKind = resolveMediaKind(media);

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
                            className="mb-2 max-h-80 w-full max-w-[17rem] rounded-xl bg-muted object-cover"
                          />
                        );
                      }

                      if (mediaKind === "VIDEO") {
                        return (
                          <video
                            key={`${message.id}-${mediaIndex}`}
                            src={media.url}
                            controls
                            preload="metadata"
                            className="mb-2 max-h-80 w-full max-w-[18rem] rounded-xl bg-muted"
                          />
                        );
                      }

                      return (
                        <FileAttachmentPreview
                          key={`${message.id}-${mediaIndex}`}
                          url={media.url}
                          mimeType={media.mimeType}
                          size={media.size}
                          fileName={media.fileName}
                        />
                      );
                    })}

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
                  ) : message.text ? (
                    <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">
                      {message.text}
                    </p>
                  ) : null}

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        aria-label="Tuỳ chọn tin nhắn"
                        className={cn(
                          "absolute top-1 inline-flex size-8 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-sm",
                          "transition-opacity duration-[--motion-fast]",
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
              </div>

              {isMine && !isSameAsNext && (
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
