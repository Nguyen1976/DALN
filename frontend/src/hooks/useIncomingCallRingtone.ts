import { useEffect, useRef } from "react";
import incomingRingtone from "@/assets/universfield-receive-phone-calls-153318.mp3";

export function useIncomingCallRingtone(active: boolean) {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!active) return;

    const audio = new Audio(incomingRingtone);
    audio.loop = true;
    audioRef.current = audio;

    void audio.play().catch(() => undefined);

    return () => {
      audio.pause();
      audio.currentTime = 0;
      audioRef.current = null;
    };
  }, [active]);
}
