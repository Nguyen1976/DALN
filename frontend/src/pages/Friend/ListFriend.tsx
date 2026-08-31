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
import { AtSign, Mail, MessageCircle, SearchX, UserRound, Users, X } from "lucide-react";
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
        <EmptyState
          icon={UserRound}
          title="Chưa chọn ai"
          description="Chọn một người bạn ở danh sách bên trái để xem thông tin."
          compact
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
      <div className="space-y-6">
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
          <div className="space-y-1 p-3">
            {displayedFriends.map((friend: Friend) => (
              <button
                key={friend.id}
                onClick={() => {
                  void handleSelectFriend(friend);
                  setMobileDetailOpen(true);
                }}
                aria-current={selectedFriendId === friend.id ? "true" : undefined}
                className={cn(
                  "group flex w-full items-center gap-3 rounded-xl p-2.5 text-left",
                  "transition-colors duration-[--motion-fast] hover:bg-accent",
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
                  className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                  aria-hidden="true"
                />
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

            {!debouncedKeyword && displayedFriends.length > 0 && (
              <div className="my-3 flex items-center justify-center">
                <Button
                  variant="outline"
                  size="sm"
                  className="interceptor-loading"
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
          className="fixed inset-0 z-30 bg-foreground/45 backdrop-blur-[2px] lg:hidden"
          onClick={() => setMobileDetailOpen(false)}
        />
      )}

      <div
        className={cn(
          "fixed inset-x-0 bottom-0 z-40 flex max-h-[85dvh] flex-col overflow-y-auto rounded-t-2xl border-t border-border bg-background p-6 shadow-2xl transition-transform duration-300",
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
