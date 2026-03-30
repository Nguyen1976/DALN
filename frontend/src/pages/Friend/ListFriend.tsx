import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
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
import { toast } from "sonner";
import { formatLastSeen } from "@/utils";

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
  const [debouncedKeyword, setDebouncedKeyword] = useState("");
  const [searchResults, setSearchResults] = useState<SearchFriendItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);

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
        const results = await searchUsersAPI(debouncedKeyword);
        if (cancelled) return;
        setSearchResults(results);

        if (results.length > 0 && !selectedFriendId) {
          setSelectedFriendId(results[0].id);
          await handleSelectFriend(results[0] as Friend);
        }
      } catch (error) {
        if (!cancelled) {
          console.log(error);
          toast.error("Không thể tìm kiếm bạn bè");
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
      console.log(error);
      toast.error("Không lấy được thông tin người dùng");
    } finally {
      setIsLoadingProfile(false);
    }
  };

  const handleChatWithFriend = async () => {
    if (!selectedFriendId || !user?.id) return;

    const existingConversation = conversations.find(
      (conversation) =>
        conversation.type === "DIRECT" &&
        conversation.members.some(
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

      if (conversation.lastMessage) {
        dispatch(addConversation({ conversation, userId: user.id }));
      }

      navigate(`/chat/${conversation.id}`, {
        state: { conversation },
      });
    } catch (error) {
      console.log(error);
      toast.error("Không thể mở cuộc trò chuyện");
    } finally {
      setIsStartingChat(false);
    }
  };

  const selectedFriend = friends.find(
    (friend) => friend.id === selectedFriendId,
  );

  return (
    <div className="h-full min-h-0 flex-1 flex">
      <div className="h-full min-h-0 flex-1 border-r">
        <div className="p-4 border-b">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="Tìm theo username..."
              className="pl-10"
            />
          </div>
        </div>

        <ScrollArea className="h-full">
          <div className="p-6">
            <div className="mb-6">
              <div className="space-y-2">
                {displayedFriends.map((friend: Friend) => (
                  <button
                    key={friend.id}
                    onClick={() => void handleSelectFriend(friend)}
                    className={`w-full p-3 rounded-lg flex items-center gap-3 hover:bg-accent transition-colors group ${
                      selectedFriendId === friend.id ? "bg-accent" : ""
                    }`}
                  >
                    <div className="relative w-12 h-12 shrink-0">
                      <Avatar className="w-12 h-12">
                        <AvatarImage
                          src={friend.avatar || "/placeholder.svg"}
                          alt={friend.username}
                        />
                        <AvatarFallback>{friend.username[0]}</AvatarFallback>
                      </Avatar>

                      {friend.status && (
                        <span className="absolute bottom-0 right-0 block w-3 h-3 rounded-full bg-green-500 border-2 border-white" />
                      )}
                    </div>

                    <div className="flex-1 min-w-0 text-left">
                      <p className="font-medium text-foreground truncate">
                        {friend.username}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {friend.status
                          ? "Đang online"
                          : formatLastSeen(friend.lastSeen)}
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
                ))}
              </div>

              {isSearching && (
                <div className="text-center py-4">
                  <p className="text-muted-foreground">Đang tìm kiếm...</p>
                </div>
              )}

              {displayedFriends.length === 0 && !isSearching && (
                <div className="text-center py-6">
                  <p className="text-muted-foreground">
                    {debouncedKeyword
                      ? "Không tìm thấy bạn bè phù hợp"
                      : "Chưa có bạn bè"}
                  </p>
                </div>
              )}

              {!debouncedKeyword && (
                <div className="w-full flex items-center justify-center my-4">
                  <Button
                    className="interceptor-loading"
                    onClick={loadMoreFriends}
                  >
                    Tải thêm
                  </Button>
                </div>
              )}
            </div>
          </div>
        </ScrollArea>
      </div>

      <div className="w-90 p-6 flex flex-col justify-center">
        {!selectedFriendId ? (
          <p className="text-muted-foreground text-center">
            Hãy chọn một người bạn để xem thông tin
          </p>
        ) : isLoadingProfile ? (
          <p className="text-muted-foreground text-center">
            Đang tải thông tin...
          </p>
        ) : (
          <div className="space-y-6">
            <div className="flex flex-col items-center gap-3">
              <Avatar className="w-24 h-24">
                <AvatarImage
                  src={selectedProfile?.avatar || "/placeholder.svg"}
                  alt={selectedProfile?.username || "Ảnh đại diện người dùng"}
                />
                <AvatarFallback>
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
                <p className="text-sm text-muted-foreground mt-1">
                  {selectedProfile?.email}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {selectedProfile?.bio || "Chưa có tiểu sử"}
                </p>
                <p className="text-xs mt-2 text-muted-foreground">
                  {selectedFriend?.status ? "Đang online" : "Đang offline"}
                </p>
              </div>
            </div>

            <Button
              className="w-full h-12 text-base font-semibold"
              onClick={() => void handleChatWithFriend()}
              disabled={isStartingChat}
            >
              {isStartingChat
                ? "Đang mở cuộc trò chuyện..."
                : "Bạn có muốn chat với họ không?"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ListFriend;
