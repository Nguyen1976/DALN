import { useEffect, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { getFriendRequestsAPI, type FriendRequestListItem } from "@/apis";
import FriendRequestModal from "@/components/FriendRequestModal";
import { formatDateTime } from "@/utils/formatDateTime";
import { showErrorToast } from "@/utils/toastError";
import { UserPlus } from "lucide-react";

const ListFriendRequests = () => {
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

  const handleCloseModal = () => {
    setSelectedRequestId("");
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
              className="flex w-full items-center gap-3 rounded-xl border border-border p-4 text-left transition-colors hover:bg-accent"
            >
              <Avatar className="size-12 shrink-0">
                <AvatarImage
                  src={request.fromUser.avatar || "/placeholder.svg"}
                  alt={request.fromUser.username}
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
                  {request.fromUser.email}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatDateTime(request.createdAt)}
                </p>
              </div>

              <span className="shrink-0 rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground">
                Xem chi tiết
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
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <UserPlus className="size-7" />
              </div>
              <p className="text-sm text-muted-foreground">
                Không có lời mời kết bạn nào
              </p>
            </div>
          )}

          {!isLoading && requests.length > 0 && (
            <div className="my-3 flex items-center justify-center">
              <Button
                variant="ghost"
                size="sm"
                className="interceptor-loading text-muted-foreground"
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
