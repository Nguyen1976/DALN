import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { verifyOtpAPI, resendOtpAPI } from "@/apis";
import { getErrorMessage } from "@/utils/getErrorMessage";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ModeToggle } from "@/components/ModeToggle";
import { AlertCircle, ArrowLeft, Loader2, MailCheck } from "lucide-react";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { OtpInput } from "@/components/ui/otp-input";
import { BrandLockup } from "@/components/Brand";

const verifyOtpSchema = z.object({
  email: z.string().email("Email không hợp lệ"),
  otp: z
    .string()
    .min(6, "Mã OTP phải có 6 chữ số")
    .max(6, "Mã OTP phải có 6 chữ số")
    .regex(/^\d{6}$/, "Mã OTP phải gồm đúng 6 chữ số"),
});

const RESEND_SECONDS = 30;
/** Deadline is kept per address so switching accounts does not inherit a wait. */
const resendDeadlineKey = (email: string) =>
  `daln:otp-resend-until:${email.trim().toLowerCase()}`;

function readResendDeadline(email: string): number {
  if (!email) return 0;
  try {
    const raw = window.localStorage.getItem(resendDeadlineKey(email));
    const at = raw ? Number(raw) : 0;
    return Number.isFinite(at) ? at : 0;
  } catch {
    return 0;
  }
}

function writeResendDeadline(email: string, until: number) {
  if (!email) return;
  try {
    window.localStorage.setItem(resendDeadlineKey(email), String(until));
  } catch {
    /* private mode: the countdown is a courtesy, the server still throttles */
  }
}

function secondsLeft(until: number): number {
  return Math.max(0, Math.ceil((until - Date.now()) / 1000));
}

export default function VerifyOtpPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const queryEmail = searchParams.get("email") || "";
  const initialEmail = useMemo(() => {
    const state = location.state as { email?: string } | null;
    return queryEmail || state?.email || "";
  }, [location.state, queryEmail]);

  const [resendCountdown, setResendCountdown] = useState(0);
  const [resending, setResending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const intervalRef = useRef<number | null>(null);

  const form = useForm<z.infer<typeof verifyOtpSchema>>({
    resolver: zodResolver(verifyOtpSchema),
    defaultValues: {
      email: initialEmail,
      otp: "",
    },
  });

  useEffect(() => {
    if (initialEmail) {
      form.setValue("email", initialEmail);
    }
  }, [form, initialEmail]);


  // The old countdown leaked its interval when the page unmounted mid-tick.
  useEffect(
    () => () => {
      if (intervalRef.current) window.clearInterval(intervalRef.current);
    },
    [],
  );

  /**
   * Tick against an absolute deadline rather than decrementing a counter.
   *
   * The old counter lived only in React state, so reloading the page reset it
   * to zero and the wait could simply be skipped. The deadline is persisted,
   * survives a reload, and is the same clock the server enforces.
   */
  const runCountdownUntil = useCallback((until: number) => {
    if (intervalRef.current) window.clearInterval(intervalRef.current);
    setResendCountdown(secondsLeft(until));
    if (secondsLeft(until) <= 0) return;

    intervalRef.current = window.setInterval(() => {
      const left = secondsLeft(until);
      setResendCountdown(left);
      if (left <= 0 && intervalRef.current) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }, 500);
  }, []);

  // Pick the countdown back up after a reload.
  useEffect(() => {
    const until = readResendDeadline(initialEmail);
    if (until > Date.now()) runCountdownUntil(until);
  }, [initialEmail, runCountdownUntil]);

  const startResendCountdown = (seconds = RESEND_SECONDS) => {
    const until = Date.now() + seconds * 1000;
    writeResendDeadline(form.getValues("email"), until);
    runCountdownUntil(until);
  };

  const onSubmit = async (values: z.infer<typeof verifyOtpSchema>) => {
    setFormError(null);
    try {
      await verifyOtpAPI(values);
      toast.success("Xác thực OTP thành công");
      navigate("/auth", { replace: true, state: { mode: "login" } });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Mã OTP không đúng hoặc đã hết hạn.";
      setFormError(message);
      form.setValue("otp", "");
    }
  };

  const handleResend = async () => {
    const email = form.getValues("email");
    if (!email) {
      form.setError("email", { message: "Vui lòng nhập email" });
      return;
    }

    setResending(true);
    try {
      await resendOtpAPI({ email });
      toast.success("Đã gửi lại mã OTP");
      startResendCountdown();
    } catch (error) {
      // A 429 carries how long the server wants us to wait; mirroring it keeps
      // the button and the server from disagreeing about the cooldown.
      const retryAfter = (
        error as { response?: { data?: { retryAfterSeconds?: number } } }
      )?.response?.data?.retryAfterSeconds;
      if (typeof retryAfter === "number" && retryAfter > 0) {
        startResendCountdown(retryAfter);
      }
      toast.error(getErrorMessage(error, "Không gửi lại được mã OTP"));
    } finally {
      setResending(false);
    }
  };

  const email = form.watch("email");

  return (
    <div className="relative flex min-h-[100dvh] w-full items-center justify-center overflow-hidden bg-background px-5 py-12">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div className="absolute -left-32 -top-32 size-80 rounded-full bg-primary/12 blur-3xl" />
        <div className="absolute -bottom-32 -right-24 size-96 rounded-full bg-primary/10 blur-3xl" />
      </div>

      <div className="absolute right-4 top-4 z-30">
        <ModeToggle />
      </div>

      <div className="relative z-20 w-full max-w-[27rem] space-y-8">
        <BrandLockup />

        <div className="space-y-6 rounded-2xl border border-border bg-card p-6 shadow-md sm:p-8">
          <header className="space-y-3">
            <span
              aria-hidden="true"
              className="flex size-12 items-center justify-center rounded-xl bg-accent text-accent-foreground"
            >
              <MailCheck className="size-6" />
            </span>
            <div className="space-y-1.5">
              <h1 className="text-2xl font-semibold tracking-[-0.02em] text-foreground">
                Xác thực email
              </h1>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Chúng tôi đã gửi mã gồm 6 chữ số tới{" "}
                <span className="font-medium text-foreground">
                  {email || "email của bạn"}
                </span>
                . Nhập mã để kích hoạt tài khoản.
              </p>
            </div>
          </header>

          {formError && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-lg border border-destructive/35 bg-destructive/10 px-3.5 py-3 text-sm text-destructive-text"
            >
              <AlertCircle
                className="mt-0.5 size-4 shrink-0"
                aria-hidden="true"
              />
              <span>{formError}</span>
            </div>
          )}

          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(onSubmit)}
              className="space-y-5"
              noValidate
            >
              {!initialEmail && (
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
              )}

              <FormField
                control={form.control}
                name="otp"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel>Mã OTP</FormLabel>
                    <FormControl>
                      <OtpInput
                        value={field.value}
                        onChange={field.onChange}
                        invalid={Boolean(fieldState.error)}
                        disabled={form.formState.isSubmitting}
                        autoFocus
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="space-y-2.5">
                <Button
                  type="submit"
                  size="lg"
                  className="w-full"
                  disabled={form.formState.isSubmitting}
                >
                  {form.formState.isSubmitting && (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  )}
                  {form.formState.isSubmitting ? "Đang xác thực..." : "Xác thực"}
                </Button>

                <Button
                  type="button"
                  variant="ghost-muted"
                  className="w-full"
                  onClick={handleResend}
                  disabled={
                    resendCountdown > 0 ||
                    resending ||
                    form.formState.isSubmitting
                  }
                >
                  {resending && (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  )}
                  {resendCountdown > 0
                    ? `Gửi lại mã sau ${resendCountdown}s`
                    : "Chưa nhận được mã? Gửi lại"}
                </Button>
              </div>
            </form>
          </Form>
        </div>

        <Button
          variant="ghost-muted"
          size="sm"
          onClick={() => navigate("/auth")}
          className="mx-auto flex"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Quay lại đăng nhập
        </Button>
      </div>
    </div>
  );
}
