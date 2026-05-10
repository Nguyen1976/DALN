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
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { registerAPI } from "@/apis";
import { toast } from "sonner";
import { useNavigate } from "react-router";

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

    console.log("[register] submit form payload", {
      username,
      email,
      hasPassword: Boolean(password),
    });

    try {
      let location: { lat: number; lon: number } | undefined;

      try {
        console.log("[register] requesting current browser location");
        location = await getCurrentPosition();
        console.log("[register] browser location resolved", location);
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

      console.log("[register] registerAPI response", {
        email: result?.email,
        requiresOtpVerification: result?.requiresOtpVerification,
        sentLocation: location ?? null,
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

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <div className="space-y-2">
          <FormField
            control={form.control}
            name="username"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Tên người dùng</FormLabel>
                <FormControl>
                  <Input placeholder="Nhập tên người dùng" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <div className="space-y-2">
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <Input placeholder="Nhập email của bạn" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <div className="space-y-2">
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Mật khẩu</FormLabel>
                <FormControl>
                  <Input placeholder="••••••••" type="password" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <div className="space-y-2">
          <FormField
            control={form.control}
            name="confirmPassword"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Xác nhận mật khẩu</FormLabel>
                <FormControl>
                  <Input placeholder="••••••••" type="password" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <Button
          type="submit"
          className="w-full"
          disabled={form.formState.isSubmitting}
        >
          Đăng ký
        </Button>
      </form>
    </Form>
  );
};

export default Register;
