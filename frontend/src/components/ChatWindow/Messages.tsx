import { cn } from "@/lib/utils";
import type { Message } from "@/redux/slices/messageSlice";
import { selectUser } from "@/redux/slices/userSlice";
import { formatDateTime } from "@/utils/formatDateTime";
import { useSelector } from "react-redux";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import { FileText, MoreVertical, RotateCcw, Trash2, User } from "lucide-react";
import { SeenStatus } from "@/components/SeenStatus";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

const MessageComponent = ({
  messages,
  highlightMessageId,
  seenMessages = {},
  onRevokeMessage,
  onDeleteMessageForMe,
}: {
  messages: Message[];
  highlightMessageId?: string | null;
  seenMessages?: Record<
    string,
    { userId: string; username?: string; avatar?: string }[]
  >;
  onRevokeMessage?: (message: Message) => void;
  onDeleteMessageForMe?: (message: Message) => void;
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

  const getFileNameFromUrl = (url?: string) => {
    if (!url) return "tệp đính kèm";
    try {
      const parsed = new URL(url);
      const rawName = parsed.pathname.split("/").pop() || "tệp đính kèm";
      return decodeURIComponent(rawName);
    } catch {
      const rawName = url.split("/").pop() || "tệp đính kèm";
      return decodeURIComponent(rawName);
    }
  };

  const formatBytes = (size?: string) => {
    const value = Number(size || 0);
    if (!Number.isFinite(value) || value <= 0) return "";
    const units = ["B", "KB", "MB", "GB"];
    let index = 0;
    let current = value;
    while (current >= 1024 && index < units.length - 1) {
      current /= 1024;
      index += 1;
    }
    return `${current.toFixed(current >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
  };

  return (
    <>
      {messages.map((message, index) => {
        const prevMessage = messages[index - 1];
        const nextMessage = messages[index + 1];

        const isMine = message.senderId === user.id;

        const isSameAsPrev = prevMessage?.senderId === message.senderId;

        const isSameAsNext = nextMessage?.senderId === message.senderId;

        const showAvatar = !isSameAsPrev;
        const isRevoked = Boolean(message.isRevoked);
        const canRevoke =
          isMine &&
          !message.id.startsWith("temp-") &&
          message.status !== "pending";

        return (
          <div
            key={message.id}
            id={`message-${message.id}`}
            className={cn(
              "mb-1 scroll-mt-24 rounded-md transition-colors duration-300",
              highlightMessageId === message.id && "bg-bg-box-message-incoming",
            )}
          >
            <div
              className={cn(
                "flex items-end gap-2",
                isMine ? "justify-end" : "justify-start",
              )}
            >
              {!isMine && showAvatar ? (
                <Avatar className="w-10 h-10 border border-bg-box-message-incoming">
                  <AvatarImage src={message.senderMember?.avatar} />
                  <AvatarFallback>
                    <User />
                  </AvatarFallback>
                </Avatar>
              ) : (
                !isMine && <div className="w-10 h-10" />
              )}

              <div
                className={cn(
                  "group relative max-w-md px-4 py-2 text-sm",
                  isMine
                    ? "bg-bg-box-message-out text-text"
                    : "bg-bg-box-message-incoming text-text",

                  // Bo góc theo chuỗi
                  isMine
                    ? cn(
                        "rounded-2xl",
                        isSameAsPrev && "rounded-tr-md",
                        isSameAsNext && "rounded-br-md",
                      )
                    : cn(
                        "rounded-2xl",
                        isSameAsPrev && "rounded-tl-md",
                        isSameAsNext && "rounded-bl-md",
                      ),
                )}
              >
                {!isRevoked &&
                  message.medias?.map((media, mediaIndex) => {
                    const mediaKind = resolveMediaKind(media);

                    if (mediaKind === "IMAGE") {
                      return (
                        <img
                          key={`${message.id}-${mediaIndex}`}
                          src={media.url}
                          alt="image-message"
                          className="max-w-70 max-h-90 rounded-lg mb-2 object-cover"
                        />
                      );
                    }

                    if (mediaKind === "VIDEO") {
                      return (
                        <video
                          key={`${message.id}-${mediaIndex}`}
                          src={media.url}
                          controls
                          className="max-w-75 max-h-90 rounded-lg mb-2"
                        />
                      );
                    }

                    return (
                      <a
                        key={`${message.id}-${mediaIndex}`}
                        href={media.url}
                        target="_blank"
                        rel="noreferrer"
                        className="mb-2 block rounded-lg border border-bg-box-message-incoming px-3 py-2 hover:opacity-90"
                      >
                        <div className="flex items-center gap-2">
                          <FileText className="h-4 w-4 shrink-0 text-blue-300" />
                          <div className="min-w-0">
                            <p className="truncate text-sm text-blue-300">
                              {getFileNameFromUrl(media.url)}
                            </p>
                            <p className="text-xs text-gray-400">
                              {formatBytes(media.size) || "Mở tệp"}
                            </p>
                          </div>
                        </div>
                      </a>
                    );
                  })}

                {isRevoked ? (
                  <p className="italic text-muted-foreground">
                    Tin nhắn đã bị thu hồi
                  </p>
                ) : message.text ? (
                  <p className="wrap-break-word">{message.text}</p>
                ) : null}

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label="Message actions"
                      className={cn(
                        "absolute top-1 inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background text-foreground shadow-sm opacity-0 transition-opacity group-hover:opacity-100 hover:bg-accent",
                        isMine ? "-left-9" : "-right-9",
                      )}
                    >
                      <MoreVertical className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align={isMine ? "end" : "start"}
                    className="w-56 bg-popover text-popover-foreground"
                  >
                    {canRevoke && (
                      <DropdownMenuGroup>
                        <DropdownMenuItem
                          onClick={() => onRevokeMessage?.(message)}
                        >
                          <RotateCcw className="h-4 w-4" />
                          Thu hồi
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                    )}

                    {isMine && <DropdownMenuSeparator />}

                    <DropdownMenuGroup>
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => onDeleteMessageForMe?.(message)}
                      >
                        <Trash2 className="h-4 w-4" />
                        Xóa chỉ ở phía tôi
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>

                {/* Hiện time ở tin cuối */}
                {!isSameAsNext && (
                  <span className="text-xs opacity-70 mt-1 block">
                    {formatDateTime(message.createdAt)}
                  </span>
                )}
              </div>
            </div>
            {isMine && !isSameAsNext && (
              <SeenStatus seenUsers={seenMessages[message.id] || []} />
            )}
          </div>
        );
      })}
    </>
  );
};

export default MessageComponent;
