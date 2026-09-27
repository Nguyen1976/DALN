import { useCallback, useEffect, useRef, useState } from "react";
import type RealtimeKitClient from "@cloudflare/realtimekit";

type RtkClient = Awaited<ReturnType<typeof RealtimeKitClient.init>>;
type RtkRemote = ReturnType<RtkClient["participants"]["joined"]["toArray"]>[number];

/** Một người trong phòng, đã chuẩn hoá để UI không chạm trực tiếp SDK. */
export interface RtkPeer {
  /** userId — lấy từ custom_participant_id `<userId>.<hex>` do gateway cấp. */
  identity: string;
  name: string;
  isLocal: boolean;
  isSpeaking: boolean;
  isMuted: boolean;
  isCameraEnabled: boolean;
  videoTrack: MediaStreamTrack | null;
  /** Chỉ có ở người khác; tiếng của chính mình không bao giờ được phát lại. */
  audioTrack: MediaStreamTrack | null;
}

export type RtkRoomState = "connecting" | "connected" | "failed" | "left";

export function userIdFromCustomId(id?: string | null): string {
  return (id ?? "").split(".")[0] ?? "";
}

/** Thời gian giữ vòng "đang nói" sau sự kiện activeSpeaker cuối cùng. */
const SPEAKING_HOLD_MS = 1500;

interface UseRtkRoomOptions {
  /** null = chưa có token (chưa gọi/nhận) → chưa vào phòng. */
  authToken: string | null;
  audio: boolean;
  video: boolean;
  /**
   * true (mặc định): hook tự phát tiếng người khác qua các <audio> ẩn. Cuộc gọi
   * 1-1 truyền false vì VoiceCallModal đã có thẻ <audio> riêng.
   */
  manageAudio?: boolean;
  /** Rớt khỏi phòng GIỮA cuộc gọi (sau khi đã vào): failed/disconnected. */
  onDisconnected?: () => void;
}

/**
 * Vào một phòng Cloudflare RealtimeKit bằng authToken do gateway cấp, và phơi ra
 * danh sách người + điều khiển mic/camera. SDK được import động: người chưa gọi
 * không phải tải ~170 KB gzip.
 */
export function useRtkRoom({
  authToken,
  audio,
  video,
  manageAudio = true,
  onDisconnected,
}: UseRtkRoomOptions) {
  const clientRef = useRef<RtkClient | null>(null);
  const [peers, setPeers] = useState<RtkPeer[]>([]);
  const [state, setState] = useState<RtkRoomState>("connecting");
  const [micOn, setMicOn] = useState(audio);
  const [cameraOn, setCameraOn] = useState(video);
  const [needsAudioUnlock, setNeedsAudioUnlock] = useState(false);
  const onDisconnectedRef = useRef(onDisconnected);
  const audioEls = useRef(new Map<string, HTMLAudioElement>());
  // Giá trị mới nhất của audio/video/manageAudio, đọc LÚC VÀO PHÒNG. Không làm
  // deps của effect vào phòng (đổi camera giữa cuộc gọi là việc của toggle*),
  // nhưng phải là giá trị của lần render có authToken — useDirectCall đặt
  // withCamera và authToken trong cùng một lượt. Effect đồng bộ này khai báo
  // TRƯỚC effect vào phòng nên chạy trước nó trong cùng commit.
  const latest = useRef({ audio, video, manageAudio });

  useEffect(() => {
    latest.current = { audio, video, manageAudio };
  }, [audio, video, manageAudio]);

  useEffect(() => {
    onDisconnectedRef.current = onDisconnected;
  }, [onDisconnected]);

  useEffect(() => {
    if (!authToken) return;
    let cancelled = false;
    let joined = false;
    let speakingId: string | null = null;
    let speakingTimer: ReturnType<typeof setTimeout> | undefined;
    const els = audioEls.current;

    const syncAudio = (client: RtkClient) => {
      if (!latest.current.manageAudio) return;
      const alive = new Set<string>();
      for (const p of client.participants.joined.toArray()) {
        const track = p.audioEnabled ? p.audioTrack : null;
        if (!track) continue;
        alive.add(p.id);
        let el = els.get(p.id);
        if (!el) {
          el = document.createElement("audio");
          el.autoplay = true;
          el.style.display = "none";
          document.body.append(el);
          els.set(p.id, el);
        }
        const current = (el.srcObject as MediaStream | null)?.getAudioTracks()[0];
        if (current !== track) {
          el.srcObject = new MediaStream([track]);
          void el.play().catch(() => setNeedsAudioUnlock(true));
        }
      }
      for (const [id, el] of els) {
        if (!alive.has(id)) {
          el.remove();
          els.delete(id);
        }
      }
    };

    const describeRemote = (p: RtkRemote): RtkPeer => ({
      identity: userIdFromCustomId(p.customParticipantId),
      name: p.name || userIdFromCustomId(p.customParticipantId),
      isLocal: false,
      isSpeaking: speakingId === p.id,
      isMuted: !p.audioEnabled,
      isCameraEnabled: p.videoEnabled,
      videoTrack: p.videoEnabled ? (p.videoTrack ?? null) : null,
      audioTrack: p.audioEnabled ? (p.audioTrack ?? null) : null,
    });

    const refresh = () => {
      const client = clientRef.current;
      if (!client) return;
      const self = client.self;
      setPeers([
        {
          identity: userIdFromCustomId(self.customParticipantId),
          name: self.name,
          isLocal: true,
          isSpeaking: speakingId === self.id,
          isMuted: !self.audioEnabled,
          isCameraEnabled: self.videoEnabled,
          videoTrack: self.videoEnabled ? (self.videoTrack ?? null) : null,
          audioTrack: null,
        },
        ...client.participants.joined.toArray().map(describeRemote),
      ]);
      setMicOn(self.audioEnabled);
      setCameraOn(self.videoEnabled);
      syncAudio(client);
    };

    void (async () => {
      try {
        const { default: RTK } = await import("@cloudflare/realtimekit");
        const client = await RTK.init({
          authToken,
          defaults: {
            audio: latest.current.audio,
            video: latest.current.video,
          },
        });
        if (cancelled) {
          void client.leave().catch(() => undefined);
          return;
        }
        clientRef.current = client;

        const joinedMap = client.participants.joined;
        joinedMap.on("participantJoined", refresh);
        joinedMap.on("participantLeft", refresh);
        joinedMap.on("videoUpdate", refresh);
        joinedMap.on("audioUpdate", refresh);
        client.participants.on("activeSpeaker", ({ peerId }) => {
          speakingId = peerId;
          if (speakingTimer) clearTimeout(speakingTimer);
          speakingTimer = setTimeout(() => {
            speakingId = null;
            refresh();
          }, SPEAKING_HOLD_MS);
          refresh();
        });
        client.self.on("videoUpdate", refresh);
        client.self.on("audioUpdate", refresh);
        client.self.on("autoplayError", () => setNeedsAudioUnlock(true));
        client.self.on("roomLeft", ({ state: leftState }) => {
          if (cancelled) return;
          if (
            joined &&
            (leftState === "failed" || leftState === "disconnected")
          ) {
            setState("failed");
            onDisconnectedRef.current?.();
          } else {
            setState("left");
          }
        });

        await client.join();
        if (cancelled) {
          void client.leave().catch(() => undefined);
          return;
        }
        joined = true;
        setState("connected");
        refresh();
      } catch {
        if (!cancelled) setState("failed");
      }
    })();

    return () => {
      cancelled = true;
      if (speakingTimer) clearTimeout(speakingTimer);
      const client = clientRef.current;
      clientRef.current = null;
      if (client) {
        client.participants.joined.removeAllListeners();
        client.participants.removeAllListeners();
        client.self.removeAllListeners();
        void client.leave().catch(() => undefined);
      }
      els.forEach((el) => el.remove());
      els.clear();
      setPeers([]);
      // Trạng thái của cuộc gọi trước không được lọt sang cuộc gọi sau: một
      // "failed" còn sót sẽ làm useDirectCall báo không kết nối được ngay.
      setState("connecting");
      setNeedsAudioUnlock(false);
    };
  }, [authToken]);

  const toggleMic = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return false;
    try {
      if (client.self.audioEnabled) await client.self.disableAudio();
      else await client.self.enableAudio();
    } catch {
      // Giữ nguyên trạng thái nếu SDK/thiết bị từ chối.
    }
    setMicOn(client.self.audioEnabled);
    return client.self.audioEnabled;
  }, []);

  const toggleCamera = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return false;
    try {
      if (client.self.videoEnabled) await client.self.disableVideo();
      else await client.self.enableVideo();
    } catch {
      // Preset cấm video (cuộc gọi thoại) hoặc camera bận: giữ nguyên.
    }
    setCameraOn(client.self.videoEnabled);
    return client.self.videoEnabled;
  }, []);

  const switchCamera = useCallback(async () => {
    const client = clientRef.current;
    if (!client?.self.videoEnabled) return;
    try {
      const devices = await client.self.getVideoDevices();
      if (devices.length < 2) return;
      const currentId = client.self.videoTrack?.getSettings().deviceId;
      const idx = devices.findIndex((d) => d.deviceId === currentId);
      const next = devices[(idx + 1) % devices.length];
      if (next && next.deviceId !== currentId) await client.self.setDevice(next);
    } catch {
      // Không đổi được — giữ camera hiện tại.
    }
  }, []);

  const leave = useCallback(async () => {
    const client = clientRef.current;
    if (client) await client.leave().catch(() => undefined);
  }, []);

  const unlockAudio = useCallback(() => {
    audioEls.current.forEach((el) => void el.play().catch(() => undefined));
    setNeedsAudioUnlock(false);
  }, []);

  return {
    peers,
    state,
    micOn,
    cameraOn,
    needsAudioUnlock,
    toggleMic,
    toggleCamera,
    switchCamera,
    leave,
    unlockAudio,
  };
}
