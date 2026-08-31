import { useState } from "react";
import { MessageSquareText } from "lucide-react";
import { EmptyState } from "@/components/ui/feedback";
import { ChatSidebar } from "@/components/ChatSidebar";
import ChatWindow from "@/components/ChatWindow";
import ProfilePanel from "@/components/ProfilePanel";
import VoiceCallModal, {
  type VoiceCallMode,
} from "@/components/VoiceCallModal";
import MainLayout from "@/layouts/MainLayout";
import { useNavigate, useParams } from "react-router";

type ActiveVoiceCall = {
  conversationId: string;
  mode: VoiceCallMode;
};

export default function ChatPage() {
  const [showProfile, setShowProfile] = useState(false);
  const [activeVoiceCall, setActiveVoiceCall] =
    useState<ActiveVoiceCall | null>(null);
  const [focusMessageId, setFocusMessageId] = useState<string | null>(null);

  const navigate = useNavigate();
  const selectedChatId = useParams().conversationId || "";

  return (
    <MainLayout>
      <ChatSidebar className={selectedChatId ? "hidden md:flex" : "flex"} />

      {selectedChatId ? (
        <ChatWindow
          conversationId={selectedChatId || undefined}
          onToggleProfile={() => setShowProfile(!showProfile)}
          onVoiceCall={() => {
            if (!selectedChatId) return;
            setActiveVoiceCall({
              conversationId: selectedChatId,
              mode: "outgoing",
            });
          }}
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

      {activeVoiceCall && (
        <VoiceCallModal
          conversationId={activeVoiceCall.conversationId}
          mode={activeVoiceCall.mode}
          onClose={() => setActiveVoiceCall(null)}
        />
      )}
    </MainLayout>
  );
}
