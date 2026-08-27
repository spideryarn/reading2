/**
 * Whether the reader is connected, and whether what they are looking at is a
 * saved copy.
 *
 * Two facts, deliberately kept apart:
 *
 * - **Connected.** Whether requests are reaching the server.
 * - **Reading a copy.** Whether the article on screen came out of the cache.
 *
 * They are not the same and they do not always agree. You can be back online
 * while still looking at a copy that was fetched ten minutes ago, and you can
 * be offline looking at an article that arrived over the network before the
 * connection died. Collapsing them into one boolean is how a banner ends up
 * lying in whichever direction the author was not thinking about.
 *
 * ## Why not `navigator.onLine`
 *
 * It is famously unreliable in one direction: it says `true` on a captive
 * portal, on a VPN with no route out, and on a LAN with no WAN. So it is used
 * here **only** as a fast way to notice a *loss* — the browser saying there is
 * no network interface at all is true when it says it. Coming back is decided
 * by a request actually succeeding, which is the only evidence that means
 * anything. See [api.ts](./lib/api.ts), which reports both.
 */
import { useSyncExternalStore } from "react";

export interface OfflineState {
  /** Our best guess at whether requests are getting through. */
  connected: boolean;
  /** When we last served a saved copy, or `null`. */
  servedCopyAt: number | null;
}

let state: OfflineState = { connected: true, servedCopyAt: null };
const listeners = new Set<() => void>();

function set(next: Partial<OfflineState>): void {
  const merged = { ...state, ...next };
  if (merged.connected === state.connected && merged.servedCopyAt === state.servedCopyAt) return;
  state = merged;
  for (const notify of listeners) notify();
}

/** A request reached the server. The only evidence that we are connected. */
export function noteReachedServer(): void {
  set({ connected: true });
}

/** A request failed at the transport layer, and we fell back to a saved copy. */
export function noteServedCopy(savedAt: number): void {
  set({ connected: false, servedCopyAt: savedAt });
}

/** A request failed at the transport layer with nothing saved to fall back on. */
export function noteNoConnection(): void {
  set({ connected: false });
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
}

const snapshot = () => state;

/**
 * The current offline state, for a component that wants to say something about
 * it.
 *
 * `useSyncExternalStore` rather than a context, for the reason the rest of this
 * app uses it: the value changes rarely and is read in a couple of places, and a
 * provider around the whole tree would be more machinery than the fact deserves.
 */
export function useOffline(): OfflineState {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/**
 * Start listening to the browser's own opinion.
 *
 * Called once, from the client entry point. The `offline` event is trusted; the
 * `online` event is treated as *worth retrying*, not as proof — so it clears
 * nothing by itself and the next successful request is what actually restores
 * the connected state.
 */
export function watchConnection(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("offline", () => set({ connected: false }));
}
