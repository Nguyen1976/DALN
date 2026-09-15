import { useState } from "react";
import { useSelector } from "react-redux";
import { toast } from "sonner";
import { MessageSquareText } from "lucide-react";
import { EmptyState } from "@/components/ui/feedback";
import { ChatSidebar } from "@/components/ChatSidebar";
import ChatWindow from "@/components/ChatWindow";
import ProfilePanel from "@/components/ProfilePanel";
import VoiceCallModal, {
  type VoiceCallMode,
} from "@/components/VoiceCallModal";
import GroupCallModal from "@/components/GroupCallModal";
import MainLayout from "@/layouts/MainLayout";
import { useNavigate, useParams } from "react-router";
import { socket } from "@/lib/socket";
import { SOCKET_EVENTS } from "@/lib/socket.events";
import { selectConversationById } from "@/redux/slices/conversationSlice";
import type { RootState } from "@/redux/store";
import { describeGroupCallError } from "@/utils/groupCallError";

type ActiveVoiceCall = {
  conversationId: string;
  mode: VoiceCallMode;
};

type ActiveGroupCall = {
  callId: string;
  conversationId: string;
  roomName: string;
  url: string;
  token: string;
};

/** Hình dạng ack của `group_call.start`. */
type GroupCallStartAck =
  | { ok: true; callId: string; roomName: string; url: string; token: string }
  | { ok: false; code?: string };

export default function ChatPage() {
  const [showProfile, setShowProfile] = useState(false);
  const [activeVoiceCall, setActiveVoiceCall] =
    useState<ActiveVoiceCall | null>(null);
  const [activeGroupCall, setActiveGroupCall] =
    useState<ActiveGroupCall | null>(null);
  const [focusMessageId, setFocusMessageId] = useState<string | null>(null);

  const navigate = useNavigate();
  const selectedChatId = useParams().conversationId || "";
  const selectedConversation = useSelector((state: RootState) =>
    selectedChatId ? selectConversationById(state, selectedChatId) : undefined,
  );

  // DIRECT → gọi 1-1 P2P (VoiceCallModal, giữ nguyên). GROUP → gọi nhóm SFU:
  // emit group_call.start, mở GroupCallModal với ack {callId, roomName, url, token}.
  const handleVoiceCall = () => {
    if (!selectedChatId) return;

    if (selectedConversation?.type === "GROUP") {
      socket.emit(
        SOCKET_EVENTS.GROUP_CALL.START,
        { conversationId: selectedChatId },
        (ack?: GroupCallStartAck) => {
          if (ack?.ok) {
            setActiveGroupCall({
              callId: ack.callId,
              conversationId: selectedChatId,
              roomName: ack.roomName,
              url: ack.url,
              token: ack.token,
            });
          } else {
            toast.error(describeGroupCallError(ack?.code));
          }
        },
      );
      return;
    }

    setActiveVoiceCall({ conversationId: selectedChatId, mode: "outgoing" });
  };

  return (
    <MainLayout>
      <ChatSidebar className={selectedChatId ? "hidden md:flex" : "flex"} />

      {selectedChatId ? (
        <ChatWindow
          conversationId={selectedChatId || undefined}
          onToggleProfile={() => setShowProfile(!showProfile)}
          onVoiceCall={handleVoiceCall}
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

      {activeGroupCall && (
        <GroupCallModal
          callId={activeGroupCall.callId}
          roomName={activeGroupCall.roomName}
          url={activeGroupCall.url}
          token={activeGroupCall.token}
          conversationId={activeGroupCall.conversationId}
          onClose={() => setActiveGroupCall(null)}
        />
      )}
    </MainLayout>
  );
}
