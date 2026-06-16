import { useState } from "react";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { useForm } from "react-hook-form";
import { formLoginScheme } from "./scheme";
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
import { loginAPI } from "@/redux/slices/userSlice";
import { useDispatch } from "react-redux";
import type { AppDispatch } from "@/redux/store";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Eye, EyeOff, Loader2 } from "lucide-react";

const Login = () => {
  const [showPassword, setShowPassword] = useState(false);
  const form = useForm<z.infer<typeof formLoginScheme>>({
    resolver: zodResolver(formLoginScheme),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();

  const onSubmit = async (data: z.infer<typeof formLoginScheme>) => {
    try {
      await dispatch(loginAPI(data)).unwrap();
      navigate("/");
    } catch (error) {
      const message =
        typeof error === "string"
          ? error
          : (error as { message?: string })?.message;

      if (
        message === "Tài khoản chưa kích hoạt. Vui lòng xác thực OTP" ||
        message === "Tài khoản chưa kích hoạt"
      ) {
        toast.info("Vui lòng xác thực OTP trước khi đăng nhập");
        navigate("/verify-otp", { state: { email: data.email } });
      }
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <div className="space-y-2">
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <Input placeholder="Nhập email" {...field} />
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
                  <div className="relative">
                    <Input
                      placeholder="••••••••"
                      {...field}
                      type={showPassword ? "text" : "password"}
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {showPassword ? (
                        <EyeOff className="size-4" />
                      ) : (
                        <Eye className="size-4" />
                      )}
                    </button>
                  </div>
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
          {form.formState.isSubmitting && (
            <Loader2 className="size-4 animate-spin" />
          )}
          {form.formState.isSubmitting ? "Đang đăng nhập..." : "Đăng nhập"}
        </Button>
      </form>
    </Form>
  );
};

export default Login;
