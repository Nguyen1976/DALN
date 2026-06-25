const TEXT_EXTENSIONS = new Set([
  "txt",
  "md",
  "markdown",
  "csv",
  "json",
  "xml",
  "yaml",
  "yml",
  "js",
  "jsx",
  "ts",
  "tsx",
  "java",
  "kt",
  "go",
  "py",
  "rb",
  "c",
  "cpp",
  "h",
  "hpp",
  "php",
  "sh",
  "bash",
  "zsh",
  "sql",
  "log",
  "env",
  "ini",
  "cfg",
  "conf",
  "html",
  "css",
  "scss",
]);

const OFFICE_EXTENSIONS = new Set([
  "ppt",
  "pptx",
  "doc",
  "docx",
  "xls",
  "xlsx",
]);

export type FilePreviewKind = "text" | "pdf" | "office" | "fallback";

export function getFileExtension(source?: string): string {
  if (!source) return "";
  const clean = source.split("?")[0].split("#")[0];
  const name = clean.split("/").pop() || clean;
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return "";
  return name.slice(dot + 1).toLowerCase();
}

export function getFileNameFromUrl(url?: string, fileName?: string): string {
  if (fileName?.trim()) return fileName.trim();

  if (!url) return "Tệp đính kèm";

  try {
    const parsed = new URL(url);
    const rawName = parsed.pathname.split("/").pop() || "Tệp đính kèm";
    return decodeURIComponent(rawName);
  } catch {
    const rawName = url.split("/").pop() || "Tệp đính kèm";
    return decodeURIComponent(rawName);
  }
}

export function formatBytes(size?: string): string {
  const value = Number(size || 0);
  if (!Number.isFinite(value) || value <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let index = 0;
  let current = value;
  while (current >= 1024 && index < units.length - 1) {
    current /= 1024;
    index += 1;
  }
  return `${current.toFixed(current >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

export function getFilePreviewKind(
  mimeType?: string,
  fileNameOrUrl?: string,
): FilePreviewKind {
  const mime = String(mimeType || "").toLowerCase();
  const ext = getFileExtension(fileNameOrUrl);

  if (mime === "application/pdf" || ext === "pdf") return "pdf";

  if (
    OFFICE_EXTENSIONS.has(ext) ||
    mime.includes("officedocument") ||
    mime.includes("ms-powerpoint") ||
    mime.includes("msword") ||
    mime.includes("ms-excel")
  ) {
    return "office";
  }

  if (
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime === "application/xml" ||
    TEXT_EXTENSIONS.has(ext)
  ) {
    return "text";
  }

  return "fallback";
}

export function getOfficeAccent(ext: string): string {
  if (ext === "pdf") return "bg-red-500";
  if (["ppt", "pptx"].includes(ext)) return "bg-orange-500";
  if (["doc", "docx"].includes(ext)) return "bg-blue-500";
  if (["xls", "xlsx"].includes(ext)) return "bg-emerald-500";
  if (TEXT_EXTENSIONS.has(ext)) return "bg-slate-600";
  if (["zip", "rar", "7z"].includes(ext)) return "bg-amber-500";
  return "bg-primary";
}

export function truncateTextPreview(content: string, maxLines = 10): string {
  return content
    .replace(/\r\n/g, "\n")
    .split("\n")
    .slice(0, maxLines)
    .map((line) => (line.length > 96 ? `${line.slice(0, 96)}…` : line))
    .join("\n")
    .trim();
}

export const TEXT_PREVIEW_MAX_BYTES = 256 * 1024;
