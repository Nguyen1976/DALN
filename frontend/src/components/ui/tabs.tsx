import * as TabsPrimitive from "@radix-ui/react-tabs";
import * as React from "react";

import { cn } from "@/lib/utils";
import { AnimateIcon } from "@/components/icons";
import { GooeyHighlight } from "@/components/GooeyHighlight";
import { useGooeyHighlight } from "@/hooks/useGooeyHighlight";

function Tabs({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("flex flex-col gap-3", className)}
      {...props}
    />
  );
}

function TabsList({
  className,
  gooey,
  children,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> & {
  /**
   * Move the active tab's pill as a drop of liquid, the way the navigation
   * rail does, instead of having it appear on the new tab. `id` names the
   * drop's SVG filter, so it has to be unique on the page.
   */
  gooey?: { id: string; activeIndex: number };
}) {
  const { rootRef, gooRef, blobRefs } = useGooeyHighlight(
    gooey ? gooey.activeIndex : -1,
    {
      id: gooey?.id ?? "tabs-goo",
      tabSelector: '[data-slot="tabs-trigger"]',
      // The pill is the card colour, so its label reads as body text.
      activeColor: "--foreground",
      // Tabs sit shoulder to shoulder: the pill pours across rather than hops.
      motion: "flow",
    },
  );

  return (
    <TabsPrimitive.List
      ref={gooey ? rootRef : undefined}
      data-slot="tabs-list"
      data-gooey={gooey ? "" : undefined}
      className={cn(
        "relative inline-flex h-11 w-fit items-center justify-center rounded-xl bg-muted p-1 text-muted-foreground",
        className,
      )}
      {...props}
    >
      {gooey && (
        <GooeyHighlight
          id={gooey.id}
          gooRef={gooRef}
          blobRefs={blobRefs}
          blobClassName="rounded-lg bg-card"
          blur={9}
        />
      )}
      {children}
    </TabsPrimitive.List>
  );
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  // Hovering a tab plays its animated icon, like buttons do.
  return (
    <AnimateIcon asChild animateOnHover>
      <TabsPrimitive.Trigger
        data-slot="tabs-trigger"
        className={cn(
          "relative inline-flex h-9 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-sm font-medium",
          "text-muted-foreground transition-[color,background-color,box-shadow] duration-(--motion-fast) ease-out",
          "hover:text-foreground",
          "data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm",
          "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          "disabled:pointer-events-none disabled:opacity-55",
          "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
          className,
        )}
        {...props}
      />
    </AnimateIcon>
  );
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 animate-slide-in-up outline-none", className)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
