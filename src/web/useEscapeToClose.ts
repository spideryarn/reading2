import { useEffect } from "react";

/**
 * Escape closes this dialog. Three panels — `ChatDialog`, `AnnotateDialog`,
 * `CommentDialog` — wanted exactly this: a bubble-phase `window` listener,
 * torn down on unmount, that calls the close/cancel handler on `Escape` and
 * nothing else.
 *
 * **`Dock.tsx` does not use this hook, deliberately.** Its drawer also closes
 * on Escape, but it must win a race against `CommentDialog`'s own listener
 * above — both would otherwise fire on the same press, closing a dialog the
 * reader could not even see under the dim. So Dock listens in the **capture**
 * phase and calls `stopImmediatePropagation`, which only works because the
 * event's target is `window` itself (there is no propagation path to cut, so
 * plain `stopPropagation` would do nothing) — see the comment beside Dock's
 * own listener. Folding Dock into this hook would either drop the capture
 * phase and lose the race, or force every other caller to opt into a
 * propagation-stopping default they don't need.
 */
export function useEscapeToClose(onClose: () => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
}
