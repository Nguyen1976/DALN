import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { CALL_RING_TIMEOUT_MS } from "@/constants/call";
import type { CSSProperties } from "react";

const SIZE = 144;
const STROKE = 4;
const RADIUS = SIZE / 2 - STROKE;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

interface CallRingAvatarProps {
  displayName: string;
  displayAvatar: string;
  active: boolean;
  durationMs?: number;
}

export default function CallRingAvatar({
  displayName,
  displayAvatar,
  active,
  durationMs = CALL_RING_TIMEOUT_MS,
}: CallRingAvatarProps) {
  return (
    <div className="relative mb-6 size-36">
      <svg
        className="pointer-events-none absolute inset-0 size-full -rotate-90"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        aria-hidden="true"
      >
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth={STROKE}
          className="text-primary/15"
        />
        {active ? (
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke="currentColor"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            className="text-primary animate-call-ring-progress"
            style={
              {
                "--ring-circumference": CIRCUMFERENCE,
                "--ring-duration": `${durationMs}ms`,
              } as CSSProperties
            }
          />
        ) : null}
      </svg>

      <div className="absolute inset-2 flex items-center justify-center">
        <Avatar className="size-32 ring-4 ring-primary/10">
          <AvatarImage src={displayAvatar} alt={displayName} />
          <AvatarFallback className="text-3xl">
            {displayName?.[0]}
          </AvatarFallback>
        </Avatar>
      </div>
    </div>
  );
}
