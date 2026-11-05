import type { Message } from "@/redux/slices/messageSlice";

export interface SeenUser {
  userId: string;
  username?: string;
  avatar?: string;
}

/**
 * Who goes under which of my messages as "seen": each reader under my newest
 * message whose `seq` is at or below their read mark, once.
 *
 * Marks are seqs, not message ids. An id only matched when the reader's last
 * read message was exactly one of mine: whoever read up to someone else's
 * message after mine, in a group, never showed as having seen mine.
 */
export function seenByMessage(
  marks: Record<string, number>,
  messages: Message[],
  myId: string,
  userOf: (userId: string) => SeenUser,
): Record<string, SeenUser[]> {
  const mine = messages
    .filter(
      (m): m is Message & { seq: number } =>
        m.senderId === myId && typeof m.seq === "number",
    )
    .sort((a, b) => a.seq - b.seq);
  const result: Record<string, SeenUser[]> = {};
  for (const [userId, mark] of Object.entries(marks)) {
    if (userId === myId) continue;
    let target: string | null = null;
    for (const message of mine) {
      if (message.seq > mark) break;
      target = message.id;
    }
    if (target) (result[target] ??= []).push(userOf(userId));
  }
  return result;
}
