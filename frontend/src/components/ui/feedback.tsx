import { Loader2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Busy indicator.
 *
 * Always ships an accessible name; a bare spinning glyph tells a screen-reader
 * user nothing about what is happening.
 */
function Spinner({
  className,
  label = "Đang tải",
  ...props
}: React.ComponentProps<"span"> & { label?: string }) {
  return (
    <span role="status" className={cn("inline-flex", className)} {...props}>
      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/**
 * Empty state.
 *
 * Three parts, always in the same order: what is missing, why that is fine,
 * and the single action that resolves it.
 */
function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  compact = false,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        compact ? "gap-3 px-6 py-10" : "gap-4 px-6 py-16",
        className,
      )}
    >
      <div
        aria-hidden="true"
        className={cn(
          "flex items-center justify-center rounded-2xl bg-accent text-accent-foreground",
          compact ? "size-12" : "size-16",
        )}
      >
        <Icon className={compact ? "size-6" : "size-7"} />
      </div>
      <div className="space-y-1.5">
        <p
          className={cn(
            "font-semibold text-foreground",
            compact ? "text-sm" : "text-base",
          )}
        >
          {title}
        </p>
        {description && (
          <p className="mx-auto max-w-xs text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}

/** Consistent page/section heading block used across the secondary screens. */
function PageHeader({
  title,
  description,
  actions,
  icon: Icon,
  className,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  icon?: LucideIcon;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-start justify-between gap-4 border-b border-border px-4 py-4 md:px-6 md:py-5",
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        {Icon && (
          <span
            aria-hidden="true"
            className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground"
          >
            <Icon className="size-5" />
          </span>
        )}
        <div className="min-w-0 space-y-1">
          <h1 className="text-lg font-semibold tracking-[-0.01em] text-foreground md:text-xl">
            {title}
          </h1>
          {description && (
            <p className="text-sm leading-relaxed text-muted-foreground">
              {description}
            </p>
          )}
        </div>
      </div>
      {actions && (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      )}
    </div>
  );
}

export { Spinner, EmptyState, PageHeader };
