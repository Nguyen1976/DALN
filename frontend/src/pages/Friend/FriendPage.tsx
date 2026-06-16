import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import MainLayout from "@/layouts/MainLayout";
import { useLocation, useNavigate } from "react-router";

const tabs = [
  { path: "/friends", label: "Bạn bè" },
  { path: "/groups", label: "Nhóm & cộng đồng" },
  { path: "/friend_requests", label: "Lời mời kết bạn" },
];

export function FriendsPage({ children }: { children?: React.ReactNode }) {
  const location = useLocation();
  const params = location.pathname;

  const titleMap: Record<string, string> = {
    "/friends": "Danh sách bạn bè",
    "/groups": "Danh sách nhóm và cộng đồng",
    "/friend_requests": "Lời mời kết bạn",
  };

  const navigate = useNavigate();

  return (
    <MainLayout>
      <div className="flex min-h-0 flex-1 flex-col bg-background">
        <div className="border-b border-border px-4 py-3 sm:px-6">
          <h2 className="text-lg font-semibold text-foreground sm:text-xl">
            {titleMap[params] || "Danh sách bạn bè"}
          </h2>

          <div className="custom-scrollbar mt-3 flex gap-1 overflow-x-auto rounded-xl bg-muted/60 p-1">
            {tabs.map((tab) => {
              const active = params === tab.path;
              return (
                <Button
                  key={tab.path}
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate(tab.path)}
                  className={cn(
                    "shrink-0 rounded-lg text-muted-foreground hover:bg-transparent hover:text-foreground",
                    active &&
                      "bg-background text-foreground shadow-sm hover:bg-background hover:text-foreground",
                  )}
                >
                  {tab.label}
                </Button>
              );
            })}
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </div>
    </MainLayout>
  );
}
