/**
 * **The viewport probe, started without a reload.**
 *
 * `?probe=1` turns `ViewportProbe` on when the page loads, and until
 * 2026-10-30 that was the only way in. It could not catch the bug it was
 * waiting for. Greg's iPad leaves the bottom bar partway up the screen
 * *sometimes*, after rotating and resizing (spya-u0vb0a), and editing the
 * address to add the flag reloads the page, which very probably clears the
 * state that needed recording. So the administrator's reading view records
 * silently from page load, and the *Viewport probe* row in the command bar
 * (admin-commands.ts) reveals that recording on the page as it stands.
 * docs/plans/261030e-the-bottom-bar-floats-on-an-ipad-after-a-rotation-and-the-probe-that-can-catch-it.md;
 * docs/postmortems/261030b-an-instrument-switched-on-by-reloading-cannot-catch-a-fault-that-reloading-clears.md.
 *
 * **A flag in this module, not a write to the address.** The address has its
 * own owners (params.ts), and the probe has no reason to put itself in a link
 * somebody copies. Once on, it stays on until the page is reloaded, which is
 * the same lifetime the `?probe=1` way has.
 */
import { useEffect, useSyncExternalStore } from "react";

let started = false;
const listeners = new Set<() => void>();
/** How many `ViewportProbe`s are mounted: one on the reading view, none elsewhere. */
let mounted = 0;

/**
 * Turn the probe on for the rest of this page's life. **`false` where there is
 * no probe to turn on** — the command bar is on Metadata too, and the probe is
 * drawn by the reading view only (Sol, plan review P7), so the row says so
 * rather than seeming to work.
 */
export function startProbe(): boolean {
  if (mounted === 0) return false;
  if (started) return true;
  started = true;
  for (const listener of listeners) listener();
  return true;
}

/** Called by `ViewportProbe` for as long as it is mounted, whether or not it is on. */
export function useProbeMounted(): void {
  useEffect(() => {
    mounted += 1;
    return () => {
      mounted -= 1;
    };
  }, []);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Has the command bar started the probe? `false` on the server, where there is
 * nothing to probe.
 */
export function useProbeStarted(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => started,
    () => false,
  );
}

/** The suite shares one module across cases; a page load does not. */
export function resetProbeSwitchForTests(): void {
  started = false;
}
