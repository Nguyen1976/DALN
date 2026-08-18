import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Login from "./Login";
import Register from "./Register";

interface AuthFormProps {
  mode: "login" | "register";
  onModeChange: (mode: "login" | "register") => void;
}

export function AuthForm({ mode, onModeChange }: AuthFormProps) {
  const isLogin = mode === "login";

  return (
    <div className="space-y-7">
      <header className="space-y-2">
        {/* No width clamp here: clamping forced "lại" onto its own line.
            text-wrap: balance (set globally on headings) handles the break. */}
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] text-foreground sm:text-3xl">
          {isLogin ? "Chào mừng bạn quay lại" : "Tạo tài khoản mới"}
        </h1>
        <p className="text-[15px] leading-relaxed text-muted-foreground">
          {isLogin
            ? "Đăng nhập để tiếp tục cuộc trò chuyện của bạn."
            : "Chỉ mất một phút để bắt đầu trò chuyện."}
        </p>
      </header>

      <Tabs
        value={mode}
        onValueChange={(v) => onModeChange(v as "login" | "register")}
        className="w-full"
      >
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="login">Đăng nhập</TabsTrigger>
          <TabsTrigger value="register">Đăng ký</TabsTrigger>
        </TabsList>

        <TabsContent value="login" className="pt-4">
          <Login />
        </TabsContent>
        <TabsContent value="register" className="pt-4">
          <Register />
        </TabsContent>
      </Tabs>

      <p className="text-center text-sm text-muted-foreground">
        {isLogin ? "Chưa có tài khoản? " : "Đã có tài khoản? "}
        <button
          type="button"
          onClick={() => onModeChange(isLogin ? "register" : "login")}
          className="rounded font-medium text-brand underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {isLogin ? "Đăng ký ngay" : "Đăng nhập"}
        </button>
      </p>
    </div>
  );
}
