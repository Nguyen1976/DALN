import { useCallback, useEffect, useRef, useState } from "react";

/** Kéo chữ hay kéo link thì không phải chuyện của thanh đính kèm. */
function carriesFiles(transfer: DataTransfer | null): boolean {
  if (!transfer) return false;
  return Array.from(transfer.types).includes("Files");
}

/**
 * Kéo tệp thả vào khung chat để đính kèm.
 *
 * Trả về `dropZoneProps` để gắn lên phần tử bao khung chat, và cờ
 * `isDraggingFiles` để vẽ lớp phủ "Thả để gửi".
 *
 * Tệp thả vào đi qua đúng `addFiles` mà nút kẹp giấy dùng, nên mọi luật về
 * định dạng, dung lượng và số tệp tối đa chỉ có MỘT nơi định nghĩa.
 */
export function useComposerDropZone({
  enabled,
  addFiles,
}: {
  enabled: boolean;
  addFiles: (files: File[]) => void;
}) {
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);

  // `dragleave` bắn mỗi lần con trỏ vượt ranh giới của từng phần tử con, nên
  // một cờ boolean trần sẽ tắt lớp phủ ngay khi chuột đi qua bong bóng tin
  // nhắn đầu tiên. Đếm vào/ra mới biết lúc nào thực sự rời khỏi khung.
  const depth = useRef(0);

  const reset = useCallback(() => {
    depth.current = 0;
    setIsDraggingFiles(false);
  }, []);

  // Thả trượt ra ngoài khung chat thì trình duyệt mở thẳng tệp trong tab hiện
  // tại — đi mất cả cuộc trò chuyện lẫn tin đang gõ dở. Nuốt luôn những cú thả
  // đó, chỉ trong lúc khung chat còn mở.
  useEffect(() => {
    const swallow = (event: DragEvent) => {
      if (!carriesFiles(event.dataTransfer)) return;
      event.preventDefault();
    };
    const onWindowDrop = (event: DragEvent) => {
      swallow(event);
      reset();
    };

    window.addEventListener("dragover", swallow);
    window.addEventListener("drop", onWindowDrop);
    return () => {
      window.removeEventListener("dragover", swallow);
      window.removeEventListener("drop", onWindowDrop);
    };
  }, [reset]);

  const onDragEnter = useCallback(
    (event: React.DragEvent) => {
      if (!enabled || !carriesFiles(event.dataTransfer)) return;
      event.preventDefault();
      depth.current += 1;
      setIsDraggingFiles(true);
    },
    [enabled],
  );

  const onDragOver = useCallback(
    (event: React.DragEvent) => {
      if (!enabled || !carriesFiles(event.dataTransfer)) return;
      // Không chặn mặc định ở đây thì `drop` không bao giờ bắn.
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    },
    [enabled],
  );

  const onDragLeave = useCallback(
    (event: React.DragEvent) => {
      if (!enabled || !carriesFiles(event.dataTransfer)) return;
      event.preventDefault();
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setIsDraggingFiles(false);
    },
    [enabled],
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      if (!enabled || !carriesFiles(event.dataTransfer)) return;
      event.preventDefault();
      reset();
      const files = Array.from(event.dataTransfer.files);
      if (files.length) addFiles(files);
    },
    [enabled, addFiles, reset],
  );

  /**
   * Dán ảnh (chụp màn hình, copy ảnh từ trang khác) vào ô nhập.
   *
   * Chỉ cướp phím dán khi clipboard thực sự mang tệp; dán chữ vẫn chạy như cũ
   * vì khi đó `files` rỗng.
   */
  const onPasteFiles = useCallback(
    (event: React.ClipboardEvent) => {
      if (!enabled) return;
      const files = Array.from(event.clipboardData?.files ?? []);
      if (!files.length) return;
      event.preventDefault();
      addFiles(files);
    },
    [enabled, addFiles],
  );

  return {
    // Suy ra thay vì dọn state trong effect: gửi bị khoá giữa lúc đang kéo
    // (rời nhóm, tệp trước còn đang tải) thì lớp phủ tắt ngay ở lần render đó.
    isDraggingFiles: enabled && isDraggingFiles,
    onPasteFiles,
    dropZoneProps: { onDragEnter, onDragOver, onDragLeave, onDrop },
  };
}
