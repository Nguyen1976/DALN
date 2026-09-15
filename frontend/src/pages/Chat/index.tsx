import { useState } from "react";
import { useSelector } from "react-redux";
import { MessageSquareText } from "lucide-react";
import { EmptyState } from "@/components/ui/feedback";
import { ChatSidebar } from "@/components/ChatSidebar";
import ChatWindow from "@/components/ChatWindow";
import ProfilePanel from "@/components/ProfilePanel";
import MainLayout from "@/layouts/MainLayout";
import { useNavigate, useParams } from "react-router";
import { selectConversationById } from "@/redux/slices/conversationSlice";
import type { RootState } from "@/redux/store";
import { useCall } from "@/contexts/callContext";

type CallType = "audio" | "video";

export default function ChatPage() {
  const [showProfile, setShowProfile] = useState(false);
  const [focusMessageId, setFocusMessageId] = useState<string | null>(null);
  // Cuộc gọi ra ngoài do CallProvider (cấp app) giữ → thu nhỏ + sống xuyên trang.
  const { startDirectCall, startGroupCall } = useCall();

  const navigate = useNavigate();
  const selectedChatId = useParams().conversationId || "";
  const selectedConversation = useSelector((state: RootState) =>
    selectedChatId ? selectConversationById(state, selectedChatId) : undefined,
  );

  // DIRECT → gọi 1-1 P2P; GROUP → gọi nhóm SFU. Cả hai do CallProvider giữ ở cấp
  // app nên mở hội thoại khác / đổi trang không cúp máy (có thể thu nhỏ để chat).
  const handleCall = (callType: CallType) => {
    if (!selectedChatId) return;
    if (selectedConversation?.type === "GROUP") {
      startGroupCall(selectedChatId, callType);
    } else {
      startDirectCall(selectedChatId, callType);
    }
  };

  return (
    <MainLayout>
      <ChatSidebar className={selectedChatId ? "hidden md:flex" : "flex"} />

      {selectedChatId ? (
        <ChatWindow
          conversationId={selectedChatId || undefined}
          onToggleProfile={() => setShowProfile(!showProfile)}
          onVoiceCall={() => handleCall("audio")}
          onVideoCall={() => handleCall("video")}
          onBack={() => navigate("/")}
          focusMessageId={focusMessageId}
          onFocusHandled={() => setFocusMessageId(null)}
        />
      ) : (
        <div className="chat-canvas hidden flex-1 flex-col items-center justify-center px-6 text-center md:flex">
          <EmptyState
            icon={MessageSquareText}
            title="Chọn một cuộc trò chuyện"
            description="Chọn cuộc trò chuyện ở danh sách bên trái để bắt đầu nhắn tin, hoặc tạo cuộc trò chuyện mới."
          />
        </div>
      )}

      {showProfile && selectedChatId && (
        <ProfilePanel
          conversationId={selectedChatId}
          onClose={() => setShowProfile(false)}
          onJumpToMessage={(messageId) => {
            setFocusMessageId(messageId);
          }}
        />
      )}
    </MainLayout>
  );
}
