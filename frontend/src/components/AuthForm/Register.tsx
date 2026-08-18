import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { useForm } from "react-hook-form";
import { formRegisterScheme } from "./scheme";
import { zodResolver } from "@hookform/resolvers/zod";
import type z from "zod";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormDescription,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { registerAPI } from "@/apis";
import { toast } from "sonner";
import { useNavigate } from "react-router";
import { Loader2 } from "lucide-react";
import { PasswordField, PasswordStrength } from "./PasswordField";

const Register = () => {
  const navigate = useNavigate();
  const form = useForm<z.infer<typeof formRegisterScheme>>({
    resolver: zodResolver(formRegisterScheme),
    defaultValues: {
      username: "",
      email: "",
      password: "",
      confirmPassword: "",
    },
  });

  const getCurrentPosition = () =>
    new Promise<{ lat: number; lon: number }>((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("Trình duyệt không hỗ trợ lấy vị trí hiện tại"));
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            lat: position.coords.latitude,
            lon: position.coords.longitude,
          });
        },
        () => {
          reject(
            new Error("Vui lòng cho phép truy cập vị trí để hoàn tất đăng ký"),
          );
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0,
        },
      );
    });

  const onSubmit = async (data: z.infer<typeof formRegisterScheme>) => {
    const { username, email, password } = data;

    try {
      let location: { lat: number; lon: number } | undefined;

      try {
        location = await getCurrentPosition();
      } catch (locationError) {
        console.warn(
          "Không lấy được vị trí hiện tại khi đăng ký",
          locationError,
        );
        toast.info(
          "Không lấy được vị trí hiện tại, tài khoản vẫn sẽ được tạo bình thường",
        );
      }

      const result = await registerAPI({
        username,
        email,
        password,
        location,
      });

      if (result?.requiresOtpVerification) {
        toast.success(
          "Đăng ký thành công, vui lòng nhập OTP để kích hoạt tài khoản",
        );
        navigate("/verify-otp", { state: { email } });
      }
      form.reset();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Không thể hoàn tất đăng ký";
      toast.error(message);
    }
  };

  const passwordValue = form.watch("password");

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="username"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Tên người dùng</FormLabel>
              <FormControl>
                <Input
                  autoComplete="username"
                  placeholder="Tên hiển thị của bạn"
                  {...field}
                />
              </FormControl>
              <FormDescription>Từ 3 đến 30 ký tự.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="ban@email.com"
                  {...field}
                />
              </FormControl>
              <FormDescription>
                Mã OTP kích hoạt sẽ được gửi tới địa chỉ này.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Mật khẩu</FormLabel>
              <FormControl>
                <PasswordField
                  autoComplete="new-password"
                  placeholder="Ít nhất 6 ký tự"
                  {...field}
                />
              </FormControl>
              <PasswordStrength value={passwordValue} />
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
                <PasswordField
                  autoComplete="new-password"
                  placeholder="Nhập lại mật khẩu"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button
          type="submit"
          size="lg"
          className="w-full"
          disabled={form.formState.isSubmitting}
        >
          {form.formState.isSubmitting && (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          )}
          {form.formState.isSubmitting ? "Đang đăng ký..." : "Tạo tài khoản"}
        </Button>

        <p className="text-center text-xs leading-relaxed text-muted-foreground">
          Ứng dụng xin quyền vị trí khi đăng ký để gợi ý bạn bè quanh bạn. Bạn có
          thể từ chối, tài khoản vẫn được tạo bình thường.
        </p>
      </form>
    </Form>
  );
};

export default Register;
