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
    <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-bg-box-message-incoming/40 border border-bg-box-message-incoming/50 animate-fade-in">
      {/* Animated typing dots */}
      <div className="flex gap-1">
        <span
          className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
          style={{ animationDelay: "0ms" }}
        />
        <span
          className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
          style={{ animationDelay: "150ms" }}
        />
        <span
          className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
          style={{ animationDelay: "300ms" }}
        />
      </div>

      {/* Text */}
      <span className="text-xs text-gray-500 font-medium">{displayText}</span>
    </div>
  );
};

export default TypingIndicator;
