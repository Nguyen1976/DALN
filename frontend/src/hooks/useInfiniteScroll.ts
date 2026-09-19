import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

export type InfiniteScrollStatus = "idle" | "loading" | "error";

/** Nearest ancestor that scrolls vertically; null means the page itself. */
function scrollParentOf(node: HTMLElement): HTMLElement | null {
  for (let el = node.parentElement; el; el = el.parentElement) {
    const { overflowY } = getComputedStyle(el);
    if (overflowY === "auto" || overflowY === "scroll") return el;
  }
  return null;
}

/** Whether the sentinel sits within `margin` px below the visible area. */
function isNearEnd(sentinel: HTMLElement, margin: number) {
  // Detached, or inside something display:none (a closed tab, a hidden panel).
  if (!sentinel.isConnected || sentinel.getClientRects().length === 0) {
    return false;
  }
  const root = scrollParentOf(sentinel);
  const view = root
    ? root.getBoundingClientRect()
    : { top: 0, bottom: window.innerHeight };
  const box = sentinel.getBoundingClientRect();
  return box.top <= view.bottom + margin && box.bottom >= view.top;
}

/**
 * Loads the next page when the end of a list scrolls into reach, instead of
 * a "Tải thêm" button. Render the returned `sentinelRef` on an element after
 * the last item (InfiniteListFooter does this).
 *
 * It can never loop against an exhausted list:
 * - nothing is requested once `hasMore` is false — the caller flips it when a
 *   page comes back shorter than asked (at worst one extra, empty request
 *   when the total is an exact multiple of the page size);
 * - the observer only fires as the sentinel crosses into reach, so resting at
 *   the bottom requests nothing;
 * - one request at a time;
 * - a failed request stops the automatic loading until `retry()` is called,
 *   so a struggling server is not hammered.
 *
 * After each page it measures once: if the end is still in reach (a short
 * page, or a filtered list that stayed short) it loads the next one, so the
 * view fills up without the user having to wiggle the scroll. That refill
 * only follows a load that grew `itemCount`: a page that added nothing (a
 * stuck cursor, all duplicates) cannot chain into another request.
 */
export function useInfiniteScroll({
  hasMore,
  loadMore,
  enabled = true,
  margin = 300,
  itemCount,
}: {
  hasMore: boolean;
  /** Fetch and append the next page; reject to show the retry state. */
  loadMore: () => Promise<unknown>;
  /** Off while the first page, a search or a reset is in flight. */
  enabled?: boolean;
  /** How far ahead of the end to start loading, in px. */
  margin?: number;
  /** Size of the paged collection (not a filtered view of it). */
  itemCount?: number;
}) {
  const [sentinel, setSentinel] = useState<HTMLElement | null>(null);
  const [status, setStatus] = useState<InfiniteScrollStatus>("idle");
  const busyRef = useRef(false);
  const failedRef = useRef(false);
  const countBeforeLoadRef = useRef<number | undefined>(undefined);
  const latest = useRef({ hasMore, loadMore, enabled, itemCount });
  useLayoutEffect(() => {
    latest.current = { hasMore, loadMore, enabled, itemCount };
  });

  const load = useCallback(async () => {
    const { hasMore, loadMore, enabled } = latest.current;
    if (!enabled || !hasMore || busyRef.current || failedRef.current) return;
    busyRef.current = true;
    countBeforeLoadRef.current = latest.current.itemCount;
    setStatus("loading");
    try {
      await loadMore();
      setStatus("idle");
    } catch {
      failedRef.current = true;
      setStatus("error");
    } finally {
      busyRef.current = false;
    }
  }, []);

  // Scroll-driven: fire as the sentinel comes within `margin` of the view.
  useEffect(() => {
    if (!sentinel || !enabled) return;
    const observer = new IntersectionObserver(
      (entries) => {
        // Entries arrive a frame late: one computed while the list was still
        // empty can land after the first page did. Measure again before
        // trusting it, or that stale "in view" fetches an unneeded page.
        if (
          entries.some((entry) => entry.isIntersecting) &&
          isNearEnd(sentinel, margin)
        ) {
          void load();
        }
      },
      // The list's own scroll box as root: with the viewport as root, the
      // margin would stop at the box's clipped edge and never look ahead.
      { root: scrollParentOf(sentinel), rootMargin: `0px 0px ${margin}px 0px` },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [sentinel, enabled, margin, load]);

  // Fill-up: after a page lands (or the list is switched back on), measure
  // once; the observer only reports crossings, not "still in view".
  useEffect(() => {
    if (status !== "idle" || !sentinel || !enabled || !hasMore) return;
    const before = countBeforeLoadRef.current;
    if (
      before !== undefined &&
      itemCount !== undefined &&
      itemCount <= before
    ) {
      return;
    }
    if (isNearEnd(sentinel, margin)) void load();
  }, [status, sentinel, enabled, hasMore, margin, itemCount, load]);

  const retry = useCallback(() => {
    failedRef.current = false;
    setStatus("idle");
    void load();
  }, [load]);

  /** For when the list is replaced (new tab, new search): forget a failure. */
  const reset = useCallback(() => {
    failedRef.current = false;
    setStatus("idle");
  }, []);

  return { sentinelRef: setSentinel, status, retry, reset };
}
