/**
 * **Whether the browser thinks it has a network.**
 *
 * One line of API, and the whole of the reason it is worth a file is which way
 * round it may be trusted. `navigator.onLine` is famously weak: `true` means
 * only that some interface is up, so a captive portal, a dead router and a VPN
 * that has fallen over all report `true` and nothing works. **`false`, though,
 * is reliable** — the browser is saying it has no route at all.
 *
 * So it is only ever read in the `false` direction: it may be used to say *this
 * definitely will not work*, and never to say *this will*. Dictation disables
 * its button on a `false` and does nothing whatever on a `true`, which is why
 * this is not a "connectivity check" and is not named like one.
 *
 * `useSyncExternalStore` rather than `useState` + an effect, because the value
 * exists outside React and can change between the render and the effect
 * running — a reader who unplugs the wifi during that gap would otherwise see a
 * live button until something else re-rendered.
 */
import { useCallback, useSyncExternalStore } from "react";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/**
 * @returns `false` only when the browser is certain there is no network.
 *
 * The server snapshot is `true`: this app renders in the browser, but a `false`
 * during hydration would flash a disabled button at somebody whose connection
 * is fine, and the honest default for "we do not know" is the one that does not
 * take a control away.
 */
export function useOnline(): boolean {
  const snapshot = useCallback(() => navigator.onLine !== false, []);
  return useSyncExternalStore(subscribe, snapshot, () => true);
}
