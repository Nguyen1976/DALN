import type { FieldValues, Path, UseFormSetError } from "react-hook-form";

/**
 * Route a backend message to the field it is actually about.
 *
 * A duplicate-email conflict shown only as a toast scrolls away in three
 * seconds and leaves the user staring at a form with no indication of which
 * input to change. Rules are tried in order; the first match wins.
 */
export function applyServerFieldError<T extends FieldValues>(
  setError: UseFormSetError<T>,
  message: string,
  rules: Array<{ match: RegExp; field: Path<T> }>,
): boolean {
  const rule = rules.find((r) => r.match.test(message));
  if (!rule) return false;
  setError(rule.field, { type: "server", message });
  return true;
}
