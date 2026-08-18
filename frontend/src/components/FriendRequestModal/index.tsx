import { useEffect, useState } from "react";
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

  const user = useSelector(selectUser);

  useEffect(() => {
    if (isOpen) {
      getFriendRequestDetail(friendRequestId).then((data) => {
        setFriendRequestData(data);
      });
    }
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
    }
  };

  const onReject = async () => {
    if (!friendRequestData) return;
    if (friendRequestData.status !== "PENDING") {
      toast.error("Lời mời kết bạn này đã được phản hồi trước đó.");
      onClose();
      return;
    }

    try {
      await updateFriendRequestStatus({
        inviterId: friendRequestData.fromUser?.id || "",
        inviteeName: user?.username || "",
        status: "REJECTED",
      });
      onClose();
    } catch (error) {
      showErrorToast(error, "Không thể từ chối lời mời kết bạn");
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
        <div className="flex flex-col items-center justify-center gap-4 py-4">
          <Avatar className="size-24 border border-border shadow-sm">
            <AvatarImage
              src={friendRequestData?.fromUser?.avatar || ""}
              alt={
                friendRequestData?.fromUser?.username ||
                "Ảnh đại diện người dùng"
              }
            />
            <AvatarFallback>
              {friendRequestData?.fromUser?.username[0]}
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
        </div>
        <DialogFooter className="gap-2 sm:flex-row">
          <Button variant="outline" className="flex-1" onClick={onReject}>
            Từ chối
          </Button>
          <Button className="flex-1" onClick={onAccept}>
            Chấp nhận
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default FriendRequestModal;
