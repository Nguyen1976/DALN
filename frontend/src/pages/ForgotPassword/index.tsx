import { useState } from "react";
import { Link } from "react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";

import { forgotPasswordAPI } from "@/apis";
import { forgotPasswordScheme } from "@/components/AuthForm/scheme";
import { AuthShell } from "@/layouts/AuthShell";
import { useResendCountdown } from "@/hooks/useResendCountdown";
import { ArrowLeft, Loader2, MailCheck } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

type Values = z.infer<typeof forgotPasswordScheme>;

/**
 * Hai trạng thái trong CÙNG một khung.
 *
 * Màn "đã gửi" hiện ra kể cả khi email không tồn tại — server trả 204 bất kể
 * thế nào. Vì vậy câu chữ phải là "Nếu địa chỉ này có tài khoản", không được
 * khẳng định là đã gửi đi.
 */
export default function ForgotPasswordPage() {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<Values>({
    resolver: zodResolver(forgotPasswordScheme),
    defaultValues: { email: "" },
  });

  // Khoá theo giá trị ĐANG GÕ, không theo `sentTo`.
  //
  // `start()` chạy ngay sau `setSentTo()`, lúc đó state chưa kịp cập nhật — lấy
  // key từ `sentTo` thì hook vẫn đang giữ chuỗi rỗng, mốc thời gian không được
  // ghi xuống đâu cả, và đếm ngược mất sạch sau mỗi lần tải lại trang.
  const typedEmail = form.watch("email").trim().toLowerCase();
  const { seconds, start } = useResendCountdown(
    typedEmail,
    "daln:pwdreset-resend-until",
  );

  const submit = form.handleSubmit(async (values) => {
    setSubmitting(true);
    try {
      await forgotPasswordAPI(values);
      setSentTo(values.email.trim().toLowerCase());
      start(60);
    } finally {
      setSubmitting(false);
    }
  });

  const resend = async () => {
    if (!sentTo || seconds > 0) return;
    await forgotPasswordAPI({ email: sentTo });
    start(60);
  };

  return (
    <AuthShell>
      {sentTo ? (
        <div className="space-y-6">
          <span className="flex size-13 items-center justify-center rounded-full bg-success/12 text-success-text">
            <MailCheck className="size-6.5" aria-hidden="true" />
          </span>
          <div className="space-y-2">
            <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] sm:text-3xl">
              Kiểm tra hộp thư của bạn
            </h1>
            <p className="text-[15px] leading-relaxed text-muted-foreground">
              Nếu địa chỉ này có tài khoản, chúng tôi vừa gửi tới đó một liên
              kết đặt lại mật khẩu.
            </p>
          </div>
          <p className="inline-flex rounded-full bg-muted px-3 py-1.5 font-mono text-sm font-medium">
            {sentTo}
          </p>
          <p className="text-sm text-muted-foreground">
            Không thấy thư? Hãy kiểm tra mục spam. Liên kết hết hạn sau 15 phút.
          </p>
          <div className="space-y-1.5">
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={seconds > 0}
              onClick={resend}
            >
              <span role="status">
                {seconds > 0 ? `Gửi lại sau ${seconds} giây` : "Gửi lại"}
              </span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => setSentTo(null)}
            >
              Dùng email khác
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <Link
            to="/auth"
            className="-ml-2 inline-flex w-fit items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-muted-foreground transition-colors duration-(--motion-fast) hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Quay lại đăng nhập
          </Link>
          <div className="space-y-2">
            <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] sm:text-3xl">
              Quên mật khẩu?
            </h1>
            <p className="text-[15px] leading-relaxed text-muted-foreground">
              Nhập email của tài khoản. Chúng tôi sẽ gửi cho bạn một liên kết để
              đặt lại mật khẩu.
            </p>
          </div>
          <Form {...form}>
            <form noValidate onSubmit={submit} className="flex flex-col gap-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="email"
                        inputMode="email"
                        autoComplete="email"
                        placeholder="ban@vidu.com"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" disabled={submitting}>
                {submitting && (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                )}
                Gửi liên kết đặt lại
              </Button>
            </form>
          </Form>
          <p className="text-center text-sm text-muted-foreground">
            Liên kết có hiệu lực trong 15 phút.
          </p>
        </div>
      )}
    </AuthShell>
  );
}
