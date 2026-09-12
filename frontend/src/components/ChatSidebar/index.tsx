import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { AvatarWithPresence } from "@/components/ui/avatar";
import { CountBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/feedback";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { ModeToggle } from "../ModeToggle";
import type { AppDispatch } from "@/redux/store";
import { useDispatch, useSelector } from "react-redux";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  getConversations,
  selectConversation,
  type Conversation,
} from "@/redux/slices/conversationSlice";
import { getFriends, selectFriend } from "@/redux/slices/friendSlice";
import { formatConversationTime } from "@/utils/formatDateTime";
import MenuCustome from "./Menu";
import { NotificationsDropdown } from "../NotificationDropdown";
import { useNavigate, useParams } from "react-router";
import { selectUser } from "@/redux/slices/userSlice";
import { MessagesSquare, SearchX, Search, X } from "lucide-react";

/** Vietnamese-friendly search: strips diacritics so "hoa" matches "Hoà". */
const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();

const FILTERS = [
  { key: "all", label: "Tất cả" },
  { key: "unread", label: "Chưa đọc" },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];

const unreadCountOf = (conversation: Conversation) => {
  const raw = conversation.unreadCount;
  if (raw === "5+") return 6;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
};

export function ChatSidebar({ className }: { className?: string }) {
  const user = useSelector(selectUser);
  const friends = useSelector(selectFriend);

  const selectedChatId = useParams().conversationId || "";

  const conversations = useSelector(selectConversation);

  const dispatch = useDispatch<AppDispatch>();

  const navigate = useNavigate();

  const [initialLoading, setInitialLoading] = useState(
    conversations.length === 0,
  );
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const isFetchingMoreRef = useRef(false);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);

  // Presence dots read from the friend slice, so make sure it is populated
  // even when the user lands straight on the chat screen.
  useEffect(() => {
    if (friends.length === 0) {
      void dispatch(getFriends({ limit: 50, page: 1 }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch]);

  useEffect(() => {
    if (conversations.length === 0) {
      void dispatch(getConversations({ limit: 10, cursor: null })).finally(() =>
        setInitialLoading(false),
      );
    } else {
      setInitialLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch]);

  // Reset the in-flight guard whenever new conversations arrive so the next
  // page can be requested; when nothing new arrives we stop loading more.
  useEffect(() => {
    isFetchingMoreRef.current = false;
  }, [conversations.length]);

  const loadMoreConversations = () => {
    if (isFetchingMoreRef.current) return;
    const last = conversations[conversations.length - 1];
    // The id rides along as a tie-breaker: several conversations can share the
    // same lastMessageAt (the friendship saga stamps them together), and a
    // timestamp-only cursor skips whichever ones fell on the page boundary.
    const cursor = last?.lastMessageAt ? `${last.lastMessageAt}|${last.id}` : null;
    if (!cursor) return;
    isFetchingMoreRef.current = true;
    dispatch(getConversations({ limit: 10, cursor }));
  };

  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          loadMoreConversations();
        }
      },
      { rootMargin: "200px" },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations.length]);

  /** userId -> online, so a direct chat can show the peer's presence. */
  const presenceByUserId = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const friend of friends) map.set(friend.id, Boolean(friend.status));
    return map;
  }, [friends]);

  const totalUnread = useMemo(
    () => conversations.filter((c) => unreadCountOf(c) > 0).length,
    [conversations],
  );

  const visibleConversations = useMemo(() => {
    const needle = normalize(query.trim());
    return conversations.filter((conversation) => {
      if (filter === "unread" && unreadCountOf(conversation) === 0) {
        return false;
      }
      if (!needle) return true;
      return (
        normalize(conversation.displayName || "").includes(needle) ||
        normalize(conversation.lastMessageText || "").includes(needle)
      );
    });
  }, [conversations, filter, query]);

  const renderConversationItem = (conversation: Conversation) => {
    const memberCount =
      conversation.memberCount ?? conversation.members?.length ?? 0;
    const isActive = selectedChatId === conversation.id;
    const unread = unreadCountOf(conversation);
    const isDirect = conversation.type === "DIRECT";

    // `peerUserId` do backend phi chuẩn hoá; `members` chỉ còn là đường dự
    // phòng cho payload nào vẫn mang nó (chi tiết hội thoại, realtime).
    const peerId = isDirect
      ? (conversation.peerUserId ??
        conversation.members?.find((m) => m.userId !== user?.id)?.userId)
      : undefined;
    const peerOnline = peerId ? presenceByUserId.get(peerId) : undefined;

    const preview = conversation.lastMessageText
      ? conversation.lastMessageSenderName &&
        conversation.lastMessageSenderId !== user?.id
        ? `${conversation.lastMessageSenderName}: ${conversation.lastMessageText}`
        : conversation.lastMessageSenderId === user?.id
          ? `Bạn: ${conversation.lastMessageText}`
          : conversation.lastMessageText
      : "Chưa có tin nhắn nào.";

    return (
      <button
        key={conversation.id}
        onClick={() => navigate(`/chat/${conversation.id}`)}
        aria-current={isActive ? "true" : undefined}
        className={cn(
          "relative flex w-full items-center gap-3 rounded-xl p-2.5 text-left",
          "transition-colors duration-[--motion-fast]",
          "hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
          isActive && "bg-accent",
        )}
      >
        {/* Active rail: the selected row is marked by shape as well as fill. */}
        <span
          aria-hidden="true"
          className={cn(
            "absolute left-0 top-1/2 h-8 w-1 -translate-y-1/2 rounded-r-full bg-primary transition-opacity duration-[--motion-fast]",
            isActive ? "opacity-100" : "opacity-0",
          )}
        />

        {isDirect ? (
          <AvatarWithPresence
            status={
              peerOnline === undefined
                ? null
                : peerOnline
                  ? "online"
                  : "offline"
            }
          >
            <Avatar className="size-12">
              <AvatarImage
                src={conversation.displayAvatar || ""}
                alt={`Ảnh đại diện ${conversation.displayName || "cuộc trò chuyện"}`}
              />
              <AvatarFallback>
                {(conversation.displayName || "C")[0]}
              </AvatarFallback>
            </Avatar>
          </AvatarWithPresence>
        ) : (
          <div className="relative shrink-0">
            <Avatar className="size-12">
              <AvatarImage
                src={conversation.displayAvatar || ""}
                alt={`Ảnh đại diện nhóm ${conversation.displayName || ""}`}
              />
              <AvatarFallback>
                {(conversation.displayName || "C")[0]}
              </AvatarFallback>
            </Avatar>
            {memberCount > 0 && (
              <span className="absolute -bottom-0.5 -right-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-secondary px-1 text-[10px] font-semibold tabular-nums text-secondary-foreground ring-2 ring-sidebar">
                {memberCount > 99 ? "99+" : memberCount}
                <span className="sr-only"> thành viên</span>
              </span>
            )}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="mb-0.5 flex items-center justify-between gap-2">
            <span
              className={cn(
                "truncate text-sm text-foreground",
                unread ? "font-semibold" : "font-medium",
              )}
            >
              {conversation.displayName}
            </span>
            <span
              className={cn(
                "shrink-0 text-[11px] tabular-nums",
                unread ? "font-medium text-brand" : "text-muted-foreground",
              )}
            >
              {formatConversationTime(
                conversation.lastMessageAt || conversation.updatedAt,
              )}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <p
              className={cn(
                "truncate text-sm",
                unread
                  ? "font-medium text-foreground"
                  : "text-muted-foreground",
              )}
            >
              {preview}
            </p>
            <CountBadge count={unread} />
          </div>
        </div>
      </button>
    );
  };

  return (
    <aside
      aria-label="Danh sách cuộc trò chuyện"
      className={cn(
        "w-full flex-col border-r border-sidebar-border bg-sidebar md:flex md:w-80 lg:w-[22rem]",
        className,
      )}
    >
      <div className="shrink-0 space-y-3 border-b border-sidebar-border px-3 pb-3 pt-3">
        <div className="flex items-center justify-between gap-2 pl-1">
          <div className="flex items-baseline gap-2">
            <h1 className="text-lg font-semibold tracking-[-0.01em] text-foreground">
              Trò chuyện
            </h1>
            {totalUnread > 0 && (
              <span className="text-xs font-medium text-brand">
                {totalUnread} chưa đọc
              </span>
            )}
          </div>
          <div className="flex items-center gap-0.5">
            <ModeToggle />
            <NotificationsDropdown />
            <MenuCustome />
          </div>
        </div>

        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Tìm cuộc trò chuyện"
            aria-label="Tìm cuộc trò chuyện"
            className={cn(
              "h-10 w-full rounded-xl border border-transparent bg-muted pl-9 pr-9 text-sm text-foreground",
              "transition-[border-color,box-shadow] duration-[--motion-fast]",
              "outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30",
              "[&::-webkit-search-cancel-button]:hidden",
            )}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Xoá từ khoá tìm kiếm"
              className="absolute right-1.5 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          )}
        </div>

        <div
          role="tablist"
          aria-label="Lọc cuộc trò chuyện"
          className="flex gap-1"
        >
          {FILTERS.map(({ key, label }) => (
            <button
              key={key}
              role="tab"
              aria-selected={filter === key}
              onClick={() => setFilter(key)}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-medium transition-colors duration-[--motion-fast]",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                filter === key
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
              {key === "unread" && totalUnread > 0 && (
                <span className="ml-1 tabular-nums">({totalUnread})</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="custom-scrollbar flex-1 space-y-0.5 overflow-y-auto p-2">
        {initialLoading ? (
          Array.from({ length: 7 }).map((_, index) => (
            <div key={index} className="flex items-center gap-3 p-2.5">
              <Skeleton className="size-12 shrink-0 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-2/3" />
                <Skeleton className="h-3 w-4/5" />
              </div>
            </div>
          ))
        ) : conversations.length === 0 ? (
          <EmptyState
            icon={MessagesSquare}
            title="Chưa có cuộc trò chuyện"
            description="Bắt đầu nhắn tin với bạn bè hoặc tạo một nhóm mới."
            compact
          />
        ) : visibleConversations.length === 0 ? (
          <EmptyState
            icon={SearchX}
            title="Không tìm thấy kết quả"
            description={
              filter === "unread"
                ? "Bạn đã đọc hết tin nhắn."
                : `Không có cuộc trò chuyện nào khớp với “${query}”.`
            }
            compact
          />
        ) : (
          <>
            {visibleConversations.map(renderConversationItem)}
            <div ref={loadMoreSentinelRef} className="h-px w-full" />
          </>
        )}
      </div>
    </aside>
  );
}
