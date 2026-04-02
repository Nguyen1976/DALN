import React from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Check } from "lucide-react";

interface SeenUser {
  userId: string;
  username?: string;
  avatar?: string;
}

interface SeenStatusProps {
  seenUsers: SeenUser[];
}

/**
 * Seen Status component showing who has viewed the message
 * Displays avatars with tooltip on hover
 */
export const SeenStatus: React.FC<SeenStatusProps> = ({ seenUsers }) => {
  if (!seenUsers || seenUsers.length === 0) {
    // Show just the check mark for sent messages without seen
    return (
      <div className="flex justify-end mr-10 h-5 mt-1">
        <Check className="w-3 h-3 text-gray-400" />
      </div>
    );
  }

  // Count of users who saw
  const seenCount = seenUsers.length;

  return (
    <div className="flex justify-end mr-10 gap-2 mt-1 items-center">
      <div className="flex -space-x-2">
        <TooltipProvider>
          {seenUsers.slice(0, 3).map((user) => (
            <Tooltip key={user.userId}>
              <TooltipTrigger asChild>
                <Avatar className="w-5 h-5 border-2 border-bg-box-chat hover:border-bg-box-message-out transition-colors cursor-pointer hover:scale-110 transform duration-200">
                  <AvatarImage src={user.avatar || ""} />
                  <AvatarFallback className="text-[8px] font-bold">
                    {(user.username || "U")[0]}
                  </AvatarFallback>
                </Avatar>
              </TooltipTrigger>
              <TooltipContent
                side="top"
                className="text-xs bg-black-bland text-text border border-bg-box-message-incoming"
              >
                {user.username || "User"} đã xem
              </TooltipContent>
            </Tooltip>
          ))}

          {/* Show +N indicator if more than 3 users */}
          {seenCount > 3 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="w-5 h-5 rounded-full bg-bg-box-message-out/20 border-2 border-bg-box-chat flex items-center justify-center hover:scale-110 transform duration-200 cursor-pointer">
                  <span className="text-[7px] font-bold text-gray-600">
                    +{seenCount - 3}
                  </span>
                </div>
              </TooltipTrigger>
              <TooltipContent
                side="top"
                className="text-xs bg-black-bland text-text border border-bg-box-message-incoming"
              >
                {seenUsers
                  .slice(3)
                  .map((u) => u.username || "User")
                  .join(", ")}{" "}
                cũng đã xem
              </TooltipContent>
            </Tooltip>
          )}
        </TooltipProvider>
      </div>

      {/* Status indicator - check mark with animation */}
      <div className="flex items-center">
        <Check
          className="w-3 h-3 text-blue-400 animate-pulse"
          strokeWidth={3}
        />
      </div>
    </div>
  );
};

export default SeenStatus;
