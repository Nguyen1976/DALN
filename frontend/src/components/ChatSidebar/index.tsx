import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ModeToggle } from "../ModeToggle";
import type { AppDispatch } from "@/redux/store";
import { useDispatch, useSelector } from "react-redux";
import { useEffect } from "react";
import {
  getConversations,
  selectConversation,
  type Conversation,
} from "@/redux/slices/conversationSlice";
import { formatDateTime } from "@/utils/formatDateTime";
import MenuCustome from "./Menu";
import { NotificationsDropdown } from "../NotificationDropdown";
import { useNavigate, useParams } from "react-router";
import { selectUser } from "@/redux/slices/userSlice";

export function ChatSidebar() {
  const user = useSelector(selectUser);

  const selectedChatId = useParams().conversationId || "";

  const conversations = useSelector(selectConversation);

  const dispatch = useDispatch<AppDispatch>();

  const navigate = useNavigate();

  useEffect(() => {
    if (conversations.length === 0) {
      dispatch(getConversations({ limit: 10, cursor: null }));
    }
  }, [dispatch, conversations?.length]);

  const loadMoreConversations = () => {
    console.log(conversations[conversations.length - 1]);
    dispatch(
      getConversations({
        limit: 10,
        cursor: conversations[conversations.length - 1]?.lastMessageAt || null,
      }),
    );
  };

  const renderConversationItem = (conversation: Conversation) => {
    const memberCount =
      conversation.memberCount ?? conversation.members?.length ?? 0;

    return (
      <button
        key={conversation.id}
        onClick={() => {
          navigate(`/chat/${conversation.id}`);
        }}
        className={cn(
          "w-full p-4 flex items-start gap-3 hover:bg-bg-box-message-incoming/50 transition-colors border-b border-bg-box-message-incoming/30",
          selectedChatId === conversation.id && "bg-bg-box-message-incoming",
        )}
      >
        <div className="relative">
          {conversation.type === "DIRECT" ? (
            <Avatar className="w-12 h-12">
              <AvatarImage
                src={conversation.groupAvatar || ""}
                alt={conversation.groupName || ""}
              />
              <AvatarFallback>
                {(conversation.groupName || "C")[0]}
              </AvatarFallback>
            </Avatar>
          ) : (
            <div className="*:data-[slot=avatar]:ring-background flex -space-x-2 *:data-[slot=avatar]:ring-2 *:data-[slot=avatar]:grayscale">
              <Avatar>
                <AvatarImage
                  src={conversation.groupAvatar || ""}
                  alt={conversation.groupName || ""}
                />
                <AvatarFallback>
                  {(conversation.groupName || "C")[0]}
                </AvatarFallback>
              </Avatar>
              {memberCount >= 2 && (
                <Avatar>
                  <AvatarFallback>
                    {memberCount - 1 <= 99 ? memberCount - 1 : "99+"}
                  </AvatarFallback>
                </Avatar>
              )}
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0 text-left">
          <div className="flex items-center justify-between mb-1">
            <span className="font-medium text-text truncate">
              {conversation.groupName}
            </span>
            <span className="text-xs text-gray-400 ml-2">
              {formatDateTime(conversation.updatedAt)}
            </span>
          </div>
          <p className="text-sm text-gray-400 truncate">
            {conversation?.lastMessageText
              ? conversation.lastMessageSenderName &&
                conversation.lastMessageSenderId !== user?.id
                ? `${conversation.lastMessageSenderName}: ${conversation.lastMessageText}`
                : conversation.lastMessageText
              : "Chưa có tin nhắn nào."}
          </p>
        </div>

        {conversation.unreadCount &&
          (Number(conversation.unreadCount) > 0 ||
            conversation.unreadCount === "5+") && (
            <div className="w-6 h-6 bg-bg-box-message-out rounded-full flex items-center justify-center">
              <span className="text-xs text-text font-medium">
                {conversation.unreadCount}
              </span>
            </div>
          )}
      </button>
    );
  };

  return (
    <div className="w-1/3 bg-black-bland border-r border-bg-box-message-incoming flex flex-col custom-scrollbar">
      <div className="flex items-center justify-end p-4 border-b border-bg-box-message-incoming">
        <div className="flex gap-2 items-center">
          <ModeToggle />
          <NotificationsDropdown />
          <MenuCustome />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {conversations?.map(renderConversationItem)}
        <div className="w-full flex items-center justify-center my-4">
          <Button
            className="interceptor-loading"
            onClick={() => loadMoreConversations()}
          >
            Tải thêm
          </Button>
        </div>
      </div>
    </div>
  );
}
