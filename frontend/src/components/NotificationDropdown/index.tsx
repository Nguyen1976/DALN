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
} from "lucide-react";
import { EmptyState, Spinner } from "@/components/ui/feedback";
import { cn } from "@/lib/utils";
import { type UIEvent, useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import type { AppDispatch } from "@/redux/store";
import {
  getNotifications,
  markAllNotificationsAsRead,
  markNotificationAsRead,
  selectNotification,
  type Notification,
} from "@/redux/slices/notificationSlice";
import { formatFullDateTime, formatRelativeTime } from "@/utils/formatDateTime";
import FriendRequestModal from "../FriendRequestModal";
import { useNavigate } from "react-router";

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
  const [page, setPage] = useState(1);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [isMarkingAllRead, setIsMarkingAllRead] = useState(false);
  const limit = 10;

  useEffect(() => {
    if (notifications.length > 0) return;

    setPage(1);
    setHasMore(true);
    void dispatch(getNotifications({ limit, page: 1 }))
      .unwrap()
      .then((res) => {
        setHasMore((res.notifications || []).length >= limit);
      })
      .catch(() => {
        setHasMore(false);
      });
  }, [dispatch, notifications.length]);

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

  const handleLoadMore = async () => {
    if (isLoadingMore || !hasMore) return;

    const nextPage = page + 1;
    setIsLoadingMore(true);
    try {
      const res = await dispatch(
        getNotifications({ limit, page: nextPage }),
      ).unwrap();
      const loaded = (res.notifications || []).length;
      setPage(nextPage);
      setHasMore(loaded >= limit);
    } catch {
      setHasMore(false);
    } finally {
      setIsLoadingMore(false);
    }
  };

  const handleNotificationScroll = (event: UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget;
    const nearBottom =
      target.scrollHeight - target.scrollTop - target.clientHeight < 80;

    if (nearBottom) {
      void handleLoadMore();
    }
  };

  const unreadCount = notifications.filter((n) => !n.isRead).length;

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
              <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold tabular-nums text-destructive-foreground ring-2 ring-sidebar">
                {unreadCount > 9 ? "9+" : unreadCount}
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
            onScroll={handleNotificationScroll}
          >
            {notifications.length > 0 ? (
              <ul className="flex flex-col">
                {notifications.map((n) => {
                  const Icon = iconForType(n.type);
                  return (
                    <li key={n.id}>
                      <button
                        className={cn(
                          "flex w-full items-start gap-3 border-b border-border px-4 py-3 text-left last:border-0",
                          "transition-colors duration-[--motion-fast] hover:bg-accent",
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
                {isLoadingMore && (
                  <li className="flex items-center justify-center gap-2 px-4 py-3 text-xs text-muted-foreground">
                    <Spinner label="Đang tải thêm thông báo" />
                    Đang tải thêm…
                  </li>
                )}
              </ul>
            ) : (
              <EmptyState
                icon={Bell}
                title="Chưa có thông báo"
                description="Tin nhắn mới và lời mời kết bạn sẽ hiện ở đây."
                compact
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
