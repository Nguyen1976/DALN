import { flushSync } from "react-dom";

export type RevealOrigin = { x: number; y: number };

/**
 * Switches the theme behind a circle that grows from `origin` (the toggle
 * button) until it covers the page. Adapted from Magic UI's
 * AnimatedThemeToggler, circle variant.
 *
 * How it works: startViewTransition snapshots the page in the old theme, runs
 * `apply`, then shows the new theme as ::view-transition-new(root) on top of
 * the old snapshot. Animating that layer's clip-path from a 0% circle to one
 * that reaches the farthest corner is the reveal.
 *
 * `apply` must switch the theme synchronously (it runs inside flushSync): the
 * browser captures the new state as soon as the callback returns. Without the
 * API, or when the user asked for reduced motion, the switch is instant.
 */
export function revealTheme(origin: RevealOrigin, apply: () => void) {
  const root = document.documentElement;
  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;

  if (
    typeof document.startViewTransition !== "function" ||
    reduceMotion ||
    root.dataset.themeReveal === "active"
  ) {
    apply();
    return;
  }

  // innerWidth/innerHeight, not visualViewport: the percentages below resolve
  // against the snapshot box, which includes classic scrollbars.
  const width = window.innerWidth;
  const height = window.innerHeight;
  const radius = Math.hypot(
    Math.max(origin.x, width - origin.x),
    Math.max(origin.y, height - origin.y),
  );

  // Percentages rather than px: Chrome mis-scales px clip-path coordinates on
  // this pseudo-element at fractional display scales (magicui#989).
  const at = `at ${(origin.x / width) * 100}% ${(origin.y / height) * 100}%`;
  // A circle() percentage radius resolves against hypot(w, h) / √2.
  const reach = (radius / (Math.hypot(width, height) / Math.SQRT2)) * 100;
  const from = `circle(0% ${at})`;
  const to = `circle(${reach}% ${at})`;

  const styles = getComputedStyle(root);
  const duration = parseFloat(styles.getPropertyValue("--motion-reveal")) || 450;
  const easing = styles.getPropertyValue("--ease-in-out").trim() || "ease-in-out";

  root.dataset.themeReveal = "active";
  // Pinned in CSS too, so no browser paints the new theme unclipped between
  // the snapshot and the first animation frame.
  root.style.setProperty("--theme-reveal-from", from);

  let reveal: Animation | undefined;
  const transition = document.startViewTransition(() => flushSync(apply));

  transition.ready
    .then(() => {
      reveal = root.animate(
        { clipPath: [from, to] },
        {
          duration,
          easing,
          fill: "forwards",
          pseudoElement: "::view-transition-new(root)",
        },
      );
    })
    .catch(() => {});

  transition.finished
    .finally(() => {
      // A finished `fill: forwards` animation outlives its pseudo-element and
      // would clamp the next switch's new layer fully open for its first frames.
      reveal?.cancel();
      delete root.dataset.themeReveal;
      root.style.removeProperty("--theme-reveal-from");
    })
    .catch(() => {});
}
