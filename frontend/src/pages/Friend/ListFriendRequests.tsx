import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getFriendRequestsAPI,
  type FriendRequestDirection,
  type FriendRequestListItem,
} from "@/apis";
import FriendRequestModal from "@/components/FriendRequestModal";
import { formatFullDateTime, formatRelativeTime } from "@/utils/formatDateTime";
import { showErrorToast } from "@/utils/toastError";
import { AlertCircle, ChevronRight, Clock, Inbox, Send } from "lucide-react";
import { EmptyState, Spinner } from "@/components/ui/feedback";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 20;

const TABS: Array<{
  key: FriendRequestDirection;
  label: string;
  emptyTitle: string;
  emptyDescription: string;
}> = [
  {
    key: "received",
    label: "Đã nhận",
    emptyTitle: "Không có lời mời nào",
    emptyDescription:
      "Khi ai đó gửi lời mời kết bạn, lời mời sẽ xuất hiện ở đây.",
  },
  {
    key: "sent",
    label: "Đã gửi",
    emptyTitle: "Bạn chưa gửi lời mời nào",
    emptyDescription:
      "Lời mời bạn gửi đi và đang chờ phản hồi sẽ được liệt kê ở đây.",
  },
];

const ListFriendRequests = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestIdFromUrl = searchParams.get("requestId") || "";
  const [direction, setDirection] =
    useState<FriendRequestDirection>("received");
  const [requests, setRequests] = useState<FriendRequestListItem[]>([]);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  // Whether the server still has more rows. The load-more button used to be
  // rendered forever, so the last press always came back with nothing.
  const [hasMore, setHasMore] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedRequestId, setSelectedRequestId] = useState("");

  const fetchRequests = useCallback(
    async ({
      nextPage,
      replace,
      dir,
    }: {
      nextPage: number;
      replace?: boolean;
      dir: FriendRequestDirection;
    }) => {
      if (replace) setIsLoading(true);
      else setIsLoadingMore(true);
      setLoadError(null);

      try {
        const data = await getFriendRequestsAPI({
          limit: PAGE_SIZE,
          page: nextPage,
          direction: dir,
        });

        setRequests((prev) => {
          if (replace) return data;
          const merged = [...prev, ...data];
          // De-duplicate by id: a request arriving while page N is in flight
          // would otherwise appear twice as the pages shift under it.
          return Array.from(
            new Map(merged.map((request) => [request.id, request])).values(),
          );
        });
        setHasMore(data.length >= PAGE_SIZE);
        setPage(nextPage);
      } catch (error) {
        setLoadError("Không thể tải danh sách lời mời kết bạn");
        showErrorToast(error, "Không thể tải danh sách lời mời kết bạn");
      } finally {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    },
    [],
  );

  useEffect(() => {
    void fetchRequests({ nextPage: 1, replace: true, dir: direction });
  }, [direction, fetchRequests]);

  useEffect(() => {
    if (requestIdFromUrl) {
      setSelectedRequestId(requestIdFromUrl);
    }
  }, [requestIdFromUrl]);

  const handleCloseModal = () => {
    setSelectedRequestId("");
    if (requestIdFromUrl) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete("requestId");
      setSearchParams(nextParams, { replace: true });
    }
    void fetchRequests({ nextPage: 1, replace: true, dir: direction });
  };

  const activeTab = TABS.find((tab) => tab.key === direction) ?? TABS[0];
  const isReceived = direction === "received";

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <FriendRequestModal
        isOpen={selectedRequestId !== ""}
        friendRequestId={selectedRequestId}
        onClose={handleCloseModal}
      />

      {/* Two separate lists: who is waiting on me, and who I am waiting on. */}
      <div
        role="tablist"
        aria-label="Loại lời mời kết bạn"
        className="flex gap-1 border-b border-border px-4 pt-3 sm:px-6"
      >
        {TABS.map((tab) => {
          const selected = tab.key === direction;
          const Icon = tab.key === "received" ? Inbox : Send;
          return (
            <button
              key={tab.key}
              role="tab"
              type="button"
              aria-selected={selected}
              onClick={() => setDirection(tab.key)}
              className={cn(
                "flex items-center gap-2 rounded-t-lg border-b-2 px-3 py-2.5 text-sm font-medium",
                "transition-colors duration-[--motion-fast]",
                "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
                selected
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
              {tab.label}
            </button>
          );
        })}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-2 p-4 sm:p-6">
          {requests.map((request) => {
            const person = request.fromUser;
            const Row = isReceived ? "button" : "div";
            return (
              <Row
                key={request.id}
                {...(isReceived
                  ? {
                      onClick: () => setSelectedRequestId(request.id),
                      type: "button" as const,
                    }
                  : {})}
                className={cn(
                  "group flex w-full items-center gap-3 rounded-xl border border-border bg-card p-4 text-left shadow-xs",
                  isReceived &&
                    "transition-[background-color,box-shadow] duration-[--motion-fast] hover:bg-accent hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                )}
              >
                <Avatar className="size-12 shrink-0">
                  <AvatarImage
                    src={person.avatar || ""}
                    alt={`Ảnh đại diện ${person.username}`}
                  />
                  <AvatarFallback>{(person.username || "U")[0]}</AvatarFallback>
                </Avatar>

                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-foreground">
                    {person.username}
                  </p>
                  <p className="truncate text-sm text-muted-foreground">
                    {isReceived
                      ? "Muốn kết bạn với bạn"
                      : "Đang chờ phản hồi từ họ"}
                  </p>
                  <time
                    dateTime={request.createdAt}
                    title={formatFullDateTime(request.createdAt)}
                    className="mt-0.5 block text-xs text-muted-foreground"
                  >
                    {formatRelativeTime(request.createdAt)}
                  </time>
                </div>

                {isReceived ? (
                  <span className="flex shrink-0 items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground transition-colors group-hover:border-input">
                    Xem chi tiết
                    <ChevronRight className="size-4" aria-hidden="true" />
                  </span>
                ) : (
                  <span className="flex shrink-0 items-center gap-1.5 rounded-lg bg-muted px-3 py-1.5 text-sm font-medium text-muted-foreground">
                    <Clock className="size-4" aria-hidden="true" />
                    Đang chờ
                  </span>
                )}
              </Row>
            );
          })}

          {isLoading && (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, index) => (
                <div
                  key={index}
                  className="flex items-center gap-3 rounded-xl border border-border p-4"
                >
                  <Skeleton className="size-12 shrink-0 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3.5 w-1/3" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {loadError && !isLoading && (
            <div
              role="alert"
              className="flex items-center justify-between gap-3 rounded-xl border border-destructive/35 bg-destructive/10 px-4 py-3 text-sm text-destructive-text"
            >
              <span className="flex items-center gap-2">
                <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
                {loadError}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  void fetchRequests({
                    nextPage: 1,
                    replace: true,
                    dir: direction,
                  })
                }
              >
                Thử lại
              </Button>
            </div>
          )}

          {requests.length === 0 && !isLoading && !loadError && (
            <EmptyState
              icon={isReceived ? Inbox : Send}
              title={activeTab.emptyTitle}
              description={activeTab.emptyDescription}
            />
          )}

          {isLoadingMore && (
            <div className="flex items-center justify-center gap-2 py-3 text-sm text-muted-foreground">
              <Spinner label="Đang tải thêm lời mời" />
              Đang tải thêm…
            </div>
          )}

          {!isLoading && !isLoadingMore && requests.length > 0 && (
            <div className="my-3 flex items-center justify-center">
              {hasMore ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    void fetchRequests({ nextPage: page + 1, dir: direction })
                  }
                >
                  Tải thêm
                </Button>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Đã hiển thị tất cả lời mời
                </p>
              )}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};

export default ListFriendRequests;
