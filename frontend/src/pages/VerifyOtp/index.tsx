import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { verifyOtpAPI, resendOtpAPI } from "@/apis";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ModeToggle } from "@/components/ModeToggle";
import { Loader2 } from "lucide-react";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

const verifyOtpSchema = z.object({
  email: z.string().email("Email không hợp lệ"),
  otp: z
    .string()
    .min(6, "Mã OTP phải có 6 chữ số")
    .max(6, "Mã OTP phải có 6 chữ số")
    .regex(/^\d{6}$/, "Mã OTP phải gồm đúng 6 chữ số"),
});

export default function VerifyOtpPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const initialEmail = useMemo(() => {
    const state = location.state as { email?: string } | null;
    return state?.email || "";
  }, [location.state]);

  const [resendCountdown, setResendCountdown] = useState(0);

  const form = useForm<z.infer<typeof verifyOtpSchema>>({
    resolver: zodResolver(verifyOtpSchema),
    defaultValues: {
      email: initialEmail,
      otp: "",
    },
  });

  const startResendCountdown = () => {
    setResendCountdown(30);
    const intervalId = window.setInterval(() => {
      setResendCountdown((prev) => {
        if (prev <= 1) {
          window.clearInterval(intervalId);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const onSubmit = async (values: z.infer<typeof verifyOtpSchema>) => {
    await verifyOtpAPI(values);
    toast.success("Xác thực OTP thành công");
    navigate("/auth", { replace: true, state: { mode: "login" } });
  };

  const handleResend = async () => {
    const email = form.getValues("email");
    if (!email) {
      form.setError("email", { message: "Vui lòng nhập email" });
      return;
    }

    await resendOtpAPI({ email });
    toast.success("Đã gửi lại mã OTP");
    startResendCountdown();
  };

  return (
    <div className="relative flex min-h-[100dvh] w-full items-center justify-center overflow-hidden bg-background p-4">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div className="absolute -left-24 -top-24 size-72 rounded-full bg-primary/20 blur-3xl" />
        <div className="absolute -bottom-24 -right-24 size-80 rounded-full bg-primary/15 blur-3xl" />
      </div>
      <div className="relative z-20 w-full max-w-md">
        <Card className="relative w-full border-border/60 bg-card/80 shadow-2xl backdrop-blur-xl">
          <div className="absolute top-4 right-4">
            <ModeToggle />
          </div>

          <CardHeader className="space-y-1">
            <CardTitle className="text-3xl font-bold text-center">
              Xác thực OTP
            </CardTitle>
            <CardDescription className="text-center">
              Nhập mã OTP để kích hoạt tài khoản
            </CardDescription>
          </CardHeader>

          <CardContent>
            <p className="mb-4 text-center text-sm text-muted-foreground">
              Mã đã được gửi đến {form.watch("email") || "email của bạn"}
            </p>

            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="space-y-4"
              >
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Nhập email"
                          {...field}
                          readOnly={Boolean(initialEmail)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="otp"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Mã OTP</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Nhập mã OTP 6 số"
                          inputMode="numeric"
                          maxLength={6}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button
                  type="submit"
                  className="w-full"
                  disabled={form.formState.isSubmitting}
                >
                  {form.formState.isSubmitting && (
                    <Loader2 className="size-4 animate-spin" />
                  )}
                  {form.formState.isSubmitting ? "Đang xác thực..." : "Xác thực"}
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={handleResend}
                  disabled={resendCountdown > 0 || form.formState.isSubmitting}
                >
                  {resendCountdown > 0
                    ? `Gửi lại mã sau ${resendCountdown}s`
                    : "Gửi lại mã OTP"}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
