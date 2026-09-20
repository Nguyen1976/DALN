import type { RefObject } from "react";

import { cn } from "@/lib/utils";

type GooeyHighlightProps = {
  /** Same id given to useGooeyHighlight: it names this filter. */
  id: string;
  gooRef: RefObject<HTMLDivElement | null>;
  blobRefs: RefObject<(HTMLSpanElement | null)[]>;
  /** Shape and colour of the drop; its size is measured from the tabs. */
  blobClassName?: string;
  /** How far the blobs bleed into each other before the alpha is sharpened. */
  blur?: number;
};

/**
 * The moving part of a gooey highlight: three copies of the active tab's
 * shape in a layer that blurs them together and then sharpens the alpha, so
 * whatever overlaps reads as one drop of liquid. useGooeyHighlight positions
 * them; this only draws them.
 */
export function GooeyHighlight({
  id,
  gooRef,
  blobRefs,
  blobClassName,
  blur = 7,
}: GooeyHighlightProps) {
  return (
    <>
      <svg aria-hidden="true" className="absolute size-0">
        <filter
          id={id}
          x="-50%"
          y="-50%"
          width="200%"
          height="200%"
          colorInterpolationFilters="sRGB"
        >
          <feGaussianBlur in="SourceGraphic" stdDeviation={blur} />
          <feColorMatrix
            mode="matrix"
            values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 16 -6"
          />
        </filter>
      </svg>
      <div
        ref={gooRef}
        aria-hidden="true"
        style={{ filter: `url(#${id})` }}
        className="pointer-events-none absolute inset-0 opacity-0"
      >
        {["tail", "bridge", "head"].map((part, index) => (
          <span
            key={part}
            ref={(node) => {
              blobRefs.current[index] = node;
            }}
            className={cn("absolute left-0 top-0", blobClassName)}
          />
        ))}
      </div>
    </>
  );
}
