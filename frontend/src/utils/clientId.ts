/**
 * Unique id minted by the client for a message it is about to send.
 *
 * The server de-duplicates on this value, so two different messages must never
 * share one. `Date.now()` alone collides whenever two sends land in the same
 * millisecond — pressing Enter twice quickly, or a queued message flushing
 * beside a fresh one — and the second message would then be silently dropped
 * as a duplicate of the first.
 */
export function createClientMessageId(prefix = "temp-id"): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;

  return `${prefix}-${Date.now()}-${random}`;
}
