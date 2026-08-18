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
import { useNavigate, useLocation } from "react-router";
import { toast } from "sonner";
import { AlertCircle, Loader2 } from "lucide-react";
import { PasswordField } from "./PasswordField";

const Login = () => {
  // Sign-in failures used to vanish unless they were the OTP case; the reason
  // is now shown in the form itself, next to the fields it concerns.
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<z.infer<typeof formLoginScheme>>({
    resolver: zodResolver(formLoginScheme),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const location = useLocation();

  const onSubmit = async (data: z.infer<typeof formLoginScheme>) => {
    setFormError(null);
    try {
      await dispatch(loginAPI(data)).unwrap();
      const from = (location.state as { from?: Location } | null)?.from;
      const redirectTo = from
        ? `${from.pathname}${from.search}${from.hash}`
        : "/";
      navigate(redirectTo);
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
        return;
      }

      setFormError(message || "Email hoặc mật khẩu không đúng.");
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        {formError && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-lg border border-destructive/35 bg-destructive/10 px-3.5 py-3 text-sm text-destructive-text"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{formError}</span>
          </div>
        )}

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
                  autoComplete="current-password"
                  placeholder="Nhập mật khẩu"
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
          {form.formState.isSubmitting ? "Đang đăng nhập..." : "Đăng nhập"}
        </Button>
      </form>
    </Form>
  );
};

export default Login;
