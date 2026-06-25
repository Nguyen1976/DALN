import { cn } from "@/lib/utils";
import { useFilePreview } from "@/hooks/useFilePreview";
import {
  formatBytes,
  getFileExtension,
  getFileNameFromUrl,
  getOfficeAccent,
} from "@/utils/filePreview";
import { FileText, Loader2 } from "lucide-react";

type FileAttachmentPreviewProps = {
  url: string;
  mimeType?: string;
  size?: string;
  fileName?: string;
  className?: string;
};

function FileExtensionBadge({ ext }: { ext: string }) {
  const label = ext ? ext.toUpperCase() : "FILE";

  return (
    <div
      className={cn(
        "flex h-16 w-14 flex-col items-center justify-center rounded-md text-white shadow-sm",
        getOfficeAccent(ext),
      )}
    >
      <FileText className="mb-1 h-5 w-5 opacity-90" />
      <span className="text-[10px] font-bold tracking-wide">{label}</span>
    </div>
  );
}

export default function FileAttachmentPreview({
  url,
  mimeType,
  size,
  fileName,
  className,
}: FileAttachmentPreviewProps) {
  const displayName = getFileNameFromUrl(url, fileName);
  const ext = getFileExtension(fileName || displayName || url);
  const preview = useFilePreview({ url, mimeType, fileName: displayName, size });

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "mb-2 block w-full max-w-[280px] overflow-hidden rounded-xl border border-border/60 bg-background/50 transition-colors hover:bg-background/80",
        className,
      )}
    >
      <div className="relative min-h-[120px] bg-muted/30">
        {preview.status === "loading" && (
          <div className="flex min-h-[120px] items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {preview.status === "ready" && preview.kind === "text" && (
          <pre className="max-h-44 overflow-hidden whitespace-pre-wrap break-all px-3 py-2 font-mono text-[11px] leading-5 text-foreground/90">
            {preview.content || " "}
          </pre>
        )}

        {preview.status === "ready" && preview.kind === "image" && (
          <img
            src={preview.src}
            alt={`Xem trước ${displayName}`}
            className="max-h-52 w-full object-cover object-top"
          />
        )}

        {preview.status === "ready" && preview.kind === "fallback" && (
          <div className="flex min-h-[120px] items-center justify-center px-4 py-6">
            <FileExtensionBadge ext={ext} />
          </div>
        )}

        {preview.status === "error" && (
          <div className="flex min-h-[120px] items-center justify-center px-4 py-6">
            <FileExtensionBadge ext={ext} />
          </div>
        )}
      </div>

      <div className="border-t border-border/50 px-3 py-2">
        <p className="truncate text-sm font-medium">{displayName}</p>
        <p className="text-xs text-muted-foreground">
          {formatBytes(size) || "Mở tệp"}
        </p>
      </div>
    </a>
  );
}
