import React from "react";

interface TypingIndicatorProps {
  userNames: string[];
}

/**
 * Animated typing indicator component
 * Shows who is currently typing with animation
 */
export const TypingIndicator: React.FC<TypingIndicatorProps> = ({
  userNames,
}) => {
  if (userNames.length === 0) return null;

  const displayText =
    userNames.length === 1
      ? `${userNames[0]} đang gõ`
      : `${userNames.slice(0, -1).join(", ")} và ${userNames[userNames.length - 1]} đang gõ`;

  return (
    <div className="flex w-fit items-center gap-2 rounded-2xl border border-border bg-bg-box-message-incoming px-4 py-3 animate-fade-in">
      {/* Animated typing dots */}
      <div className="flex gap-1">
        <span
          className="size-2 rounded-full bg-muted-foreground animate-bounce"
          style={{ animationDelay: "0ms" }}
        />
        <span
          className="size-2 rounded-full bg-muted-foreground animate-bounce"
          style={{ animationDelay: "150ms" }}
        />
        <span
          className="size-2 rounded-full bg-muted-foreground animate-bounce"
          style={{ animationDelay: "300ms" }}
        />
      </div>

      {/* Text */}
      <span className="text-xs font-medium text-muted-foreground">
        {displayText}
      </span>
    </div>
  );
};

export default TypingIndicator;
