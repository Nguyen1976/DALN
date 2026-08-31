import React from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Check, CheckCheck } from "lucide-react";

interface SeenUser {
  userId: string;
  username?: string;
  avatar?: string;
}

interface SeenStatusProps {
  seenUsers: SeenUser[];
}

/**
 * Delivery / read receipt under the last message of a run.
 *
 * Sent and seen use different glyphs (single vs. double check) as well as
 * different colours, so the two states stay distinguishable without colour
 * vision. The state is always spelled out for assistive tech.
 */
export const SeenStatus: React.FC<SeenStatusProps> = ({ seenUsers }) => {
  if (!seenUsers || seenUsers.length === 0) {
    return (
      <div className="mr-1 mt-1 flex h-4 items-center justify-end gap-1">
        <Check className="size-3 text-muted-foreground" aria-hidden="true" />
        <span className="sr-only">Đã gửi</span>
      </div>
    );
  }

  const seenCount = seenUsers.length;
  const visible = seenUsers.slice(0, 3);
  const overflow = seenUsers.slice(3);

  return (
    <div className="mr-1 mt-1 flex items-center justify-end gap-1.5">
      <TooltipProvider>
        <div className="flex -space-x-1.5">
          {visible.map((user) => (
            <Tooltip key={user.userId}>
              <TooltipTrigger asChild>
                <Avatar className="size-4 ring-2 ring-chat-bg">
                  <AvatarImage
                    src={user.avatar || ""}
                    alt={`${user.username || "Người dùng"} đã xem`}
                  />
                  <AvatarFallback className="text-[8px] font-bold">
                    {(user.username || "U")[0]}
                  </AvatarFallback>
                </Avatar>
              </TooltipTrigger>
              <TooltipContent side="top">
                {user.username || "Người dùng"} đã xem
              </TooltipContent>
            </Tooltip>
          ))}

          {overflow.length > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex size-4 items-center justify-center rounded-full bg-secondary text-[8px] font-bold text-secondary-foreground ring-2 ring-chat-bg">
                  +{overflow.length}
                </span>
              </TooltipTrigger>
              <TooltipContent side="top">
                {overflow.map((u) => u.username || "Người dùng").join(", ")} cũng
                đã xem
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </TooltipProvider>

      <CheckCheck className="size-3.5 text-brand" aria-hidden="true" />
      <span className="sr-only">{`${seenCount} người đã xem`}</span>
    </div>
  );
};

export default SeenStatus;
