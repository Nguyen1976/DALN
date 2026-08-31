import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  [
    "inline-flex w-fit items-center justify-center gap-1.5 rounded-full border px-2.5 py-0.5",
    "text-xs font-medium leading-5",
    // A compact label stays whole; when it genuinely cannot fit, the caller
    // passes a title/tooltip so the full value is still reachable.
    "whitespace-nowrap",
    "[&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-3.5",
    "transition-colors duration-[--motion-fast]",
  ].join(" "),
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "border-border bg-transparent text-foreground",
        soft: "border-transparent bg-accent text-accent-foreground",
        success: "border-transparent bg-success/15 text-success-text",
        warning: "border-transparent bg-warning/20 text-warning-text",
        destructive:
          "border-transparent bg-destructive/15 text-destructive-text",
      },
      size: {
        default: "",
        sm: "px-2 py-0 text-[11px]",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

function Badge({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span";

  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant, size }), className)}
      {...props}
    />
  );
}

/**
 * Unread counter.
 *
 * The visible glyph is compact ("5+"), but the accessible name spells out what
 * the number means so a screen reader never announces a bare digit.
 */
function CountBadge({
  count,
  max = 5,
  label = "tin nhắn chưa đọc",
  className,
  ...props
}: React.ComponentProps<"span"> & {
  count: number;
  max?: number;
  label?: string;
}) {
  if (!count) return null;
  const display = count > max ? `${max}+` : String(count);

  return (
    <span
      data-slot="count-badge"
      className={cn(
        "flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold tabular-nums text-primary-foreground",
        className,
      )}
      {...props}
    >
      <span aria-hidden="true">{display}</span>
      <span className="sr-only">{`${count} ${label}`}</span>
    </span>
  );
}

/**
 * Interactive chip (filter / interest tag).
 *
 * Renders a real <button> with aria-pressed so the selected state is exposed
 * programmatically rather than only through colour.
 */
function Chip({
  selected = false,
  className,
  children,
  ...props
}: React.ComponentProps<"button"> & { selected?: boolean }) {
  return (
    <button
      type="button"
      data-slot="chip"
      aria-pressed={selected}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium",
        "transition-[background-color,border-color,color,transform] duration-[--motion-fast] ease-[--ease-out]",
        "active:scale-[0.97]",
        "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        selected
          ? "border-primary bg-primary text-primary-foreground shadow-xs"
          : "border-border bg-card text-foreground hover:border-input hover:bg-accent hover:text-accent-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export { Badge, CountBadge, Chip };
