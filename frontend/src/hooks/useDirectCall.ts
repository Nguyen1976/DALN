import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { SOCKET_EVENTS } from "@/lib/socket.events";
import { useRtkRoom } from "@/hooks/useRtkRoom";
import {
  CallSetupError,
  type CallSetupErrorCode,
  probeLocalMedia,
} from "@/utils/callErrors";

export type CallStatus =
  | "idle"
  | "calling"
  | "ringing"
  | "connecting"
  | "connected"
  | "ended"
  | "rejected"
  | "no_answer"
  | "unreachable";

export type CallType = "audio" | "video";

/** Chờ ack gọi/nhận: server có thể mất tới 8s gọi API media + tra quyền. */
const CALL_ACK_TIMEOUT_MS = 12000;
/** Đã nhận cuộc gọi mà quá 15s chưa thấy bên kia trong phòng → không nối được. */
const CONNECTING_TIMEOUT_MS = 15000;
/** Đang nói chuyện mà bên kia biến khỏi phòng quá lâu (và không có call.ended). */
const PEER_GONE_GRACE_MS = 8000;

type CallAck =
  | { ok: true; callId?: string; authToken: string }
  | { ok: false; code: CallSetupErrorCode }
  | null;

function emitWithAck(socket: Socket, event: string, payload: unknown) {
  return new Promise<CallAck>((resolve) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(null);
    }, CALL_ACK_TIMEOUT_MS);
    socket.emit(event, payload, (res: CallAck) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(res ?? null);
    });
  });
}

/**
 * Cuộc gọi 1-1 trên Cloudflare RealtimeKit. Nghiệp vụ (đổ chuông, nhận, từ chối,
 * kết thúc) vẫn đi qua socket như trước; media là một phòng RealtimeKit 2 người
 * mà gateway cấp token qua ack. Giữ nguyên hình dạng trả về của useWebRTC cũ để
 * VoiceCallModal không phải đổi bố cục.
 */
export const useDirectCall = (socket: Socket) => {
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [withCamera, setWithCamera] = useState(false);
  const [callStatus, setCallStatus] = useState<CallStatus>("idle");
  const [callType, setCallType] = useState<CallType>("audio");
  const [connectedAt, setConnectedAt] = useState<number | null>(null);
  const callIdRef = useRef<string | null>(null);
  const statusRef = useRef<CallStatus>("idle");
  const connectingTimerRef = useRef<number | null>(null);
  const peerGoneTimerRef = useRef<number | null>(null);

  useEffect(() => {
    statusRef.current = callStatus;
  }, [callStatus]);

  const clearTimers = useCallback(() => {
    if (connectingTimerRef.current !== null) {
      window.clearTimeout(connectingTimerRef.current);
      connectingTimerRef.current = null;
    }
    if (peerGoneTimerRef.current !== null) {
      window.clearTimeout(peerGoneTimerRef.current);
      peerGoneTimerRef.current = null;
    }
  }, []);

  const cleanup = useCallback(() => {
    clearTimers();
    setAuthToken(null);
    setWithCamera(false);
    setCallType("audio");
    setCallStatus("idle");
  }, [clearTimers]);

  const endCall = useCallback(
    (reason?: "no_answer" | "unreachable", options?: { emit?: boolean }) => {
      const callId = callIdRef.current;
      if ((options?.emit ?? true) && callId) {
        socket.emit(SOCKET_EVENTS.CALL.CALL_ENDED, { callId, reason });
      }
      callIdRef.current = null;
      setConnectedAt(null);
      cleanup();
      setCallStatus(
        reason === "no_answer"
          ? "no_answer"
          : reason === "unreachable"
            ? "unreachable"
            : "ended",
      );
    },
    [cleanup, socket],
  );

  const failUnreachable = useCallback(() => {
    clearTimers();
    if (!callIdRef.current) return;
    endCall("unreachable");
  }, [clearTimers, endCall]);

  const room = useRtkRoom({
    authToken,
    audio: true,
    video: withCamera,
    manageAudio: false,
    onDisconnected: failUnreachable,
  });

  const remote = useMemo(
    () => room.peers.find((peer) => !peer.isLocal) ?? null,
    [room.peers],
  );
  const local = useMemo(
    () => room.peers.find((peer) => peer.isLocal) ?? null,
    [room.peers],
  );

  // Không vào được phòng (token hỏng, mạng chặn…) = không kết nối được.
  useEffect(() => {
    if (authToken && room.state === "failed") failUnreachable();
  }, [authToken, room.state, failUnreachable]);

  // Bên kia xuất hiện trong phòng → mới tính là đã kết nối và bắt đầu đếm giờ.
  useEffect(() => {
    const status = statusRef.current;
    if (remote && (status === "calling" || status === "connecting")) {
      clearTimers();
      setConnectedAt((prev) => prev ?? Date.now());
      setCallStatus("connected");
    }
    if (!remote && status === "connected" && peerGoneTimerRef.current === null) {
      peerGoneTimerRef.current = window.setTimeout(() => {
        peerGoneTimerRef.current = null;
        failUnreachable();
      }, PEER_GONE_GRACE_MS);
    }
    if (remote && peerGoneTimerRef.current !== null) {
      window.clearTimeout(peerGoneTimerRef.current);
      peerGoneTimerRef.current = null;
    }
  }, [remote, clearTimers, failUnreachable]);

  const startConnectingWatchdog = useCallback(() => {
    if (connectingTimerRef.current !== null) return;
    connectingTimerRef.current = window.setTimeout(() => {
      connectingTimerRef.current = null;
      if (statusRef.current !== "connected") failUnreachable();
    }, CONNECTING_TIMEOUT_MS);
  }, [failUnreachable]);

  const startCall = useCallback(
    async (conversationId: string, type: CallType = "audio") => {
      const video = type === "video";
      await probeLocalMedia(video);
      const ack = await emitWithAck(socket, SOCKET_EVENTS.CALL.INCOMING_CALL, {
        v: 2,
        conversationId,
        callType: type,
      });
      if (!ack || ack.ok !== true || !ack.callId) {
        throw new CallSetupError(ack && ack.ok === false ? ack.code : "UNKNOWN");
      }
      callIdRef.current = ack.callId;
      setCallType(type);
      setWithCamera(video);
      setAuthToken(ack.authToken);
      setCallStatus("calling");
    },
    [socket],
  );

  const acceptCall = useCallback(
    async (callId: string, opts?: { withCamera?: boolean }) => {
      const camera = opts?.withCamera === true;
      await probeLocalMedia(camera);
      const ack = await emitWithAck(socket, SOCKET_EVENTS.CALL.CALL_ACCEPTED, {
        v: 2,
        callId,
      });
      if (!ack || ack.ok !== true) {
        throw new CallSetupError(ack && ack.ok === false ? ack.code : "UNKNOWN");
      }
      callIdRef.current = callId;
      setCallType(camera ? "video" : "audio");
      setWithCamera(camera);
      setAuthToken(ack.authToken);
      setCallStatus("connecting");
      startConnectingWatchdog();
    },
    [socket, startConnectingWatchdog],
  );

  /** Người gọi: bên kia vừa bấm nghe (socket call.accepted). */
  const handlePeerAccepted = useCallback(() => {
    if (statusRef.current === "calling") {
      setCallStatus("connecting");
      startConnectingWatchdog();
    }
  }, [startConnectingWatchdog]);

  const rejectCall = useCallback(
    (callId: string) => {
      socket.emit(SOCKET_EVENTS.CALL.CALL_REJECTED, { callId });
      setCallStatus("rejected");
    },
    [socket],
  );

  const toggleMute = useCallback(async () => !(await room.toggleMic()), [room]);

  const localVideoTrack = local?.videoTrack ?? null;
  const remoteAudioTrack = remote?.audioTrack ?? null;
  const remoteVideoTrack = remote?.videoTrack ?? null;
  const localStream = useMemo(
    () => (localVideoTrack ? new MediaStream([localVideoTrack]) : null),
    [localVideoTrack],
  );
  const remoteStream = useMemo(() => {
    const tracks = [remoteAudioTrack, remoteVideoTrack].filter(
      (track): track is MediaStreamTrack => Boolean(track),
    );
    return tracks.length ? new MediaStream(tracks) : null;
  }, [remoteAudioTrack, remoteVideoTrack]);

  return {
    localStream,
    remoteStream,
    callStatus,
    callType,
    isCameraOn: room.cameraOn,
    remoteMedia: {
      cameraOn: remote?.isCameraEnabled ?? false,
      micOn: remote ? !remote.isMuted : true,
    },
    startCall,
    acceptCall,
    rejectCall,
    endCall,
    connectedAt,
    handlePeerAccepted,
    toggleMute,
    toggleCamera: room.toggleCamera,
    switchCamera: room.switchCamera,
    cleanup,
    callIdRef,
  };
};
