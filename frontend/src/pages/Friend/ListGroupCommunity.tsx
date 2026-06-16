import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { searchConversationsAPI, type SearchConversationItem } from "@/apis";
import {
  applyConversationUpdate,
  getConversations,
  selectConversation,
  type Conversation,
} from "@/redux/slices/conversationSlice";
import type { AppDispatch } from "@/redux/store";
import { Search, UsersRound } from "lucide-react";
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
    const cursor =
      conversations[conversations.length - 1]?.lastMessageAt || null;

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
        className="flex w-full items-center gap-3 rounded-xl p-3 text-left transition-colors hover:bg-accent"
      >
        <Avatar className="size-12 shrink-0">
          <AvatarImage
            src={(group.groupAvatar as string) || "/placeholder.svg"}
            alt={group.groupName || "Nhóm"}
          />
          <AvatarFallback>{(group.groupName || "G")[0]}</AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-foreground">
            {group.groupName || "Nhóm chưa đặt tên"}
          </p>
          <p className="text-xs text-muted-foreground">
            {memberCount} thành viên
          </p>
        </div>
      </button>
    );
  };

  return (
    <div className="h-full min-h-0 flex-1">
      <div className="border-b border-border p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="Tìm theo tên nhóm/cộng đồng..."
            className="pl-10"
          />
        </div>
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
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <UsersRound className="size-7" />
              </div>
              <p className="text-sm text-muted-foreground">
                {debouncedKeyword
                  ? "Không tìm thấy cuộc trò chuyện phù hợp"
                  : "Chưa có nhóm hoặc cộng đồng"}
              </p>
            </div>
          )}

          {!debouncedKeyword && displayedGroups.length > 0 && (
            <div className="my-3 flex items-center justify-center">
              <Button
                variant="ghost"
                size="sm"
                className="interceptor-loading text-muted-foreground"
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
