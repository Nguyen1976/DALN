import { useCallback, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { SOCKET_EVENTS } from "@/lib/socket.events";

const STUN_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

export type CallStatus =
  | "idle"
  | "calling"
  | "ringing"
  | "connected"
  | "ended"
  | "rejected"
  | "no_answer";

export const useWebRTC = (socket: Socket) => {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [callStatus, setCallStatus] = useState<CallStatus>("idle");

  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerUserIdRef = useRef<string | null>(null);

  const setStream = useCallback((stream: MediaStream | null) => {
    localStreamRef.current = stream;
    setLocalStream(stream);
  }, []);

  const addLocalTracks = (pc: RTCPeerConnection) => {
    const stream = localStreamRef.current;
    if (!stream) return;

    stream.getTracks().forEach((track) => {
      pc.addTrack(track, stream);
    });
  };

  const cleanup = useCallback(() => {
    peerConnection.current?.close();
    peerConnection.current = null;

    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    peerUserIdRef.current = null;
    setCallStatus("idle");
  }, []);

  const initPeerConnection = (peerUserId: string) => {
    peerUserIdRef.current = peerUserId;

    const pc = new RTCPeerConnection(STUN_SERVERS);
    addLocalTracks(pc);

    pc.onicecandidate = (event) => {
      if (!event.candidate || !peerUserIdRef.current) return;

      socket.emit(SOCKET_EVENTS.CALL.ICE_CANDIDATE, {
        targetUserId: peerUserIdRef.current,
        candidate: event.candidate,
      });
    };

    pc.ontrack = (event) => {
      setRemoteStream(event.streams[0] ?? null);
      setCallStatus("connected");
    };

    peerConnection.current = pc;
    return pc;
  };

  const acquireLocalAudio = useCallback(async () => {
    if (localStreamRef.current) return localStreamRef.current;

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    setStream(stream);
    return stream;
  }, [setStream]);

  const startCall = useCallback(
    async (targetUserId: string, conversationId?: string) => {
      await acquireLocalAudio();

      const pc = initPeerConnection(targetUserId);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      socket.emit(SOCKET_EVENTS.CALL.INCOMING_CALL, {
        targetUserId,
        offer,
        conversationId,
      });
      setCallStatus("calling");
    },
    [acquireLocalAudio, socket],
  );

  const acceptCall = useCallback(
    async (callerId: string, offer: RTCSessionDescriptionInit) => {
      await acquireLocalAudio();

      const pc = initPeerConnection(callerId);
      await pc.setRemoteDescription(new RTCSessionDescription(offer));

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      socket.emit(SOCKET_EVENTS.CALL.CALL_ACCEPTED, {
        callerId,
        answer,
      });
      setCallStatus("connected");
    },
    [acquireLocalAudio, socket],
  );

  const rejectCall = useCallback(
    (callerId: string) => {
      socket.emit(SOCKET_EVENTS.CALL.CALL_REJECTED, { callerId });
      setCallStatus("rejected");
    },
    [socket],
  );

  const endCall = useCallback(
    (peerUserId: string, reason?: "no_answer") => {
      socket.emit(SOCKET_EVENTS.CALL.CALL_ENDED, {
        targetUserId: peerUserId,
        reason,
      });
      cleanup();
      setCallStatus(reason === "no_answer" ? "no_answer" : "ended");
    },
    [cleanup, socket],
  );

  const handleReceiveAnswer = useCallback(
    async (answer: RTCSessionDescriptionInit) => {
      if (!peerConnection.current) return;
      await peerConnection.current.setRemoteDescription(
        new RTCSessionDescription(answer),
      );
      setCallStatus("connected");
    },
    [],
  );

  const handleReceiveIceCandidate = useCallback(
    async (candidate: RTCIceCandidateInit) => {
      if (!peerConnection.current) return;
      await peerConnection.current.addIceCandidate(
        new RTCIceCandidate(candidate),
      );
    },
    [],
  );

  const toggleMute = useCallback(() => {
    const audioTrack = localStreamRef.current
      ?.getAudioTracks()
      .find((track) => track.kind === "audio");

    if (!audioTrack) return false;
    audioTrack.enabled = !audioTrack.enabled;
    return !audioTrack.enabled;
  }, []);

  return {
    localStream,
    remoteStream,
    callStatus,
    setStream,
    startCall,
    acceptCall,
    rejectCall,
    endCall,
    handleReceiveAnswer,
    handleReceiveIceCandidate,
    toggleMute,
    cleanup,
    peerConnection,
  };
};
