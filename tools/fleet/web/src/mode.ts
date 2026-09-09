/**
 * What the page is showing, held in the URL hash: the mode, and a few
 * preferences beside it.
 *
 * THE HASH, NOT `useState`, because the thing this page is most often asked to
 * do is survive a refresh: it is left open on a phone for hours and reloaded by
 * the browser whenever iOS feels like reclaiming the tab. A mode that lives
 * only in memory comes back as Sessions every time, which is the right default
 * and the wrong answer for somebody who was watching Box health.
 *
 * **The same argument applies to everything else the reader chose**, which is
 * why the hash grew a query string on 2026-09-08: `#sessions?order=uptime&sel=%241643`.
 * The sort order is a control the reader sets and then stops thinking about, so
 * losing it to a reload is the same small betrayal as losing the mode; and the
 * selected session in the hash means a link to one row is a link somebody can
 * send. Written as `?key=value` inside the fragment rather than as a real query
 * string so it still costs the server nothing — no route table, no history API,
 * and a static `dist/` that can be served from any prefix.
 *
 * `hashchange` is the one navigation event a browser fires for free, so back
 * and forward work with no router.
 *
 * An unrecognised mode — a stale bookmark, a mode that has been renamed — falls
 * back to Sessions rather than rendering nothing. An unrecognised PARAMETER is
 * carried along untouched, which is what lets a link written by a later build
 * survive a round trip through this one.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * `usage` sits next to `health` on purpose: one is the box's body and the other
 * is its budget, and a reader asking "why is everything slow / stalled" checks
 * both. Appending it would have been a smaller diff and a worse dock.
 */
export const MODES = ["sessions", "health", "usage", "overseer", "deploys"] as const;

export type Mode = (typeof MODES)[number];

export const MODE_LABELS: Record<Mode, string> = {
  sessions: "Sessions",
  health: "Box health",
  usage: "Usage limits",
  overseer: "Overseer",
  deploys: "Deploys",
};

/** Everything the fragment says. `params` is plain, so React can compare it. */
export type HashState = { mode: Mode; params: Readonly<Record<string, string>> };

/** The mode a hash names, or `sessions` for anything this build does not know. */
export function modeFromHash(hash: string): Mode {
  return parseHash(hash).mode;
}

/**
 * The fragment, split at the first `?`.
 *
 * The first `?` and not the last: a value may contain one, and `URLSearchParams`
 * will decode it. Everything is lower-cased on the MODE only — a session handle
 * is case-sensitive in principle and a title is not ours to fold.
 */
export function parseHash(hash: string): HashState {
  const body = hash.replace(/^#/, "");
  const cut = body.indexOf("?");
  const name = (cut === -1 ? body : body.slice(0, cut)).trim().toLowerCase();
  const mode: Mode = (MODES as readonly string[]).includes(name) ? (name as Mode) : "sessions";
  const params: Record<string, string> = {};
  if (cut !== -1) {
    for (const [key, value] of new URLSearchParams(body.slice(cut + 1))) {
      if (key !== "") params[key] = value;
    }
  }
  return { mode, params };
}

/**
 * A hash, from a mode and its parameters.
 *
 * Keys are sorted so the same state always spells the same string: an
 * unsorted version writes a different hash on every render whose object
 * happened to be built in another order, and a hash that changes is a
 * `hashchange`, which is a re-render, which writes the hash again.
 *
 * An empty value drops the key rather than writing `key=`, so "back to the
 * default" leaves no trace in the URL.
 */
export function formatHash(state: HashState): string {
  const search = new URLSearchParams();
  for (const key of Object.keys(state.params).sort()) {
    const value = state.params[key];
    if (value !== undefined && value !== "") search.set(key, value);
  }
  const query = search.toString();
  return query === "" ? `#${state.mode}` : `#${state.mode}?${query}`;
}

/**
 * The hash, and the two ways the page changes it.
 *
 * `setParam(key, null)` removes a key, which is how a control says "back to the
 * default" without inventing a sentinel value.
 */
export function useHashState(): {
  mode: Mode;
  params: Readonly<Record<string, string>>;
  chooseMode: (mode: Mode) => void;
  setParam: (key: string, value: string | null) => void;
} {
  const [hash, setHash] = useState<string>(() => (typeof window === "undefined" ? "" : window.location.hash));

  useEffect(() => {
    const onHashChange = (): void => setHash(window.location.hash);
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const state = useMemo(() => parseHash(hash), [hash]);

  /* Set the local state as well as the location rather than waiting for the
     event. Assigning the same hash fires no `hashchange`, so a tab already on
     `#health` whose button is clicked again would otherwise do nothing at all —
     and "nothing at all" is indistinguishable from a broken button. */
  const write = useCallback((next: HashState) => {
    const spelled = formatHash(next);
    setHash(spelled);
    if (typeof window !== "undefined") window.location.hash = spelled;
  }, []);

  const chooseMode = useCallback(
    (mode: Mode) => {
      /* The parameters ride along. Switching to Box health and back should
         land on the list the way it was left, and the alternative — dropping
         them — makes the mode switch quietly destructive. */
      write({ mode, params: state.params });
    },
    [state.params, write],
  );

  const setParam = useCallback(
    (key: string, value: string | null) => {
      const params: Record<string, string> = { ...state.params };
      if (value === null || value === "") delete params[key];
      else params[key] = value;
      write({ mode: state.mode, params });
    },
    [state.mode, state.params, write],
  );

  return { mode: state.mode, params: state.params, chooseMode, setParam };
}
