import type { CSSProperties } from "react";

/**
 * Delay slot for `.animate-stagger-in` (index × --stagger-step). Capped so the
 * tail of a long list, or a page of items loaded later, never waits long.
 */
export function staggerStyle(index: number, max = 8): CSSProperties {
  return { "--stagger": Math.min(index, max) } as CSSProperties;
}
