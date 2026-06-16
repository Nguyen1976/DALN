import { useEffect, useState } from "react";

/** Debounce giá trị string (mặc định 400ms) — dùng cho ô tìm kiếm. */
export function useDebouncedValue(value: string, delayMs = 400) {
  const [debounced, setDebounced] = useState(value.trim());

  useEffect(() => {
    const timeout = setTimeout(() => setDebounced(value.trim()), delayMs);
    return () => clearTimeout(timeout);
  }, [value, delayMs]);

  return debounced;
}
