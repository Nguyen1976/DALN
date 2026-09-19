import { useLocation } from "react-router";
import { useState } from "react";
import {
  Sparkles,
  SquarePen,
  UserPlus,
  Users,
  Users2,
} from "@/components/icons";
import { useSelector } from "react-redux";
import { selectFriend, selectFriendHasMore } from "@/redux/slices/friendSlice";
import { Button } from "@/components/ui/button";
import { MakeFriendModal } from "@/components/MakeFriendModal";
import { NewChatModal } from "@/components/NewChatModal";
import { TabbedLayout } from "@/layouts/TabbedLayout";

const TABS = [
  { path: "/friends", label: "Bạn bè", icon: Users },
  { path: "/groups", label: "Nhóm & cộng đồng", icon: Users2 },
  { path: "/friend_requests", label: "Lời mời kết bạn", icon: UserPlus },
  { path: "/recommendations", label: "Gợi ý kết bạn", icon: Sparkles },
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
  "/recommendations": {
    title: "Gợi ý kết bạn",
    description:
      "Những người có thể bạn quen, dựa trên bạn chung, nhóm và sở thích.",
  },
};

export function FriendsPage({ children }: { children?: React.ReactNode }) {
  const params = useLocation().pathname;
  const friends = useSelector(selectFriend);
  // The list pages in as it scrolls, so until the last page the count is
  // only how many are loaded: "20+", not a total.
  const allFriendsLoaded = !useSelector(selectFriendHasMore);

  const meta = TITLES[params] || TITLES["/friends"];
  // One primary action per section: grow the friend list, or start a group.
  const [dialog, setDialog] = useState<"friend" | "group" | null>(null);
  const onGroups = params === "/groups";

  return (
    <TabbedLayout
      title={
        <>
          {meta.title}
          {params === "/friends" && friends.length > 0 && (
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {friends.length}
              {!allFriendsLoaded && "+"}
            </span>
          )}
        </>
      }
      description={meta.description}
      tabs={TABS}
      tabsLabel="Mục bạn bè"
      actions={
        <Button
          className="shrink-0"
          aria-label={onGroups ? "Tạo nhóm" : "Thêm bạn"}
          onClick={() => setDialog(onGroups ? "group" : "friend")}
        >
          {onGroups ? (
            <SquarePen aria-hidden="true" />
          ) : (
            <UserPlus aria-hidden="true" />
          )}
          {/* Icon-only on phones, where the header is narrow. */}
          <span className="hidden sm:inline">
            {onGroups ? "Tạo nhóm" : "Thêm bạn"}
          </span>
        </Button>
      }
    >
      {dialog === "friend" && (
        <MakeFriendModal onClose={() => setDialog(null)} />
      )}
      {dialog === "group" && <NewChatModal onClose={() => setDialog(null)} />}
      {children}
    </TabbedLayout>
  );
}
