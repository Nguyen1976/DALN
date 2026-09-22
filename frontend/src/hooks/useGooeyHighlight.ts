import { useLayoutEffect, useRef } from "react";

/**
 * Where each highlight sat last, by id. Module scope, so a highlight that is
 * mounted again (the rail after signing out and back in) glides to the active
 * tab rather than appearing on it.
 */
const lastActiveById = new Map<string, number | null>();

/** The leading edge of a flow: off at once, easing into the far wall. */
const easeOut = (t: number) => 1 - (1 - t) ** 1.9;
/** The trailing edge: it hangs back, then runs in to gather. */
const easeIn = (t: number) => t ** 1.5;
type Box = { x: number; y: number; w: number; h: number };

type GooeyOptions = {
  /** Unique per highlight: names its SVG filter and remembers its position. */
  id: string;
  /** Which descendants of the measured root are the tabs. */
  tabSelector?: string;
  /** Label colour while the drop covers a tab, and once it has left. */
  activeColor?: string;
  idleColor?: string;
  /**
   * How the shape gets from one tab to the next. "hop" carries it across as a
   * drop that necks in the middle — what a circle moving between round tabs
   * wants. "flow" pours it instead, the way liquid runs to the low side of a
   * tilted tray: the leading edge sets off first and the body thins as it
   * stretches, then the trailing edge piles in and it settles thick again.
   * A pill as wide as its own tab has to flow; hopping it would just fill the
   * whole track on the way.
   */
  motion?: "hop" | "flow";
};

/**
 * Gooey highlight: the active tab's shape behaves like a drop of liquid. On a
 * tab change it stretches toward the target, pinches into a neck, and the tail
 * catches up and merges back into one shape on the new tab.
 *
 * Three copies (head, bridge, tail) move at staggered speeds inside a layer
 * with an SVG "goo" filter: blur them together, then sharpen the alpha, and
 * whatever overlaps reads as one shape. The bridge shrinks mid-flight to form
 * the neck without letting the drop split in two. Everything is measured, so
 * the same code drives the vertical rail, the mobile bottom bar and a row of
 * tabs; it assumes the tabs it moves between are the same size.
 */
export function useGooeyHighlight(activeIndex: number, options: GooeyOptions) {
  const {
    id,
    tabSelector = "[data-gooey-tab]",
    activeColor = "--primary-foreground",
    idleColor = "--muted-foreground",
    motion = "hop",
  } = options;
  const rootRef = useRef<HTMLDivElement>(null);
  const gooRef = useRef<HTMLDivElement>(null);
  const blobRefs = useRef<(HTMLSpanElement | null)[]>([]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const goo = gooRef.current;
    const [tail, bridge, head] = blobRefs.current;
    if (!root || !goo || !tail || !bridge || !head) return;

    const tabs = Array.from(root.querySelectorAll<HTMLElement>(tabSelector));
    // Measured against the drop's own layer: exact whatever padding or
    // positioning the tabs sit in.
    const box = (index: number): Box | null => {
      const tab = tabs[index];
      if (!tab) return null;
      const layer = goo.getBoundingClientRect();
      const rect = tab.getBoundingClientRect();
      return {
        x: rect.left - layer.left,
        y: rect.top - layer.top,
        w: rect.width,
        h: rect.height,
      };
    };
    const css = (b: Box) => `${b.x}px ${b.y}px`;
    const settle = (b: Box) => {
      for (const blob of [tail, bridge, head]) {
        blob.style.width = `${b.w}px`;
        blob.style.height = `${b.h}px`;
        blob.style.translate = css(b);
      }
    };

    const fromIndex = lastActiveById.get(id) ?? null;
    const to = activeIndex >= 0 ? box(activeIndex) : null;
    const from = fromIndex !== null ? box(fromIndex) : null;
    lastActiveById.set(id, activeIndex >= 0 ? activeIndex : null);

    if (!to) {
      goo.style.opacity = "0";
      return;
    }
    goo.style.opacity = "1";
    settle(to);

    const distance = from ? Math.hypot(to.x - from.x, to.y - from.y) : 0;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    // Web Animations: the global reduced-motion CSS does not reach these.
    if (from && fromIndex !== null && distance > 0 && !reduceMotion) {
      const styles = getComputedStyle(document.documentElement);
      const easing =
        styles.getPropertyValue("--ease-in-out").trim() || "ease-in-out";
      const flowing = motion === "flow";

      /**
       * Liquid running to the low side of a tilted tray, sampled per frame.
       *
       * The two edges keep their own clocks: the leading one leaves at once
       * and eases into the far wall, the trailing one hangs back and then
       * runs in to gather. Between them the body is longer than it rests and
       * thins by as much as it stretched, because the volume has to go
       * somewhere — that is what separates liquid from a box being resized.
       *
       * The three copies are the parts of that body, not three drops: a thick
       * crest at the leading edge, a thin film spanning the whole run, and a
       * wake left at the back. The goo filter melts them into one shape, so
       * the flow arrives heavy and trails off thin. At rest all three sit
       * inside the tab's pill, which is what you see between changes.
       */
      // Which side leads is the side being poured towards, so the flow looks
      // the same in both directions.
      const rightwards = to.x > from.x;
      const leadFrom = rightwards ? from.x + from.w : from.x;
      const leadTo = rightwards ? to.x + to.w : to.x;
      const trailFrom = rightwards ? from.x : from.x + from.w;
      const trailTo = rightwards ? to.x : to.x + to.w;

      const pour = (role: "crest" | "film" | "wake") =>
        Array.from({ length: 25 }, (_, i) => {
          const t = i / 24;
          const front = easeOut(Math.min(1, t / 0.85));
          const back = easeIn(Math.max(0, (t - 0.05) / 0.95));
          const lead = leadFrom + (leadTo - leadFrom) * front;
          const trail = trailFrom + (trailTo - trailFrom) * back;
          const left = Math.min(lead, trail);
          const body = Math.max(to.w, Math.abs(lead - trail));
          const stretch = body / to.w;
          const thin = 1 / (1 + (stretch - 1) * 0.95);

          const width =
            role === "crest"
              ? to.w / (1 + (stretch - 1) * 0.4)
              : role === "film"
                ? body
                : to.w * (0.45 + 0.55 / stretch);
          // The crest rides the leading edge and the wake is left at the
          // trailing one; the film spans everything in between. Each is
          // hung by the edge it belongs to, whichever way the flow runs.
          const x =
            role === "film"
              ? left
              : role === "crest"
                ? rightwards
                  ? lead - width
                  : lead
                : rightwards
                  ? trail
                  : trail - width;
          const height =
            role === "crest"
              ? 1
              : role === "film"
                ? thin
                : Math.min(1, thin * 1.3);

          return {
            // Scaling happens about the centre, so the box is nudged to put
            // the edges where the flow wants them.
            translate: `${x + (width - to.w) / 2}px ${to.y}px`,
            scale: `${width / to.w} ${height}`,
          };
        });

      const flowMs = Math.min(460, 340 + distance * 0.35);
      // Longer hops take a little longer; the whole drop settles in ≤ 500ms.
      const headMs = flowing ? flowMs : Math.min(360, 260 + distance * 0.8);
      const tailDelay = 90;
      const tailMs = flowing ? flowMs : Math.min(410, headMs + 70);
      const bridgeMs = (headMs + tailMs) / 2;
      // Shrink the bridge less on long hops so the drop never breaks apart.
      const neck = Math.max(0.55, 1 - 19 / distance);
      const hop = (scale: number) => [
        { translate: css(from), scale: 1 },
        { scale, offset: 0.5 },
        { translate: css(to), scale: 1 },
      ];
      const timing = flowing ? "linear" : easing;

      head.animate(
        flowing
          ? pour("crest")
          : [{ translate: css(from) }, { translate: css(to) }],
        { duration: headMs, easing: timing },
      );
      bridge.animate(flowing ? pour("film") : hop(neck), {
        duration: bridgeMs,
        delay: flowing ? 0 : tailDelay / 2,
        easing: timing,
        fill: "backwards",
      });
      tail.animate(flowing ? pour("wake") : hop(0.85), {
        duration: tailMs,
        delay: flowing ? 0 : tailDelay,
        easing: timing,
        fill: "backwards",
      });

      // Labels follow the drop: lit while it covers them, muted otherwise.
      const on = styles.getPropertyValue(activeColor).trim();
      const off = styles.getPropertyValue(idleColor).trim();
      const tailLeaves = tailDelay + tailMs * 0.45;
      tabs[activeIndex]?.animate([{ color: off }, {}], {
        delay: headMs * 0.45,
        duration: headMs * 0.3,
        fill: "backwards",
      });
      tabs[fromIndex]?.animate([{ color: on }, {}], {
        delay: tailLeaves,
        duration: tailMs * 0.25,
        fill: "backwards",
      });
      const step = activeIndex > fromIndex ? 1 : -1;
      for (let i = fromIndex + step; i !== activeIndex; i += step) {
        tabs[i]?.animate(
          [
            { color: off },
            { color: on, offset: 0.3 },
            { color: on, offset: 0.7 },
            { color: off },
          ],
          { delay: headMs * 0.3, duration: tailLeaves - headMs * 0.3 },
        );
      }
    }

    // Breakpoint changes and resizing move the tabs; follow without animating.
    const observer = new ResizeObserver(() => {
      const next = box(activeIndex);
      if (next) settle(next);
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, [activeIndex, id, tabSelector, activeColor, idleColor, motion]);

  return { rootRef, gooRef, blobRefs };
}
