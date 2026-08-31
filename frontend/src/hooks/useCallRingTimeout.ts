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
  // Kept in a ref so a new callback identity does not restart the timer, and
  // written inside an effect — assigning during render is not allowed.
  const onTimeoutRef = useRef(onTimeout);

  useEffect(() => {
    onTimeoutRef.current = onTimeout;
  }, [onTimeout]);

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
