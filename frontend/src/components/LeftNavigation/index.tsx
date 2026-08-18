import { Users, MessageSquare, LogOut, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
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

export function LeftNavigation() {
  const navigate = useNavigate();
  const pathname = useLocation().pathname;

  const dispatch = useDispatch<AppDispatch>();
  const handleLogout = () => {
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

        <div className="flex flex-1 flex-row items-center justify-around gap-1 md:flex-none md:flex-col md:justify-start md:gap-1.5">
          <div className="md:hidden">
            <ProfileSetting />
          </div>

          {navItems.map(({ label, icon: Icon, onClick, active }) => (
            <Tooltip key={label}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={label}
                  aria-current={active ? "page" : undefined}
                  onClick={onClick}
                  className={cn(
                    "relative size-11 rounded-xl text-muted-foreground",
                    "hover:bg-accent hover:text-accent-foreground",
                    active &&
                      "bg-primary text-primary-foreground hover:bg-primary-hover hover:text-primary-foreground",
                  )}
                >
                  <Icon className="size-5" />
                  {/* Second, non-colour cue for the active tab. */}
                  {active && (
                    <span
                      aria-hidden="true"
                      className="absolute -bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-primary md:hidden"
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

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Đăng xuất"
              onClick={handleLogout}
              className="size-11 rounded-xl text-muted-foreground hover:bg-destructive/10 hover:text-destructive-text md:mt-auto"
            >
              <LogOut className="size-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right" className="hidden md:block">
            Đăng xuất
          </TooltipContent>
        </Tooltip>
      </nav>
    </TooltipProvider>
  );
}
