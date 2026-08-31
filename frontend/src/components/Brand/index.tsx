import { cn } from "@/lib/utils";

/**
 * Product mark: a speech bubble whose tail doubles as a connection node —
 * messaging plus the friend-graph the app is built around.
 *
 * Drawn as inline SVG (no emoji, no raster) so it stays crisp at every size
 * and inherits the current text colour.
 */
export function BrandMark({
  className,
  title,
}: {
  className?: string;
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      role={title ? "img" : "presentation"}
      aria-hidden={title ? undefined : "true"}
      aria-label={title}
      className={cn("size-8", className)}
    >
      <path
        d="M16 3.5c7.18 0 12.5 4.62 12.5 10.75 0 6.13-5.32 10.75-12.5 10.75-1.2 0-2.36-.11-3.46-.33l-5.9 3.1a.9.9 0 0 1-1.3-.98l1.03-4.86C3.9 20.03 3.5 17.1 3.5 14.25 3.5 8.12 8.82 3.5 16 3.5Z"
        fill="currentColor"
      />
      <circle cx="11" cy="14" r="2.15" className="fill-primary" />
      <circle cx="20.5" cy="10.5" r="1.7" className="fill-primary" />
      <circle cx="20.5" cy="17.5" r="1.7" className="fill-primary" />
      <path
        d="M11 14l9.5-3.5M11 14l9.5 3.5"
        className="stroke-primary"
        strokeWidth="1.1"
        strokeLinecap="round"
        opacity="0.75"
      />
    </svg>
  );
}

export function BrandLockup({
  className,
  size = "md",
}: {
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const dims = {
    sm: { box: "size-8 rounded-lg", mark: "size-5", text: "text-base" },
    md: { box: "size-10 rounded-xl", mark: "size-6", text: "text-lg" },
    lg: { box: "size-12 rounded-2xl", mark: "size-7", text: "text-xl" },
  }[size];

  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <span
        className={cn(
          "flex shrink-0 items-center justify-center bg-primary text-primary-foreground shadow-sm",
          dims.box,
        )}
      >
        <BrandMark className={dims.mark} />
      </span>
      <span
        className={cn(
          "font-semibold tracking-[-0.02em] text-foreground",
          dims.text,
        )}
      >
        DALN&nbsp;Chat
      </span>
    </div>
  );
}
