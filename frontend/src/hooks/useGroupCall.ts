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
  /** Gọi khi phòng đóng/rớt kết nối (RoomEvent.Disconnected) để đóng modal. */
  onDisconnected?: () => void;
}

/**
 * Quản lý một phiên gọi nhóm audio qua SFU LiveKit: kết nối phòng, bật micro,
 * theo dõi danh sách người + trạng thái nói/mute, và dọn dẹp khi rời.
 *
 * Tách khỏi cuộc gọi 1-1 (WebRTC P2P trong useWebRTC) — đây là SFU nên chỉ cần
 * một `Room`, không tự dựng RTCPeerConnection.
 */
export function useGroupCall({
  url,
  token,
  onDisconnected,
}: UseGroupCallOptions) {
  const roomRef = useRef<Room | null>(null);
  // Giữ callback trong ref để một identity mới không phải nối/ngắt lại phòng.
  const onDisconnectedRef = useRef(onDisconnected);
  const [participants, setParticipants] = useState<GroupCallParticipant[]>([]);
  const [isMicEnabled, setIsMicEnabled] = useState(true);
  const [connectionState, setConnectionState] =
    useState<GroupCallConnectionState>("connecting");
  const [connectedAt, setConnectedAt] = useState<number | null>(null);

  useEffect(() => {
    onDisconnectedRef.current = onDisconnected;
  }, [onDisconnected]);

  useEffect(() => {
    const room = new Room();
    roomRef.current = room;

    // Container ẩn giữ các <audio> của remote để nghe được tiếng; SDK tự phát.
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
    });

    const refresh = () => {
      const remotes = [...room.remoteParticipants.values()];
      setParticipants([
        describe(room.localParticipant, true),
        ...remotes.map((remote) => describe(remote, false)),
      ]);
    };

    const handleTrackSubscribed = (track: RemoteTrack) => {
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
        await room.connect(url, token);
        if (cancelled) return;
        await room.localParticipant.setMicrophoneEnabled(true);
        if (cancelled) return;
        setIsMicEnabled(true);
        setConnectionState("connected");
        setConnectedAt(Date.now());
        refresh();
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
  }, [url, token]);

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

  const leave = useCallback(() => {
    void roomRef.current?.disconnect();
  }, []);

  return {
    participants,
    isMicEnabled,
    connectionState,
    connectedAt,
    toggleMic,
    leave,
  };
}
