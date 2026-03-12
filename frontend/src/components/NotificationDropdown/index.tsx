import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Bell, MoreHorizontal, Check } from "lucide-react";
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
import { formatDateTime } from "@/utils/formatDateTime";
import FriendRequestModal from "../FriendRequestModal";
import { useNavigate } from "react-router";

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
            className="relative text-muted-foreground hover:text-foreground"
          >
            <Bell className="w-5 h-5 text-text" />
            {notifications.filter((n) => !n.isRead).length > 0 && (
              <span className="absolute top-2 right-2 w-2 h-2 bg-destructive rounded-full border-2 border-background" />
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-80 p-0 overflow-hidden"
          align="start"
          sideOffset={8}
        >
          <div className="flex items-center justify-between p-4 border-b">
            <h2 className="text-sm font-semibold">Thông báo</h2>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground"
              onClick={() => navigate("/settings/notifications")}
            >
              <MoreHorizontal className="w-4 h-4" />
            </Button>
          </div>

          <div
            className="max-h-96 h-96 overflow-y-auto"
            onScroll={handleNotificationScroll}
          >
            {notifications.length > 0 ? (
              <div className="flex flex-col">
                {notifications.map((n) => (
                  <button
                    key={n.id}
                    className={cn(
                      "w-full px-4 py-3 flex items-start gap-3 hover:bg-accent transition-colors text-left border-b last:border-0",
                      !n.isRead && "bg-primary/5",
                    )}
                    onClick={() => handleClickNotification(n)}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-xs leading-relaxed">{n.message}</p>
                      <span
                        className={cn(
                          "text-[10px] mt-1 block text-muted-foreground",
                        )}
                      >
                        {formatDateTime(n.createdAt)}
                      </span>
                    </div>
                    {!n.isRead && (
                      <div className="w-2 h-2 bg-primary rounded-full mt-2" />
                    )}
                  </button>
                ))}
                {isLoadingMore && (
                  <div className="px-4 py-3 text-center text-xs text-muted-foreground border-b">
                    Đang tải thêm thông báo...
                  </div>
                )}
              </div>
            ) : (
              <div className="p-8 text-center">
                <p className="text-muted-foreground text-xs">
                  Không có thông báo mới
                </p>
              </div>
            )}
          </div>

          <div className="p-2 border-t">
            <Button
              variant="ghost"
              className="w-full text-xs text-primary hover:bg-primary/10 justify-center gap-2 h-8"
              onClick={handleMarkAllRead}
              disabled={isMarkingAllRead || notifications.length === 0}
            >
              <Check className="w-3 h-3" />
              {isMarkingAllRead ? "Đang xử lý..." : "Đánh dấu tất cả đã đọc"}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
}
