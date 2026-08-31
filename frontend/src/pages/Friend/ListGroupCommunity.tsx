import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SearchField } from "@/components/ui/search-field";
import { Skeleton } from "@/components/ui/skeleton";
import { searchConversationsAPI, type SearchConversationItem } from "@/apis";
import {
  applyConversationUpdate,
  getConversations,
  selectConversation,
  type Conversation,
} from "@/redux/slices/conversationSlice";
import type { AppDispatch } from "@/redux/store";
import { ChevronRight, SearchX, UsersRound } from "lucide-react";
import { EmptyState } from "@/components/ui/feedback";
import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router";
import { showErrorToast } from "@/utils/toastError";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

const ListGroupCommunity = () => {
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const conversations = useSelector(selectConversation);
  const [keyword, setKeyword] = useState("");
  const debouncedKeyword = useDebouncedValue(keyword);
  const [searchResults, setSearchResults] = useState<SearchConversationItem[]>(
    [],
  );
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    if (conversations.length === 0) {
      dispatch(getConversations({ limit: 20, cursor: null }));
    }
  }, [dispatch, conversations.length]);

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
        setSearchResults(
          results.filter((conversation) => conversation.type !== "DIRECT"),
        );
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

  const loadMoreGroups = () => {
    const last = conversations[conversations.length - 1];
    const cursor = last?.lastMessageAt ? `${last.lastMessageAt}|${last.id}` : null;

    dispatch(getConversations({ limit: 20, cursor }));
  };

  const openConversation = (
    conversation: Conversation | SearchConversationItem,
  ) => {
    const existing = conversations.find((item) => item.id === conversation.id);

    if (existing) {
      navigate(`/chat/${existing.id}`);
      return;
    }

    dispatch(
      applyConversationUpdate({
        conversation: conversation as Conversation,
      }),
    );

    navigate(`/chat/${conversation.id}`, {
      state: { conversation },
    });
  };

  const renderGroupItem = (group: Conversation | SearchConversationItem) => {
    const memberCount = group.memberCount ?? group.members?.length ?? 0;

    return (
      <button
        key={group.id}
        onClick={() => openConversation(group)}
        className="group flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition-colors duration-[--motion-fast] hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
      >
        <div className="relative shrink-0">
          <Avatar className="size-12">
            <AvatarImage
              src={(group.groupAvatar as string) || group.displayAvatar || ""}
              alt={`Ảnh đại diện nhóm ${group.displayName || ""}`}
            />
            <AvatarFallback>{(group.displayName || "G")[0]}</AvatarFallback>
          </Avatar>
          <span className="absolute -bottom-0.5 -right-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-secondary px-1 text-[10px] font-semibold tabular-nums text-secondary-foreground ring-2 ring-background">
            {memberCount > 99 ? "99+" : memberCount}
            <span className="sr-only"> thành viên</span>
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-foreground">
            {group.displayName || "Nhóm chưa đặt tên"}
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
    <div className="h-full min-h-0 flex-1">
      <div className="border-b border-border p-4">
        <SearchField
          value={keyword}
          onValueChange={setKeyword}
          placeholder="Tìm nhóm hoặc cộng đồng"
        />
      </div>

      <ScrollArea className="h-full">
        <div className="space-y-1 p-3">
          {displayedGroups.map(renderGroupItem)}

          {isSearching && (
            <div className="space-y-1">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="flex items-center gap-3 p-3">
                  <Skeleton className="size-12 shrink-0 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3.5 w-1/2" />
                    <Skeleton className="h-3 w-1/4" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {displayedGroups.length === 0 && !isSearching && (
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

          {!debouncedKeyword && displayedGroups.length > 0 && (
            <div className="my-3 flex items-center justify-center">
              <Button
                variant="outline"
                size="sm"
                className="interceptor-loading"
                onClick={loadMoreGroups}
              >
                Tải thêm
              </Button>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};

export default ListGroupCommunity;
