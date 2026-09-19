import { useLayoutEffect, useRef, useState } from "react";
import { Users, MessageSquare, LogOut, Settings, Sparkles } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import ProfileSetting from "../ChatSidebar/ProfileSetting";
import { useLocation, useNavigate } from "react-router";
import type { AppDispatch } from "@/redux/store";
import { useDispatch } from "react-redux";
import { logoutAPI } from "@/redux/slices/userSlice";
import { BrandMark } from "@/components/Brand";
import { ProfileSettings } from "@/components/Setting";

/**
 * Which tab the rail's highlight sat on last. Every screen renders its own
 * MainLayout, so this component remounts on each route change and cannot keep
 * that in state; module scope survives the remount.
 */
let lastActiveIndex: number | null = null;

/**
 * Gooey highlight: the active tab's circle behaves like a drop of liquid. On a
 * tab change it stretches toward the target, pinches into a neck, and the tail
 * catches up and merges back into a circle on the new tab.
 *
 * Three circles (head, bridge, tail) move at staggered speeds inside a layer
 * with an SVG "goo" filter: blur them together, then sharpen the alpha, and
 * whatever overlaps reads as one shape. The bridge shrinks mid-flight to form
 * the neck without letting the drop split in two. Positions are measured, so
 * the same code runs on the vertical desktop rail and the mobile bottom bar.
 */
function useGooeyHighlight(activeIndex: number) {
  const railRef = useRef<HTMLDivElement>(null);
  const gooRef = useRef<HTMLDivElement>(null);
  const blobRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useLayoutEffect(() => {
    const goo = gooRef.current;
    const rail = railRef.current;
    const [tail, bridge, head] = blobRefs.current;
    if (!goo || !rail || !tail || !bridge || !head) return;

    const point = (index: number) => {
      const tab = tabRefs.current[index];
      return tab ? { x: tab.offsetLeft, y: tab.offsetTop } : null;
    };
    const css = (p: { x: number; y: number }) => `${p.x}px ${p.y}px`;
    const settle = (p: { x: number; y: number }) => {
      for (const blob of [tail, bridge, head]) blob.style.translate = css(p);
    };

    const fromIndex = lastActiveIndex;
    const to = activeIndex >= 0 ? point(activeIndex) : null;
    const from = fromIndex !== null ? point(fromIndex) : null;
    lastActiveIndex = activeIndex >= 0 ? activeIndex : null;

    if (!to) {
      goo.style.opacity = "0";
      return;
    }
    goo.style.opacity = "1";
    settle(to);

    const distance = from ? Math.hypot(to.x - from.x, to.y - from.y) : 0;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    // Web Animations: the global reduced-motion CSS does not reach these.
    if (from && fromIndex !== null && distance > 0 && !reduceMotion) {
      const styles = getComputedStyle(document.documentElement);
      const easing =
        styles.getPropertyValue("--ease-in-out").trim() || "ease-in-out";
      // Longer hops take a little longer; the whole drop settles in ≤ 500ms.
      const headMs = Math.min(360, 260 + distance * 0.8);
      const tailDelay = 90;
      const tailMs = Math.min(410, headMs + 70);
      const bridgeMs = (headMs + tailMs) / 2;
      // Shrink the bridge less on long hops so the drop never breaks apart.
      const neck = Math.max(0.55, 1 - 19 / distance);
      const path = (scale: number) => [
        { translate: css(from), scale: 1 },
        { scale, offset: 0.5 },
        { translate: css(to), scale: 1 },
      ];

      head.animate([{ translate: css(from) }, { translate: css(to) }], {
        duration: headMs,
        easing,
      });
      bridge.animate(path(neck), {
        duration: bridgeMs,
        delay: tailDelay / 2,
        easing,
        fill: "backwards",
      });
      tail.animate(path(0.85), {
        duration: tailMs,
        delay: tailDelay,
        easing,
        fill: "backwards",
      });

      // Icons follow the drop: white while it covers them, muted otherwise.
      const on = styles.getPropertyValue("--primary-foreground").trim();
      const off = styles.getPropertyValue("--muted-foreground").trim();
      const tailLeaves = tailDelay + tailMs * 0.45;
      tabRefs.current[activeIndex]?.animate([{ color: off }, {}], {
        delay: headMs * 0.45,
        duration: headMs * 0.3,
        fill: "backwards",
      });
      tabRefs.current[fromIndex]?.animate([{ color: on }, {}], {
        delay: tailLeaves,
        duration: tailMs * 0.25,
        fill: "backwards",
      });
      const step = activeIndex > fromIndex ? 1 : -1;
      for (let i = fromIndex + step; i !== activeIndex; i += step) {
        tabRefs.current[i]?.animate(
          [
            { color: off },
            { color: on, offset: 0.3 },
            { color: on, offset: 0.7 },
            { color: off },
          ],
          { delay: headMs * 0.3, duration: tailLeaves - headMs * 0.3 },
        );
      }
    }

    // Breakpoint changes move the tabs; follow them without animating.
    const observer = new ResizeObserver(() => {
      const next = point(activeIndex);
      if (next) settle(next);
    });
    observer.observe(rail);
    return () => observer.disconnect();
  }, [activeIndex]);

  return { railRef, gooRef, blobRefs, tabRefs };
}

export function LeftNavigation() {
  const navigate = useNavigate();
  const pathname = useLocation().pathname;

  const dispatch = useDispatch<AppDispatch>();
  // The logout button sits at the bottom of the rail, right where a stray
  // click lands; it used to sign out on the spot and drop unsent drafts.
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const handleLogout = () => {
    setConfirmLogout(false);
    dispatch(logoutAPI());
    navigate("/auth");
  };

  const navItems = [
    {
      label: "Trò chuyện",
      icon: MessageSquare,
      onClick: () => navigate("/"),
      active: pathname === "/" || pathname.startsWith("/chat"),
    },
    {
      label: "Bạn bè",
      icon: Users,
      onClick: () => navigate("/friends"),
      active:
        pathname === "/friends" ||
        pathname === "/groups" ||
        pathname === "/friend_requests",
    },
    {
      label: "Gợi ý bạn bè",
      icon: Sparkles,
      onClick: () => navigate("/recommendations"),
      active: pathname === "/recommendations",
    },
  ];

  const { railRef, gooRef, blobRefs, tabRefs } = useGooeyHighlight(
    navItems.findIndex((item) => item.active),
  );

  return (
    <TooltipProvider delayDuration={300}>
      <nav
        aria-label="Điều hướng chính"
        className={cn(
          // Mobile: bottom bar, respecting the home-indicator safe area.
          "z-30 flex w-full shrink-0 flex-row items-center justify-around gap-1 border-t border-sidebar-border bg-sidebar px-2 py-1.5",
          "pb-[max(0.375rem,env(safe-area-inset-bottom))]",
          // Desktop: slim rail.
          "md:h-full md:w-[76px] md:flex-col md:justify-start md:gap-2 md:border-r md:border-t-0 md:px-0 md:py-4 md:pb-4",
        )}
      >
        <div className="hidden md:mb-1 md:flex md:flex-col md:items-center md:gap-4">
          <span
            aria-hidden="true"
            className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground"
          >
            <BrandMark className="size-[22px]" />
          </span>
          <ProfileSetting />
        </div>

        <div
          ref={railRef}
          className="group/rail relative flex flex-1 flex-row items-center justify-around gap-1 md:flex-none md:flex-col md:justify-start md:gap-1.5"
        >
          {/* Blur-then-sharpen: circles that touch melt into one drop. */}
          <svg aria-hidden="true" className="absolute size-0">
            <filter
              id="left-nav-goo"
              x="-50%"
              y="-50%"
              width="200%"
              height="200%"
              colorInterpolationFilters="sRGB"
            >
              <feGaussianBlur in="SourceGraphic" stdDeviation="7" />
              <feColorMatrix
                mode="matrix"
                values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 16 -6"
              />
            </filter>
          </svg>
          <div
            ref={gooRef}
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-0 [filter:url(#left-nav-goo)]"
          >
            {["tail", "bridge", "head"].map((part, index) => (
              <span
                key={part}
                ref={(node) => {
                  blobRefs.current[index] = node;
                }}
                className="absolute left-0 top-0 size-11 rounded-full bg-primary transition-colors duration-(--motion-fast) group-has-[[aria-current=page]:hover]/rail:bg-primary-hover"
              />
            ))}
          </div>
          <div className="md:hidden">
            <ProfileSetting />
          </div>

          {navItems.map(({ label, icon: Icon, onClick, active }, index) => (
            <Tooltip key={label}>
              <TooltipTrigger asChild>
                <Button
                  ref={(node) => {
                    tabRefs.current[index] = node;
                  }}
                  variant="ghost"
                  size="icon"
                  aria-label={label}
                  aria-current={active ? "page" : undefined}
                  onClick={onClick}
                  className={cn(
                    "relative size-11 rounded-full text-muted-foreground",
                    // Icon nudges up on hover; the button itself keeps still.
                    "[&_svg]:transition-transform [&_svg]:duration-(--motion-base) [&_svg]:ease-(--ease-spring) hover:[&_svg]:scale-110",
                    "hover:bg-accent hover:text-accent-foreground",
                    // The fill comes from the shared highlight behind the tabs.
                    active &&
                      "text-primary-foreground hover:bg-transparent hover:text-primary-foreground",
                  )}
                >
                  <Icon className="size-5" />
                  {/* Second, non-colour cue for the active tab. */}
                  {active && (
                    <span
                      aria-hidden="true"
                      className="absolute -bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 animate-pop-in rounded-full bg-primary md:hidden"
                    />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right" className="hidden md:block">
                {label}
              </TooltipContent>
            </Tooltip>
          ))}
        </div>

        {/* Account-level actions sit at the foot of the rail, away from the
            screens above them: settings first, sign-out last. */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Cài đặt"
              onClick={() => setShowSettings(true)}
              className="size-11 rounded-full text-muted-foreground hover:bg-accent hover:text-accent-foreground md:mt-auto"
            >
              <Settings className="size-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right" className="hidden md:block">
            Cài đặt
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Đăng xuất"
              onClick={() => setConfirmLogout(true)}
              className="size-11 rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive-text"
            >
              <LogOut className="size-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right" className="hidden md:block">
            Đăng xuất
          </TooltipContent>
        </Tooltip>
      </nav>

      {showSettings && (
        <ProfileSettings onClose={() => setShowSettings(false)} />
      )}

      <ConfirmDialog
        open={confirmLogout}
        onOpenChange={setConfirmLogout}
        title="Đăng xuất khỏi DALN Chat?"
        description="Bạn sẽ thoát khỏi tài khoản trên thiết bị này. Tin nhắn đang soạn dở chưa gửi sẽ không được giữ lại."
        confirmLabel="Đăng xuất"
        onConfirm={handleLogout}
      />
    </TooltipProvider>
  );
}
