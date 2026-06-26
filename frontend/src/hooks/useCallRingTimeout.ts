import { useEffect, useRef } from "react";

export function useCallRingTimeout({
  active,
  durationMs,
  onTimeout,
}: {
  active: boolean;
  durationMs: number;
  onTimeout: () => void;
}) {
  const onTimeoutRef = useRef(onTimeout);
  onTimeoutRef.current = onTimeout;

  useEffect(() => {
    if (!active) return;

    const timer = window.setTimeout(() => {
      onTimeoutRef.current();
    }, durationMs);

    return () => {
      window.clearTimeout(timer);
    };
  }, [active, durationMs]);
}
