import { useCallback, useEffect, useRef, useState } from "react";
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
import { useLiquidUnderline } from "@/hooks/useLiquidUnderline";
import { showErrorToast } from "@/utils/toastError";
import {
  AlertCircle,
  ChevronRight,
  Clock,
  Inbox,
  Send,
  AnimateIcon,
} from "@/components/icons";
import { EmptyState } from "@/components/ui/feedback";
import { InfiniteListFooter } from "@/components/ui/infinite-list-footer";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { staggerStyle } from "@/lib/motion";
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

/** Placeholder rows shaped like a request card. */
function RequestRowsSkeleton({ count }: { count: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, index) => (
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
  );
}

const ListFriendRequests = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestIdFromUrl = searchParams.get("requestId") || "";
  const [direction, setDirection] =
    useState<FriendRequestDirection>("received");
  const { listRef, lineRef, tabRefs } = useLiquidUnderline(
    TABS.findIndex((tab) => tab.key === direction),
  );
  const [requests, setRequests] = useState<FriendRequestListItem[]>([]);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  // Whether the server still has more rows. The load-more button used to be
  // rendered forever, so the last press always came back with nothing.
  const [hasMore, setHasMore] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedRequestId, setSelectedRequestId] = useState("");

  // The tab a response belongs to; one arriving after a switch is dropped.
  const directionRef = useRef(direction);
  directionRef.current = direction;

  /** The first page of a tab, replacing whatever was shown. */
  const fetchRequests = useCallback(
    async ({ dir }: { dir: FriendRequestDirection }) => {
      setIsLoading(true);
      setLoadError(null);

      try {
        const data = await getFriendRequestsAPI({
          limit: PAGE_SIZE,
          page: 1,
          direction: dir,
        });
        if (directionRef.current !== dir) return;
        setRequests(data);
        setHasMore(data.length >= PAGE_SIZE);
        setPage(1);
      } catch (error) {
        if (directionRef.current !== dir) return;
        setLoadError("Không thể tải danh sách lời mời kết bạn");
        showErrorToast(error, "Không thể tải danh sách lời mời kết bạn");
      } finally {
        if (directionRef.current === dir) setIsLoading(false);
      }
    },
    [],
  );

  // Later pages, as the list is scrolled. Failures surface in the footer.
  const paging = useInfiniteScroll({
    hasMore,
    enabled: !isLoading && !loadError && requests.length > 0,
    itemCount: requests.length,
    loadMore: async () => {
      const dir = direction;
      const nextPage = page + 1;
      const data = await getFriendRequestsAPI({
        limit: PAGE_SIZE,
        page: nextPage,
        direction: dir,
      });
      if (directionRef.current !== dir) return;
      setRequests((prev) => {
        const merged = [...prev, ...data];
        // De-duplicate by id: a request arriving while page N is in flight
        // would otherwise appear twice as the pages shift under it.
        return Array.from(
          new Map(merged.map((request) => [request.id, request])).values(),
        );
      });
      setHasMore(data.length >= PAGE_SIZE);
      setPage(nextPage);
    },
  });
  const resetPaging = paging.reset;

  useEffect(() => {
    resetPaging();
    void fetchRequests({ dir: direction });
  }, [direction, fetchRequests, resetPaging]);

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
    void fetchRequests({ dir: direction });
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
        ref={listRef}
        role="tablist"
        aria-label="Loại lời mời kết bạn"
        className="relative flex gap-1 border-b border-border px-4 pt-3 sm:px-6"
      >
        {TABS.map((tab, index) => {
          const selected = tab.key === direction;
          const Icon = tab.key === "received" ? Inbox : Send;
          return (
            <AnimateIcon key={tab.key} asChild animateOnHover>
              <button
                ref={(node) => {
                  tabRefs.current[index] = node;
                }}
                role="tab"
                type="button"
                aria-selected={selected}
                onClick={() => setDirection(tab.key)}
                className={cn(
                  "flex items-center gap-2 rounded-t-lg border-b-2 border-transparent px-3 py-2.5 text-sm font-medium",
                  "transition-colors duration-(--motion-fast)",
                  "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
                  selected
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-4" aria-hidden="true" />
                {tab.label}
              </button>
            </AnimateIcon>
          );
        })}
        {/* One shared bar that glides between tabs (useLiquidUnderline).
            -bottom-px puts it on this row's own bottom border, not above it. */}
        <span
          ref={lineRef}
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-px left-0 h-0.5 origin-left rounded-full bg-primary opacity-0"
        />
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div
          className="space-y-2 p-4 sm:p-6"
          aria-busy={isLoading || paging.status === "loading"}
        >
          {requests.map((request, index) => {
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
                style={staggerStyle(index % PAGE_SIZE)}
                className={cn(
                  "group flex w-full animate-stagger-in items-center gap-3 rounded-xl border border-border bg-card p-4 text-left shadow-xs",
                  isReceived &&
                    "hover-lift hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
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

          {isLoading && <RequestRowsSkeleton count={5} />}

          {loadError && !isLoading && (
            <div
              role="alert"
              className="flex animate-fade-in items-center justify-between gap-3 rounded-xl border border-destructive/35 bg-destructive/10 px-4 py-3 text-sm text-destructive-text"
            >
              <span className="flex items-center gap-2">
                <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
                {loadError}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void fetchRequests({ dir: direction })}
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

          {!isLoading && !loadError && requests.length > 0 && (
            <InfiniteListFooter
              sentinelRef={paging.sentinelRef}
              status={paging.status}
              hasMore={hasMore}
              onRetry={paging.retry}
              loading={<RequestRowsSkeleton count={2} />}
              endLabel={
                requests.length > PAGE_SIZE
                  ? "Đã hiển thị tất cả lời mời"
                  : undefined
              }
            />
          )}
        </div>
      </ScrollArea>
    </div>
  );
};

export default ListFriendRequests;
