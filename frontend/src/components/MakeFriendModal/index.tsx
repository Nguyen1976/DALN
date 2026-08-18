import { Button } from "@/components/ui/button";
import { UserPlus, X } from "lucide-react";
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/60 p-4 backdrop-blur-sm animate-fade-in">
      <form
        className="w-full max-w-md overflow-hidden rounded-2xl border border-border bg-card shadow-lg"
        onSubmit={handleSubmit(onSubmit)}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border p-5">
          <div className="flex gap-3">
            <span
              aria-hidden="true"
              className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground"
            >
              <UserPlus className="size-5" />
            </span>
            <div className="space-y-0.5">
              <h2 className="text-lg font-semibold tracking-[-0.01em] text-foreground">
                Thêm bạn bè
              </h2>
              <p className="text-sm text-muted-foreground">
                Gửi lời mời bằng email đã đăng ký.
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost-muted"
            size="icon"
            onClick={onClose}
            aria-label="Đóng"
            className="-mr-1 -mt-1 shrink-0"
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
            placeholder="ban@email.com"
            autoComplete="email"
            inputMode="email"
            {...register("email", { required: "Vui lòng nhập email" })}
          />
          <p className="text-xs text-muted-foreground">
            Người nhận sẽ thấy lời mời trong mục Lời mời kết bạn.
          </p>
        </div>

        <div className="flex justify-end gap-2 border-t border-border p-4">
          <Button type="button" variant="ghost" onClick={onClose}>
            Huỷ
          </Button>
          <Button type="submit" className="interceptor-loading">
            Gửi lời mời
          </Button>
        </div>
      </form>
    </div>
  );
}
