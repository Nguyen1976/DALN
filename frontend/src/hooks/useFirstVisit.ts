import { useEffect, useState } from "react";

const visited = new Set<string>();

/**
 * True the first time something with this key mounts this session, false
 * on every later mount. For entrance animations that should greet a screen
 * once, not replay on each trip back to it. Stable for the life of a mount.
 */
export function useFirstVisit(key: string) {
  const [first] = useState(() => !visited.has(key));
  useEffect(() => {
    visited.add(key);
  }, [key]);
  return first;
}
