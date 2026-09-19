/**
 * Bản song sinh phía client của bộ resolve mention ở server
 * (`apps/chat/src/domain/mention.resolver.ts`).
 *
 * Server vẫn là nguồn sự thật khi GỬI; bản này dùng để (1) hiện đúng danh sách
 * "đang nhắc ai" lúc soạn — kể cả khi người dùng gõ tay hoặc vừa xoá chữ @ đi,
 * và (2) tô sáng tin nhắn CŨ chưa có dữ liệu `mentions` kèm theo.
 */

export interface MentionMember {
  userId: string;
  username?: string | null;
  fullName?: string | null;
}

export type ResolvedMention =
  | { userId: string; label: string }
  | { all: true; label: string };

export const MENTION_ALL_TOKENS = [
  "everyone",
  "tất cả",
  "tatca",
  "mọi người",
  "moi nguoi",
  "all",
];

const lower = (value: string) => value.toLocaleLowerCase("vi");
const isWordChar = (char: string) => /[\p{L}\p{N}_]/u.test(char);

export function resolveMentionsInText(
  text: string | null | undefined,
  members: MentionMember[],
  selfId: string,
): ResolvedMention[] {
  if (!text || !members?.length) return [];

  const handles: { lower: string; userId: string | null }[] = [];
  for (const member of members) {
    if (!member?.userId || member.userId === selfId) continue;
    for (const raw of [member.username, member.fullName]) {
      const label = String(raw || "").trim();
      if (label) handles.push({ lower: lower(label), userId: member.userId });
    }
  }
  for (const token of MENTION_ALL_TOKENS) {
    handles.push({ lower: token, userId: null });
  }
  handles.sort((a, b) => b.lower.length - a.lower.length);

  const out: ResolvedMention[] = [];
  const seen = new Set<string>();
  let hasAll = false;

  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== "@") continue;
    if (i > 0 && isWordChar(text[i - 1])) continue;

    const hit = handles.find((handle) => {
      const slice = text.slice(i + 1, i + 1 + handle.lower.length);
      if (slice.length !== handle.lower.length) return false;
      if (lower(slice) !== handle.lower) return false;
      const next = text[i + 1 + handle.lower.length];
      return next === undefined || !isWordChar(next);
    });
    if (!hit) continue;

    const label = text.slice(i + 1, i + 1 + hit.lower.length);
    if (hit.userId === null) {
      if (!hasAll) {
        hasAll = true;
        out.push({ all: true, label });
      }
    } else if (!seen.has(hit.userId)) {
      seen.add(hit.userId);
      out.push({ userId: hit.userId, label });
    }
    i += hit.lower.length;
  }

  return out;
}

/** Id những người thật sự được nhắc trong text (đã tính cả `@all`). */
export function mentionedUserIds(
  mentions: ResolvedMention[],
  members: MentionMember[],
  selfId: string,
): string[] {
  const ids = new Set<string>();
  let all = false;
  for (const mention of mentions) {
    if ("all" in mention) all = true;
    else ids.add(mention.userId);
  }
  if (all) {
    for (const member of members) {
      if (member.userId && member.userId !== selfId) ids.add(member.userId);
    }
  }
  return [...ids];
}

/** Xoá đúng một lượt nhắc khỏi text (dùng cho nút × trên chip). */
export function removeMentionFromText(text: string, label: string): string {
  const token = `@${label}`;
  const at = text.indexOf(token);
  if (at === -1) return text;
  const after = at + token.length;
  // Nuốt luôn một khoảng trắng phía sau để không để lại khoảng trống thừa.
  const end = text[after] === " " ? after + 1 : after;
  return (text.slice(0, at) + text.slice(end)).replace(/\s+$/, (m) =>
    text.length === end ? "" : m,
  );
}

/** Một mảnh text khi tách để tô sáng: `mention` khác null là một lượt nhắc. */
export interface MentionSegment {
  text: string;
  mention: ResolvedMention | null;
}

/**
 * Tách nội dung tin thành các mảnh để tô sáng CHÍNH XÁC theo danh sách lượt nhắc
 * đã biết — thay vì dò `@[\w.-]+` (trượt tên có dấu/có khoảng trắng, lại tô nhầm
 * cả những `@chữ` không phải mention).
 */
export function buildMentionSegments(
  text: string,
  mentions: ResolvedMention[],
): MentionSegment[] {
  if (!text) return [];
  if (!mentions?.length) return [{ text, mention: null }];

  const sorted = [...mentions].sort((a, b) => b.label.length - a.label.length);
  const segments: MentionSegment[] = [];
  let plainFrom = 0;

  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== "@") continue;
    if (i > 0 && isWordChar(text[i - 1])) continue;

    const hit = sorted.find((mention) => {
      const slice = text.slice(i + 1, i + 1 + mention.label.length);
      if (slice.length !== mention.label.length) return false;
      if (lower(slice) !== lower(mention.label)) return false;
      const next = text[i + 1 + mention.label.length];
      return next === undefined || !isWordChar(next);
    });
    if (!hit) continue;

    if (i > plainFrom) {
      segments.push({ text: text.slice(plainFrom, i), mention: null });
    }
    const end = i + 1 + hit.label.length;
    segments.push({ text: text.slice(i, end), mention: hit });
    plainFrom = end;
    i = end - 1;
  }

  if (plainFrom < text.length) {
    segments.push({ text: text.slice(plainFrom), mention: null });
  }
  return segments;
}
