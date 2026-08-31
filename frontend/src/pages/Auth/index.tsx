import { MessagesSquare, ShieldCheck, Sparkles } from "lucide-react";
import { useState } from "react";

import { AuthForm } from "@/components/AuthForm";
import { BrandLockup, BrandMark } from "@/components/Brand";
import { ModeToggle } from "@/components/ModeToggle";

const HIGHLIGHTS = [
  {
    icon: MessagesSquare,
    title: "Nhắn tin tức thời",
    description:
      "Tin nhắn, hình ảnh và tệp gửi đi ngay, kèm trạng thái đã xem và đang nhập.",
  },
  {
    icon: Sparkles,
    title: "Gợi ý bạn bè thông minh",
    description:
      "Tìm người phù hợp dựa trên sở thích và mối quan hệ chung của bạn.",
  },
  {
    icon: ShieldCheck,
    title: "Tài khoản được bảo vệ",
    description: "Xác thực OTP qua email trước khi tài khoản được kích hoạt.",
  },
];

export default function AuthPage() {
  const [mode, setMode] = useState<"login" | "register">("login");

  return (
    <div className="relative min-h-[100dvh] w-full bg-background lg:grid lg:grid-cols-[1.05fr_1fr]">
      {/* Theme switch belongs to the page, not to the form card — it stays put
          while the form grows and shrinks between login and register. */}
      <div className="absolute right-4 top-4 z-30">
        <ModeToggle />
      </div>

      {/* ---- Brand panel (desktop only) ---- */}
      <aside className="relative hidden overflow-hidden bg-primary p-12 text-primary-foreground lg:flex lg:flex-col lg:justify-between">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-90"
        >
          <div className="absolute -left-24 -top-32 size-96 rounded-full bg-white/10 blur-3xl" />
          <div className="absolute -bottom-40 -right-24 size-[26rem] rounded-full bg-black/20 blur-3xl" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.14)_1px,transparent_0)] [background-size:26px_26px]" />
        </div>

        <div className="relative flex items-center gap-2.5">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/15 text-white">
            <BrandMark className="size-6" />
          </span>
          <span className="text-lg font-semibold tracking-[-0.02em]">
            DALN&nbsp;Chat
          </span>
        </div>

        <div className="relative max-w-md space-y-8">
          <div className="space-y-3">
            <h2 className="text-3xl font-semibold leading-tight tracking-[-0.02em]">
              Giữ liên lạc với những người quan trọng
            </h2>
            <p className="text-[15px] leading-relaxed text-primary-foreground/80">
              Một nơi để trò chuyện, gọi thoại và mở rộng vòng kết nối của bạn.
            </p>
          </div>

          <ul className="space-y-5">
            {HIGHLIGHTS.map(({ icon: Icon, title, description }) => (
              <li key={title} className="flex gap-3.5">
                <span
                  aria-hidden="true"
                  className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/15"
                >
                  <Icon className="size-[18px]" />
                </span>
                <div className="space-y-0.5">
                  <p className="font-medium">{title}</p>
                  <p className="text-sm leading-relaxed text-primary-foreground/75">
                    {description}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-primary-foreground/60">
          © {new Date().getFullYear()} DALN Chat
        </p>
      </aside>

      {/* ---- Form column ---- */}
      <main className="flex min-h-[100dvh] items-center justify-center px-5 py-12 sm:px-8 lg:min-h-0">
        <div className="w-full max-w-[26rem]">
          <BrandLockup className="mb-8 lg:hidden" />
          <AuthForm mode={mode} onModeChange={setMode} />
        </div>
      </main>
    </div>
  );
}
