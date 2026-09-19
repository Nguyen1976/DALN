import { Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useTheme } from "../ThemeProvider";
import { cn } from "@/lib/utils";

/** One tap flips light ↔ dark; the new theme spreads out from this button. */
export function ModeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <Button
      variant="ghost"
      size="icon"
      data-theme-toggle
      aria-label={isDark ? "Chuyển sang giao diện sáng" : "Chuyển sang giao diện tối"}
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        setTheme(isDark ? "light" : "dark", {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        });
      }}
      className={cn("relative", className)}
    >
      <Sun
        aria-hidden="true"
        className="size-[1.15rem] scale-100 rotate-0 transition-transform duration-(--motion-slow) ease-(--ease-out) dark:scale-0 dark:-rotate-90"
      />
      <Moon
        aria-hidden="true"
        className="absolute size-[1.15rem] scale-0 rotate-90 transition-transform duration-(--motion-slow) ease-(--ease-out) dark:scale-100 dark:rotate-0"
      />
    </Button>
  );
}
