import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SearchField } from "@/components/ui/search-field";
import { Skeleton } from "@/components/ui/skeleton";
import { searchConversationsAPI } from "@/apis";
import {
  applyConversationUpdate,
  getConversations,
  selectConversation,
  type Conversation,
} from "@/redux/slices/conversationSlice";
import type { AppDispatch } from "@/redux/store";
import { ChevronRight, SearchX, UsersRound } from "@/components/icons";
import { EmptyState } from "@/components/ui/feedback";
import { useEffect, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router";
import { showErrorToast } from "@/utils/toastError";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import {
  selectConversationsHasMore,
  selectConversationsNextCursor,
} from "@/redux/slices/conversationPagingSlice";
import { useListMotion } from "@/hooks/useListMotion";
import { InfiniteListFooter } from "@/components/ui/infinite-list-footer";

/** Groups load in pages of this size; each page staggers from the top. */
const GROUPS_PAGE_SIZE = 20;

/** Placeholder rows shaped like a group row, while a page loads. */
function GroupRowsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-1">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="flex items-center gap-3 p-3">
          <Skeleton className="size-12 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-1/2" />
            <Skeleton className="h-3 w-1/4" />
          </div>
        </div>
      ))}
    </div>
  );
}

const ListGroupCommunity = () => {
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const conversations = useSelector(selectConversation);
  const [keyword, setKeyword] = useState("");
  const debouncedKeyword = useDebouncedValue(keyword);
  const [searchResults, setSearchResults] = useState<Conversation[]>(
    [],
  );
  const [isSearching, setIsSearching] = useState(false);

  // The server pages every conversation, direct chats included; this tab
  // keeps only groups. While the groups found so far leave the end of the
  // list in view, the next page is fetched on its own, so someone with many
  // direct chats still sees their groups without scrolling through nothing.
  // Shared with the chat sidebar through redux, so neither starts over.
  const hasMore = useSelector(selectConversationsHasMore);
  const nextCursor = useSelector(selectConversationsNextCursor);
  const paging = useInfiniteScroll({
    hasMore,
    enabled: !debouncedKeyword,
    itemCount: conversations.length,
    loadMore: () =>
      dispatch(
        getConversations({ limit: GROUPS_PAGE_SIZE, cursor: nextCursor }),
      ).unwrap(),
  });

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
        const results = await searchConversationsAPI(debouncedKeyword);
        if (cancelled) return;
        setSearchResults(results);
      } catch (error) {
        if (!cancelled) {
          showErrorToast(error, "Không thể tìm kiếm cuộc trò chuyện");
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

  const groups = conversations.filter(
    (conversation) => conversation.type !== "DIRECT",
  );

  const displayedGroups = debouncedKeyword ? searchResults : groups;

  /** A search hit may not be loaded yet: it goes into the store first. */
  const openConversation = (conversation: Conversation) => {
    if (!conversations.some((item) => item.id === conversation.id)) {
      dispatch(applyConversationUpdate({ conversation }));
    }
    navigate(`/chat/${conversation.id}`);
  };

  // Groups reorder as they get messages; see useListMotion.
  const listRef = useRef<HTMLDivElement>(null);
  useListMotion(listRef, { id: "groups" });

  const renderGroupItem = (group: Conversation) => {
    const { memberCount } = group;

    return (
      <button
        key={group.id}
        onClick={() => openConversation(group)}
        data-motion-key={group.id}
        className="group flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition-colors duration-(--motion-fast) hover:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
      >
        <div className="relative shrink-0">
          <Avatar className="size-12">
            <AvatarImage
              src={group.displayAvatar}
              alt={`Ảnh đại diện nhóm ${group.displayName}`}
            />
            <AvatarFallback>{group.displayName[0]}</AvatarFallback>
          </Avatar>
          <span className="absolute -bottom-0.5 -right-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-secondary px-1 text-[10px] font-semibold tabular-nums text-secondary-foreground ring-2 ring-background">
            {memberCount > 99 ? "99+" : memberCount}
            <span className="sr-only"> thành viên</span>
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-foreground">
            {group.displayName}
          </p>
          <p className="text-xs text-muted-foreground">
            {memberCount} thành viên
          </p>
        </div>

        <ChevronRight
          className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
          aria-hidden="true"
        />
      </button>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="border-b border-border p-4">
        <SearchField
          value={keyword}
          onValueChange={setKeyword}
          placeholder="Tìm nhóm hoặc cộng đồng"
        />
      </div>

      {/* flex-1, not h-full: h-full made the list as tall as the whole tab,
          pushing its last rows (now the loading footer) below the fold. */}
      <ScrollArea className="min-h-0 flex-1">
        <div
          ref={listRef}
          className="relative space-y-1 p-3"
          aria-busy={paging.status === "loading"}
        >
          {displayedGroups.map(renderGroupItem)}

          {isSearching && <GroupRowsSkeleton />}

          {/* "No groups" is only true once every conversation was checked. */}
          {displayedGroups.length === 0 &&
            !isSearching &&
            (debouncedKeyword || !hasMore) && (
              <EmptyState
                icon={debouncedKeyword ? SearchX : UsersRound}
                title={
                  debouncedKeyword
                    ? "Không tìm thấy nhóm nào"
                    : "Chưa tham gia nhóm nào"
                }
                description={
                  debouncedKeyword
                    ? `Không có nhóm nào khớp với “${debouncedKeyword}”.`
                    : "Tạo nhóm mới từ menu ở màn hình trò chuyện để bắt đầu."
                }
              />
            )}

          {!debouncedKeyword && (
            <InfiniteListFooter
              sentinelRef={paging.sentinelRef}
              status={paging.status}
              hasMore={hasMore}
              onRetry={paging.retry}
              loading={<GroupRowsSkeleton count={groups.length ? 3 : 6} />}
              endLabel={
                groups.length > GROUPS_PAGE_SIZE
                  ? `Đã hiển thị tất cả ${groups.length} nhóm`
                  : undefined
              }
            />
          )}
        </div>
      </ScrollArea>
    </div>
  );
};

export default ListGroupCommunity;
