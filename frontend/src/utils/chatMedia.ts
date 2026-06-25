const EXTENSION_MIME_MAP: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  pdf: "application/pdf",
  zip: "application/zip",
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  xml: "application/xml",
  yaml: "text/plain",
  yml: "text/plain",
  js: "text/plain",
  jsx: "text/plain",
  ts: "text/plain",
  tsx: "text/plain",
  java: "text/plain",
  kt: "text/plain",
  go: "text/plain",
  py: "text/plain",
  rb: "text/plain",
  c: "text/plain",
  cpp: "text/plain",
  h: "text/plain",
  hpp: "text/plain",
  php: "text/plain",
  sh: "text/plain",
  bash: "text/plain",
  zsh: "text/plain",
  sql: "text/plain",
  log: "text/plain",
};

const BROWSER_MIME_ALIASES: Record<string, string> = {
  "application/x-sh": "text/plain",
  "text/x-sh": "text/plain",
  "text/x-shellscript": "text/plain",
  "application/javascript": "text/plain",
  "text/javascript": "text/plain",
};

function getMimeTypeFromFileName(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  return EXTENSION_MIME_MAP[ext] || "application/octet-stream";
}

export function getMessageTypeFromFile(
  file: File,
): "IMAGE" | "VIDEO" | "FILE" {
  const mimeType = getMimeTypeFromFile(file);
  if (mimeType.startsWith("image/")) return "IMAGE";
  if (mimeType.startsWith("video/")) return "VIDEO";
  if (file.type.startsWith("image/")) return "IMAGE";
  if (file.type.startsWith("video/")) return "VIDEO";
  return "FILE";
}

export function getMimeTypeFromFile(file: File): string {
  const reported = file.type.trim().toLowerCase();
  const aliased = BROWSER_MIME_ALIASES[reported] || reported;
  const extensionMime = getMimeTypeFromFileName(file.name);

  if (aliased.startsWith("image/") || aliased.startsWith("video/")) {
    return aliased;
  }

  if (
    !aliased ||
    aliased === "application/octet-stream" ||
    aliased === "application/binary"
  ) {
    return extensionMime;
  }

  return aliased;
}
