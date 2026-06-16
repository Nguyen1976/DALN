import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { Input } from "../ui/input";
import { useForm } from "react-hook-form";
import { makeFriendRequest } from "@/apis";
import { toast } from "sonner";

interface MakeFriendModalProps {
  onClose: () => void;
}

export function MakeFriendModal({ onClose }: MakeFriendModalProps) {
  const { register, handleSubmit } = useForm<{ email: string }>();

  const onSubmit = (data: { email: string }) => {
    makeFriendRequest(data.email).then(() => {
      toast.success("Đã gửi lời mời kết bạn thành công");
      onClose();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm animate-fade-in">
      <form
        className="w-full max-w-md overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
        onSubmit={handleSubmit(onSubmit)}
      >
        <div className="flex items-center justify-between border-b border-border p-5">
          <h2 className="text-lg font-semibold text-foreground">Thêm bạn bè</h2>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Đóng"
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="size-5" />
          </Button>
        </div>

        <div className="space-y-2 p-5">
          <label
            htmlFor="make-friend-email"
            className="text-sm font-medium text-foreground"
          >
            Email người dùng
          </label>
          <Input
            id="make-friend-email"
            type="email"
            placeholder="Nhập email"
            {...register("email", { required: "Vui lòng nhập email" })}
          />
        </div>

        <div className="flex justify-end border-t border-border p-4">
          <Button type="submit" className="interceptor-loading">
            Gửi lời mời
          </Button>
        </div>
      </form>
    </div>
  );
}
