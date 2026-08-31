import React from "react";

interface TypingIndicatorProps {
  userNames: string[];
}

/**
 * "X đang gõ" bubble.
 *
 * The dots are decorative; the status is also announced as text through an
 * aria-live region so it is never conveyed by motion alone. Under
 * prefers-reduced-motion the global rule freezes the bounce and the text
 * carries the whole message.
 */
export const TypingIndicator: React.FC<TypingIndicatorProps> = ({
  userNames,
}) => {
  if (userNames.length === 0) return null;

  const displayText =
    userNames.length === 1
      ? `${userNames[0]} đang nhập…`
      : userNames.length === 2
        ? `${userNames[0]} và ${userNames[1]} đang nhập…`
        : `${userNames[0]} và ${userNames.length - 1} người khác đang nhập…`;

  return (
    <div
      className="flex w-fit animate-fade-in items-center gap-2.5 rounded-2xl rounded-bl-md bg-bubble-in px-3.5 py-2.5 shadow-bubble"
      role="status"
      aria-live="polite"
    >
      <span className="flex gap-1" aria-hidden="true">
        {[0, 150, 300].map((delay) => (
          <span
            key={delay}
            className="size-1.5 rounded-full bg-typing"
            style={{
              animation: "typingBounce 1.2s infinite",
              animationDelay: `${delay}ms`,
            }}
          />
        ))}
      </span>
      <span className="text-xs font-medium text-typing">{displayText}</span>
    </div>
  );
};

export default TypingIndicator;
