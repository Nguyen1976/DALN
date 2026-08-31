import * as React from "react";
import * as AvatarPrimitive from "@radix-ui/react-avatar";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

function Avatar({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Root>) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      className={cn(
        "relative flex size-8 shrink-0 overflow-hidden rounded-full bg-muted",
        className,
      )}
      {...props}
    />
  );
}

function AvatarImage({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Image>) {
  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      className={cn("aspect-square size-full object-cover", className)}
      {...props}
    />
  );
}

function AvatarFallback({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Fallback>) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn(
        "flex size-full items-center justify-center rounded-full bg-secondary text-sm font-semibold uppercase text-secondary-foreground",
        className,
      )}
      {...props}
    />
  );
}

const presenceDotVariants = cva(
  "block rounded-full ring-2 ring-card transition-colors duration-[--motion-base]",
  {
    variants: {
      status: {
        online: "bg-presence-online",
        away: "bg-presence-away",
        busy: "bg-presence-busy",
        offline: "bg-presence-offline",
      },
      size: {
        sm: "size-2.5",
        md: "size-3",
        lg: "size-3.5",
      },
    },
    defaultVariants: { status: "offline", size: "md" },
  },
);

const PRESENCE_LABEL: Record<string, string> = {
  online: "Đang hoạt động",
  away: "Vắng mặt",
  busy: "Bận",
  offline: "Ngoại tuyến",
};

/**
 * Presence indicator.
 *
 * Colour alone never carries the meaning — every dot ships with a text label
 * for assistive tech, and offline is additionally distinguished by a hollow
 * centre so the states stay separable without colour vision.
 */
function PresenceDot({
  status = "offline",
  size = "md",
  className,
  label,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof presenceDotVariants> & { label?: string }) {
  const text = label ?? PRESENCE_LABEL[status ?? "offline"];

  return (
    <span
      data-slot="presence-dot"
      data-status={status}
      className={cn(
        presenceDotVariants({ status, size }),
        status === "offline" &&
          "border-2 border-card bg-transparent shadow-[inset_0_0_0_2px_var(--presence-offline)]",
        className,
      )}
      {...props}
    >
      <span className="sr-only">{text}</span>
    </span>
  );
}

/** Avatar + presence dot in one positioned wrapper. */
function AvatarWithPresence({
  status,
  className,
  dotSize = "md",
  children,
  ...props
}: React.ComponentProps<"div"> & {
  status?: "online" | "away" | "busy" | "offline" | null;
  dotSize?: "sm" | "md" | "lg";
}) {
  return (
    <div className={cn("relative shrink-0", className)} {...props}>
      {children}
      {status ? (
        <PresenceDot
          status={status}
          size={dotSize}
          className="absolute bottom-0 right-0"
        />
      ) : null}
    </div>
  );
}

export { Avatar, AvatarImage, AvatarFallback, AvatarWithPresence, PresenceDot };
