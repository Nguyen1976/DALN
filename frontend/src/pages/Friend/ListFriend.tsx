import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  AvatarWithPresence,
} from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SearchField } from "@/components/ui/search-field";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  AtSign,
  Mail,
  MessageCircle,
  SearchX,
  UserRound,
  Users,
  X,
  AnimateIcon,
} from "@/components/icons";
import {
  getConversationByFriendIdAPI,
  searchUsersAPI,
  type SearchFriendItem,
} from "@/apis";
import {
  addConversation,
  selectConversation,
  type Conversation,
} from "@/redux/slices/conversationSlice";
import {
  FRIENDS_PAGE_SIZE,
  fetchFriendProfile,
  getMoreFriends,
  selectFriend,
  selectFriendHasMore,
  selectFriendProfile,
  selectFriendProfileStatus,
  selectSelectedFriendId,
  setSelectedFriend,
  type Friend,
} from "@/redux/slices/friendSlice";
import type { AppDispatch, RootState } from "@/redux/store";
import { selectUser } from "@/redux/slices/userSlice";
import { useEffect, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router";
import { formatLastSeen } from "@/utils";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { showErrorToast } from "@/utils/toastError";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { useListMotion } from "@/hooks/useListMotion";
import { InfiniteListFooter } from "@/components/ui/infinite-list-footer";

/** Placeholder rows shaped like a friend row, while a page loads. */
function FriendRowsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-1">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="flex items-center gap-3 p-3">
          <Skeleton className="size-12 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

const ListFriend = () => {
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const friends = useSelector(selectFriend);
  const user = useSelector(selectUser);
  const conversations = useSelector(selectConversation);
  // Who is open in the detail panel, and their profile, come from redux: the
  // choice survives a trip to another tab, and a profile fetched once is not
  // fetched again. Nobody is selected until the person picks someone.
  const selectedFriendId = useSelector(selectSelectedFriendId);
  const selectedProfile = useSelector((state: RootState) =>
    selectFriendProfile(state, selectedFriendId),
  );
  const profileStatus = useSelector((state: RootState) =>
    selectFriendProfileStatus(state, selectedFriendId),
  );
  const isLoadingProfile =
    Boolean(selectedFriendId) && !selectedProfile && profileStatus !== "error";
  // The detail animates in when a friend is picked, not when the tab is
  // simply shown again with the same friend.
  const [shownOnArrival] = useState(selectedFriendId);
  const [isStartingChat, setIsStartingChat] = useState(false);
  const [keyword, setKeyword] = useState("");
  const debouncedKeyword = useDebouncedValue(keyword);
  const [searchResults, setSearchResults] = useState<SearchFriendItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);

  useEffect(() => {
    if (!debouncedKeyword) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    let cancelled = false;

    const runSearch = async () => {
      try {
        setIsSearching(true);
        const results = await searchUsersAPI(debouncedKeyword);
        if (cancelled) return;
        setSearchResults(results);
      } catch (error) {
        if (!cancelled) {
          showErrorToast(error, "Không thể tìm kiếm bạn bè");
        }
      } finally {
        if (!cancelled) setIsSearching(false);
      }
    };

    void runSearch();

    return () => {
      cancelled = true;
    };
  }, [debouncedKeyword]);

  // Pages load as the list scrolls; the first one too, when nothing is
  // loaded yet. Searching shows server results, so paging pauses meanwhile.
  const hasMore = useSelector(selectFriendHasMore);
  const paging = useInfiniteScroll({
    hasMore,
    enabled: !debouncedKeyword,
    loadMore: () => dispatch(getMoreFriends()).unwrap(),
  });

  const displayedFriends = debouncedKeyword
    ? (searchResults as Friend[])
    : friends;

  /** Open a friend; their profile is fetched only the first time. */
  const handleSelectFriend = (friend: Friend) => {
    dispatch(setSelectedFriend(friend.id));
    void dispatch(fetchFriendProfile(friend.id));
  };

  // Rows fade in the first time they show this session, not on every visit.
  const listRef = useRef<HTMLDivElement>(null);
  useListMotion(listRef, { id: "friends" });

  const handleChatWithFriend = async () => {
    if (!selectedFriendId || !user?.id) return;

    const existingConversation = conversations.find(
      (conversation) =>
        conversation.type === "DIRECT" &&
        conversation.members?.some(
          (member) => member.userId === selectedFriendId,
        ),
    );

    if (existingConversation) {
      navigate(`/chat/${existingConversation.id}`);
      return;
    }

    try {
      setIsStartingChat(true);
      const response = await getConversationByFriendIdAPI(selectedFriendId);
      const conversation = response.conversation as Conversation;

      dispatch(addConversation({ conversation }));

      navigate(`/chat/${conversation.id}`, {
        state: { conversation },
      });
    } catch (error) {
      showErrorToast(error, "Không thể mở cuộc trò chuyện");
    } finally {
      setIsStartingChat(false);
    }
  };

  const selectedFriend =
    friends.find((friend) => friend.id === selectedFriendId) ??
    (searchResults as Friend[]).find(
      (friend) => friend.id === selectedFriendId,
    );

  const renderProfileDetail = () => {
    if (!selectedFriendId) {
      return (
        <EmptyState
          icon={UserRound}
          title="Chưa chọn ai"
          description="Chọn một người bạn ở danh sách bên trái để xem thông tin."
          compact
        />
      );
    }

    if (profileStatus === "error" && !selectedProfile) {
      return (
        <EmptyState
          icon={UserRound}
          title="Không tải được thông tin"
          description="Kiểm tra kết nối rồi thử lại."
          compact
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                // Drop the failed attempt so the thunk may run again.
                if (selectedFriendId) {
                  void dispatch(fetchFriendProfile(selectedFriendId));
                }
              }}
            >
              Thử lại
            </Button>
          }
        />
      );
    }

    if (isLoadingProfile) {
      return (
        <div className="flex flex-col items-center gap-3">
          <Skeleton className="size-24 rounded-full" />
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="mt-2 h-12 w-full rounded-lg" />
        </div>
      );
    }

    const isOnline = Boolean(selectedFriend?.status);

    return (
      // Keyed on the friend: picking someone else replays the entrance.
      <div
        key={selectedFriendId}
        className={cn(
          "space-y-6",
          selectedFriendId !== shownOnArrival && "animate-stagger-in",
        )}
      >
        <div className="flex flex-col items-center gap-3 text-center">
          <AvatarWithPresence
            status={isOnline ? "online" : "offline"}
            dotSize="lg"
          >
            <Avatar className="size-24 border border-border">
              <AvatarImage
                src={selectedProfile?.avatar || ""}
                alt={`Ảnh đại diện ${selectedProfile?.username || "người dùng"}`}
              />
              <AvatarFallback className="text-2xl">
                {(selectedProfile?.username || "U")[0]}
              </AvatarFallback>
            </Avatar>
          </AvatarWithPresence>

          <div className="space-y-1">
            <p className="text-lg font-semibold tracking-[-0.01em] text-foreground">
              {selectedProfile?.fullName || selectedProfile?.username}
            </p>
            <Badge variant={isOnline ? "success" : "secondary"}>
              {isOnline
                ? "Đang hoạt động"
                : selectedFriend?.lastSeen
                  ? formatLastSeen(selectedFriend.lastSeen)
                  : "Ngoại tuyến"}
            </Badge>
          </div>

          <p className="text-sm leading-relaxed text-muted-foreground">
            {selectedProfile?.bio || "Chưa có giới thiệu."}
          </p>
        </div>

        {/* Contact facts as labelled rows rather than a stack of grey lines. */}
        <dl className="space-y-2 rounded-xl border border-border bg-card p-3">
          <div className="flex items-center gap-2.5">
            <dt className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <AtSign className="size-4" aria-hidden="true" />
              <span className="sr-only">Tên người dùng</span>
            </dt>
            <dd className="min-w-0 truncate text-sm text-foreground">
              {selectedProfile?.username}
            </dd>
          </div>
          <div className="flex items-center gap-2.5">
            <dt className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <Mail className="size-4" aria-hidden="true" />
              <span className="sr-only">Email</span>
            </dt>
            <dd className="min-w-0 truncate text-sm text-foreground">
              {selectedProfile?.email}
            </dd>
          </div>
        </dl>

        <Button
          size="lg"
          className="w-full"
          onClick={() => void handleChatWithFriend()}
          disabled={isStartingChat}
        >
          <MessageCircle className="size-5" aria-hidden="true" />
          {isStartingChat ? "Đang mở cuộc trò chuyện..." : "Nhắn tin"}
        </Button>
      </div>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-1 lg:flex-row">
      <div className="flex h-full min-h-0 flex-1 flex-col border-border lg:border-r">
        <div className="border-b border-border p-4">
          <SearchField
            value={keyword}
            onValueChange={setKeyword}
            placeholder="Tìm bạn theo tên hoặc username"
            label="Tìm bạn bè"
          />
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div
            ref={listRef}
            className="relative space-y-1 p-3"
            aria-busy={paging.status === "loading"}
          >
            {displayedFriends.map((friend: Friend) => (
              <AnimateIcon key={friend.id} asChild animateOnHover>
                <button
                  data-motion-key={friend.id}
                  onClick={() => {
                    handleSelectFriend(friend);
                    setMobileDetailOpen(true);
                  }}
                  aria-current={
                    selectedFriendId === friend.id ? "true" : undefined
                  }
                  className={cn(
                    "group flex w-full items-center gap-3 rounded-xl p-2.5 text-left",
                    "transition-colors duration-(--motion-fast) hover:bg-accent",
                    "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
                    selectedFriendId === friend.id && "bg-accent",
                  )}
                >
                  <AvatarWithPresence
                    status={friend.status ? "online" : "offline"}
                  >
                    <Avatar className="size-12">
                      <AvatarImage
                        src={friend.avatar || ""}
                        alt={`Ảnh đại diện ${friend.username}`}
                      />
                      <AvatarFallback>{friend.username[0]}</AvatarFallback>
                    </Avatar>
                  </AvatarWithPresence>

                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-foreground">
                      {friend.fullName || friend.username}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {friend.status
                        ? "Đang hoạt động"
                        : formatLastSeen(friend.lastSeen)}
                    </p>
                  </div>

                  <MessageCircle
                    className="size-4 shrink-0 -translate-x-1 text-muted-foreground opacity-0 transition-[opacity,translate] duration-(--motion-base) ease-(--ease-out) group-hover:translate-x-0 group-hover:opacity-100"
                    aria-hidden="true"
                  />
                </button>
              </AnimateIcon>
            ))}

            {isSearching && <FriendRowsSkeleton />}

            {displayedFriends.length === 0 &&
              !isSearching &&
              (debouncedKeyword || !hasMore) && (
                <EmptyState
                  icon={debouncedKeyword ? SearchX : Users}
                  title={
                    debouncedKeyword
                      ? "Không tìm thấy ai phù hợp"
                      : "Chưa có bạn bè nào"
                  }
                  description={
                    debouncedKeyword
                      ? `Không có kết quả cho “${debouncedKeyword}”.`
                      : "Hãy xem mục Gợi ý kết bạn để tìm những người có thể bạn quen."
                  }
                  compact
                />
              )}

            {!debouncedKeyword && (
              <InfiniteListFooter
                sentinelRef={paging.sentinelRef}
                status={paging.status}
                hasMore={hasMore}
                onRetry={paging.retry}
                loading={<FriendRowsSkeleton count={friends.length ? 3 : 6} />}
                endLabel={
                  friends.length > FRIENDS_PAGE_SIZE
                    ? `Đã hiển thị tất cả ${friends.length} bạn bè`
                    : undefined
                }
              />
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Backdrop for mobile detail sheet */}
      {mobileDetailOpen && (
        <div
          className="fixed inset-0 z-30 animate-overlay-in bg-scrim backdrop-blur-[2px] lg:hidden"
          onClick={() => setMobileDetailOpen(false)}
        />
      )}

      <div
        className={cn(
          "fixed inset-x-0 bottom-0 z-40 flex max-h-[85dvh] flex-col overflow-y-auto rounded-t-2xl border-t border-border bg-background p-6 shadow-2xl transition-transform duration-(--motion-slow) ease-(--ease-out)",
          mobileDetailOpen ? "translate-y-0" : "translate-y-full",
          "lg:static lg:z-auto lg:max-h-none lg:w-[22rem] lg:translate-y-0 lg:justify-start lg:rounded-none lg:border-l lg:border-t-0 lg:pt-8 lg:shadow-none",
        )}
      >
        <div className="mb-4 flex items-center justify-end lg:hidden">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Đóng"
            onClick={() => setMobileDetailOpen(false)}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="size-5" />
          </Button>
        </div>
        {renderProfileDetail()}
      </div>
    </div>
  );
};

export default ListFriend;
