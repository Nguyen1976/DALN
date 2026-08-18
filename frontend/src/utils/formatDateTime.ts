const VI = "vi-VN";

const isSameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

const startOfDay = (d: Date) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** Clock time on a message bubble — 24h, the convention Vietnamese users expect. */
export const formatDateTime = (dateStr?: string) => {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleTimeString(VI, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
};

/**
 * Date divider label between message groups.
 * Today and yesterday are named rather than dated — a reader scanning the
 * thread should not have to convert a date back into "that was yesterday".
 */
export const formatDayDivider = (dateStr?: string) => {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return "";

  const now = new Date();
  if (isSameDay(date, now)) return "Hôm nay";

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(date, yesterday)) return "Hôm qua";

  const withinWeek =
    (startOfDay(now).getTime() - startOfDay(date).getTime()) /
      (24 * 60 * 60 * 1000) <
    7;

  if (withinWeek) {
    return date.toLocaleDateString(VI, { weekday: "long" });
  }

  return date.toLocaleDateString(VI, {
    day: "2-digit",
    month: "2-digit",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
};

/** True when two timestamps fall on different calendar days. */
export const isNewDay = (current?: string, previous?: string) => {
  if (!current) return false;
  if (!previous) return true;
  const a = new Date(current);
  const b = new Date(previous);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return false;
  return !isSameDay(a, b);
};

/**
 * Compact timestamp for conversation lists and notifications:
 * "14:32" today, "Hôm qua", weekday within the week, then a short date.
 */
export const formatConversationTime = (dateStr?: string) => {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return "";

  const now = new Date();
  if (isSameDay(date, now)) {
    return date.toLocaleTimeString(VI, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(date, yesterday)) return "Hôm qua";

  const days =
    (startOfDay(now).getTime() - startOfDay(date).getTime()) /
    (24 * 60 * 60 * 1000);

  if (days < 7) {
    return date.toLocaleDateString(VI, { weekday: "short" });
  }

  return date.toLocaleDateString(VI, { day: "2-digit", month: "2-digit" });
};

/** "vừa xong", "5 phút", "3 giờ", "2 ngày" — for last-seen and notifications. */
export const formatRelativeTime = (dateStr?: string) => {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return "";

  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "vừa xong";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} phút trước`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} giờ trước`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)} ngày trước`;

  return date.toLocaleDateString(VI, { day: "2-digit", month: "2-digit" });
};

/** Full timestamp for tooltips / title attributes. */
export const formatFullDateTime = (dateStr?: string) => {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleString(VI, {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
};
