import { useLayoutEffect, useRef, type RefObject } from "react";

const MOVE = "list-move";

/**
 * Rows already shown this session, per list. Module scope so that a list
 * whose screen is left and come back to does not replay its entrance.
 */
const seenByList = new Map<string, Set<string>>();

/** Vertical part of the `translate` a running animation is drawing now. */
function drawnOffsetY(row: HTMLElement) {
  const value = getComputedStyle(row).translate;
  if (!value || value === "none") return 0;
  return parseFloat(value.split(" ")[1] ?? "0") || 0;
}

/**
 * Motion for a keyed list whose order changes in front of the user (a chat
 * moving to the top on a new message). Put `data-motion-key` on each row.
 *
 * - A row fades up once, the first time it shows, in a wave down the list.
 *   Done with the Web Animations API, not a CSS class: when a row jumps to the
 *   top React re-inserts the rows it passed, and re-inserting an element
 *   restarts its CSS animations, so the whole list used to flash and replay
 *   its entrance.
 * - A reorder slides rows from where they were to where they are (FLIP). A row
 *   that moves up is lifted first — a slight scale and shadow — then travels;
 *   the rows it passes slide down to make room. A move that starts while
 *   another is under way continues from where the row is drawn.
 * - Filtering or searching swaps many rows at once; that snaps into place.
 *
 * Only transform properties animate. Reduced motion skips all of it.
 *
 * It reads the rows from the DOM after each render rather than taking a list
 * of keys: what matters is what is on screen, and a list can hold data a beat
 * before it renders it (the sidebar keeps its skeleton up a moment longer).
 */
export function useListMotion(
  listRef: RefObject<HTMLElement | null>,
  {
    id,
    maxStagger = 14,
  }: {
    /** Names the list so its rows are remembered across remounts. */
    id?: string;
    maxStagger?: number;
  } = {},
) {
  const ownSeen = useRef(new Set<string>());
  const tops = useRef(new Map<string, number>());
  const lastOrder = useRef("");

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    let seen = ownSeen.current;
    if (id) {
      seen = seenByList.get(id) ?? new Set<string>();
      seenByList.set(id, seen);
    }

    const rows = Array.from(
      list.querySelectorAll<HTMLElement>("[data-motion-key]"),
    );
    // Most renders (typing, unread counts) leave the order alone: stop here.
    const order = rows.map((row) => row.dataset.motionKey).join("|");
    if (order === lastOrder.current) return;
    lastOrder.current = order;
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const tokens = getComputedStyle(document.documentElement);
    const step = parseFloat(tokens.getPropertyValue("--stagger-step")) || 60;
    const easeOut = tokens.getPropertyValue("--ease-out").trim() || "ease-out";
    const easeInOut =
      tokens.getPropertyValue("--ease-in-out").trim() || "ease-in-out";

    const before = tops.current;
    const after = new Map<string, number>();
    for (const row of rows) after.set(row.dataset.motionKey!, row.offsetTop);

    // A new message reorders the same rows (plus maybe one arriving or
    // leaving). Anything bigger is a filter or a search: no travel for that.
    let membershipChanges = 0;
    for (const key of after.keys()) if (!before.has(key)) membershipChanges++;
    for (const key of before.keys()) if (!after.has(key)) membershipChanges++;
    const animateMoves = !reduce && before.size > 0 && membershipChanges <= 2;

    let entering = 0;
    for (const row of rows) {
      const key = row.dataset.motionKey!;
      const top = after.get(key)!;

      if (!seen.has(key)) {
        seen.add(key);
        if (!reduce) {
          row.animate(
            [
              { opacity: 0, translate: "0 12px" },
              { opacity: 1, translate: "0 0" },
            ],
            {
              duration: 320,
              easing: easeOut,
              delay: Math.min(entering, maxStagger) * step,
              fill: "backwards",
            },
          );
        }
        entering += 1;
        continue;
      }

      const was = before.get(key);
      if (!animateMoves || was === undefined) continue;

      // Continue an interrupted move from where the row is drawn right now.
      let from = was;
      for (const running of row.getAnimations()) {
        if (running.id !== MOVE) continue;
        from += drawnOffsetY(row);
        running.cancel();
      }
      const delta = from - top;
      if (Math.abs(delta) < 1) continue;

      // `delta` is how far the row must be pushed back to where it was drawn:
      // positive means it is now higher up the list.
      if (delta > row.offsetHeight / 2) {
        // Moving up past other rows: lift, then travel.
        row.classList.add("list-lift");
        const lift = row.animate(
          [
            { translate: `0 ${delta}px`, scale: "1", easing: easeOut },
            {
              translate: `0 ${delta}px`,
              scale: "1.025",
              offset: 0.25,
              easing: easeInOut,
            },
            { translate: "0 0", scale: "1" },
          ],
          { duration: 480, id: MOVE },
        );
        // Events arrive later: a cancelled lift must not undo a newer one.
        const drop = () => {
          const moving = row
            .getAnimations()
            .some((anim) => anim.id === MOVE && anim.playState === "running");
          if (!moving) row.classList.remove("list-lift");
        };
        lift.addEventListener("finish", drop);
        lift.addEventListener("cancel", drop);
      } else {
        // Making room: slide as the lifted row sets off.
        row.animate([{ translate: `0 ${delta}px` }, { translate: "0 0" }], {
          duration: 360,
          delay: 100,
          easing: easeInOut,
          fill: "backwards",
          id: MOVE,
        });
      }
    }

    tops.current = after;
  });
}
