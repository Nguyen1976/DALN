import { useCallback, useLayoutEffect, useRef, useState } from "react";

type Snapshot = { height: number; rects: Map<string, DOMRect> };

/** The card opens its gap first, then the new fields drop into it. */
const OPEN_MS = 220;
/** Closing, and any pure reflow, runs on one clock instead. */
const SETTLE_MS = 340;
const DROP_MS = 340;
/**
 * Leaving is quicker than arriving, and barely staggered. A field on its way
 * out keeps the spot it had while the ones that stay slide up into it, so any
 * time it is still legible it is lying on top of them — it has to be gone
 * before the card finishes closing, not after.
 */
const LIFT_MS = 150;
/** Each arriving field waits this much longer than the one before it. */
const STAGGER = 60;

/**
 * One form changing shape, rather than two forms swapping places.
 *
 * Mark every block inside the stage with `data-morph="<name>"`, and the ones
 * that only one mode has with `data-extra`. On a mode change there are three
 * jobs:
 *
 * 1. Blocks both modes have (email, password) keep their own DOM node and
 *    only glide to their new spot — measured before and after, then animated
 *    from the difference, so nothing flickers, re-mounts, or loses what was
 *    typed into it.
 * 2. Blocks that join wait for the card to open a gap, then drop into it one
 *    after another with a small bounce.
 * 3. Blocks that leave are lifted out of the layout first — so the card can
 *    close around them straight away — and slide up out of the way.
 *
 * The card's height is animated across the whole thing, which is what makes
 * the change read as one movement rather than a jump.
 */
export function useFieldMorph<Mode extends string>(initial: Mode) {
  const stageRef = useRef<HTMLElement>(null);
  const before = useRef<Snapshot | null>(null);
  const running = useRef<Animation[]>([]);
  const [mode, setMode] = useState<Mode>(initial);
  /** A mode's own fields stay mounted while they are on their way out. */
  const [leaving, setLeaving] = useState(false);

  const switchTo = useCallback(
    (next: Mode) => {
      const stage = stageRef.current;
      if (!stage || next === mode) return;

      // Measured now, while the old shape is still on screen.
      before.current = {
        height: stage.getBoundingClientRect().height,
        rects: new Map(
          Array.from(
            stage.querySelectorAll<HTMLElement>("[data-morph]"),
            (node) => [node.dataset.morph ?? "", node.getBoundingClientRect()],
          ),
        ),
      };

      for (const animation of running.current) animation.cancel();
      running.current = [];

      setMode(next);
      setLeaving(next === initial);
    },
    [initial, mode],
  );

  useLayoutEffect(() => {
    const stage = stageRef.current;
    const snapshot = before.current;
    if (!stage || !snapshot) return;
    // A snapshot describes one change and is spent on it. Dropping the
    // fields that have finished leaving commits again, and without this the
    // card would replay the whole close from the height it started at.
    before.current = null;

    const nodes = () =>
      Array.from(stage.querySelectorAll<HTMLElement>("[data-morph]"));

    // Fields on their way out leave the layout first, so the card can close
    // the gap while they are still moving.
    const outgoing = leaving
      ? nodes().filter((node) => node.dataset.extra !== undefined)
      : [];
    for (const node of nodes()) {
      if (outgoing.includes(node)) continue;
      // Turning back mid-exit: whatever was lifted out belongs in the layout
      // again, as does whatever was made to hold it.
      node.style.removeProperty("position");
      node.style.removeProperty("top");
      node.style.removeProperty("left");
      node.style.removeProperty("width");
      node.style.removeProperty("pointer-events");
      node.style.removeProperty("z-index");
    }

    // Read every position before moving anything: taking the first field out
    // of the layout would shift the ones measured after it.
    const lift = outgoing.map((node) => {
      const parent = node.parentElement ?? stage;
      return {
        node,
        parent,
        rect: node.getBoundingClientRect(),
        from: parent.getBoundingClientRect(),
      };
    });
    for (const { node, parent, rect, from } of lift) {
      // Held by its own parent, not by the card. A field that stays gets a
      // transform to glide it to its new spot, and a transform makes that
      // field the frame of reference for anything absolute inside it — so a
      // hint that lives inside one has to be placed against it, and then it
      // travels along instead of standing where the field is heading.
      parent.style.position = "relative";
      node.style.position = "absolute";
      node.style.top = `${rect.top - from.top}px`;
      node.style.left = `${rect.left - from.left}px`;
      node.style.width = `${rect.width}px`;
      // Under the fields that stay, for whatever moment it is still legible.
      node.style.zIndex = "-1";
    }

    const settled = stage.getBoundingClientRect().height;
    const staying: HTMLElement[] = [];
    const joining: HTMLElement[] = [];
    for (const node of nodes()) {
      if (outgoing.includes(node)) continue;
      (snapshot.rects.has(node.dataset.morph ?? "") ? staying : joining).push(
        node,
      );
    }

    const finish = (delay: number) =>
      window.setTimeout(() => setLeaving(false), delay);

    // Web Animations: the global reduced-motion CSS does not reach these.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      if (!outgoing.length) return;
      const done = finish(0);
      return () => window.clearTimeout(done);
    }

    // The Web Animations API wants a real easing, not `var(--x)`.
    const tokens = getComputedStyle(document.documentElement);
    const ease = (name: string, fallback: string) =>
      tokens.getPropertyValue(name).trim() || fallback;
    const play = (
      node: Element,
      frames: Keyframe[],
      options: KeyframeAnimationOptions,
    ) => running.current.push(node.animate(frames, options));

    const opening = joining.length > 0;
    const heightMs = opening ? OPEN_MS : SETTLE_MS;
    const glide = ease("--ease-in-out", "ease-in-out");

    if (Math.abs(settled - snapshot.height) > 1) {
      play(
        stage,
        [{ height: `${snapshot.height}px` }, { height: `${settled}px` }],
        { duration: heightMs, easing: glide },
      );
    }

    // Blocks both modes have: same node, new spot.
    for (const node of staying) {
      const was = snapshot.rects.get(node.dataset.morph ?? "");
      if (!was) continue;
      const now = node.getBoundingClientRect();
      const dx = was.left - now.left;
      const dy = was.top - now.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      play(node, [{ translate: `${dx}px ${dy}px` }, { translate: "0 0" }], {
        duration: heightMs,
        easing: glide,
      });
    }

    joining.forEach((node, index) => {
      play(
        node,
        [
          { translate: "0 -34px", opacity: 0 },
          { translate: "0 5px", opacity: 1, offset: 0.72 },
          { translate: "0 0", opacity: 1 },
        ],
        {
          duration: DROP_MS,
          // After the gap is open, and behind the field above it.
          delay: OPEN_MS + index * STAGGER,
          easing: ease("--ease-out", "ease-out"),
          fill: "backwards",
        },
      );
    });

    for (const node of outgoing) {
      node.style.pointerEvents = "none";
      play(
        node,
        [
          { translate: "0 0", opacity: 1 },
          { translate: "0 -16px", opacity: 0 },
        ],
        {
          duration: LIFT_MS,
          // All at once, and most of the fade spent in the first half: they
          // are standing where the remaining fields are about to be.
          easing: ease("--ease-out", "ease-out"),
          fill: "forwards",
        },
      );
    }

    if (!outgoing.length) return;
    const done = finish(LIFT_MS);
    return () => window.clearTimeout(done);
  }, [mode, leaving]);

  return {
    mode,
    switchTo,
    stageRef,
    /** A mode's own fields are on screen while entering or leaving. */
    leaving,
  };
}
