import { useCallback, useEffect, useRef, useState } from "react";
import {
  Participant,
  RemoteTrack,
  Room,
  RoomEvent,
  Track,
} from "livekit-client";

/**
 * Một người trong cuộc gọi nhóm, đã chuẩn hoá từ LiveKit `Participant` để phần
 * UI không phải chạm trực tiếp vào SDK.
 */
export interface GroupCallParticipant {
  /** `identity` = userId (gateway ký token với identity = userId). */
  identity: string;
  /** Tên hiển thị: `participant.name` (gateway set = username) hoặc identity. */
  name: string;
  isLocal: boolean;
  isSpeaking: boolean;
  /** micro đang tắt (không có audio track đang mở). */
  isMuted: boolean;
  /** camera đang bật (`participant.isCameraEnabled`). */
  isCameraEnabled: boolean;
  /**
   * Track camera của người này để modal tự `attach()` vào thẻ `<video>`; null
   * khi chưa có (audio-only, camera tắt, hoặc remote chưa subscribe về). Hook
   * chỉ phơi ra `Track`; việc attach/detach do MODAL làm để adaptiveStream nhìn
   * thấy phần tử thật mà tự tạm dừng video ngoài màn hình.
   */
  videoTrack?: Track | null;
}

export type GroupCallConnectionState =
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

interface UseGroupCallOptions {
  /** LiveKit URL lấy từ ack (`ack.url`). */
  url: string;
  /** Access token lấy từ ack (`ack.token`). */
  token: string;
  /**
   * Loại cuộc gọi: `'audio'` (mặc định) chỉ bật micro; `'video'` bật thêm camera
   * sau khi kết nối. Tuỳ chọn để giữ tương thích với caller cũ.
   */
  callType?: "audio" | "video";
  /**
   * STUN/TURN (coturn) từ ack để LiveKit vượt NAT chặt/UDP bị chặn. Additive:
   * bổ sung vào ICE do LiveKit tự cấp, KHÔNG ép relay nên đường trực tiếp vẫn ưu
   * tiên. Rỗng/không truyền thì giữ nguyên hành vi cũ.
   */
  iceServers?: RTCIceServer[];
  /** Gọi khi phòng đóng/rớt kết nối (RoomEvent.Disconnected) để đóng modal. */
  onDisconnected?: () => void;
}

/**
 * Quản lý một phiên gọi nhóm (audio hoặc video) qua SFU LiveKit: kết nối phòng,
 * bật micro/camera, theo dõi danh sách người + trạng thái nói/mute/camera, và
 * dọn dẹp khi rời.
 *
 * Tách khỏi cuộc gọi 1-1 (WebRTC P2P trong useWebRTC) — đây là SFU nên chỉ cần
 * một `Room`, không tự dựng RTCPeerConnection.
 */
export function useGroupCall({
  url,
  token,
  callType = "audio",
  iceServers,
  onDisconnected,
}: UseGroupCallOptions) {
  const roomRef = useRef<Room | null>(null);
  // Giữ callback trong ref để một identity mới không phải nối/ngắt lại phòng.
  const onDisconnectedRef = useRef(onDisconnected);
  const [participants, setParticipants] = useState<GroupCallParticipant[]>([]);
  const [isMicEnabled, setIsMicEnabled] = useState(true);
  const [isCameraEnabled, setIsCameraEnabled] = useState(false);
  const [connectionState, setConnectionState] =
    useState<GroupCallConnectionState>("connecting");
  const [connectedAt, setConnectedAt] = useState<number | null>(null);

  useEffect(() => {
    onDisconnectedRef.current = onDisconnected;
  }, [onDisconnected]);

  useEffect(() => {
    // adaptiveStream tự tạm dừng video mà thẻ `<video>` của nó không hiển thị
    // (đây là điểm tiết kiệm băng thông — luôn bật); dynacast tắt encode layer
    // không ai xem.
    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;

    // Container ẩn giữ các <audio> của remote để nghe được tiếng; SDK tự phát.
    // Video KHÔNG attach ở đây — modal tự attach để adaptiveStream hoạt động.
    const audioContainer = document.createElement("div");
    audioContainer.style.display = "none";
    document.body.append(audioContainer);

    const describe = (
      participant: Participant,
      isLocal: boolean,
    ): GroupCallParticipant => ({
      identity: participant.identity,
      name: participant.name || participant.identity,
      isLocal,
      isSpeaking: participant.isSpeaking,
      isMuted: !participant.isMicrophoneEnabled,
      isCameraEnabled: participant.isCameraEnabled,
      videoTrack:
        participant.getTrackPublication(Track.Source.Camera)?.track ?? null,
    });

    const refresh = () => {
      const remotes = [...room.remoteParticipants.values()];
      setParticipants([
        describe(room.localParticipant, true),
        ...remotes.map((remote) => describe(remote, false)),
      ]);
    };

    const handleTrackSubscribed = (track: RemoteTrack) => {
      // Chỉ audio được gắn vào container ẩn để phát tiếng; video để modal attach.
      if (track.kind === Track.Kind.Audio) {
        const element = track.attach();
        element.style.display = "none";
        audioContainer.append(element);
      }
      refresh();
    };

    const handleTrackUnsubscribed = (track: RemoteTrack) => {
      if (track.kind === Track.Kind.Audio) {
        track.detach().forEach((element) => element.remove());
      }
      refresh();
    };

    room
      .on(RoomEvent.ParticipantConnected, refresh)
      .on(RoomEvent.ParticipantDisconnected, refresh)
      .on(RoomEvent.TrackSubscribed, handleTrackSubscribed)
      .on(RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed)
      .on(RoomEvent.TrackMuted, refresh)
      .on(RoomEvent.TrackUnmuted, refresh)
      .on(RoomEvent.ActiveSpeakersChanged, refresh)
      .on(RoomEvent.LocalTrackPublished, refresh)
      .on(RoomEvent.LocalTrackUnpublished, refresh)
      .on(RoomEvent.Disconnected, () => {
        setConnectionState("disconnected");
        onDisconnectedRef.current?.();
      });

    let cancelled = false;
    void (async () => {
      try {
        // rtcConfig.iceServers bổ sung STUN/TURN (coturn) vào ICE mà LiveKit tự
        // cấp — giúp client sau NAT chặt vẫn tới được SFU. Không truyền thì kết
        // nối như cũ.
        await room.connect(
          url,
          token,
          iceServers && iceServers.length
            ? { rtcConfig: { iceServers } }
            : undefined,
        );
        if (cancelled) return;
        await room.localParticipant.setMicrophoneEnabled(true);
        if (cancelled) return;
        setIsMicEnabled(true);
        // Vào phòng + có micro là coi như đã kết nối: KHÔNG chờ camera, vì bật
        // camera có thể chậm/kẹt và không được giữ UI mãi ở "đang kết nối".
        setConnectionState("connected");
        setConnectedAt(Date.now());
        refresh();
        // Cuộc gọi video: bật camera ở nền. Lỗi/chậm camera KHÔNG làm rớt cuộc
        // gọi — audio vẫn sống; publish xong thì cập nhật cờ + roster.
        if (callType === "video") {
          void room.localParticipant
            .setCameraEnabled(true)
            .then(() => {
              if (cancelled) return;
              setIsCameraEnabled(true);
              refresh();
            })
            .catch(() => {
              // Giữ camera tắt, cuộc gọi vẫn tiếp tục ở dạng audio.
            });
        }
      } catch {
        if (cancelled) return;
        setConnectionState("error");
      }
    })();

    return () => {
      cancelled = true;
      room.removeAllListeners();
      void room.disconnect();
      audioContainer.remove();
      roomRef.current = null;
    };
    // iceServers đến cùng ack (cùng lúc với url/token) và được cha giữ trong
    // state nên tham chiếu ổn định — không gây nối lại phòng ngoài ý muốn.
  }, [url, token, callType, iceServers]);

  const toggleMic = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const next = !room.localParticipant.isMicrophoneEnabled;
    await room.localParticipant.setMicrophoneEnabled(next);
    setIsMicEnabled(next);
    // Cập nhật badge mute của chính mình ngay, không đợi vòng refresh sự kiện.
    setParticipants((prev) =>
      prev.map((participant) =>
        participant.isLocal ? { ...participant, isMuted: !next } : participant,
      ),
    );
  }, []);

  const toggleCamera = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const next = !room.localParticipant.isCameraEnabled;
    try {
      await room.localParticipant.setCameraEnabled(next);
      setIsCameraEnabled(next);
      // Cập nhật ngay track/cờ camera của chính mình, không đợi vòng refresh.
      setParticipants((prev) =>
        prev.map((participant) =>
          participant.isLocal
            ? {
                ...participant,
                isCameraEnabled: next,
                videoTrack:
                  room.localParticipant.getTrackPublication(Track.Source.Camera)
                    ?.track ?? null,
              }
            : participant,
        ),
      );
    } catch {
      // Bỏ qua lỗi bật/tắt camera — không làm rớt cuộc gọi.
    }
  }, []);

  // Đổi camera đang dùng (ví dụ trước/sau trên điện thoại). Optional-safe: một số
  // trình duyệt không hỗ trợ switchActiveDevice.
  const switchCamera = useCallback(async (deviceId: string) => {
    const room = roomRef.current;
    if (!room) return;
    try {
      await room.switchActiveDevice("videoinput", deviceId);
    } catch {
      // Không hỗ trợ / bị từ chối — giữ nguyên camera hiện tại.
    }
  }, []);

  const leave = useCallback(() => {
    void roomRef.current?.disconnect();
  }, []);

  return {
    participants,
    isMicEnabled,
    isCameraEnabled,
    connectionState,
    connectedAt,
    toggleMic,
    toggleCamera,
    switchCamera,
    leave,
  };
}
