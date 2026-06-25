import { useEffect, useState } from "react";
import {
  getFileExtension,
  getFilePreviewKind,
  TEXT_PREVIEW_MAX_BYTES,
  truncateTextPreview,
  type FilePreviewKind,
} from "@/utils/filePreview";

export type FilePreviewResult =
  | { status: "loading" }
  | { status: "ready"; kind: "text"; content: string }
  | { status: "ready"; kind: "image"; src: string }
  | { status: "ready"; kind: "fallback"; previewKind: FilePreviewKind }
  | { status: "error" };

async function fetchArrayBuffer(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Fetch failed: ${response.status}`);
  }
  return response.arrayBuffer();
}

async function loadTextPreview(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Fetch failed: ${response.status}`);
  }

  const buffer = await response.arrayBuffer();
  const slice = buffer.slice(0, TEXT_PREVIEW_MAX_BYTES);
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const content = decoder.decode(slice);

  if (content.includes("\u0000")) {
    throw new Error("Binary file");
  }

  return truncateTextPreview(content);
}

async function loadPdfPreview(url: string): Promise<string> {
  const [{ getDocument, GlobalWorkerOptions }, workerUrl] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);

  GlobalWorkerOptions.workerSrc = workerUrl.default;

  const data = await fetchArrayBuffer(url);
  const pdf = await getDocument({ data }).promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 1 });
  const maxWidth = 280;
  const scale = Math.min(1.5, maxWidth / viewport.width);
  const scaledViewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas unavailable");
  }

  canvas.width = scaledViewport.width;
  canvas.height = scaledViewport.height;

  await page.render({
    canvasContext: context,
    viewport: scaledViewport,
    canvas,
  }).promise;

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => {
      if (value) resolve(value);
      else reject(new Error("Failed to render PDF preview"));
    }, "image/jpeg", 0.82);
  });

  return URL.createObjectURL(blob);
}

async function loadOfficeThumbnail(url: string): Promise<string | null> {
  const [{ default: JSZip }, data] = await Promise.all([
    import("jszip"),
    fetchArrayBuffer(url),
  ]);

  const zip = await JSZip.loadAsync(data);

  const candidates = [
    "docProps/thumbnail.jpeg",
    "docProps/thumbnail.jpg",
    "docProps/thumbnail.png",
    "Thumbnails/thumbnail.jpeg",
  ];

  for (const path of candidates) {
    const file = zip.file(path);
    if (!file) continue;
    const blob = await file.async("blob");
    return URL.createObjectURL(blob);
  }

  return null;
}

export function useFilePreview({
  url,
  mimeType,
  fileName,
  size,
  enabled = true,
}: {
  url?: string;
  mimeType?: string;
  fileName?: string;
  size?: string;
  enabled?: boolean;
}): FilePreviewResult {
  const [state, setState] = useState<FilePreviewResult>({ status: "loading" });

  useEffect(() => {
    if (!enabled || !url) {
      setState({ status: "error" });
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;

    const previewKind = getFilePreviewKind(mimeType, fileName || url);
    const ext = getFileExtension(fileName || url);
    const numericSize = Number(size || 0);

    const load = async () => {
      setState({ status: "loading" });

      try {
        if (previewKind === "text") {
          if (numericSize > TEXT_PREVIEW_MAX_BYTES) {
            throw new Error("File too large for text preview");
          }

          const content = await loadTextPreview(url);
          if (cancelled) return;
          setState({ status: "ready", kind: "text", content });
          return;
        }

        if (previewKind === "pdf") {
          objectUrl = await loadPdfPreview(url);
          if (cancelled) return;
          setState({ status: "ready", kind: "image", src: objectUrl });
          return;
        }

        if (previewKind === "office" && ["pptx", "docx", "xlsx"].includes(ext)) {
          objectUrl = await loadOfficeThumbnail(url);
          if (cancelled) return;
          if (objectUrl) {
            setState({ status: "ready", kind: "image", src: objectUrl });
            return;
          }
        }

        if (cancelled) return;
        setState({ status: "ready", kind: "fallback", previewKind });
      } catch {
        if (cancelled) return;
        setState({ status: "ready", kind: "fallback", previewKind });
      }
    };

    void load();

    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [enabled, url, mimeType, fileName, size]);

  return state;
}
