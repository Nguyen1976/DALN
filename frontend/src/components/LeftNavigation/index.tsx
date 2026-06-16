import { Users, MessageSquare, LogOut, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import ProfileSetting from "../ChatSidebar/ProfileSetting";
import { useLocation, useNavigate } from "react-router";
import type { AppDispatch } from "@/redux/store";
import { useDispatch } from "react-redux";
import { logoutAPI } from "@/redux/slices/userSlice";

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
    <nav
      aria-label="Điều hướng chính"
      className={cn(
        "z-30 flex w-full shrink-0 flex-row items-center justify-around gap-1 border-t border-sidebar-border bg-sidebar px-2 py-1.5",
        "md:h-full md:w-[76px] md:flex-col md:justify-start md:gap-3 md:border-t-0 md:border-r md:px-0 md:py-4",
      )}
    >
      <div className="hidden md:block">
        <ProfileSetting />
      </div>

      <div className="flex flex-1 flex-row items-center justify-around gap-1 md:flex-none md:flex-col md:justify-start md:gap-2">
        <div className="md:hidden">
          <ProfileSetting />
        </div>

        {navItems.map(({ label, icon: Icon, onClick, active }) => (
          <Button
            key={label}
            variant="ghost"
            size="icon"
            aria-label={label}
            aria-current={active ? "page" : undefined}
            title={label}
            onClick={onClick}
            className={cn(
              "size-11 rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
              active &&
                "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground",
            )}
          >
            <Icon className="size-5" />
          </Button>
        ))}
      </div>

      <Button
        variant="ghost"
        size="icon"
        aria-label="Đăng xuất"
        title="Đăng xuất"
        onClick={handleLogout}
        className="size-11 rounded-xl text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive md:mt-auto"
      >
        <LogOut className="size-5" />
      </Button>
    </nav>
  );
}
