import { Eye, EyeOff } from "lucide-react";
import * as React from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Password input with a reveal toggle.
 *
 * The toggle is a real button with an accessible name that reflects the action
 * it performs, and aria-pressed so the current state is exposed too.
 */
export function PasswordField({
  className,
  ...props
}: React.ComponentProps<typeof Input>) {
  const [visible, setVisible] = React.useState(false);

  return (
    <div className="relative">
      <Input
        {...props}
        type={visible ? "text" : "password"}
        className={cn("pr-11", className)}
      />
      <button
        type="button"
        onClick={() => setVisible((prev) => !prev)}
        aria-label={visible ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
        aria-pressed={visible}
        className="absolute right-1 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors duration-[--motion-fast] hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
      >
        {visible ? (
          <EyeOff className="size-4" aria-hidden="true" />
        ) : (
          <Eye className="size-4" aria-hidden="true" />
        )}
      </button>
    </div>
  );
}

const LEVELS = [
  { label: "Yếu", className: "bg-destructive" },
  { label: "Trung bình", className: "bg-warning" },
  { label: "Khá", className: "bg-brand" },
  { label: "Mạnh", className: "bg-success" },
];

function scorePassword(value: string) {
  if (!value) return -1;
  let score = 0;
  if (value.length >= 8) score += 1;
  if (value.length >= 12) score += 1;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
  if (/\d/.test(value) && /[^\w\s]/.test(value)) score += 1;
  return Math.min(score, LEVELS.length - 1);
}

/**
 * Password strength meter.
 *
 * Strength is announced as text as well as drawn as bars, so the signal never
 * depends on colour alone.
 */
export function PasswordStrength({ value }: { value: string }) {
  const score = scorePassword(value);
  if (score < 0) return null;
  const level = LEVELS[score];

  return (
    <div className="space-y-1.5 pt-0.5">
      <div className="flex gap-1" aria-hidden="true">
        {LEVELS.map((_, index) => (
          <span
            key={index}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors duration-[--motion-base]",
              index <= score ? level.className : "bg-muted",
            )}
          />
        ))}
      </div>
      <p className="text-xs text-muted-foreground" aria-live="polite">
        Độ mạnh mật khẩu: <span className="font-medium">{level.label}</span>
      </p>
    </div>
  );
}
