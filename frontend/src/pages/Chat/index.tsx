import { useState } from "react";
import { MessageSquareText } from "lucide-react";
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
        <div className="hidden flex-1 flex-col items-center justify-center gap-4 bg-bg-box-chat px-6 text-center md:flex">
          <div className="flex size-20 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <MessageSquareText className="size-9" />
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-foreground">
              Chưa có cuộc trò chuyện nào được chọn
            </h2>
            <p className="max-w-sm text-sm text-muted-foreground">
              Hãy chọn một cuộc trò chuyện ở danh sách bên trái để bắt đầu nhắn
              tin.
            </p>
          </div>
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
