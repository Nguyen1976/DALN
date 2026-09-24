import { AlertCircle, Loader2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFieldMorph } from "@/hooks/useFieldMorph";
import { Link } from "react-router";

import { PasswordField, PasswordStrength } from "./PasswordField";
import { useAuthForm, type AuthMode } from "./useAuthForm";

/**
 * Signing in and registering are the same form in two shapes, not two forms.
 *
 * Email and password belong to both, so they are one set of boxes that slides
 * to its new place when the shape changes — what was typed into them survives
 * the switch. The fields only registering needs are marked `data-extra`: they
 * drop into the gap the card opens for them, and slide back out when it
 * closes. useFieldMorph does the measuring and the movement.
 */
export function AuthForm() {
  const { mode, switchTo, stageRef, leaving } =
    useFieldMorph<AuthMode>("login");
  const { form, formError, submit, clearProblems } = useAuthForm(mode);
  const isLogin = mode === "login";
  // Registering's own fields are on screen while they arrive or leave.
  const showExtras = !isLogin || leaving;
  // Đối xứng với showExtras: phần chỉ tab đăng nhập có, vẫn nằm trên màn hình
  // trong lúc nó rời đi để useFieldMorph kịp diễn hoạt.
  const showLoginExtras = isLogin || leaving;

  const change = (next: AuthMode) => {
    if (next === mode) return;
    clearProblems();
    switchTo(next);
  };

  return (
    <div className="space-y-7">
      <header className="space-y-2">
        {/* No width clamp here: clamping forced "lại" onto its own line.
            text-wrap: balance (set globally on headings) handles the break. */}
        <h1
          key={`title-${mode}`}
          className="animate-fade-in text-[26px] font-semibold leading-tight tracking-[-0.02em] text-foreground sm:text-3xl"
        >
          {isLogin ? "Chào mừng bạn quay lại" : "Tạo tài khoản mới"}
        </h1>
        <p
          key={`subtitle-${mode}`}
          className="animate-fade-in text-[15px] leading-relaxed text-muted-foreground"
        >
          {isLogin
            ? "Đăng nhập để tiếp tục cuộc trò chuyện của bạn."
            : "Chỉ mất một phút để bắt đầu trò chuyện."}
        </p>
      </header>

      <Tabs
        value={mode}
        onValueChange={(value) => change(value as AuthMode)}
        className="w-full"
      >
        <TabsList
          className="grid w-full grid-cols-2"
          gooey={{ id: "auth-mode-goo", activeIndex: isLogin ? 0 : 1 }}
        >
          <TabsTrigger value="login">Đăng nhập</TabsTrigger>
          <TabsTrigger value="register">Đăng ký</TabsTrigger>
        </TabsList>

        {/* One panel that follows the chosen tab: the form inside it is the
            same form either way, so it must not be re-created. */}
        <TabsContent value={mode} forceMount className="pt-4">
          <Form {...form}>
            <form
              ref={stageRef as React.RefObject<HTMLFormElement>}
              noValidate
              onSubmit={submit}
              // Gaps, not `space-y`: that one keys off the first child, so a
              // field lifted out of the layout on its way out would still
              // push the one below it.
              className="relative flex flex-col gap-4"
            >
              {formError && (
                <div
                  // Keyed on the message: a new, different error shakes again.
                  key={formError}
                  data-morph="error"
                  role="alert"
                  className="flex animate-shake items-start gap-2.5 rounded-lg border border-destructive/35 bg-destructive/10 px-3.5 py-3 text-sm text-destructive-text"
                >
                  <AlertCircle
                    className="mt-0.5 size-4 shrink-0"
                    aria-hidden="true"
                  />
                  <span>{formError}</span>
                </div>
              )}

              {showExtras && (
                <FormField
                  control={form.control}
                  name="username"
                  render={({ field }) => (
                    <FormItem data-morph="username" data-extra>
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
              )}

              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem data-morph="email">
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
                    {showExtras && (
                      <FormDescription data-morph="email-hint" data-extra>
                        Mã OTP kích hoạt sẽ được gửi tới địa chỉ này.
                      </FormDescription>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem data-morph="password">
                    <div className="flex items-center justify-between gap-2">
                      <FormLabel>Mật khẩu</FormLabel>
                      {showLoginExtras && (
                        <Link
                          to="/forgot-password"
                          className="text-sm font-medium text-brand hover:underline"
                        >
                          Quên mật khẩu?
                        </Link>
                      )}
                    </div>
                    <FormControl>
                      <PasswordField
                        autoComplete={
                          isLogin ? "current-password" : "new-password"
                        }
                        placeholder={
                          isLogin ? "Nhập mật khẩu" : "Ít nhất 8 ký tự"
                        }
                        {...field}
                      />
                    </FormControl>
                    {showExtras && (
                      <div data-morph="strength" data-extra>
                        <PasswordStrength value={form.watch("password")} />
                      </div>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />

              {showExtras && (
                <FormField
                  control={form.control}
                  name="confirmPassword"
                  render={({ field }) => (
                    <FormItem data-morph="confirm" data-extra>
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
              )}

              <Button
                data-morph="submit"
                type="submit"
                size="lg"
                className="w-full"
                disabled={form.formState.isSubmitting}
              >
                {form.formState.isSubmitting && (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                )}
                {form.formState.isSubmitting
                  ? isLogin
                    ? "Đang đăng nhập..."
                    : "Đang đăng ký..."
                  : isLogin
                    ? "Đăng nhập"
                    : "Tạo tài khoản"}
              </Button>

              {showExtras && (
                <p
                  data-morph="note"
                  data-extra
                  className="text-center text-xs leading-relaxed text-muted-foreground"
                >
                  Ứng dụng xin quyền vị trí khi đăng ký để gợi ý bạn bè quanh
                  bạn. Bạn có thể từ chối, tài khoản vẫn được tạo bình thường.
                </p>
              )}
            </form>
          </Form>
        </TabsContent>
      </Tabs>

      <p className="text-center text-sm text-muted-foreground">
        {isLogin ? "Chưa có tài khoản? " : "Đã có tài khoản? "}
        <button
          type="button"
          onClick={() => change(isLogin ? "register" : "login")}
          className="rounded font-medium text-brand underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {isLogin ? "Đăng ký ngay" : "Đăng nhập"}
        </button>
      </p>
    </div>
  );
}
