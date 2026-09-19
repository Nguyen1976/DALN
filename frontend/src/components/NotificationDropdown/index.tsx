import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Bell,
  BellRing,
  Check,
  MessageSquare,
  Settings2,
  UserPlus,
  Users,
} from "@/components/icons";
import { EmptyState } from "@/components/ui/feedback";
import { InfiniteListFooter } from "@/components/ui/infinite-list-footer";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import type { AppDispatch } from "@/redux/store";
import {
  fetchUnreadCount,
  getNotifications,
  markAllNotificationsAsRead,
  markNotificationAsRead,
  NOTIFICATIONS_PAGE_SIZE,
  selectNotification,
  selectNotificationsHasMore,
  selectNotificationsLoaded,
  selectNotificationsPage,
  selectUnreadCountLoaded,
  selectUnreadNotificationCount,
  type Notification,
} from "@/redux/slices/notificationSlice";
import { formatFullDateTime, formatRelativeTime } from "@/utils/formatDateTime";
import FriendRequestModal from "../FriendRequestModal";
import { useNavigate } from "react-router";
import { socket } from "@/lib/socket";
import { staggerStyle } from "@/lib/motion";

/** Notification type -> icon, so each row is scannable without reading it. */
const iconForType = (type?: string) => {
  if (type === "FRIEND_REQUEST") return UserPlus;
  if (type?.includes("GROUP")) return Users;
  if (type?.includes("MESSAGE")) return MessageSquare;
  return BellRing;
};

export function NotificationsDropdown() {
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const notifications = useSelector(selectNotification);
  // From the server, not from `notifications`: the list holds one page, so
  // counting it capped the badge at the page size.
  const unreadCount = useSelector(selectUnreadNotificationCount);
  const unreadCountLoaded = useSelector(selectUnreadCountLoaded);
  // Paging lives in redux: this dropdown sits in the chat sidebar, which
  // unmounts whenever another tab is open, and must not start over each time.
  const loaded = useSelector(selectNotificationsLoaded);
  const page = useSelector(selectNotificationsPage);
  const hasMore = useSelector(selectNotificationsHasMore);
  const [isMarkingAllRead, setIsMarkingAllRead] = useState(false);
  const limit = NOTIFICATIONS_PAGE_SIZE;
  // The badge pops when the count changes, not every time the chat screen
  // (and this bell with it) comes back into view.
  const [countOnArrival] = useState(unreadCount);

  // Once per session: afterwards arrivals and reads keep the count right,
  // and a reconnect re-syncs it (below). It used to be refetched every time
  // the chat screen came back into view.
  useEffect(() => {
    if (!unreadCountLoaded) void dispatch(fetchUnreadCount());
  }, [dispatch, unreadCountLoaded]);

  // Re-sync after the realtime channel drops and comes back, so a badge that
  // drifted while disconnected snaps back to the truth.
  useEffect(() => {
    const resync = () => void dispatch(fetchUnreadCount());
    socket.on("connect", resync);
    return () => {
      socket.off("connect", resync);
    };
  }, [dispatch]);

  // First page once per session. Checking `loaded` rather than an empty list:
  // someone with no notifications at all used to refetch on every visit.
  useEffect(() => {
    if (!loaded) void dispatch(getNotifications({ limit, page: 1 }));
  }, [dispatch, loaded, limit]);

  const [showFriendRequestModal, setShowFriendRequestModal] = useState("");

  const handleClickNotification = async (n: Notification) => {
    if (!n.isRead) {
      await dispatch(markNotificationAsRead({ notificationId: n.id }));
    }

    if (n.type === "FRIEND_REQUEST" && n.friendRequestId) {
      setShowFriendRequestModal(n.friendRequestId);
    }
  };

  const handleMarkAllRead = async () => {
    setIsMarkingAllRead(true);
    try {
      await dispatch(markAllNotificationsAsRead()).unwrap();
    } finally {
      setIsMarkingAllRead(false);
    }
  };

  // Older notifications page in as the list is scrolled. A failure used to
  // end the list silently; it now offers a retry at the bottom.
  const paging = useInfiniteScroll({
    hasMore,
    enabled: notifications.length > 0,
    itemCount: notifications.length,
    loadMore: () =>
      dispatch(getNotifications({ limit, page: page + 1 })).unwrap(),
  });

  return (
    <>
      <FriendRequestModal
        isOpen={showFriendRequestModal !== ""}
        onClose={() => setShowFriendRequestModal("")}
        friendRequestId={showFriendRequestModal}
      />
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={
              unreadCount > 0
                ? `Thông báo, ${unreadCount} chưa đọc`
                : "Thông báo"
            }
            className="relative"
          >
            <Bell className="size-5" />
            {unreadCount > 0 && (
              <span
                // Re-keyed per count: a new notification pops the badge.
                key={unreadCount}
                aria-hidden="true"
                className={cn(
                  "absolute right-1.5 top-1.5 flex h-4 min-w-4",
                  unreadCount !== countOnArrival && "animate-pop-in",
                  "items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold tabular-nums text-destructive-foreground ring-2 ring-sidebar",
                )}
              >
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[22rem] overflow-hidden p-0"
          align="end"
          sideOffset={8}
        >
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
            <div className="flex items-baseline gap-2">
              <h2 className="text-sm font-semibold text-foreground">
                Thông báo
              </h2>
              {unreadCount > 0 && (
                <span className="text-xs font-medium text-brand">
                  {unreadCount} mới
                </span>
              )}
            </div>
            <Button
              variant="ghost-muted"
              size="icon-sm"
              aria-label="Cài đặt thông báo"
              onClick={() => navigate("/settings/notifications")}
            >
              <Settings2 className="size-4" />
            </Button>
          </div>

          <div
            className="custom-scrollbar h-96 overflow-y-auto"
            aria-busy={paging.status === "loading"}
          >
            {notifications.length > 0 ? (
              <ul className="flex flex-col">
                {notifications.map((n, index) => {
                  const Icon = iconForType(n.type);
                  return (
                    <li
                      key={n.id}
                      className="animate-stagger-in"
                      style={staggerStyle(index % limit)}
                    >
                      <button
                        className={cn(
                          "flex w-full items-start gap-3 border-b border-border px-4 py-3 text-left last:border-0",
                          "transition-colors duration-(--motion-fast) hover:bg-accent",
                          "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
                          !n.isRead && "bg-accent/45",
                        )}
                        onClick={() => handleClickNotification(n)}
                      >
                        <span
                          aria-hidden="true"
                          className={cn(
                            "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg",
                            n.isRead
                              ? "bg-muted text-muted-foreground"
                              : "bg-primary/15 text-brand",
                          )}
                        >
                          <Icon className="size-4" />
                        </span>

                        <div className="min-w-0 flex-1">
                          <p
                            className={cn(
                              "text-sm leading-relaxed",
                              n.isRead
                                ? "text-muted-foreground"
                                : "font-medium text-foreground",
                            )}
                          >
                            {n.message}
                          </p>
                          <time
                            dateTime={n.createdAt}
                            title={formatFullDateTime(n.createdAt)}
                            className="mt-0.5 block text-xs text-muted-foreground"
                          >
                            {formatRelativeTime(n.createdAt)}
                          </time>
                        </div>

                        {!n.isRead && (
                          <>
                            <span
                              aria-hidden="true"
                              className="mt-2 size-2 shrink-0 rounded-full bg-primary"
                            />
                            <span className="sr-only">Chưa đọc</span>
                          </>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState
                icon={Bell}
                title="Chưa có thông báo"
                description="Tin nhắn mới và lời mời kết bạn sẽ hiện ở đây."
                compact
              />
            )}
            {notifications.length > 0 && (
              <InfiniteListFooter
                sentinelRef={paging.sentinelRef}
                status={paging.status}
                hasMore={hasMore}
                onRetry={paging.retry}
              />
            )}
          </div>

          <div className="border-t border-border p-2">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-center"
              onClick={handleMarkAllRead}
              disabled={isMarkingAllRead || unreadCount === 0}
            >
              <Check className="size-4" aria-hidden="true" />
              {isMarkingAllRead ? "Đang xử lý..." : "Đánh dấu tất cả đã đọc"}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
}
