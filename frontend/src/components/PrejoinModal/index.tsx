import { useEffect, useRef, useState } from "react";
import { Phone, Video, VideoOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

/**
 * Màn hình xem trước trước khi gọi VIDEO (thiết kế mục 02): người gọi thấy camera
 * của mình, chọn bật/tắt camera, rồi mới bắt đầu. Preview là LOCAL — chưa publish
 * cho ai. Tắt camera ở đây = bắt đầu ở dạng thoại (vẫn nghe/nói, bật lại sau).
 */
export default function PrejoinModal({
  scope,
  title,
  avatarUrl,
  onConfirm,
  onCancel,
}: {
  scope: "direct" | "group";
  title: string;
  avatarUrl?: string;
  /** Bắt đầu cuộc gọi với camera bật hay tắt. */
  onConfirm: (cameraOn: boolean) => void;
  onCancel: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraOn, setCameraOn] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Lấy camera để xem trước; tôn trọng cờ cameraOn. Dọn stream khi tắt/đóng.
  useEffect(() => {
    let cancelled = false;
    if (!cameraOn) {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
      return;
    }
    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play().catch(() => undefined);
        }
      } catch {
        if (!cancelled) setError("Không truy cập được camera. Có thể bắt đầu ở dạng thoại.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cameraOn]);

  // Dọn stream khi unmount (bắt đầu gọi / huỷ).
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Xem trước cuộc gọi"
      className="fixed inset-0 z-50 flex animate-overlay-in items-center justify-center bg-foreground/60 p-4 backdrop-blur-sm"
    >
      <div className="relative flex w-full max-w-md animate-dialog-in flex-col rounded-2xl border border-white/10 bg-neutral-950 p-6 text-white shadow-lg">
        <button
          type="button"
          onClick={onCancel}
          aria-label="Đóng"
          className="absolute right-4 top-4 flex size-8 items-center justify-center rounded-full bg-white/10 hover:bg-white/20"
        >
          <X className="size-4" />
        </button>

        <h3 className="mb-1 text-center text-lg font-semibold">{title}</h3>
        <p className="mb-4 text-center text-sm text-white/70">
          Xem trước trước khi gọi{scope === "group" ? " nhóm" : ""}
        </p>

        <div className="relative mb-4 aspect-video w-full overflow-hidden rounded-xl bg-neutral-900">
          {cameraOn ? (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              style={{ transform: "scaleX(-1)" }}
              className="size-full bg-neutral-900 object-contain"
            />
          ) : (
            <div className="flex size-full flex-col items-center justify-center gap-2">
              <Avatar className="size-20">
                <AvatarImage src={avatarUrl || ""} alt="" />
                <AvatarFallback className="text-2xl">
                  {title?.[0] || "?"}
                </AvatarFallback>
              </Avatar>
              <span className="text-sm text-white/70">Camera đang tắt</span>
            </div>
          )}
        </div>

        {error && (
          <p className="mb-3 text-center text-xs text-warning-text">{error}</p>
        )}

        <div className="mb-5 flex items-center justify-center">
          <Button
            variant="secondary"
            size="icon"
            onClick={() => setCameraOn((v) => !v)}
            aria-label={cameraOn ? "Tắt camera" : "Bật camera"}
            aria-pressed={!cameraOn}
            className={cn("size-14 rounded-full")}
          >
            {cameraOn ? (
              <Video className="size-6" />
            ) : (
              <VideoOff className="size-6" />
            )}
          </Button>
        </div>

        <div className="flex items-center justify-center gap-3">
          <Button variant="secondary" onClick={onCancel} className="min-w-24">
            Hủy
          </Button>
          <Button
            variant="success"
            onClick={() => onConfirm(cameraOn)}
            className="min-w-32"
          >
            {scope === "group" ? (
              <>
                <Phone className="mr-1.5 size-4" /> Bắt đầu
              </>
            ) : (
              <>
                <Phone className="mr-1.5 size-4" /> Gọi
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
