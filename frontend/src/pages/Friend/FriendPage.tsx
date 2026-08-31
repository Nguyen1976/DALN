import { cn } from "@/lib/utils";
import MainLayout from "@/layouts/MainLayout";
import { useLocation, useNavigate } from "react-router";
import { UserPlus, Users, Users2 } from "lucide-react";
import { useSelector } from "react-redux";
import { selectFriend } from "@/redux/slices/friendSlice";

const TABS = [
  { path: "/friends", label: "Bạn bè", icon: Users },
  { path: "/groups", label: "Nhóm & cộng đồng", icon: Users2 },
  { path: "/friend_requests", label: "Lời mời kết bạn", icon: UserPlus },
];

const TITLES: Record<string, { title: string; description: string }> = {
  "/friends": {
    title: "Bạn bè",
    description: "Những người bạn đã kết nối trên DALN Chat.",
  },
  "/groups": {
    title: "Nhóm & cộng đồng",
    description: "Các nhóm bạn đang tham gia.",
  },
  "/friend_requests": {
    title: "Lời mời kết bạn",
    description: "Lời mời bạn đã nhận và lời mời bạn đã gửi.",
  },
};

export function FriendsPage({ children }: { children?: React.ReactNode }) {
  const location = useLocation();
  const params = location.pathname;
  const navigate = useNavigate();
  const friends = useSelector(selectFriend);

  const meta = TITLES[params] || TITLES["/friends"];

  return (
    <MainLayout>
      <div className="flex min-h-0 flex-1 flex-col bg-background">
        <div className="shrink-0 space-y-4 border-b border-border px-4 pb-0 pt-4 md:px-6">
          <div className="space-y-1">
            <h1 className="text-lg font-semibold tracking-[-0.01em] text-foreground md:text-xl">
              {meta.title}
              {params === "/friends" && friends.length > 0 && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  {friends.length}
                </span>
              )}
            </h1>
            <p className="text-sm text-muted-foreground">{meta.description}</p>
          </div>

          {/* Underline tabs: the active section is marked by an indicator bar,
              not by colour alone. */}
          <div
            role="tablist"
            aria-label="Mục bạn bè"
            className="custom-scrollbar -mb-px flex gap-1 overflow-x-auto"
          >
            {TABS.map(({ path, label, icon: Icon }) => {
              const active = params === path;
              return (
                <button
                  key={path}
                  role="tab"
                  aria-selected={active}
                  onClick={() => navigate(path)}
                  className={cn(
                    "flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium",
                    "transition-colors duration-[--motion-fast]",
                    "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
                    active
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="size-4" aria-hidden="true" />
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </div>
    </MainLayout>
  );
}
