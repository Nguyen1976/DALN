import { RotateCcw } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/feedback";
import type { InfiniteScrollStatus } from "@/hooks/useInfiniteScroll";

/**
 * The end of a list driven by useInfiniteScroll: the sentinel that triggers
 * the next page, and what the person sees down there — placeholder rows while
 * a page loads, a retry when it failed, a quiet note once everything is shown.
 */
export function InfiniteListFooter({
  sentinelRef,
  status,
  hasMore,
  onRetry,
  loading,
  endLabel,
}: {
  sentinelRef: (node: HTMLElement | null) => void;
  status: InfiniteScrollStatus;
  hasMore: boolean;
  onRetry: () => void;
  /** Placeholder rows shaped like the list's items; a spinner otherwise. */
  loading?: React.ReactNode;
  /** Shown once the list is complete; omit for short lists. */
  endLabel?: string;
}) {
  return (
    <div>
      {status === "loading" &&
        (loading ?? (
          <div className="flex items-center justify-center gap-2 py-3 text-sm text-muted-foreground">
            <Spinner label="Đang tải thêm" />
            Đang tải thêm…
          </div>
        ))}

      {status === "error" && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 py-3 text-sm text-muted-foreground"
        >
          Không tải được thêm.
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RotateCcw aria-hidden="true" />
            Thử lại
          </Button>
        </div>
      )}

      {status !== "error" && !hasMore && endLabel && (
        <p className="py-3 text-center text-xs text-muted-foreground">
          {endLabel}
        </p>
      )}

      {/* Screen readers hear that more is on the way. */}
      <span className="sr-only" aria-live="polite">
        {status === "loading" ? "Đang tải thêm…" : ""}
      </span>

      {/* Gone once the list is complete or failed, so nothing can fire. */}
      {hasMore && status !== "error" && (
        <div ref={sentinelRef} aria-hidden="true" className="h-px" />
      )}
    </div>
  );
}
