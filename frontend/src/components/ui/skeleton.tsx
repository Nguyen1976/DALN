import { cn } from "@/lib/utils";

/**
 * Loading placeholder.
 *
 * Skeletons reserve the final layout box so content arriving later does not
 * shift the page (CLS). The sweep is decorative and disappears under
 * prefers-reduced-motion, leaving a plain muted block.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn(
        "relative overflow-hidden rounded-md bg-muted",
        "after:absolute after:inset-0 after:-translate-x-full after:animate-[shimmer_1.6s_infinite]",
        "after:bg-gradient-to-r after:from-transparent after:via-foreground/[0.06] after:to-transparent",
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
