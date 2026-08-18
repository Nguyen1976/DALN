import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getConversationAssetsAPI,
  type ConversationAssetMessage,
} from "@/apis";
import type {
  Conversation,
  ConversationState,
} from "@/redux/slices/conversationSlice";
import { FileText, ImageIcon, Link2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { GroupMemberManager } from "./GroupMemberManager";

interface ProfilePanelProps {
  conversationId: string;
  onClose: () => void;
  onJumpToMessage: (messageId: string) => void;
}

export default function ProfilePanel({
  conversationId,
  onClose,
  onJumpToMessage,
}: ProfilePanelProps) {
  const [assetKind, setAssetKind] = useState<"MEDIA" | "LINK" | "DOC">("MEDIA");
  const [assets, setAssets] = useState<ConversationAssetMessage[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [fetchKey, setFetchKey] = useState(0);

  const conversation = useSelector(
    (state: { conversations: ConversationState }) => {
      return state.conversations?.find((c) => c.id === conversationId);
    },
  ) as Conversation;

  const title = conversation?.displayName || "Cuộc trò chuyện";

  const canAccessConversationData =
    conversation?.membershipStatus !== "REMOVED" &&
    conversation?.membershipStatus !== "LEFT";

  useEffect(() => {
    setAssets([]);
    setCursor(null);
    setNextCursor(null);
    setHasMore(canAccessConversationData);
    setFetchKey((prev) => prev + 1);
  }, [conversationId, assetKind, canAccessConversationData]);

  useEffect(() => {
    if (
      !conversationId ||
      !canAccessConversationData ||
      !hasMore ||
      isLoading
    ) {
      return;
    }

    setIsLoading(true);
    getConversationAssetsAPI({
      conversationId,
      kind: assetKind,
      cursor,
      limit: 18,
    })
      .then((response) => {
        const nextMessages = response.messages || [];
        setAssets((prev) => {
          const merged = [...prev, ...nextMessages];
          return merged.filter(
            (message, index, array) =>
              index === array.findIndex((item) => item.id === message.id),
          );
        });
        setNextCursor(response.nextCursor || null);
        setHasMore(Boolean(response.nextCursor));
      })
      .catch(() => {
        setHasMore(false);
      })
      .finally(() => setIsLoading(false));
  }, [
    conversationId,
    assetKind,
    cursor,
    hasMore,
    fetchKey,
    canAccessConversationData,
  ]);

  const resolveMediaPreviewUrl = (message: ConversationAssetMessage) => {
    const media = message.medias?.[0];
    if (media?.url) return media.url;

    const content = message.text || "";
    if (content.startsWith("http")) return content;
    return "";
  };

  const resolveFileName = (message: ConversationAssetMessage) => {
    const mediaUrl = message.medias?.[0]?.url || message.text || "";
    if (!mediaUrl) return "tệp đính kèm";
    try {
      const parsed = new URL(mediaUrl);
      return decodeURIComponent(
        parsed.pathname.split("/").pop() || "tệp đính kèm",
      );
    } catch {
      return decodeURIComponent(mediaUrl.split("/").pop() || "tệp đính kèm");
    }
  };

  const resolvePrimaryLink = (message: ConversationAssetMessage) => {
    const text = message.text || "";
    const matched = text.match(/https?:\/\/\S+/i);
    if (matched?.[0]) return matched[0];
    return message.medias?.[0]?.url || "";
  };

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-sidebar md:static md:z-auto md:w-80 md:shrink-0 md:border-l md:border-border lg:w-96">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="text-base font-semibold tracking-[-0.01em] text-foreground">
          Thông tin cuộc trò chuyện
        </h2>
        <Button
          variant="ghost-muted"
          size="icon"
          onClick={onClose}
          aria-label="Đóng bảng thông tin"
        >
          <X className="size-5" />
        </Button>
      </div>

      <div className="custom-scrollbar flex-1 overflow-y-auto">
        <div className="space-y-6 p-6">
          {/* Avatar */}
          <div className="flex flex-col items-center text-center">
            <Avatar className="mb-3 size-24 border border-border">
              <AvatarImage
                src={conversation.groupAvatar || conversation.displayAvatar || ""}
                alt={`Ảnh đại diện ${title}`}
              />
              <AvatarFallback className="text-2xl">{title?.[0]}</AvatarFallback>
            </Avatar>
            <h3 className="text-lg font-semibold tracking-[-0.01em] text-foreground">
              {title}
            </h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {conversation.type === "GROUP"
                ? `${conversation.memberCount ?? conversation.members?.length ?? 0} thành viên`
                : "Trò chuyện trực tiếp"}
            </p>
          </div>

          {/* Settings */}
          <div className="space-y-3 rounded-xl border border-border bg-card p-4">
            {[
              ["Tắt thông báo cuộc trò chuyện", "chat-mute"],
              ["Tin nhắn tự biến mất", "chat-ephemeral"],
            ].map(([label, key]) => (
              <div key={key} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-sm text-muted-foreground">
                  {label}
                  <Badge variant="secondary" size="sm">
                    Sắp có
                  </Badge>
                </span>
                <Switch
                  checked={false}
                  disabled
                  aria-label={label}
                  onCheckedChange={() => {}}
                />
              </div>
            ))}
          </div>

          {conversation.type === "GROUP" && <GroupMemberManager />}

          {/* Media */}
          <div>
            <h4 className="mb-3 text-sm font-semibold text-foreground">
              Ảnh, liên kết & tài liệu
            </h4>

            <div className="mb-3 flex gap-2">
              {(
                [
                  ["MEDIA", "Ảnh/Video"],
                  ["LINK", "Liên kết"],
                  ["DOC", "Tài liệu"],
                ] as const
              ).map(([kind, label]) => (
                <Button
                  key={kind}
                  size="sm"
                  variant={assetKind === kind ? "default" : "outline"}
                  onClick={() => setAssetKind(kind)}
                  aria-pressed={assetKind === kind}
                  className="h-8"
                >
                  {label}
                </Button>
              ))}
            </div>

            <div className="space-y-2">
              {assets.map((message) => {
                if (assetKind === "MEDIA") {
                  const url = resolveMediaPreviewUrl(message);
                  if (!url) return null;

                  return (
                    <button
                      key={message.id}
                      onClick={() => onJumpToMessage(message.id)}
                      className="w-full rounded-lg border border-border p-2 text-left transition-colors hover:bg-accent"
                    >
                      <div className="flex items-center gap-2">
                        <ImageIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <img
                          src={url}
                          alt={message.text || "Tệp phương tiện đã gửi"}
                          loading="lazy"
                          className="size-12 rounded-md object-cover"
                        />
                        <p className="truncate text-xs text-muted-foreground">
                          {message.text || "Tệp phương tiện"}
                        </p>
                      </div>
                    </button>
                  );
                }

                if (assetKind === "LINK") {
                  const link = resolvePrimaryLink(message);
                  if (!link) return null;
                  return (
                    <button
                      key={message.id}
                      onClick={() => onJumpToMessage(message.id)}
                      className="w-full rounded-lg border border-border p-2 text-left transition-colors hover:bg-accent"
                    >
                      <div className="flex items-start gap-2">
                        <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                        <p className="truncate text-xs text-primary">{link}</p>
                      </div>
                    </button>
                  );
                }

                return (
                  <button
                    key={message.id}
                    onClick={() => onJumpToMessage(message.id)}
                    className="w-full rounded-lg border border-border p-2 text-left transition-colors hover:bg-accent"
                  >
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <p className="truncate text-xs text-foreground">
                        {resolveFileName(message)}
                      </p>
                    </div>
                  </button>
                );
              })}

              {isLoading && (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, index) => (
                    <Skeleton key={index} className="h-14 w-full rounded-lg" />
                  ))}
                </div>
              )}

              {!isLoading && assets.length === 0 && (
                <p className="py-6 text-center text-xs text-muted-foreground">
                  {canAccessConversationData
                    ? "Không có dữ liệu"
                    : "Bạn không còn trong nhóm này"}
                </p>
              )}

              {!isLoading && hasMore && assets.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full"
                  onClick={() => {
                    if (!isLoading && nextCursor) {
                      setCursor(nextCursor);
                      setFetchKey((prev) => prev + 1);
                    }
                  }}
                >
                  Tải thêm
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
