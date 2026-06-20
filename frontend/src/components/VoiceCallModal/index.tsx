import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import type {
  Conversation,
  ConversationState,
} from "@/redux/slices/conversationSlice";
import { X, Mic, Volume2 } from "lucide-react";
import { useSelector } from "react-redux";

interface VoiceCallModalProps {
  conversationId: string;
  onClose: () => void;
}

export default function VoiceCallModal({
  conversationId,
  onClose,
}: VoiceCallModalProps) {
  const conversation = useSelector(
    (state: { conversations: ConversationState }) => {
      return state.conversations?.find((c) => c.id === conversationId);
    },
  ) as Conversation;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Cuộc gọi thoại"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm animate-fade-in"
    >
      <div className="relative w-full max-w-sm rounded-2xl border border-border bg-card p-8 shadow-2xl">
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label="Đóng"
          className="absolute right-4 top-4 text-muted-foreground hover:text-foreground"
        >
          <X className="size-5" />
        </Button>

        <div className="flex flex-col items-center text-center">
          <Avatar className="mb-6 size-32 ring-4 ring-primary/20">
            <AvatarImage
              src={conversation.displayAvatar || "/placeholder.svg"}
              alt={conversation.displayName}
            />
            <AvatarFallback className="text-3xl">
              {conversation.displayName?.[0]}
            </AvatarFallback>
          </Avatar>

          <h3 className="mb-1 text-2xl font-semibold text-foreground">
            {conversation.displayName}
          </h3>
          <p className="mb-8 text-sm text-muted-foreground">Đang gọi thoại...</p>

          <div className="flex gap-6">
            <Button
              variant="secondary"
              size="icon"
              aria-label="Tắt/bật micro"
              className="size-14 rounded-full"
            >
              <Mic className="size-6" />
            </Button>

            <Button
              variant="destructive"
              size="icon"
              onClick={onClose}
              aria-label="Kết thúc cuộc gọi"
              className="size-14 rounded-full"
            >
              <X className="size-6" />
            </Button>

            <Button
              variant="secondary"
              size="icon"
              aria-label="Tắt/bật loa"
              className="size-14 rounded-full"
            >
              <Volume2 className="size-6" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
