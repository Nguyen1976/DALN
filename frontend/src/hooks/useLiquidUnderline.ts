import { useLayoutEffect, useRef } from "react";

/** ≈ the --ease-in-out token; sampled in JS because each edge has its own clock. */
const easeInOut = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/**
 * Tab underline that glides to the new tab and stretches on the way: the
 * leading edge sets off first, the trailing edge follows and catches up, so
 * the bar grows long mid-move (and a little thinner) before settling to the
 * new tab's width. At rest it is the same 2px bar under the active tab.
 *
 * Only transform properties animate: the bar is placed with `translate` and
 * sized with `scale` from its left edge. Both edges have their own easing, so
 * the path is sampled into keyframes rather than left to a single curve.
 */
export function useLiquidUnderline(activeIndex: number) {
  const listRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLSpanElement>(null);
  const tabRefs = useRef<(HTMLElement | null)[]>([]);
  const previousRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    const list = listRef.current;
    const line = lineRef.current;
    if (!list || !line) return;

    const edges = (index: number) => {
      const tab = tabRefs.current[index];
      return tab
        ? { left: tab.offsetLeft, right: tab.offsetLeft + tab.offsetWidth }
        : null;
    };
    const rest = (to: { left: number; right: number }) => {
      line.style.width = `${to.right - to.left}px`;
      line.style.translate = `${to.left}px 0`;
    };

    const from = previousRef.current !== null ? edges(previousRef.current) : null;
    const to = activeIndex >= 0 ? edges(activeIndex) : null;
    previousRef.current = activeIndex >= 0 ? activeIndex : null;

    if (!to) {
      line.style.opacity = "0";
      return;
    }
    line.style.opacity = "1";
    rest(to);

    let glide: Animation | undefined;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    // Web Animations: the global reduced-motion CSS does not reach these.
    if (from && from.left !== to.left && !reduceMotion) {
      const forward = to.left > from.left;
      const width = to.right - to.left;
      const distance = Math.abs(to.left - from.left);
      const duration = Math.min(600, 380 + distance * 0.6);
      const steps = 24;

      const keyframes = Array.from({ length: steps + 1 }, (_, i) => {
        const t = i / steps;
        // The leading edge lands at 65% of the run; the trailing one waits 20%.
        const lead = easeInOut(clamp01(t / 0.65));
        const trail = easeInOut(clamp01((t - 0.2) / 0.8));
        const leftP = forward ? trail : lead;
        const rightP = forward ? lead : trail;
        const left = from.left + (to.left - from.left) * leftP;
        const right = from.right + (to.right - from.right) * rightP;
        // A touch thinner while stretched, back to full height at rest.
        const thickness = 1 - 0.3 * Math.abs(lead - trail);
        return {
          translate: `${left}px 0`,
          scale: `${(right - left) / width} ${thickness}`,
        };
      });

      glide = line.animate(keyframes, { duration, easing: "linear" });
    }

    // Tabs can change width (fonts loading, counts appearing, resizing);
    // keep the bar under the active one without animating.
    const observer = new ResizeObserver(() => {
      const next = edges(activeIndex);
      if (next) rest(next);
    });
    observer.observe(list);
    tabRefs.current.forEach((tab) => tab && observer.observe(tab));
    return () => {
      observer.disconnect();
      glide?.cancel();
    };
  }, [activeIndex]);

  return { listRef, lineRef, tabRefs };
}
