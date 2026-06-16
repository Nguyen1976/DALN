import { useState } from "react";
import { AuthForm } from "@/components/AuthForm";

export default function AuthPage() {
  const [mode, setMode] = useState<"login" | "register">("login");

  return (
    <div className="relative flex min-h-[100dvh] w-full items-center justify-center overflow-hidden bg-background p-4">
      {/* Decorative background */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div className="absolute -left-24 -top-24 size-72 rounded-full bg-primary/20 blur-3xl" />
        <div className="absolute -bottom-24 -right-24 size-80 rounded-full bg-primary/15 blur-3xl" />
        <div className="absolute left-1/2 top-1/3 size-64 -translate-x-1/2 rounded-full bg-chart-4/10 blur-3xl" />
      </div>

      <div className="relative z-20 w-full max-w-md">
        <AuthForm mode={mode} onModeChange={setMode} />
      </div>
    </div>
  );
}
