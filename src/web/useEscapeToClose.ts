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
 *
 * ## Two things this hook will not do, both added 2026-09-07
 *
 * This is tier **T3** of five, and the two additions below are the two ways a
 * press can already belong to somebody else by the time it gets here. The
 * inventory —
 * docs/plans/260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen-escape-inventory.md —
 * is the map, and tests/one-escape-closes-one-surface.test.tsx is the pairs.
 *
 * **`enabled`, because the surface in front decides.** All three callers listen
 * on `window` and none of them stops propagation, so with two of them mounted
 * one press closed both — and one of the two was a half-typed annotation. The
 * rule is *the surface the reader sees in front owns the press*, and it is
 * expressed as an argument the caller passes rather than as which component
 * mounted first: registration order encodes mount time, which is not what the
 * reader can see. The listener is **not registered at all** while this is
 * false, rather than registered and returning early — one fewer thing on
 * `window`, and it makes the disabled state something a test can observe.
 *
 * **An open native `<dialog>` outranks every one of us.** A dialog opened with
 * `showModal()` sits in the browser's top layer and its Escape is the
 * platform's own close request — not a listener, so `stopImmediatePropagation`
 * cannot reach it and only `preventDefault()` on the keydown or on `cancel`
 * would suppress it. Nothing in this app does either, deliberately. So the fix
 * cannot live in the dialog, and the surface that has to yield asks *the
 * platform what the platform already owns*: `document.querySelector`. That is
 * reading an existing fact rather than building a parallel registry, which is
 * why there is no `useNativeModalOpen()` hook and no shared state.
 *
 * `dialog[open]` also matches a non-modal `show()` dialog, which would be
 * wrong — a modeless dialog is not in the top layer and does not own the press.
 * It cannot happen here: **every `<dialog>` in `src/web/` is opened with
 * `showModal()` and nothing calls `.show()`** (the Lightbox, Feedback,
 * Illustrated full, Sketch full, and the command bar; checked 2026-09-07). The
 * day somebody adds a `.show()`, this query has to be narrowed. `Dock.tsx`
 * makes the same query for the same reason, twice in `useCommandBarChord` and
 * once in the drawer's own capture listener.
 */
export function useEscapeToClose(onClose: () => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (document.querySelector("dialog[open]") !== null) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, enabled]);
}
