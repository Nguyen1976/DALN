import { Users, MessageSquare, LogOut, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import ProfileSetting from "../ChatSidebar/ProfileSetting";
import { useLocation, useNavigate } from "react-router";
import { useEffect } from "react";
import type { AppDispatch } from "@/redux/store";
import { useDispatch } from "react-redux";
import { logoutAPI } from "@/redux/slices/userSlice";

export function LeftNavigation() {
  const navigate = useNavigate();
  const pathname = useLocation().pathname;
  useEffect(() => {
    console.log(pathname);
  }, [pathname]);

  const dispatch = useDispatch<AppDispatch>();
  const handleLogout = () => {
    dispatch(logoutAPI());
    navigate("/auth");
  };
  return (
    <div className="w-20 bg-black-bland border-r flex flex-col items-center py-4 gap-4">
      {/* User Avatar at top */}
      <ProfileSetting />

      {/* Navigation Icons */}
      <div className="flex flex-col gap-4 flex-1">
        {/* Chat Tab */}
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "w-12 h-12 rounded-lg transition-colors",
            (pathname === "/" || pathname.startsWith("/chat")) &&
              "bg-primary text-primary-foreground",
          )}
          title="Trò chuyện"
          onClick={() => navigate("/")}
        >
          <MessageSquare className="w-6 h-6" />
        </Button>

        {/* Friends Tab */}
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "w-12 h-12 rounded-lg transition-colors",
            (pathname === "/friends" ||
              pathname === "/groups" ||
              pathname === "/friend_requests") &&
              "bg-primary text-primary-foreground",
          )}
          title="Bạn bè"
          onClick={() => navigate("/friends")}
        >
          <Users className="w-6 h-6" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "w-12 h-12 rounded-lg transition-colors",
            pathname === "/recommendations" &&
              "bg-primary text-primary-foreground",
          )}
          title="Gợi ý bạn bè"
          onClick={() => navigate("/recommendations")}
        >
          <Sparkles className="w-6 h-6" />
        </Button>

        {/* Other Navigation Items */}
        {/* <Button
          variant='ghost'
          size='icon'
          className='w-12 h-12 rounded-lg text-muted-foreground hover:text-foreground transition-colors'
          title='Notifications'
        >
          <Bell className='w-6 h-6' />
        </Button> */}

        {/* <Button
          variant='ghost'
          size='icon'
          className='w-12 h-12 rounded-lg text-muted-foreground hover:text-foreground transition-colors'
          title='Settings'
        >
          <Settings className='w-6 h-6' />
        </Button> */}
      </div>

      {/* Logout at bottom */}
      <Button
        variant="ghost"
        size="icon"
        className="w-12 h-12 rounded-lg text-muted-foreground hover:text-destructive transition-colors"
        title="Đăng xuất"
        onClick={handleLogout}
      >
        <LogOut className="w-6 h-6" />
      </Button>
    </div>
  );
}
