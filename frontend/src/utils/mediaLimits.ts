import { getMessageTypeFromFile, getMimeTypeFromFile } from "@/utils/chatMedia";

/**
 * Upload limits, mirrored from the chat service.
 *
 * The server has always enforced these. The browser did not: picking a 30 MB
 * file or a .exe went straight to the presign call, and the user's only clue
 * was a raw "tải tệp lên kho lưu trữ thất bại" after the wait. Checking here
 * too costs one comparison and turns a failed upload into an instant, specific
 * message. The server check stays authoritative — this is a courtesy, not a
 * security boundary.
 */
export const UPLOAD_LIMIT_BY_TYPE: Record<"IMAGE" | "VIDEO" | "FILE", number> = {
  IMAGE: 10 * 1024 * 1024,
  VIDEO: 100 * 1024 * 1024,
  FILE: 50 * 1024 * 1024,
};

export const ALLOWED_MIME_BY_TYPE: Record<
  "IMAGE" | "VIDEO" | "FILE",
  string[]
> = {
  IMAGE: [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/bmp",
    "image/svg+xml",
    "image/heic",
    "image/heif",
    "image/x-icon",
  ],
  VIDEO: ["video/mp4", "video/webm", "video/quicktime", "video/x-msvideo"],
  FILE: [
    "application/pdf",
    "text/plain",
    "text/markdown",
    "text/csv",
    "text/html",
    "text/calendar",
    "application/json",
    "application/xml",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/epub+zip",
    "application/zip",
    "application/vnd.rar",
    "application/x-7z-compressed",
    "application/x-tar",
    "application/gzip",
    "application/pkcs12",
    "audio/mpeg",
    "audio/wav",
    "audio/ogg",
  ],
};

/** `accept` value for the picker, so the dialog filters before the user does. */
export const FILE_INPUT_ACCEPT = [
  ...ALLOWED_MIME_BY_TYPE.IMAGE,
  ...ALLOWED_MIME_BY_TYPE.VIDEO,
  ...ALLOWED_MIME_BY_TYPE.FILE,
].join(",");

/** Human-readable size, e.g. "1,5 MB". */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** exponent;
  return `${value.toLocaleString("vi-VN", { maximumFractionDigits: 1 })} ${units[exponent]}`;
}

const TYPE_LABEL: Record<"IMAGE" | "VIDEO" | "FILE", string> = {
  IMAGE: "ảnh",
  VIDEO: "video",
  FILE: "tài liệu",
};

/**
 * Returns null when the file may be uploaded, or a message naming the file,
 * the reason and the limit that applies.
 */
export function validateUploadFile(file: File): string | null {
  const type = getMessageTypeFromFile(file);
  const mimeType = getMimeTypeFromFile(file);
  const allowed = ALLOWED_MIME_BY_TYPE[type];
  const limit = UPLOAD_LIMIT_BY_TYPE[type];

  if (!allowed?.includes(mimeType)) {
    return `Không hỗ trợ định dạng của tệp "${file.name}". Bạn có thể gửi ảnh (JPG, PNG, WEBP, GIF), video (MP4, WEBM, MOV) và tài liệu (PDF, Word, Excel, PowerPoint, TXT, CSV, ZIP).`;
  }

  if (!Number.isFinite(file.size) || file.size <= 0) {
    return `Tệp "${file.name}" rỗng hoặc không đọc được.`;
  }

  if (file.size > limit) {
    return `Tệp "${file.name}" nặng ${formatFileSize(file.size)}, vượt giới hạn ${formatFileSize(limit)} cho ${TYPE_LABEL[type]}.`;
  }

  return null;
}
