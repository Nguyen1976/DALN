import { useState, type AnimationEvent } from "react";

/**
 * Lets a hand-rolled modal play its exit before the parent unmounts it.
 *
 * `requestClose` swaps the enter classes for the exit ones; when the overlay's
 * own exit animation ends, the real `onClose` runs. Under reduced motion the
 * exit lasts 0.01ms, so closing stays immediate.
 */
export function useModalExit(onClose: () => void) {
  const [closing, setClosing] = useState(false);

  const requestClose = () => setClosing(true);

  const onOverlayAnimationEnd = (event: AnimationEvent<HTMLElement>) => {
    // Child animations (spinners, the panel) bubble up here too.
    if (closing && event.target === event.currentTarget) onClose();
  };

  return { closing, requestClose, onOverlayAnimationEnd };
}
