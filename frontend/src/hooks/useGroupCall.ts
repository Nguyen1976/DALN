import { useCallback, useEffect, useState } from "react";
import { type RtkPeer, useRtkRoom } from "@/hooks/useRtkRoom";

/** Một người trong cuộc gọi nhóm; `identity` = userId, videoTrack là MediaStreamTrack. */
export type GroupCallParticipant = RtkPeer;

export type GroupCallConnectionState =
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

interface UseGroupCallOptions {
  /** authToken RealtimeKit lấy từ ack group_call.start / group_call.accept. */
  authToken: string;
  callType?: "audio" | "video";
  /** Cuộc gọi video có bật camera khi vào không ("Tham gia chỉ âm thanh" = false). */
  startWithCamera?: boolean;
  /** Rớt khỏi phòng giữa cuộc gọi — modal đóng lại. */
  onDisconnected?: () => void;
}

/**
 * Một phiên gọi nhóm trên Cloudflare RealtimeKit. Giữ nguyên hình dạng trả về
 * của bản LiveKit trước đây để GroupCallModal không phải đổi bố cục.
 */
export function useGroupCall({
  authToken,
  callType = "audio",
  startWithCamera = true,
  onDisconnected,
}: UseGroupCallOptions) {
  const room = useRtkRoom({
    authToken,
    audio: true,
    video: callType === "video" && startWithCamera,
    onDisconnected,
  });
  const [connectedAt, setConnectedAt] = useState<number | null>(null);

  useEffect(() => {
    if (room.state === "connected") setConnectedAt((prev) => prev ?? Date.now());
  }, [room.state]);

  const connectionState: GroupCallConnectionState =
    room.state === "connected"
      ? "connected"
      : room.state === "failed"
        ? "error"
        : room.state === "left"
          ? "disconnected"
          : "connecting";

  const { toggleMic: rtkToggleMic, toggleCamera: rtkToggleCamera, leave: rtkLeave } = room;
  const toggleMic = useCallback(async () => {
    await rtkToggleMic();
  }, [rtkToggleMic]);
  const toggleCamera = useCallback(async () => {
    await rtkToggleCamera();
  }, [rtkToggleCamera]);
  const leave = useCallback(() => {
    void rtkLeave();
  }, [rtkLeave]);

  return {
    participants: room.peers,
    isMicEnabled: room.micOn,
    isCameraEnabled: room.cameraOn,
    connectionState,
    connectedAt,
    toggleMic,
    toggleCamera,
    switchCamera: room.switchCamera,
    leave,
    needsAudioUnlock: room.needsAudioUnlock,
    unlockAudio: room.unlockAudio,
  };
}
