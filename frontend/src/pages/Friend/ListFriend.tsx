import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { MessageCircle, X } from "lucide-react";
import {
  getConversationByFriendIdAPI,
  searchUsersAPI,
  type SearchFriendItem,
  getUserProfileByIdAPI,
  type UserProfileByIdResponse,
} from "@/apis";
import {
  addConversation,
  selectConversation,
  type Conversation,
} from "@/redux/slices/conversationSlice";
import {
  getFriends,
  selectFriend,
  selectFriendPage,
  type Friend,
} from "@/redux/slices/friendSlice";
import type { AppDispatch } from "@/redux/store";
import { selectUser } from "@/redux/slices/userSlice";
import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router";
import { formatLastSeen } from "@/utils";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { showErrorToast } from "@/utils/toastError";

const ListFriend = () => {
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const friends = useSelector(selectFriend);
  const user = useSelector(selectUser);
  const conversations = useSelector(selectConversation);
  const [selectedFriendId, setSelectedFriendId] = useState<string | null>(null);
  const [selectedProfile, setSelectedProfile] =
    useState<UserProfileByIdResponse | null>(null);
  const [isLoadingProfile, setIsLoadingProfile] = useState(false);
  const [isStartingChat, setIsStartingChat] = useState(false);
  const [keyword, setKeyword] = useState("");
  const debouncedKeyword = useDebouncedValue(keyword);
  const [searchResults, setSearchResults] = useState<SearchFriendItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);

  useEffect(() => {
    //fetch friends từ redux store hoặc API
    if (friends.length === 0) {
      dispatch(getFriends({ limit: 100, page: 1 }));
    }
  }, [dispatch, friends.length]);

  useEffect(() => {
    if (friends.length > 0 && !selectedFriendId) {
      const firstFriend = friends[0];
      setSelectedFriendId(firstFriend.id);
      void handleSelectFriend(firstFriend);
    }
  }, [friends, selectedFriendId]);

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

        if (results.length > 0 && !selectedFriendId) {
          setSelectedFriendId(results[0].id);
          await handleSelectFriend(results[0] as Friend);
        }
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
  }, [debouncedKeyword, selectedFriendId]);

  const page = useSelector(selectFriendPage);

  const loadMoreFriends = () => {
    dispatch(getFriends({ limit: 20, page: page + 1 }));
  };

  const displayedFriends = debouncedKeyword
    ? (searchResults as Friend[])
    : friends;

  const handleSelectFriend = async (friend: Friend) => {
    try {
      setSelectedFriendId(friend.id);
      setIsLoadingProfile(true);
      const profile = await getUserProfileByIdAPI(friend.id);
      setSelectedProfile(profile);
    } catch (error) {
      showErrorToast(error, "Không lấy được thông tin người dùng");
    } finally {
      setIsLoadingProfile(false);
    }
  };

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

  const selectedFriend = friends.find(
    (friend) => friend.id === selectedFriendId,
  );

  const renderProfileDetail = () => {
    if (!selectedFriendId) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
          <p className="text-sm text-muted-foreground">
            Hãy chọn một người bạn để xem thông tin
          </p>
        </div>
      );
    }

    if (isLoadingProfile) {
      return (
        <div className="flex flex-col items-center gap-3">
          <Skeleton className="size-24 rounded-full" />
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="mt-2 h-12 w-full rounded-md" />
        </div>
      );
    }

    return (
      <div className="space-y-6">
        <div className="flex flex-col items-center gap-3">
          <Avatar className="size-24">
            <AvatarImage
              src={selectedProfile?.avatar || "/placeholder.svg"}
              alt={selectedProfile?.username || "Ảnh đại diện người dùng"}
            />
            <AvatarFallback className="text-2xl">
              {(selectedProfile?.username || "U")[0]}
            </AvatarFallback>
          </Avatar>

          <div className="text-center">
            <p className="text-lg font-semibold text-foreground">
              {selectedProfile?.fullName || selectedProfile?.username}
            </p>
            <p className="text-sm text-muted-foreground">
              @{selectedProfile?.username}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {selectedProfile?.email}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {selectedProfile?.bio || "Chưa có tiểu sử"}
            </p>
            <span
              className={cn(
                "mt-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
                selectedFriend?.status
                  ? "bg-success/15 text-success"
                  : "bg-muted text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  selectedFriend?.status ? "bg-success" : "bg-muted-foreground",
                )}
              />
              {selectedFriend?.status ? "Đang online" : "Đang offline"}
            </span>
          </div>
        </div>

        <Button
          className="h-12 w-full gap-2 text-base font-semibold"
          onClick={() => void handleChatWithFriend()}
          disabled={isStartingChat}
        >
          <MessageCircle className="size-5" />
          {isStartingChat ? "Đang mở cuộc trò chuyện..." : "Nhắn tin"}
        </Button>
      </div>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-1 lg:flex-row">
      <div className="flex h-full min-h-0 flex-1 flex-col border-border lg:border-r">
        <div className="border-b border-border p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="Tìm theo username..."
              className="pl-10"
            />
          </div>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-1 p-3">
            {displayedFriends.map((friend: Friend) => (
              <button
                key={friend.id}
                onClick={() => {
                  void handleSelectFriend(friend);
                  setMobileDetailOpen(true);
                }}
                className={cn(
                  "group flex w-full items-center gap-3 rounded-xl p-3 text-left transition-colors hover:bg-accent",
                  selectedFriendId === friend.id && "bg-accent",
                )}
              >
                <div className="relative size-12 shrink-0">
                  <Avatar className="size-12">
                    <AvatarImage
                      src={friend.avatar || "/placeholder.svg"}
                      alt={friend.username}
                    />
                    <AvatarFallback>{friend.username[0]}</AvatarFallback>
                  </Avatar>

                  {friend.status && (
                    <span className="absolute bottom-0 right-0 block size-3 rounded-full border-2 border-background bg-success" />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-foreground">
                    {friend.username}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {friend.status
                      ? "Đang online"
                      : formatLastSeen(friend.lastSeen)}
                  </p>
                </div>
              </button>
            ))}

            {isSearching && (
              <div className="space-y-1">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className="flex items-center gap-3 p-3">
                    <Skeleton className="size-12 shrink-0 rounded-full" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-3.5 w-2/3" />
                      <Skeleton className="h-3 w-1/3" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {displayedFriends.length === 0 && !isSearching && (
              <div className="py-10 text-center">
                <p className="text-sm text-muted-foreground">
                  {debouncedKeyword
                    ? "Không tìm thấy bạn bè phù hợp"
                    : "Chưa có bạn bè"}
                </p>
              </div>
            )}

            {!debouncedKeyword && displayedFriends.length > 0 && (
              <div className="my-3 flex items-center justify-center">
                <Button
                  variant="ghost"
                  size="sm"
                  className="interceptor-loading text-muted-foreground"
                  onClick={loadMoreFriends}
                >
                  Tải thêm
                </Button>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Backdrop for mobile detail sheet */}
      {mobileDetailOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={() => setMobileDetailOpen(false)}
        />
      )}

      <div
        className={cn(
          "fixed inset-x-0 bottom-0 z-40 flex max-h-[85dvh] flex-col overflow-y-auto rounded-t-2xl border-t border-border bg-background p-6 shadow-2xl transition-transform duration-300",
          mobileDetailOpen ? "translate-y-0" : "translate-y-full",
          "lg:static lg:z-auto lg:max-h-none lg:w-80 lg:translate-y-0 lg:justify-center lg:rounded-none lg:border-l lg:border-t-0 lg:shadow-none",
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
