import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Six-box OTP entry.
 *
 * A single hidden-ish model string is kept in the parent; the boxes are just a
 * presentation of it. Paste of a full code works from any box, arrow keys and
 * Backspace move between boxes, and each box carries its own accessible name
 * so a screen reader announces "Chữ số 3 trên 6" rather than an unlabelled
 * text field. Autocomplete is left on the first box so platform SMS/email code
 * autofill still works (WCAG 2.2 "Accessible Authentication": never force the
 * user to retype a code from memory).
 */
export function OtpInput({
  value,
  onChange,
  length = 6,
  disabled,
  invalid,
  className,
  autoFocus,
}: {
  value: string;
  onChange: (next: string) => void;
  length?: number;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
  autoFocus?: boolean;
}) {
  const refs = React.useRef<Array<HTMLInputElement | null>>([]);
  const digits = React.useMemo(
    () => Array.from({ length }, (_, i) => value[i] ?? ""),
    [value, length],
  );

  const setDigit = (index: number, digit: string) => {
    const next = digits.slice();
    next[index] = digit;
    onChange(next.join("").slice(0, length));
  };

  const focusBox = (index: number) => {
    const target = refs.current[Math.max(0, Math.min(length - 1, index))];
    target?.focus();
    target?.select();
  };

  const handleChange = (
    index: number,
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const raw = event.target.value.replace(/\D/g, "");
    if (!raw) {
      setDigit(index, "");
      return;
    }

    // Typing or autofilling several digits at once fills forward.
    if (raw.length > 1) {
      const next = (
        value.slice(0, index) +
        raw +
        value.slice(index + raw.length)
      ).slice(0, length);
      onChange(next);
      focusBox(index + raw.length);
      return;
    }

    setDigit(index, raw);
    if (index < length - 1) focusBox(index + 1);
  };

  const handleKeyDown = (
    index: number,
    event: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    if (event.key === "Backspace" && !digits[index] && index > 0) {
      event.preventDefault();
      setDigit(index - 1, "");
      focusBox(index - 1);
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      focusBox(index - 1);
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      focusBox(index + 1);
    }
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData("text").replace(/\D/g, "");
    if (!pasted) return;
    event.preventDefault();
    onChange(pasted.slice(0, length));
    focusBox(Math.min(pasted.length, length - 1));
  };

  return (
    <div className={cn("flex gap-2 sm:gap-2.5", className)}>
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(node) => {
            refs.current[index] = node;
          }}
          value={digit}
          onChange={(event) => handleChange(index, event)}
          onKeyDown={(event) => handleKeyDown(index, event)}
          onPaste={handlePaste}
          onFocus={(event) => event.currentTarget.select()}
          inputMode="numeric"
          autoComplete={index === 0 ? "one-time-code" : "off"}
          autoFocus={autoFocus && index === 0}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-label={`Chữ số ${index + 1} trên ${length}`}
          maxLength={length}
          className={cn(
            "h-13 w-full min-w-0 rounded-xl border border-input bg-card text-center text-xl font-semibold tabular-nums text-foreground shadow-xs",
            "py-3 transition-[border-color,box-shadow] duration-[--motion-fast]",
            "outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/35",
            "disabled:cursor-not-allowed disabled:opacity-55",
            invalid && "border-destructive ring-2 ring-destructive/25",
          )}
        />
      ))}
    </div>
  );
}
