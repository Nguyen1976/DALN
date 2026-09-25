import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import type { z } from "zod";

import { changePasswordAPI, requestChangePasswordOtpAPI } from "@/apis";
import { changePasswordScheme } from "@/components/AuthForm/scheme";
import {
  PasswordField,
  PasswordStrength,
} from "@/components/AuthForm/PasswordField";
import { KeyRound, Loader2, Mail } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import { OtpInput } from "@/components/ui/otp-input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getErrorMessage } from "@/utils/getErrorMessage";

type Values = z.infer<typeof changePasswordScheme>;

const RESEND_SECONDS = 60;

/**
 * Đổi mật khẩu với hai đường tự chứng minh, chọn một.
 *
 * Hai đường nằm trên tab chứ không phải cùng một form dài: người dùng chỉ cần
 * một trong hai, và bày cả hai ô cùng lúc sẽ trông như phải điền hết. Tab cũng
 * làm cho "đang chọn đường nào" là một trạng thái nhìn thấy được, nên thông
 * báo lỗi không bao giờ chỉ vào ô mà người dùng đã cố ý bỏ trống.
 */
export function ChangePasswordDialog({
  open,
  onOpenChange,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Đổi xong: danh sách phiên bên ngoài có thể đã khác, gọi để tải lại. */
  onChanged: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [sendingOtp, setSendingOtp] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [otpSent, setOtpSent] = useState(false);

  const form = useForm<Values>({
    resolver: zodResolver(changePasswordScheme),
    defaultValues: {
      method: "current-password",
      currentPassword: "",
      otp: "",
      newPassword: "",
      confirmPassword: "",
      revokeOtherSessions: false,
    },
  });

  const method = form.watch("method");
  const newPassword = form.watch("newPassword");

  // Bỏ đồng hồ đi khi hộp thoại đóng: để nó chạy tiếp nghĩa là setState trên
  // một cây đã gỡ, và người mở lại sau đó thấy một số đếm ngược vô nghĩa.
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (cooldown <= 0) return;
    timer.current = setInterval(() => {
      setCooldown((left) => (left <= 1 ? 0 : left - 1));
    }, 1000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [cooldown]);

  useEffect(() => {
    if (open) return;
    // Đóng là quên sạch: ô mật khẩu cũ không được nằm lại trong bộ nhớ của
    // trang sau khi người dùng đã rời hộp thoại.
    form.reset();
    setOtpSent(false);
    setCooldown(0);
  }, [open, form]);

  const sendOtp = async () => {
    setSendingOtp(true);
    try {
      await requestChangePasswordOtpAPI();
      setOtpSent(true);
      setCooldown(RESEND_SECONDS);
      toast.success("Đã gửi mã tới email của bạn");
    } catch (error) {
      // 429 mang theo số giây còn phải chờ — hiện đúng số đó thay vì bắt người
      // dùng bấm mò cho tới khi hết khoá.
      const response = (
        error as { response?: { status?: number; data?: unknown } }
      ).response;
      const retryAfter = (response?.data as { retryAfterSeconds?: number })
        ?.retryAfterSeconds;
      if (response?.status === 429 && retryAfter) {
        setCooldown(retryAfter);
      }
      toast.error(getErrorMessage(error, "Không gửi được mã"));
    } finally {
      setSendingOtp(false);
    }
  };

  const submit = form.handleSubmit(async (values) => {
    setSubmitting(true);
    try {
      await changePasswordAPI({
        newPassword: values.newPassword,
        // Gửi đúng một trong hai: backend từ chối body mang cả hai.
        ...(values.method === "otp"
          ? { otp: values.otp }
          : { currentPassword: values.currentPassword }),
        revokeOtherSessions: values.revokeOtherSessions,
      });
      toast.success(
        values.revokeOtherSessions
          ? "Đã đổi mật khẩu và đăng xuất các thiết bị khác"
          : "Đã đổi mật khẩu",
      );
      onOpenChange(false);
      onChanged();
    } catch (error) {
      const response = (
        error as { response?: { status?: number; data?: { code?: string } } }
      ).response;
      // Lỗi nói về CÁCH XÁC THỰC thì gắn vào đúng ô đó, không đẩy ra toast:
      // một thông báo trôi qua ở góc màn hình không cho người dùng biết phải
      // sửa ô nào.
      //
      // Phân biệt bằng `code` chứ không bằng status: cả hai nhánh đều trả 400
      // (cùng mã với lỗi DTO), nên status một mình không đủ để biết ô nào sai.
      const message = getErrorMessage(error, "Không đổi được mật khẩu");
      if (response?.data?.code === "CURRENT_PASSWORD_INVALID") {
        form.setError("currentPassword", { message });
      } else if (values.method === "otp" && response?.status === 400) {
        form.setError("otp", { message });
      } else {
        toast.error(message);
      }
    } finally {
      setSubmitting(false);
    }
  });

  return (
    <Dialog open={open} onOpenChange={submitting ? undefined : onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Đổi mật khẩu</DialogTitle>
          <DialogDescription>
            Xác nhận bằng mật khẩu hiện tại, hoặc bằng mã gửi tới email của bạn.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={submit} className="space-y-5">
            <Tabs
              value={method}
              onValueChange={(next) => {
                form.setValue("method", next as Values["method"]);
                // Xoá lỗi của đường vừa rời đi: giữ lại thì người dùng đổi
                // sang tab khác vẫn thấy một ô đỏ mà họ không còn phải điền.
                form.clearErrors(["currentPassword", "otp"]);
              }}
            >
              <TabsList className="w-full">
                <TabsTrigger value="current-password" className="flex-1">
                  <KeyRound className="size-4" aria-hidden="true" />
                  Mật khẩu hiện tại
                </TabsTrigger>
                <TabsTrigger value="otp" className="flex-1">
                  <Mail className="size-4" aria-hidden="true" />
                  Mã qua email
                </TabsTrigger>
              </TabsList>

              <TabsContent value="current-password" className="pt-4">
                <FormField
                  control={form.control}
                  name="currentPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Mật khẩu hiện tại</FormLabel>
                      <FormControl>
                        <PasswordField
                          {...field}
                          autoComplete="current-password"
                          placeholder="Mật khẩu đang dùng"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </TabsContent>

              <TabsContent value="otp" className="space-y-3 pt-4">
                <FormField
                  control={form.control}
                  name="otp"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Mã xác nhận</FormLabel>
                      <FormControl>
                        <OtpInput
                          value={field.value}
                          onChange={field.onChange}
                          invalid={Boolean(form.formState.errors.otp)}
                          disabled={!otpSent}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="flex items-center justify-between gap-3">
                  <p className="text-muted-foreground text-sm">
                    {otpSent
                      ? "Mã có hiệu lực trong 5 phút."
                      : "Chúng tôi sẽ gửi mã 6 chữ số tới email của bạn."}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={sendingOtp || cooldown > 0}
                    onClick={() => void sendOtp()}
                  >
                    {sendingOtp && (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    )}
                    {cooldown > 0
                      ? `Gửi lại sau ${cooldown}s`
                      : otpSent
                        ? "Gửi lại mã"
                        : "Gửi mã"}
                  </Button>
                </div>
              </TabsContent>
            </Tabs>

            <FormField
              control={form.control}
              name="newPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Mật khẩu mới</FormLabel>
                  <FormControl>
                    <PasswordField
                      {...field}
                      autoComplete="new-password"
                      placeholder="Ít nhất 8 ký tự"
                    />
                  </FormControl>
                  <PasswordStrength value={newPassword} />
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="confirmPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nhập lại mật khẩu mới</FormLabel>
                  <FormControl>
                    <PasswordField
                      {...field}
                      autoComplete="new-password"
                      placeholder="Nhập lại để chắc chắn"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="revokeOtherSessions"
              render={({ field }) => (
                <FormItem className="border-input flex flex-row items-start gap-3 rounded-lg border p-3">
                  <FormControl>
                    <Checkbox
                      id="revoke-other-sessions"
                      checked={field.value}
                      onCheckedChange={(checked) =>
                        field.onChange(checked === true)
                      }
                      className="mt-0.5"
                    />
                  </FormControl>
                  <div className="min-w-0 space-y-1">
                    <Label
                      htmlFor="revoke-other-sessions"
                      className="cursor-pointer font-medium"
                    >
                      Đăng xuất khỏi các thiết bị khác
                    </Label>
                    <p className="text-muted-foreground text-sm">
                      Thiết bị này vẫn đăng nhập. Dùng khi bạn nghi có người
                      khác đang dùng tài khoản.
                    </p>
                  </div>
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={submitting}
                onClick={() => onOpenChange(false)}
              >
                Huỷ
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting && (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                )}
                {submitting ? "Đang đổi…" : "Đổi mật khẩu"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
