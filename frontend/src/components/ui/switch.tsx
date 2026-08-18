import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * On/off control.
 *
 * Built on a native button with role="switch" and aria-checked, so it is
 * keyboard operable and announced correctly without pulling in another Radix
 * package. The knob movement is a transform (cheap to composite) and is
 * neutralised under prefers-reduced-motion by the global rule.
 */
function Switch({
  checked,
  onCheckedChange,
  disabled,
  className,
  ...props
}: Omit<React.ComponentProps<"button">, "onChange"> & {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      data-slot="switch"
      data-state={checked ? "checked" : "unchecked"}
      onClick={() => onCheckedChange?.(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 border-transparent",
        "transition-colors duration-[--motion-fast] ease-[--ease-out]",
        "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        "disabled:cursor-not-allowed disabled:opacity-55",
        checked ? "bg-primary" : "bg-input/70",
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none block size-5 rounded-full bg-card shadow-sm ring-0",
          "transition-transform duration-[--motion-fast] ease-[--ease-out]",
          checked ? "translate-x-5" : "translate-x-0",
        )}
      />
    </button>
  );
}

export { Switch };
