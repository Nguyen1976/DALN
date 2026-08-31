import { useEffect, useRef, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import {
  getFriendRequestDetail,
  updateFriendRequestStatus,
  type DetailMakeFriendResponse,
} from "@/apis";
import { useDispatch, useSelector } from "react-redux";
import { getFriends } from "@/redux/slices/friendSlice";
import { selectUser } from "@/redux/slices/userSlice";
import type { AppDispatch } from "@/redux/store";
import { showErrorToast } from "@/utils/toastError";
import { getErrorMessage } from "@/utils/getErrorMessage";
import { Skeleton } from "../ui/skeleton";
import { AlertCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface FriendRequestModalProps {
  friendRequestId: string;
  isOpen: boolean;
  onClose: () => void;
}

const FriendRequestModal = ({
  isOpen,
  friendRequestId,
  onClose,
}: FriendRequestModalProps) => {
  const dispatch = useDispatch<AppDispatch>();
  const [friendRequestData, setFriendRequestData] =
    useState<DetailMakeFriendResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  // Which action is in flight, so both buttons can lock together and the one
  // that was pressed can say what it is doing.
  const [pending, setPending] = useState<"accept" | "reject" | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Guards both actions synchronously: `pending` only takes effect after a
  // re-render, so a rapid double-click still fired two accepts — which the
  // server then raced into a half-created friendship.
  const inFlight = useRef(false);

  const user = useSelector(selectUser);

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    setIsLoading(true);
    setLoadError(null);
    setFriendRequestData(null);

    // The old call had no rejection handler: a failed lookup left an unhandled
    // promise rejection and a dialog stuck showing an empty avatar.
    getFriendRequestDetail(friendRequestId)
      .then((data) => {
        if (!cancelled) setFriendRequestData(data);
      })
      .catch((error) => {
        if (!cancelled) {
          setLoadError(
            getErrorMessage(error, "Không tải được lời mời kết bạn"),
          );
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, friendRequestId]);

  const onAccept = async () => {
    if (!friendRequestData) return;
    if (friendRequestData.status !== "PENDING") {
      toast.error("Lời mời kết bạn này đã được phản hồi trước đó.");
      onClose();
      return;
    }

    const fromUser = friendRequestData.fromUser;
    if (!fromUser?.id) {
      toast.error("Không tìm thấy thông tin người gửi lời mời.");
      return;
    }

    if (inFlight.current) return;
    inFlight.current = true;
    setPending("accept");
    try {
      await updateFriendRequestStatus({
        inviterId: fromUser.id,
        inviteeName: user?.username || "",
        status: "ACCEPTED",
      });

      await dispatch(getFriends({ limit: 100, page: 1 })).unwrap();

      toast.success(`Đã kết bạn với ${fromUser.username}`);
      onClose();
    } catch (error) {
      showErrorToast(error, "Không thể chấp nhận lời mời kết bạn");
    } finally {
      setPending(null);
      inFlight.current = false;
    }
  };

  const onReject = async () => {
    if (!friendRequestData) return;
    if (friendRequestData.status !== "PENDING") {
      toast.error("Lời mời kết bạn này đã được phản hồi trước đó.");
      onClose();
      return;
    }

    if (inFlight.current) return;
    inFlight.current = true;
    setPending("reject");
    try {
      await updateFriendRequestStatus({
        inviterId: friendRequestData.fromUser?.id || "",
        inviteeName: user?.username || "",
        status: "REJECTED",
      });
      toast.success("Đã từ chối lời mời kết bạn");
      onClose();
    } catch (error) {
      showErrorToast(error, "Không thể từ chối lời mời kết bạn");
    } finally {
      setPending(null);
      inFlight.current = false;
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-center">Lời mời kết bạn</DialogTitle>
          <DialogDescription className="text-center">
            Bạn vừa nhận được một lời mời kết bạn mới.
          </DialogDescription>
        </DialogHeader>
        {loadError ? (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-lg border border-destructive/35 bg-destructive/10 px-3.5 py-3 text-sm text-destructive-text"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{loadError}</span>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-4 py-4">
            {isLoading ? (
              <>
                <Skeleton className="size-24 rounded-full" />
                <div className="space-y-2">
                  <Skeleton className="mx-auto h-5 w-36" />
                  <Skeleton className="mx-auto h-4 w-48" />
                </div>
              </>
            ) : (
              <>
                <Avatar className="size-24 border border-border shadow-sm">
                  <AvatarImage
                    src={friendRequestData?.fromUser?.avatar || ""}
                    alt={
                      friendRequestData?.fromUser?.username ||
                      "Ảnh đại diện người dùng"
                    }
                  />
                  <AvatarFallback>
                    {friendRequestData?.fromUser?.username?.[0]}
                  </AvatarFallback>
                </Avatar>
                <div className="space-y-1 text-center">
                  <h3 className="text-lg font-semibold tracking-[-0.01em] text-foreground">
                    {friendRequestData?.fromUser?.username}
                  </h3>
                  {friendRequestData?.fromUser?.email && (
                    <p className="text-sm text-muted-foreground">
                      {friendRequestData.fromUser.email}
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        )}
        <DialogFooter className="gap-2 sm:flex-row">
          {/* Both buttons lock while either request is in flight: a second
              click used to fire a second accept before the first returned. */}
          <Button
            variant="outline"
            className="flex-1"
            onClick={onReject}
            disabled={Boolean(pending) || isLoading || Boolean(loadError)}
          >
            {pending === "reject" && (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            )}
            {pending === "reject" ? "Đang xử lý..." : "Từ chối"}
          </Button>
          <Button
            className="flex-1"
            onClick={onAccept}
            disabled={Boolean(pending) || isLoading || Boolean(loadError)}
          >
            {pending === "accept" && (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            )}
            {pending === "accept" ? "Đang xử lý..." : "Chấp nhận"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default FriendRequestModal;
