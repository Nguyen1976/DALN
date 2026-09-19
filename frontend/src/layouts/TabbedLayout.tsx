import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";

import { AnimateIcon, type AppIcon } from "@/components/icons";
import { useLiquidUnderline } from "@/hooks/useLiquidUnderline";
import { cn } from "@/lib/utils";

export interface TabbedLayoutTab {
  path: string;
  label: string;
  icon: AppIcon;
}

/**
 * A screen split into sections that each have their own URL: a title row, a
 * row of underline tabs, then the active section. Friends and Settings both
 * use it, so moving between them feels like the same kind of place.
 *
 * It is the parent route of its tabs (see App.tsx), so the header stays
 * mounted across tab changes and the underline can glide.
 */
export function TabbedLayout({
  title,
  description,
  actions,
  tabs,
  tabsLabel,
  children,
}: {
  title: React.ReactNode;
  description: React.ReactNode;
  actions?: React.ReactNode;
  tabs: TabbedLayoutTab[];
  tabsLabel: string;
  children?: React.ReactNode;
}) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const activeIndex = tabs.findIndex((tab) => tab.path === pathname);
  const { listRef, lineRef, tabRefs } = useLiquidUnderline(activeIndex);

  // On phones the row scrolls sideways; bring the active tab into view (a
  // deep link can land on one that starts off-screen). Only the row scrolls,
  // never the page, which scrollIntoView could do.
  useEffect(() => {
    const list = listRef.current;
    const tab = tabRefs.current[activeIndex];
    if (!list || !tab || list.scrollWidth <= list.clientWidth) return;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    list.scrollTo({
      left: tab.offsetLeft - (list.clientWidth - tab.offsetWidth) / 2,
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }, [activeIndex, listRef, tabRefs]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="shrink-0 space-y-4 border-b border-border px-4 pb-0 pt-4 md:px-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h1 className="text-lg font-semibold tracking-[-0.01em] text-foreground md:text-xl">
              {title}
            </h1>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
          {actions}
        </div>

        {/* Underline tabs: the active section is marked by an indicator bar,
              not by colour alone. -mb-px lays the row over the header's
              bottom border, so the bar covers that line. */}
        <div
          ref={listRef}
          role="tablist"
          aria-label={tabsLabel}
          className="custom-scrollbar relative -mb-px flex gap-1 overflow-x-auto"
        >
          {tabs.map(({ path, label, icon: Icon }, index) => {
            const active = pathname === path;
            return (
              <AnimateIcon key={path} asChild animateOnHover>
                <button
                  ref={(node) => {
                    tabRefs.current[index] = node;
                  }}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => navigate(path)}
                  className={cn(
                    "flex shrink-0 items-center gap-2 border-b-2 border-transparent px-3 py-2.5 text-sm font-medium",
                    "transition-colors duration-(--motion-fast)",
                    "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
                    active
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="size-4" aria-hidden="true" />
                  {label}
                </button>
              </AnimateIcon>
            );
          })}
          {/* One shared bar that glides between tabs (useLiquidUnderline). */}
          <span
            ref={lineRef}
            aria-hidden="true"
            className="pointer-events-none absolute bottom-0 left-0 h-0.5 origin-left rounded-full bg-primary opacity-0"
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
