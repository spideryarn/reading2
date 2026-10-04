/**
 * **A button whose card opens on hover and focus, and toggles on a press.**
 * Every band's (i) (BandAbout.tsx) and Referee's *How to read this*
 * (modes/referee/RefereeMode.tsx § `HowToRead`).
 *
 * The one thing it knows that a bare `useState` does not: **a press can close
 * the card before a pending hover-open timer fires.** Pointing at the button
 * schedules the open; the button's own click toggles the state without going
 * through Floating UI's openchange emitter, so that timer survives, and two
 * quick presses were followed by the card opening itself again. So a press
 * that closes is remembered, and an open is refused until the pointer comes
 * back or the keyboard focuses the button. GPT Sol found it and wrote the
 * guard for `HowToRead` (plan 261003m); it moved here when the band's (i)
 * needed the same eight lines (qi-9rk34gjz, plan 261004g).
 */
import { useCallback, useRef, useState } from "react";

export interface PressToggle {
  /** The tooltip's controlled open state. */
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Spread on the trigger button. */
  trigger: {
    onPointerEnter(): void;
    onFocusCapture(): void;
    onClick(): void;
  };
}

export function usePressToggle(): PressToggle {
  const [open, setOpen] = useState(false);
  const dismissedByPress = useRef(false);
  const onOpenChange = useCallback((next: boolean) => {
    if (!next || !dismissedByPress.current) setOpen(next);
  }, []);
  const fresh = useCallback(() => {
    dismissedByPress.current = false;
  }, []);
  return {
    open,
    onOpenChange,
    trigger: {
      onPointerEnter: fresh,
      onFocusCapture: fresh,
      onClick: () => {
        dismissedByPress.current = open;
        setOpen(!open);
      },
    },
  };
}
