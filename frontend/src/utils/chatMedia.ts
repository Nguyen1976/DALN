export function getMessageTypeFromFile(
  file: File,
): "IMAGE" | "VIDEO" | "FILE" {
  if (file.type.startsWith("image/")) return "IMAGE";
  if (file.type.startsWith("video/")) return "VIDEO";
  return "FILE";
}

export function getMimeTypeFromFile(file: File): string {
  if (file.type) return file.type;

  const fileName = file.name.toLowerCase();
  if (
    fileName.endsWith(".java") ||
    fileName.endsWith(".txt") ||
    fileName.endsWith(".md") ||
    fileName.endsWith(".csv") ||
    fileName.endsWith(".py")
  ) {
    return "text/plain";
  }
  if (fileName.endsWith(".json")) return "application/json";
  if (fileName.endsWith(".js") || fileName.endsWith(".jsx")) {
    return "text/plain";
  }
  if (fileName.endsWith(".ts") || fileName.endsWith(".tsx")) {
    return "text/plain";
  }

  return "application/octet-stream";
}
