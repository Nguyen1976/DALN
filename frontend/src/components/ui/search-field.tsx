import { Search, X } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * The one search box used everywhere.
 *
 * Every screen had rolled its own: a magnifier glued onto an Input, and only
 * the conversation sidebar bothered to add a clear button. A search field the
 * user cannot empty without selecting the text and deleting it — and that
 * ignores Escape, which is what people press — is a small, constant tax. This
 * keeps the clear affordance, the Escape handling, and the accessible name in
 * one place so no screen can quietly ship without them.
 */
function SearchField({
  value,
  onValueChange,
  placeholder,
  label,
  className,
  inputClassName,
  autoFocus,
  onKeyDown,
}: {
  value: string;
  onValueChange: (next: string) => void;
  placeholder: string;
  /** Accessible name; falls back to the placeholder. */
  label?: string;
  className?: string;
  inputClassName?: string;
  autoFocus?: boolean;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const accessibleName = label ?? placeholder;

  const handleKeyDown: React.KeyboardEventHandler<HTMLInputElement> = (
    event,
  ) => {
    if (event.key === "Escape" && value) {
      // Stop here: inside a dialog, a bubbling Escape would close the whole
      // dialog when the user only meant to clear what they had typed.
      event.preventDefault();
      event.stopPropagation();
      onValueChange("");
    }
    onKeyDown?.(event);
  };

  return (
    <div className={cn("relative", className)}>
      <Search
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        aria-label={accessibleName}
        autoFocus={autoFocus}
        className={cn(
          "h-10 w-full rounded-xl border border-input bg-card pl-9 pr-9 text-sm text-foreground",
          "placeholder:text-muted-foreground",
          "transition-[border-color,box-shadow] duration-[--motion-fast]",
          "outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30",
          inputClassName,
        )}
      />
      {value && (
        <button
          type="button"
          onClick={() => {
            onValueChange("");
            inputRef.current?.focus();
          }}
          aria-label="Xoá từ khoá tìm kiếm"
          className={cn(
            "absolute right-2 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md",
            "text-muted-foreground transition-colors duration-[--motion-fast]",
            "hover:bg-accent hover:text-foreground",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          )}
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

export { SearchField };
