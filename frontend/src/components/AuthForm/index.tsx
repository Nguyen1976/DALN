import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Login from "./Login";
import Register from "./Register";
import { ModeToggle } from "../ModeToggle";

interface AuthFormProps {
  mode: "login" | "register";
  onModeChange: (mode: "login" | "register") => void;
}

export function AuthForm({ mode, onModeChange }: AuthFormProps) {
  return (
    <Card className="w-full max-w-md backdrop-blur-xl bg-card/80 border-border/50 shadow-2xl relative">
      <div className="absolute right-3 top-3 z-10">
        <ModeToggle />
      </div>
      <CardHeader className="space-y-1 pt-2">
        <CardTitle className="mx-auto max-w-[16rem] text-center text-2xl font-bold leading-snug">
          {mode === "login" ? "Chào mừng bạn quay lại khà khà" : "Tạo tài khoản"}
        </CardTitle>
        <CardDescription className="text-center">
          {mode === "login"
            ? "Nhập thông tin đăng nhập để truy cập tài khoản"
            : "Nhập thông tin để tạo tài khoản mới"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs
          value={mode}
          onValueChange={(v) => onModeChange(v as "login" | "register")}
          className="w-full"
        >
          <TabsList className="grid w-full grid-cols-2 mb-6">
            <TabsTrigger value="login">Đăng nhập</TabsTrigger>
            <TabsTrigger value="register">Đăng ký</TabsTrigger>
          </TabsList>
          <TabsContent value="login">
            <Login />
          </TabsContent>
          <TabsContent value="register">
            <Register />
          </TabsContent>
        </Tabs>
      </CardContent>
      <CardFooter className="flex flex-col space-y-2">
        <div className="text-sm text-muted-foreground text-center">
          {mode === "login" ? (
            <>
              {"Chưa có tài khoản? "}
              <button
                onClick={() => onModeChange("register")}
                className="font-medium text-primary hover:underline"
              >
                Đăng ký ngay
              </button>
            </>
          ) : (
            <>
              {"Đã có tài khoản? "}
              <button
                onClick={() => onModeChange("login")}
                className="font-medium text-primary hover:underline"
              >
                Đăng nhập
              </button>
            </>
          )}
        </div>
      </CardFooter>
    </Card>
  );
}
