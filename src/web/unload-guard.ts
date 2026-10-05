/**
 * **Hold the tab open while closing it would lose work** — the `beforeunload`
 * warning, and the fact that one is up.
 *
 * The two upload engines each had their own copy of the listener
 * (uploadEngine.ts and batchUpload.ts § `guardUnload`). It is one function now
 * because a second thing needs to know the same fact: the page that reloads
 * itself for a new build (safe-to-reload.ts) must not do it while an upload is
 * going, and *"an engine has asked for the warning"* is exactly when that is.
 * Asking the engines' phases instead would be a second definition of "in
 * flight", free to drift from the one the reader is actually warned by.
 *
 * Counted rather than a boolean, because two engines can hold it at once and
 * one finishing must not release the other's.
 *
 * **Every `beforeunload` in the client goes through here**, with the reason it
 * is held. ProfileBox.tsx § `useUnsavedWarning` had one of its own until
 * 2026-10-05; and useAutosavedText.ts holds one for the window after its box
 * has unmounted with the newest words still waiting behind an older save,
 * which nothing warned about before, because the field that would have was
 * gone (GPT Sol's F12, plan 261005d).
 */

/** Why the tab is being held: a transfer in flight, or words not yet saved. */
export type UnloadReason = "upload" | "unsaved";

const holds: Record<UnloadReason, number> = { upload: 0, unsaved: 0 };
let held = 0;

function warn(e: BeforeUnloadEvent): void {
  /* `preventDefault` is the modern spelling and `returnValue` the one older
     browsers still read. Both, because the cost of the dead one is a line and
     the cost of missing the live one is a lost upload. The string is never
     shown — browsers replaced it with their own wording years ago. */
  e.preventDefault();
  e.returnValue = "";
}

/** Warn on leaving, from now until the returned function is called. */
export function warnBeforeUnload(why: UnloadReason): () => void {
  holds[why] += 1;
  held += 1;
  if (held === 1) window.addEventListener("beforeunload", warn);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds[why] -= 1;
    held -= 1;
    if (held === 0) window.removeEventListener("beforeunload", warn);
  };
}

/** Whether anything is holding the tab open right now, for that reason. */
export function unloadGuarded(why: UnloadReason): boolean {
  return holds[why] > 0;
}
