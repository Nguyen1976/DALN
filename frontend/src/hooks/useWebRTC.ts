import { useCallback, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { SOCKET_EVENTS } from "@/lib/socket.events";

/**
 * STUN công cộng của Google — hàng rào an toàn khi không lấy được cấu hình
 * ICE động (TURN) từ gateway. Không chặn cuộc gọi P2P trong LAN/dev.
 */
const FALLBACK_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

/** Bao lâu chờ ack `call.ice_config` trước khi rơi về STUN dự phòng. */
const ICE_CONFIG_ACK_TIMEOUT_MS = 5000;

/** Bao lâu chờ ack `call.incoming_call` (nhận callId) trước khi báo lỗi. */
const INCOMING_CALL_ACK_TIMEOUT_MS = 5000;

/** Trừ hao trước khi credential TURN hết hạn để không dùng cấu hình sắp chết. */
const ICE_CACHE_SAFETY_MS = 60_000;

/** Quá lâu ở trạng thái 'connecting' mà chưa thông thì coi là không gọi được. */
const CONNECTING_TIMEOUT_MS = 15000;

/** 'disconnected' kéo dài quá mức này thì coi như rớt hẳn. */
const DISCONNECTED_GRACE_MS = 5000;

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

/** Loại cuộc gọi 1-1. 'video' đàm phán video ngay từ offer đầu tiên. */
export type CallType = "audio" | "video";

/** Hình dạng ack của `call.ice_config` (xem hợp đồng TURN). */
// Gateway ack: { ok, iceServers, expiresAt, ttlSeconds }.
type IceConfigResponse = {
  iceServers?: RTCIceServer[];
  ttlSeconds?: number;
} | null;

/** Hình dạng ack của `call.incoming_call` (xem hợp đồng TURN). */
type IncomingCallAck =
  | { ok: true; callId: string }
  | {
      ok: false;
      code: "CALL_FORBIDDEN" | "CALLEE_OFFLINE" | "BUSY" | "CALLEE_BUSY";
    }
  | null;

export type CallSetupErrorCode =
  | "CALL_FORBIDDEN"
  | "CALLEE_OFFLINE"
  | "BUSY"
  | "CALLEE_BUSY"
  | "UNKNOWN";

/** Lỗi thiết lập cuộc gọi từ phía gateway (không phải lỗi micro). */
export class CallSetupError extends Error {
  code: CallSetupErrorCode;
  constructor(code: CallSetupErrorCode) {
    super("Không thiết lập được cuộc gọi");
    this.name = "CallSetupError";
    this.code = code;
  }
}

/** Bao lâu chờ micro trước khi coi là hỏng. */
const MIC_ACQUIRE_TIMEOUT_MS = 15000;

export class MicrophoneTimeoutError extends Error {
  constructor() {
    super("Không truy cập được micro");
    this.name = "MicrophoneTimeoutError";
  }
}

/** Thông điệp cho người dùng ứng với từng lý do không lấy được micro. */
export function describeMicrophoneError(error: unknown): string {
  const name = (error as { name?: string })?.name;

  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Bạn đã từ chối quyền dùng micro. Hãy bật lại quyền cho trang này trong cài đặt trình duyệt rồi gọi lại.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "Không tìm thấy micro nào trên thiết bị này.";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "Micro đang được ứng dụng khác sử dụng. Hãy đóng ứng dụng đó rồi thử lại.";
  }
  if (name === "MicrophoneTimeoutError") {
    return "Không truy cập được micro sau 15 giây. Hãy kiểm tra quyền micro của trình duyệt rồi gọi lại.";
  }
  return "Không thể bắt đầu cuộc gọi. Vui lòng thử lại.";
}

/**
 * Thông điệp cho người dùng gộp cả lỗi thiết lập từ gateway lẫn lỗi micro.
 * Dùng cho luồng bắt đầu/chấp nhận cuộc gọi.
 */
export function describeCallError(error: unknown): string {
  if (error instanceof CallSetupError) {
    if (error.code === "CALL_FORBIDDEN") {
      return "Bạn không thể gọi cho người này.";
    }
    if (error.code === "CALLEE_OFFLINE") {
      return "Người nhận hiện không trực tuyến.";
    }
    if (error.code === "BUSY") {
      return "Bạn đang trong một cuộc gọi khác.";
    }
    if (error.code === "CALLEE_BUSY") {
      return "Người này đang bận trong cuộc gọi khác.";
    }
    return "Không thể bắt đầu cuộc gọi. Vui lòng thử lại.";
  }
  return describeMicrophoneError(error);
}

export const useWebRTC = (socket: Socket) => {
  /** Thời điểm hai bên thực sự nghe được nhau; null khi chưa kết nối. */
  const connectedAtRef = useRef<number | null>(null);
  const [connectedAt, setConnectedAt] = useState<number | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [callStatus, setCallStatus] = useState<CallStatus>("idle");

  /** Loại cuộc gọi hiện tại; UI dựa vào đây để biết là cuộc gọi video. */
  const [callType, setCallType] = useState<CallType>("audio");
  /** Camera cục bộ có đang phát hay không (điều khiển nút bật/tắt camera). */
  const [isCameraOn, setIsCameraOn] = useState(false);

  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  /** Track camera đang phát; giữ ref để toggleCamera + cleanup dừng đúng track. */
  const cameraTrackRef = useRef<MediaStreamTrack | null>(null);
  /**
   * Sender video của peer connection. Giữ ref vì replaceTrack(null) làm
   * `sender.track` = null nên không tìm lại được qua getSenders() sau khi tắt.
   */
  const videoSenderRef = useRef<RTCRtpSender | null>(null);

  /** ID phiên cuộc gọi do gateway cấp; mọi sự kiện sau incoming_call phải mang nó. */
  const callIdRef = useRef<string | null>(null);

  /** Cache iceServers theo ttl để không hỏi gateway mỗi lần gọi. */
  const iceCacheRef = useRef<{
    iceServers: RTCIceServer[];
    expiresAt: number;
  } | null>(null);

  // Trickle ICE cần đệm hai chiều:
  //  - candidate nội bộ có thể sinh ra TRƯỚC khi ack trả callId → giữ lại rồi xả.
  //  - candidate của đối phương có thể đến TRƯỚC khi ta set remote description.
  const pendingLocalCandidatesRef = useRef<RTCIceCandidate[]>([]);
  const pendingRemoteCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const remoteDescriptionSetRef = useRef(false);

  // Hàng rào phát hiện rớt/không thông.
  const connectingTimerRef = useRef<number | null>(null);
  const disconnectedTimerRef = useRef<number | null>(null);

  const setStream = useCallback((stream: MediaStream | null) => {
    localStreamRef.current = stream;
    setLocalStream(stream);
  }, []);

  const addLocalTracks = useCallback((pc: RTCPeerConnection) => {
    const stream = localStreamRef.current;
    if (!stream) return;

    stream.getTracks().forEach((track) => {
      pc.addTrack(track, stream);
    });
  }, []);

  const clearConnectionTimers = useCallback(() => {
    if (connectingTimerRef.current !== null) {
      window.clearTimeout(connectingTimerRef.current);
      connectingTimerRef.current = null;
    }
    if (disconnectedTimerRef.current !== null) {
      window.clearTimeout(disconnectedTimerRef.current);
      disconnectedTimerRef.current = null;
    }
  }, []);

  const cleanup = useCallback(() => {
    clearConnectionTimers();

    peerConnection.current?.close();
    peerConnection.current = null;

    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);

    // Track camera có thể đã tách khỏi localStream khi tắt camera → dừng riêng
    // (giữ ref chính vì lý do này). Nếu camera đang bật thì nó nằm trong
    // localStream và đã được dừng ở trên, gọi lại chỉ là vô hại.
    cameraTrackRef.current?.stop();
    cameraTrackRef.current = null;
    videoSenderRef.current = null;
    setIsCameraOn(false);
    setCallType("audio");

    pendingLocalCandidatesRef.current = [];
    pendingRemoteCandidatesRef.current = [];
    remoteDescriptionSetRef.current = false;

    setCallStatus("idle");
  }, [clearConnectionTimers]);

  /**
   * Kết thúc cuộc gọi. Theo hợp đồng, `call.ended` mang callId của phiên; gateway
   * tự suy ra đối phương + conversationId, nên client không khai lại.
   * `options.emit=false` dùng khi ĐỐI PHƯƠNG đã kết thúc (ta chỉ dọn dẹp/hiển thị,
   * không phát lại sự kiện).
   */
  const endCall = useCallback(
    (
      reason?: "no_answer" | "unreachable",
      options?: { emit?: boolean },
    ) => {
      const shouldEmit = options?.emit ?? true;
      const callId = callIdRef.current;
      const startedAt = connectedAtRef.current;

      if (shouldEmit && callId) {
        socket.emit(SOCKET_EVENTS.CALL.CALL_ENDED, {
          callId,
          reason,
          durationSeconds: startedAt
            ? Math.round((Date.now() - startedAt) / 1000)
            : 0,
        });
      }

      callIdRef.current = null;
      connectedAtRef.current = null;
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

  /** Không kết nối được → báo unreachable (phát call.ended) rồi dọn dẹp. */
  const failUnreachable = useCallback(() => {
    clearConnectionTimers();
    // Đã dọn dẹp rồi thì bỏ qua để không phát lại call.ended.
    if (!peerConnection.current && !callIdRef.current) return;
    endCall("unreachable");
  }, [clearConnectionTimers, endCall]);

  /** ICE thật sự thông → mới tính là connected và bắt đầu đếm giờ. */
  const markConnected = useCallback(() => {
    clearConnectionTimers();
    if (!connectedAtRef.current) connectedAtRef.current = Date.now();
    setConnectedAt(connectedAtRef.current);
    setCallStatus("connected");
  }, [clearConnectionTimers]);

  /** 'disconnected': cho ICE ~5s tự phục hồi, quá thì coi như rớt. */
  const scheduleDisconnectedFailure = useCallback(() => {
    if (disconnectedTimerRef.current !== null) return;
    disconnectedTimerRef.current = window.setTimeout(() => {
      disconnectedTimerRef.current = null;
      failUnreachable();
    }, DISCONNECTED_GRACE_MS);
  }, [failUnreachable]);

  /** Ở 'connecting' quá 15s chưa thông → không gọi được. */
  const startConnectingWatchdog = useCallback(() => {
    if (connectingTimerRef.current !== null) return;
    connectingTimerRef.current = window.setTimeout(() => {
      connectingTimerRef.current = null;
      failUnreachable();
    }, CONNECTING_TIMEOUT_MS);
  }, [failUnreachable]);

  /**
   * Lấy cấu hình ICE (STUN/TURN) từ gateway qua ack `call.ice_config`.
   * Có timeout ~5s và fallback về STUN Google để không chặn cuộc gọi.
   * Cache theo ttl để không hỏi lại mỗi lần.
   */
  const fetchIceServers = useCallback(async (): Promise<RTCIceServer[]> => {
    const cached = iceCacheRef.current;
    if (cached && cached.expiresAt > Date.now()) {
      return cached.iceServers;
    }

    const config = await new Promise<IceConfigResponse>((resolve) => {
      let settled = false;
      const timer = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve(null);
      }, ICE_CONFIG_ACK_TIMEOUT_MS);

      try {
        socket.emit(
          SOCKET_EVENTS.CALL.ICE_CONFIG,
          {},
          (res: IceConfigResponse) => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timer);
            resolve(res ?? null);
          },
        );
      } catch {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(null);
      }
    });

    const iceServers =
      config?.iceServers && config.iceServers.length > 0
        ? config.iceServers
        : FALLBACK_ICE_SERVERS;

    // Chỉ cache khi có cấu hình thật kèm ttl > 0 (ttl 0 = chỉ STUN dev).
    const ttlSeconds = config?.ttlSeconds ?? 0;
    const ttlMs = ttlSeconds > 0 ? ttlSeconds * 1000 : 0;
    if (ttlMs > 0 && config?.iceServers?.length) {
      iceCacheRef.current = {
        iceServers,
        expiresAt: Date.now() + Math.max(0, ttlMs - ICE_CACHE_SAFETY_MS),
      };
    } else {
      iceCacheRef.current = null;
    }

    return iceServers;
  }, [socket]);

  /** Xả các candidate nội bộ đã đệm khi chưa có callId. */
  const flushLocalCandidates = useCallback(() => {
    const callId = callIdRef.current;
    if (!callId) return;
    const pending = pendingLocalCandidatesRef.current;
    pendingLocalCandidatesRef.current = [];
    pending.forEach((candidate) => {
      socket.emit(SOCKET_EVENTS.CALL.ICE_CANDIDATE, { callId, candidate });
    });
  }, [socket]);

  /** Nạp các candidate của đối phương đã đệm khi chưa set remote description. */
  const flushRemoteCandidates = useCallback(() => {
    const pc = peerConnection.current;
    if (!pc || !remoteDescriptionSetRef.current) return;
    const pending = pendingRemoteCandidatesRef.current;
    pendingRemoteCandidatesRef.current = [];
    pending.forEach((candidate) => {
      void pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {
        // Candidate lỗi thời/không hợp lệ — bỏ qua, ICE vẫn còn candidate khác.
      });
    });
  }, []);

  const initPeerConnection = useCallback(async () => {
    const iceServers = await fetchIceServers();

    const pc = new RTCPeerConnection({ iceServers });
    addLocalTracks(pc);

    // Ghi nhớ sender video (nếu localStream có track camera) để toggleCamera dùng
    // lại đúng sender đó — không cần đàm phán lại khi bật/tắt camera.
    videoSenderRef.current =
      pc.getSenders().find((s) => s.track?.kind === "video") ?? null;

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;

      const callId = callIdRef.current;
      // Chưa có callId (đang chờ ack incoming_call) → đệm lại, xả sau.
      if (!callId) {
        pendingLocalCandidatesRef.current.push(event.candidate);
        return;
      }

      socket.emit(SOCKET_EVENTS.CALL.ICE_CANDIDATE, {
        callId,
        candidate: event.candidate,
      });
    };

    pc.ontrack = (event) => {
      // Chỉ gắn luồng tiếng ở đây. KHÔNG coi là đã kết nối — mốc 'connected'
      // và việc bắt đầu đếm giờ do onconnectionstatechange quyết định khi ICE
      // thật sự thông.
      setRemoteStream(event.streams[0] ?? null);
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === "connected") markConnected();
      else if (state === "failed") failUnreachable();
      else if (state === "disconnected") scheduleDisconnectedFailure();
    };

    // Dự phòng cho trình duyệt mà connectionState chưa ổn định (Firefox cũ).
    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      if (state === "connected" || state === "completed") markConnected();
      else if (state === "failed") failUnreachable();
      else if (state === "disconnected") scheduleDisconnectedFailure();
    };

    peerConnection.current = pc;
    return pc;
  }, [
    addLocalTracks,
    failUnreachable,
    fetchIceServers,
    markConnected,
    scheduleDisconnectedFailure,
    socket,
  ]);

  /**
   * Get the microphone (and camera when `withVideo`), but never wait for ever.
   *
   * `getUserMedia` can hang indefinitely — another app holding the device, a
   * permission prompt the user walks away from, a wedged driver. Without a
   * bound the call screen sat on "Đang kết nối..." with no error and no way
   * out, which is exactly what the call flow promises not to do.
   */
  const acquireLocalMedia = useCallback(
    async (withVideo: boolean) => {
      if (localStreamRef.current) return localStreamRef.current;

      const constraints: MediaStreamConstraints = {
        audio: true,
        video: withVideo
          ? { width: { ideal: 1280 }, height: { ideal: 720 } }
          : false,
      };

      let timer: ReturnType<typeof setTimeout> | undefined;
      let timedOut = false;
      const mediaPromise = navigator.mediaDevices.getUserMedia(constraints);
      try {
        const stream = await Promise.race([
          mediaPromise,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              timedOut = true;
              reject(new MicrophoneTimeoutError());
            }, MIC_ACQUIRE_TIMEOUT_MS);
          }),
        ]);
        setStream(stream);
        return stream;
      } catch (error) {
        // Luồng về muộn SAU khi đã timeout → dừng track để không rò micro/camera.
        if (timedOut) {
          void mediaPromise
            .then((late) => late.getTracks().forEach((track) => track.stop()))
            .catch(() => undefined);
        }
        throw error;
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
    [setStream],
  );

  /** Chỉ lấy micro — giữ nguyên hành vi cuộc gọi thoại cũ. */
  const acquireLocalAudio = useCallback(
    () => acquireLocalMedia(false),
    [acquireLocalMedia],
  );

  const startCall = useCallback(
    async (conversationId: string, callType: CallType = "audio") => {
      const withVideo = callType === "video";
      // Cuộc gọi video đàm phán video ngay từ offer: track camera nằm trong
      // localStream nên được addLocalTracks đưa vào offer.
      await (withVideo ? acquireLocalMedia(true) : acquireLocalAudio());
      setCallType(callType);
      setIsCameraOn(withVideo);
      cameraTrackRef.current =
        localStreamRef.current?.getVideoTracks()[0] ?? null;

      const pc = await initPeerConnection();
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Theo hợp đồng: người gọi chỉ gửi { conversationId, offer } (KHÔNG khai
      // targetUserId) và nhận callId từ ack. callType để phía nhận biết đây là
      // cuộc gọi video (hiển thị đúng bố cục + chấp nhận kèm camera).
      const ack = await new Promise<IncomingCallAck>((resolve) => {
        let settled = false;
        const timer = window.setTimeout(() => {
          if (settled) return;
          settled = true;
          resolve(null);
        }, INCOMING_CALL_ACK_TIMEOUT_MS);

        socket.emit(
          SOCKET_EVENTS.CALL.INCOMING_CALL,
          { conversationId, offer, callType },
          (res: IncomingCallAck) => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timer);
            resolve(res ?? null);
          },
        );
      });

      if (!ack || ack.ok !== true) {
        cleanup();
        const code = ack && ack.ok === false ? ack.code : "UNKNOWN";
        throw new CallSetupError(code);
      }

      callIdRef.current = ack.callId;
      flushLocalCandidates();
      setCallStatus("calling");
    },
    [
      acquireLocalAudio,
      acquireLocalMedia,
      cleanup,
      flushLocalCandidates,
      initPeerConnection,
      socket,
    ],
  );

  const acceptCall = useCallback(
    async (
      callId: string,
      offer: RTCSessionDescriptionInit,
      opts?: { withCamera?: boolean },
    ) => {
      // callId đến từ sự kiện incoming_call của gateway.
      callIdRef.current = callId;

      const withCamera = opts?.withCamera === true;
      // Chấp nhận-kèm-camera thì lấy thêm camera; chấp nhận chỉ-âm-thanh vẫn NHẬN
      // được video của người gọi vì WebRTC tự trả lời m-line video ở dạng recvonly.
      await (withCamera ? acquireLocalMedia(true) : acquireLocalAudio());
      setCallType(withCamera ? "video" : "audio");
      setIsCameraOn(withCamera);
      cameraTrackRef.current =
        localStreamRef.current?.getVideoTracks()[0] ?? null;

      const pc = await initPeerConnection();
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      remoteDescriptionSetRef.current = true;
      flushRemoteCandidates();

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      socket.emit(SOCKET_EVENTS.CALL.CALL_ACCEPTED, { callId, answer });

      // Đã trao đổi offer/answer nhưng ICE chưa chắc thông → 'connecting'.
      setCallStatus("connecting");
      startConnectingWatchdog();
    },
    [
      acquireLocalAudio,
      acquireLocalMedia,
      flushRemoteCandidates,
      initPeerConnection,
      socket,
      startConnectingWatchdog,
    ],
  );

  const rejectCall = useCallback(
    (callId: string) => {
      socket.emit(SOCKET_EVENTS.CALL.CALL_REJECTED, { callId });
      setCallStatus("rejected");
    },
    [socket],
  );

  const handleReceiveAnswer = useCallback(
    async (answer: RTCSessionDescriptionInit) => {
      const pc = peerConnection.current;
      if (!pc) return;

      await pc.setRemoteDescription(new RTCSessionDescription(answer));
      remoteDescriptionSetRef.current = true;
      flushRemoteCandidates();

      // Nhận answer xong nhưng ICE chưa chắc thông → 'connecting', chờ ICE.
      setCallStatus("connecting");
      startConnectingWatchdog();
    },
    [flushRemoteCandidates, startConnectingWatchdog],
  );

  const handleReceiveIceCandidate = useCallback(
    async (candidate: RTCIceCandidateInit) => {
      const pc = peerConnection.current;
      // Chưa set remote description → đệm lại, nạp sau khi có.
      if (!pc || !remoteDescriptionSetRef.current) {
        pendingRemoteCandidatesRef.current.push(candidate);
        return;
      }
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
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

  /**
   * Bật/tắt camera TRONG cuộc gọi video mà KHÔNG đàm phán lại (renegotiation):
   * thao tác trên chính sender video sẵn có bằng replaceTrack.
   *  - Tắt: replaceTrack(null) rồi dừng track camera (đèn camera tắt).
   *  - Bật: lấy track camera mới rồi replaceTrack(track) vào đúng sender cũ.
   * Cập nhật localStream để preview cục bộ phản ánh trạng thái. Trả về trạng thái
   * mới. Chỉ có tác dụng khi có sender video (tức là cuộc gọi video).
   */
  const toggleCamera = useCallback(async () => {
    const sender =
      videoSenderRef.current ??
      peerConnection.current
        ?.getSenders()
        .find((s) => s.track?.kind === "video") ??
      null;
    if (!sender) return false;
    videoSenderRef.current = sender;

    const current = localStreamRef.current;

    // Đang bật camera → tắt.
    if (cameraTrackRef.current) {
      const track = cameraTrackRef.current;
      await sender.replaceTrack(null);
      track.stop();
      cameraTrackRef.current = null;

      // Stream mới (bỏ track camera) để React nhận diện thay đổi và cập nhật preview.
      const remaining = current?.getTracks().filter((t) => t !== track) ?? [];
      setStream(new MediaStream(remaining));
      setIsCameraOn(false);
      return false;
    }

    // Đang tắt camera → bật: lấy camera mới, gắn vào sender hiện có.
    const camStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    const newTrack = camStream.getVideoTracks()[0];
    await sender.replaceTrack(newTrack);
    cameraTrackRef.current = newTrack;

    const nextTracks = current ? [...current.getTracks(), newTrack] : [newTrack];
    setStream(new MediaStream(nextTracks));
    setIsCameraOn(true);
    return true;
  }, [setStream]);

  /**
   * Đổi sang camera kế tiếp (trước/sau trên điện thoại, hoặc webcam khác trên máy
   * tính). Chỉ có tác dụng khi camera đang bật và có ≥2 thiết bị video. Dùng
   * replaceTrack trên sender sẵn có nên KHÔNG phải đàm phán lại.
   */
  const switchCamera = useCallback(async () => {
    const sender = videoSenderRef.current;
    const currentTrack = cameraTrackRef.current;
    if (!sender || !currentTrack) return; // camera đang tắt → không làm gì

    let devices: MediaDeviceInfo[] = [];
    try {
      devices = (await navigator.mediaDevices.enumerateDevices()).filter(
        (d) => d.kind === "videoinput",
      );
    } catch {
      return;
    }
    if (devices.length < 2) return; // chỉ có 1 camera → không có gì để đổi

    const currentId = currentTrack.getSettings().deviceId;
    const idx = devices.findIndex((d) => d.deviceId === currentId);
    const next = devices[(idx + 1) % devices.length];
    if (!next || next.deviceId === currentId) return;

    try {
      const camStream = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: { exact: next.deviceId },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      const newTrack = camStream.getVideoTracks()[0];
      await sender.replaceTrack(newTrack);
      currentTrack.stop();
      cameraTrackRef.current = newTrack;

      const current = localStreamRef.current;
      const nextTracks = current
        ? [...current.getTracks().filter((t) => t !== currentTrack), newTrack]
        : [newTrack];
      setStream(new MediaStream(nextTracks));
    } catch {
      // Không đổi được (thiết bị bận / bị từ chối) → giữ nguyên camera hiện tại.
    }
  }, [setStream]);

  return {
    localStream,
    remoteStream,
    callStatus,
    callType,
    isCameraOn,
    setStream,
    startCall,
    acceptCall,
    rejectCall,
    endCall,
    connectedAt,
    handleReceiveAnswer,
    handleReceiveIceCandidate,
    toggleMute,
    toggleCamera,
    switchCamera,
    cleanup,
    peerConnection,
    callIdRef,
  };
};
