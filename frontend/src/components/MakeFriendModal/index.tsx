import { Button } from "@/components/ui/button";
import { AlertCircle, Loader2, UserPlus, X } from "lucide-react";
import { Input } from "../ui/input";
import { useRef } from "react";
import { useForm } from "react-hook-form";
import { makeFriendRequest } from "@/apis";
import { toast } from "sonner";
import { getErrorMessage } from "@/utils/getErrorMessage";

interface MakeFriendModalProps {
  onClose: () => void;
}

export function MakeFriendModal({ onClose }: MakeFriendModalProps) {
  const {
    register,
    handleSubmit,
    setError,
    clearErrors,
    formState: { errors, isSubmitting },
  } = useForm<{ email: string }>();
  // `isSubmitting` only disables the button after React re-renders; two clicks
  // inside the same tick both get through. This ref closes that window.
  const inFlight = useRef(false);

  /**
   * The previous version was `makeFriendRequest(email).then(close)` with no
   * rejection handler: a rejected invite left an unhandled AxiosError in the
   * console, no busy state (so the button could be hammered), and no sign in
   * the dialog itself of what went wrong.
   */
  const onSubmit = async (data: { email: string }) => {
    if (inFlight.current) return;
    inFlight.current = true;
    clearErrors("email");
    try {
      await makeFriendRequest(data.email.trim());
      toast.success("Đã gửi lời mời kết bạn thành công");
      onClose();
    } catch (error) {
      setError("email", {
        type: "server",
        message: getErrorMessage(error, "Không gửi được lời mời kết bạn"),
      });
    } finally {
      inFlight.current = false;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/60 p-4 backdrop-blur-sm animate-fade-in">
      <form
        noValidate
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
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={
              errors.email ? "make-friend-email-error" : undefined
            }
            {...register("email", {
              required: "Vui lòng nhập email",
              pattern: {
                value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                message: "Email không hợp lệ",
              },
            })}
          />
          {errors.email ? (
            <p
              id="make-friend-email-error"
              role="alert"
              className="flex items-start gap-1.5 text-sm text-destructive-text"
            >
              <AlertCircle
                className="mt-0.5 size-3.5 shrink-0"
                aria-hidden="true"
              />
              <span>{errors.email.message}</span>
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Người nhận sẽ thấy lời mời trong mục Lời mời kết bạn.
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border p-4">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Huỷ
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting && (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            )}
            {isSubmitting ? "Đang gửi..." : "Gửi lời mời"}
          </Button>
        </div>
      </form>
    </div>
  );
}
