import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import type { z } from "zod";

import { resetPasswordAPI, validateResetTokenAPI } from "@/apis";
import { resetPasswordScheme } from "@/components/AuthForm/scheme";
import {
  PasswordField,
  PasswordStrength,
} from "@/components/AuthForm/PasswordField";
import { AuthShell } from "@/layouts/AuthShell";
import { AlertCircle, Loader2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { getErrorMessage } from "@/utils/getErrorMessage";

type Values = z.infer<typeof resetPasswordScheme>;
type Status =
  | { kind: "checking" }
  | { kind: "invalid" }
  | { kind: "ready"; maskedEmail?: string };

/**
 * Kiểm tra token NGAY khi vào trang, trước khi hiện form.
 *
 * Nếu không, người dùng gõ xong mật khẩu rồi mới biết liên kết đã chết — và
 * phải gõ lại từ đầu sau khi xin liên kết mới.
 */
export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [status, setStatus] = useState<Status>({ kind: "checking" });
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<Values>({
    resolver: zodResolver(resetPasswordScheme),
    defaultValues: { password: "", confirmPassword: "" },
  });

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setStatus({ kind: "invalid" });
      return;
    }
    validateResetTokenAPI(token)
      .then((result) => {
        if (cancelled) return;
        setStatus(
          result.valid
            ? { kind: "ready", maskedEmail: result.maskedEmail }
            : { kind: "invalid" },
        );
      })
      .catch(() => {
        if (!cancelled) setStatus({ kind: "invalid" });
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const submit = form.handleSubmit(async (values) => {
    setSubmitting(true);
    try {
      await resetPasswordAPI({ token, password: values.password });
      toast.success("Đặt lại mật khẩu thành công. Hãy đăng nhập lại.");
      navigate("/auth");
    } catch (error) {
      // 400 nghĩa là token đã chết (hết hạn hoặc bị thay bởi lần gửi khác)
      // giữa lúc người dùng đang gõ — lỗi này nói về LIÊN KẾT, không phải mật
      // khẩu, nên gắn nó vào field "password" khiến người dùng tưởng nhầm mật
      // khẩu sai. Chuyển sang màn "invalid" sẵn có: nó nói đúng nguyên nhân và
      // có nút "Xin liên kết mới" mà form không có. Phân biệt bằng status HTTP
      // chứ không so khớp chuỗi message, để không vỡ khi backend đổi câu chữ.
      const status = (error as { response?: { status?: number } }).response
        ?.status;
      if (status === 400) {
        setStatus({ kind: "invalid" });
        return;
      }
      form.setError("password", { message: getErrorMessage(error) });
      setSubmitting(false);
    }
  });

  if (status.kind === "checking") {
    return (
      <AuthShell>
        <div className="space-y-6" aria-busy="true">
          <div className="size-13 animate-pulse rounded-full bg-muted" />
          <div className="space-y-3">
            <div className="h-6 w-3/4 animate-pulse rounded-lg bg-muted" />
            <div className="h-4 w-11/12 animate-pulse rounded-lg bg-muted" />
          </div>
          <div className="space-y-4">
            <div className="h-11 animate-pulse rounded-lg bg-muted" />
            <div className="h-11 animate-pulse rounded-lg bg-muted" />
            <div className="h-11 animate-pulse rounded-lg bg-muted" />
          </div>
          <p
            className="flex items-center justify-center gap-2 text-sm text-muted-foreground"
            role="status"
          >
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Đang kiểm tra liên kết…
          </p>
        </div>
      </AuthShell>
    );
  }

  if (status.kind === "invalid") {
    return (
      <AuthShell>
        <div className="space-y-6">
          <span className="flex size-13 items-center justify-center rounded-full bg-destructive/12 text-destructive-text">
            <AlertCircle className="size-6.5" aria-hidden="true" />
          </span>
          <div className="space-y-2">
            <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] sm:text-3xl">
              Liên kết không còn hiệu lực
            </h1>
            {/* Gọi tên đúng nguyên nhân: xin liên kết mới sẽ giết liên kết cũ,
                nên người vừa bấm "Gửi lại" rất dễ rơi vào đây khi họ mở nhầm
                email đầu tiên. "Liên kết không hợp lệ" trống không sẽ khiến họ
                tưởng hệ thống hỏng. */}
            <p className="text-[15px] leading-relaxed text-muted-foreground">
              Liên kết đặt lại mật khẩu chỉ dùng được một lần và hết hạn sau 15
              phút. Có thể bạn đã dùng nó rồi, hoặc đã yêu cầu một liên kết mới
              hơn.
            </p>
          </div>
          <div className="space-y-1.5">
            <Button
              type="button"
              className="w-full"
              onClick={() => navigate("/forgot-password")}
            >
              Xin liên kết mới
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => navigate("/auth")}
            >
              Quay lại đăng nhập
            </Button>
          </div>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div className="space-y-6">
        <div className="space-y-2">
          <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] sm:text-3xl">
            Đặt mật khẩu mới
          </h1>
          {status.maskedEmail && (
            <p className="text-[15px] leading-relaxed text-muted-foreground">
              Cho tài khoản{" "}
              <strong className="font-semibold text-foreground">
                {status.maskedEmail}
              </strong>
              .
            </p>
          )}
        </div>
        <Form {...form}>
          <form noValidate onSubmit={submit} className="flex flex-col gap-4">
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Mật khẩu mới</FormLabel>
                  <FormControl>
                    {/* autoComplete="new-password" và cho phép dán: chặn dán là
                        vi phạm WCAG 2.2 Accessible Authentication — nó buộc
                        người dùng trình quản lý mật khẩu gõ tay chuỗi ngẫu nhiên. */}
                    <PasswordField {...field} autoComplete="new-password" />
                  </FormControl>
                  <PasswordStrength value={field.value} />
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="confirmPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Xác nhận mật khẩu</FormLabel>
                  <FormControl>
                    <PasswordField {...field} autoComplete="new-password" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" disabled={submitting}>
              {submitting && (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              )}
              Đặt lại mật khẩu
            </Button>
          </form>
        </Form>
      </div>
    </AuthShell>
  );
}
