import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { getFriendRequestsAPI, type FriendRequestListItem } from "@/apis";
import FriendRequestModal from "@/components/FriendRequestModal";
import { formatRelativeTime } from "@/utils/formatDateTime";
import { showErrorToast } from "@/utils/toastError";
import { ChevronRight, Inbox } from "lucide-react";
import { EmptyState } from "@/components/ui/feedback";

const ListFriendRequests = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestIdFromUrl = searchParams.get("requestId") || "";
  const [requests, setRequests] = useState<FriendRequestListItem[]>([]);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedRequestId, setSelectedRequestId] = useState("");

  const fetchRequests = async ({
    nextPage,
    replace,
  }: {
    nextPage: number;
    replace?: boolean;
  }) => {
    try {
      setIsLoading(true);
      const data = await getFriendRequestsAPI({ limit: 20, page: nextPage });

      setRequests((prev) => {
        if (replace) return data;

        const merged = [...prev, ...data];
        return Array.from(
          new Map(merged.map((request) => [request.id, request])).values(),
        );
      });
      setPage(nextPage);
    } catch (error) {
      showErrorToast(error, "Không thể tải danh sách lời mời kết bạn");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void fetchRequests({ nextPage: 1, replace: true });
  }, []);

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
    void fetchRequests({ nextPage: 1, replace: true });
  };

  return (
    <div className="h-full min-h-0 flex-1">
      <FriendRequestModal
        isOpen={selectedRequestId !== ""}
        friendRequestId={selectedRequestId}
        onClose={handleCloseModal}
      />

      <ScrollArea className="h-full">
        <div className="space-y-2 p-4 sm:p-6">
          {requests.map((request) => (
            <button
              key={request.id}
              onClick={() => setSelectedRequestId(request.id)}
              className="group flex w-full items-center gap-3 rounded-xl border border-border bg-card p-4 text-left shadow-xs transition-[background-color,box-shadow] duration-[--motion-fast] hover:bg-accent hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <Avatar className="size-12 shrink-0">
                <AvatarImage
                  src={request.fromUser.avatar || ""}
                  alt={`Ảnh đại diện ${request.fromUser.username}`}
                />
                <AvatarFallback>
                  {(request.fromUser.username || "U")[0]}
                </AvatarFallback>
              </Avatar>

              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-foreground">
                  {request.fromUser.username}
                </p>
                <p className="truncate text-sm text-muted-foreground">
                  Muốn kết bạn với bạn
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {formatRelativeTime(request.createdAt)}
                </p>
              </div>

              <span className="flex shrink-0 items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground transition-colors group-hover:border-input">
                Xem chi tiết
                <ChevronRight className="size-4" aria-hidden="true" />
              </span>
            </button>
          ))}

          {isLoading && requests.length === 0 && (
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

          {requests.length === 0 && !isLoading && (
            <EmptyState
              icon={Inbox}
              title="Không có lời mời nào"
              description="Khi ai đó gửi lời mời kết bạn, lời mời sẽ xuất hiện ở đây."
            />
          )}

          {!isLoading && requests.length > 0 && (
            <div className="my-3 flex items-center justify-center">
              <Button
                variant="outline"
                size="sm"
                className="interceptor-loading"
                onClick={() => void fetchRequests({ nextPage: page + 1 })}
              >
                Tải thêm
              </Button>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};

export default ListFriendRequests;
