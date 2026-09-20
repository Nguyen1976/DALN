import { useEffect, useState } from "react";
import { Users, MessageSquare, LogOut, Settings } from "@/components/icons";
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
import type { AppDispatch, RootState } from "@/redux/store";
import { useDispatch, useSelector } from "react-redux";
import { logoutAPI } from "@/redux/slices/userSlice";
import {
  rememberPath,
  sectionOf,
  type NavSection,
} from "@/redux/slices/navigationSlice";
import { BrandMark } from "@/components/Brand";
import { GooeyHighlight } from "@/components/GooeyHighlight";
import { useGooeyHighlight } from "@/hooks/useGooeyHighlight";

export function LeftNavigation() {
  const navigate = useNavigate();
  const dispatch = useDispatch<AppDispatch>();
  const { pathname } = useLocation();
  const lastPaths = useSelector((state: RootState) => state.navigation);

  // Note where each section is left, so coming back reopens that spot. The
  // path only: a query like ?requestId= opens a dialog, which should not
  // pop up again on the way back.
  useEffect(() => {
    dispatch(rememberPath(pathname));
  }, [dispatch, pathname]);

  /**
   * A section's button returns to where that section was left (the open
   * conversation, the Friends or Settings tab). Pressed again while already
   * there, it goes to the section's first page.
   */
  const goTo = (section: NavSection, root: string) =>
    navigate(sectionOf(pathname) === section ? root : lastPaths[section]);

  // The logout button sits at the bottom of the rail, right where a stray
  // click lands; it used to sign out on the spot and drop unsent drafts.
  const [confirmLogout, setConfirmLogout] = useState(false);
  const handleLogout = () => {
    setConfirmLogout(false);
    dispatch(logoutAPI());
    navigate("/auth");
  };

  const navItems = [
    {
      label: "Trò chuyện",
      icon: MessageSquare,
      onClick: () => goTo("chat", "/"),
      active: pathname === "/" || pathname.startsWith("/chat"),
    },
    {
      label: "Bạn bè",
      icon: Users,
      onClick: () => goTo("friends", "/friends"),
      // Suggestions live in the Friends screen as one of its tabs.
      active:
        pathname === "/friends" ||
        pathname === "/groups" ||
        pathname === "/friend_requests" ||
        pathname === "/recommendations",
    },
    {
      label: "Cài đặt",
      icon: Settings,
      onClick: () => goTo("settings", "/settings"),
      active: pathname.startsWith("/settings"),
    },
  ];

  const { rootRef, gooRef, blobRefs } = useGooeyHighlight(
    navItems.findIndex((item) => item.active),
    { id: "left-nav-goo" },
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
          "md:h-full md:w-19 md:flex-col md:justify-start md:gap-2 md:border-r md:border-t-0 md:px-0 md:py-4 md:pb-4",
        )}
      >
        <div className="hidden md:mb-1 md:flex md:flex-col md:items-center md:gap-4">
          <span
            aria-hidden="true"
            className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground"
          >
            <BrandMark className="size-5.5" />
          </span>
          <ProfileSetting />
        </div>

        <div
          ref={rootRef}
          className="group/rail relative flex flex-1 flex-row items-center justify-around gap-1 md:flex-none md:flex-col md:justify-start md:gap-1.5"
        >
          <GooeyHighlight
            id="left-nav-goo"
            gooRef={gooRef}
            blobRefs={blobRefs}
            blobClassName="rounded-full bg-primary transition-colors duration-(--motion-fast) group-has-[[aria-current=page]:hover]/rail:bg-primary-hover"
          />
          <div className="md:hidden">
            <ProfileSetting />
          </div>

          {navItems.map(({ label, icon: Icon, onClick, active }) => (
            <Tooltip key={label}>
              <TooltipTrigger asChild>
                <Button
                  data-gooey-tab=""
                  variant="ghost"
                  size="icon"
                  aria-label={label}
                  aria-current={active ? "page" : undefined}
                  onClick={onClick}
                  className={cn(
                    "relative size-11 rounded-full text-muted-foreground",
                    // Icon nudges up on hover; the button itself keeps still.
                    "[&_svg]:transition-transform [&_svg]:duration-(--motion-base) [&_svg]:ease-spring hover:[&_svg]:scale-110",
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

        {/* Sign-out sits alone at the foot of the rail, away from the
            screens above it. */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Đăng xuất"
              onClick={() => setConfirmLogout(true)}
              className="size-11 rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive-text md:mt-auto"
            >
              <LogOut className="size-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right" className="hidden md:block">
            Đăng xuất
          </TooltipContent>
        </Tooltip>
      </nav>

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
