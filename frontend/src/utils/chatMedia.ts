const EXTENSION_MIME_MAP: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  heic: "image/heic",
  heif: "image/heif",
  ico: "image/x-icon",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  avi: "video/x-msvideo",
  pdf: "application/pdf",
  epub: "application/epub+zip",
  zip: "application/zip",
  rar: "application/vnd.rar",
  "7z": "application/x-7z-compressed",
  tar: "application/x-tar",
  gz: "application/gzip",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  pem: "text/plain",
  key: "text/plain",
  crt: "text/plain",
  cer: "text/plain",
  p12: "application/pkcs12",
  pfx: "application/pkcs12",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  xml: "application/xml",
  html: "text/html",
  htm: "text/html",
  ics: "text/calendar",
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
  env: "text/plain",
};

const BROWSER_MIME_ALIASES: Record<string, string> = {
  "application/x-sh": "text/plain",
  "text/x-sh": "text/plain",
  "text/x-shellscript": "text/plain",
  "application/javascript": "text/plain",
  "text/javascript": "text/plain",
  "application/x-pem-file": "text/plain",
  "application/x-x509-ca-cert": "text/plain",
  "application/x-x509-user-cert": "text/plain",
  "application/pkix-cert": "text/plain",
  "application/pkcs8": "text/plain",
  "application/x-pkcs12": "application/pkcs12",
  "application/x-zip-compressed": "application/zip",
  "application/x-rar-compressed": "application/vnd.rar",
};

const GENERIC_BROWSER_MIME_TYPES = new Set([
  "",
  "application/octet-stream",
  "application/binary",
  "binary/octet-stream",
]);

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

  if (GENERIC_BROWSER_MIME_TYPES.has(aliased)) {
    return extensionMime;
  }

  if (extensionMime !== "application/octet-stream") {
    return extensionMime;
  }

  return aliased || extensionMime;
}
