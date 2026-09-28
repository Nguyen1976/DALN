import type { CSSProperties } from "react";

/**
 * Delay slot for `.animate-stagger-in` (index × --stagger-step). Capped so the
 * tail of a long list, or a page of items loaded later, never waits long.
 */
export function staggerStyle(index: number, max = 8): CSSProperties {
  return { "--stagger": Math.min(index, max) } as CSSProperties;
}

/**
 * Reads a time token (`--motion-reveal`, `--stagger-step`) as milliseconds.
 * The production CSS minifier rewrites each value to its shortest form, so
 * `450ms` ships as `.45s`: a bare parseFloat would read 0.45 ms.
 */
export function cssTimeMs(name: string, fallback: number): number {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  const amount = parseFloat(value);
  if (Number.isNaN(amount)) return fallback;
  return value.endsWith("ms")
    ? amount
    : value.endsWith("s")
      ? amount * 1000
      : fallback;
}
