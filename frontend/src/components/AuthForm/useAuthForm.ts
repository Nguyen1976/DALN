import { useState } from "react";
import { useForm, type FieldErrors, type Resolver } from "react-hook-form";
import { useDispatch } from "react-redux";
import { useLocation, useNavigate } from "react-router";
import { toast } from "sonner";
import type z from "zod";

import { registerAPI } from "@/apis";
import { loginAPI } from "@/redux/slices/userSlice";
import type { AppDispatch } from "@/redux/store";
import { applyServerFieldError } from "@/utils/formServerError";
import { getErrorMessage } from "@/utils/getErrorMessage";

import { formLoginScheme, formRegisterScheme } from "./scheme";

export type AuthMode = "login" | "register";

/**
 * One set of fields for both modes: signing in uses two of them, registering
 * uses all four. Keeping them in a single form is what lets the email and
 * password boxes survive a switch — same node, same value, no re-mount.
 */
export type AuthValues = z.infer<typeof formRegisterScheme>;

/** Where the browser reports a position, when the user allows it. */
function currentPosition() {
  return new Promise<{ lat: number; lon: number }>((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Trình duyệt không hỗ trợ lấy vị trí hiện tại"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          lat: position.coords.latitude,
          lon: position.coords.longitude,
        }),
      () =>
        reject(
          new Error("Vui lòng cho phép truy cập vị trí để hoàn tất đăng ký"),
        ),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  });
}

export function useAuthForm(mode: AuthMode) {
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const location = useLocation();
  // A failure shown only as a toast leaves the user guessing which field to
  // change; anything not attributable to one field lands in this banner.
  const [formError, setFormError] = useState<string | null>(null);

  // Which rules apply depends on the mode, and the mode changes while the
  // form is alive. react-hook-form re-reads its options on every render, so
  // handing it a fresh resolver each time is enough: registering validates
  // every field, signing in ignores the two it does not show.
  const resolver: Resolver<AuthValues> = (values) => {
    const schema = mode === "login" ? formLoginScheme : formRegisterScheme;
    const parsed = schema.safeParse(values);
    if (parsed.success) return { values, errors: {} };

    const errors: FieldErrors<AuthValues> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as keyof AuthValues | undefined;
      if (field && !errors[field]) {
        errors[field] = { type: issue.code, message: issue.message };
      }
    }
    return { values: {}, errors };
  };

  const form = useForm<AuthValues>({
    resolver,
    defaultValues: {
      username: "",
      email: "",
      password: "",
      confirmPassword: "",
    },
  });

  const signIn = async ({ email, password }: AuthValues) => {
    try {
      await dispatch(loginAPI({ email, password })).unwrap();
      const from = (location.state as { from?: Location } | null)?.from;
      navigate(from ? `${from.pathname}${from.search}${from.hash}` : "/");
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
        navigate("/verify-otp", { state: { email } });
        return;
      }

      setFormError(message || "Email hoặc mật khẩu không đúng.");
    }
  };

  const signUp = async ({ username, email, password }: AuthValues) => {
    try {
      let position: { lat: number; lon: number } | undefined;
      try {
        position = await currentPosition();
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
        location: position,
      });

      if (result?.requiresOtpVerification) {
        toast.success(
          "Đăng ký thành công, vui lòng nhập OTP để kích hoạt tài khoản",
        );
        navigate("/verify-otp", { state: { email } });
      }
      form.reset();
    } catch (error) {
      // `error.message` on an axios rejection is "Request failed with status
      // code 409" — a technical string no user should ever read.
      const message = getErrorMessage(error, "Không thể hoàn tất đăng ký");
      const attached = applyServerFieldError(form.setError, message, [
        { match: /email/i, field: "email" },
        { match: /tên người dùng|username/i, field: "username" },
      ]);
      if (!attached) {
        setFormError(
          message === "Network Error"
            ? "Không thể kết nối đến máy chủ, vui lòng thử lại"
            : message,
        );
      }
    }
  };

  const submit = form.handleSubmit(async (values) => {
    setFormError(null);
    await (mode === "login" ? signIn(values) : signUp(values));
  });

  /** Leaving a mode drops its complaints; the values themselves stay. */
  const clearProblems = () => {
    setFormError(null);
    form.clearErrors();
  };

  return { form, formError, submit, clearProblems };
}
