import { useId } from "react";

import { type AppIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { staggerStyle } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * One group on a settings tab: a short label, then its card. The groups
 * stack in a single centred column.
 */
export function SettingsSection({
  title,
  step = 0,
  children,
}: {
  title: string;
  /** Position on the tab, for the entrance stagger. */
  step?: number;
  children: React.ReactNode;
}) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className="animate-stagger-in space-y-2.5 not-first:mt-8"
      style={staggerStyle(step)}
    >
      <h2 id={id} className="px-1 text-sm font-semibold text-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** The surface a section's controls sit on; rows inside get hairlines. */
export function SettingsCard({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-xs",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * One line in a card: an icon tile, what it is, a value or explanation, and
 * its control. `soon` marks things the app cannot do yet, so a disabled
 * control never looks broken.
 */
export function SettingRow({
  icon: Icon,
  title,
  description,
  soon = false,
  children,
}: {
  icon?: AppIcon;
  title: string;
  description?: React.ReactNode;
  soon?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3.5 px-4 py-4 sm:px-5">
      {Icon && (
        <span
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
        >
          <Icon className="size-[18px]" />
        </span>
      )}
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-foreground">
          {title}
          {soon && (
            <Badge variant="secondary" size="sm">
              Sắp có
            </Badge>
          )}
        </p>
        {description && (
          <div className="text-sm text-muted-foreground">{description}</div>
        )}
      </div>
      {children && (
        <div className="flex shrink-0 items-center gap-2">{children}</div>
      )}
    </div>
  );
}
