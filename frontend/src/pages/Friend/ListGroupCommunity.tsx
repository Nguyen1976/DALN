import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { searchConversationsAPI, type SearchConversationItem } from "@/apis";
import {
  getConversations,
  selectConversation,
  type Conversation,
} from "@/redux/slices/conversationSlice";
import type { AppDispatch } from "@/redux/store";
import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router";
import { toast } from "sonner";

const ListGroupCommunity = () => {
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const conversations = useSelector(selectConversation);
  const [keyword, setKeyword] = useState("");
  const [debouncedKeyword, setDebouncedKeyword] = useState("");
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
    const timeout = setTimeout(() => {
      setDebouncedKeyword(keyword.trim());
    }, 400);

    return () => clearTimeout(timeout);
  }, [keyword]);

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
          console.log(error);
          toast.error("Không thể tìm kiếm cuộc trò chuyện");
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
        className="w-full p-3 rounded-lg flex items-center gap-3 hover:bg-accent transition-colors group"
      >
        <div className="relative w-12 h-12 shrink-0">
          <Avatar className="w-12 h-12">
            <AvatarImage
              src={(group.groupAvatar as string) || "/placeholder.svg"}
              alt={group.groupName || "Nhóm"}
            />
            <AvatarFallback>{(group.groupName || "G")[0]}</AvatarFallback>
          </Avatar>
        </div>

        <div className="flex-1 min-w-0 text-left">
          <p className="font-medium text-foreground truncate">
            {group.groupName || "Nhóm chưa đặt tên"}
          </p>
          <p className="text-xs text-muted-foreground">
            {memberCount} thành viên
          </p>
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <span className="text-xl">⋮</span>
        </Button>
      </button>
    );
  };

  return (
    <div className="h-full min-h-0 flex-1">
      <div className="p-4 border-b">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="Tìm theo tên nhóm/cộng đồng..."
            className="pl-10"
          />
        </div>
      </div>

      <ScrollArea className="h-full">
        <div className="p-6">
          <div className="space-y-2">
            {displayedGroups.map(renderGroupItem)}
          </div>

          {isSearching && (
            <div className="text-center py-6">
              <p className="text-muted-foreground">Đang tìm kiếm...</p>
            </div>
          )}

          {displayedGroups.length === 0 && !isSearching && (
            <div className="text-center py-12">
              <p className="text-muted-foreground">
                {debouncedKeyword
                  ? "Không tìm thấy cuộc trò chuyện phù hợp"
                  : "Chưa có nhóm hoặc cộng đồng"}
              </p>
            </div>
          )}

          {!debouncedKeyword && (
            <div className="w-full flex items-center justify-center my-4">
              <Button className="interceptor-loading" onClick={loadMoreGroups}>
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
