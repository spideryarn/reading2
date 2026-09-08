/**
 * Which mode the page is in, held in the URL hash.
 *
 * THE HASH, NOT `useState`, because the thing this page is most often asked to
 * do is survive a refresh: it is left open on a phone for hours and reloaded by
 * the browser whenever iOS feels like reclaiming the tab. A mode that lives
 * only in memory comes back as Sessions every time, which is the right default
 * and the wrong answer for somebody who was watching Box health.
 *
 * The hash rather than a query string or a path because it costs the server
 * nothing — no route table, no history API, and a static `dist/` that can be
 * served from any prefix. `hashchange` is also the one navigation event a
 * browser fires for free, so back and forward work with no router.
 *
 * An unrecognised hash — a stale bookmark, a mode that has been renamed —
 * falls back to Sessions rather than rendering nothing.
 */
import { useCallback, useEffect, useState } from "react";

export const MODES = ["sessions", "health", "orchestrator"] as const;

export type Mode = (typeof MODES)[number];

export const MODE_LABELS: Record<Mode, string> = {
  sessions: "Sessions",
  health: "Box health",
  orchestrator: "Orchestrator",
};

/** The mode a hash names, or `sessions` for anything this build does not know. */
export function modeFromHash(hash: string): Mode {
  const name = hash.replace(/^#/, "").trim().toLowerCase();
  return (MODES as readonly string[]).includes(name) ? (name as Mode) : "sessions";
}

/** The current mode, and a way to change it that writes the hash. */
export function useMode(): [Mode, (mode: Mode) => void] {
  const [mode, setMode] = useState<Mode>(() =>
    modeFromHash(typeof window === "undefined" ? "" : window.location.hash),
  );

  useEffect(() => {
    const onHashChange = (): void => setMode(modeFromHash(window.location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const choose = useCallback((next: Mode) => {
    /* Set the state as well as the hash rather than waiting for the event.
       Assigning the same hash fires no `hashchange`, so a tab that is already
       on `#health` and is clicked again would otherwise do nothing at all — and
       "nothing at all" is indistinguishable from a broken button. */
    setMode(next);
    if (typeof window !== "undefined") window.location.hash = next;
  }, []);

  return [mode, choose];
}
