import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { ModeToggle } from "../ModeToggle";
import type { AppDispatch } from "@/redux/store";
import { useDispatch, useSelector } from "react-redux";
import { useEffect, useRef, useState } from "react";
import {
  getConversations,
  selectConversation,
  type Conversation,
} from "@/redux/slices/conversationSlice";
import { formatDateTime } from "@/utils/formatDateTime";
import MenuCustome from "./Menu";
import { NotificationsDropdown } from "../NotificationDropdown";
import { useNavigate, useParams } from "react-router";
import { selectUser } from "@/redux/slices/userSlice";
import { MessagesSquare } from "lucide-react";

export function ChatSidebar({ className }: { className?: string }) {
  const user = useSelector(selectUser);

  const selectedChatId = useParams().conversationId || "";

  const conversations = useSelector(selectConversation);

  const dispatch = useDispatch<AppDispatch>();

  const navigate = useNavigate();

  const [initialLoading, setInitialLoading] = useState(
    conversations.length === 0,
  );
  const isFetchingMoreRef = useRef(false);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (conversations.length === 0) {
      void dispatch(
        getConversations({ limit: 10, cursor: null }),
      ).finally(() => setInitialLoading(false));
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
    const cursor =
      conversations[conversations.length - 1]?.lastMessageAt || null;
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

  const renderConversationItem = (conversation: Conversation) => {
    const memberCount =
      conversation.memberCount ?? conversation.members?.length ?? 0;
    const isActive = selectedChatId === conversation.id;
    const unread =
      Number(conversation.unreadCount) > 0 || conversation.unreadCount === "5+";

    return (
      <button
        key={conversation.id}
        onClick={() => {
          navigate(`/chat/${conversation.id}`);
        }}
        className={cn(
          "flex w-full items-center gap-3 rounded-xl p-3 text-left transition-colors hover:bg-accent",
          isActive && "bg-accent",
        )}
      >
        <div className="relative shrink-0">
          {conversation.type === "DIRECT" ? (
            <Avatar className="size-12">
              <AvatarImage
                src={conversation.displayAvatar || ""}
                alt={conversation.displayName || "Ảnh đại diện"}
              />
              <AvatarFallback>
                {(conversation.displayName || "C")[0]}
              </AvatarFallback>
            </Avatar>
          ) : (
            <div className="flex -space-x-2 *:data-[slot=avatar]:ring-2 *:data-[slot=avatar]:ring-background">
              <Avatar className="size-12">
                <AvatarImage
                  src={conversation.displayAvatar || ""}
                  alt={conversation.displayName || "Ảnh đại diện nhóm"}
                />
                <AvatarFallback>
                  {(conversation.displayName || "C")[0]}
                </AvatarFallback>
              </Avatar>
              {memberCount >= 2 && (
                <Avatar className="size-12">
                  <AvatarFallback className="text-xs">
                    {memberCount - 1 <= 99 ? memberCount - 1 : "99+"}
                  </AvatarFallback>
                </Avatar>
              )}
            </div>
          )}
        </div>

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
            <span className="shrink-0 text-xs text-muted-foreground">
              {formatDateTime(conversation.updatedAt)}
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
              {conversation?.lastMessageText
                ? conversation.lastMessageSenderName &&
                  conversation.lastMessageSenderId !== user?.id
                  ? `${conversation.lastMessageSenderName}: ${conversation.lastMessageText}`
                  : conversation.lastMessageText
                : "Chưa có tin nhắn nào."}
            </p>
            {unread && (
              <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">
                {Number(conversation.unreadCount) > 5
                  ? "5+"
                  : conversation.unreadCount}
              </span>
            )}
          </div>
        </div>
      </button>
    );
  };

  return (
    <aside
      className={cn(
        "w-full flex-col border-r border-border bg-sidebar md:flex md:w-80 lg:w-96",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h1 className="text-base font-semibold text-foreground">Trò chuyện</h1>
        <div className="flex items-center gap-1">
          <ModeToggle />
          <NotificationsDropdown />
          <MenuCustome />
        </div>
      </div>

      <div className="custom-scrollbar flex-1 space-y-1 overflow-y-auto p-2">
        {initialLoading ? (
          Array.from({ length: 7 }).map((_, index) => (
            <div key={index} className="flex items-center gap-3 p-3">
              <Skeleton className="size-12 shrink-0 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-2/3" />
                <Skeleton className="h-3 w-4/5" />
              </div>
            </div>
          ))
        ) : conversations.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-12 text-center">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <MessagesSquare className="size-7" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">
                Chưa có cuộc trò chuyện
              </p>
              <p className="text-xs text-muted-foreground">
                Bắt đầu nhắn tin với bạn bè hoặc tạo nhóm mới.
              </p>
            </div>
          </div>
        ) : (
          <>
            {conversations.map(renderConversationItem)}
            <div ref={loadMoreSentinelRef} className="h-px w-full" />
          </>
        )}
      </div>
    </aside>
  );
}
