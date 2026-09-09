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
export const MODES = ["sessions", "messages", "health", "usage", "readiness", "overseer", "decisions", "ideas", "deploys"] as const;

export type Mode = (typeof MODES)[number];

export const MODE_LABELS: Record<Mode, string> = {
  sessions: "Sessions",
  messages: "Recent messages",
  health: "Box health",
  usage: "Usage limits",
  readiness: "Readiness",
  overseer: "Overseer",
  decisions: "Decisions",
  ideas: "Queued ideas",
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
 * A set of parameters with some changes applied. `null` — or `""` — removes a
 * key, which is how a control says "back to the default" without inventing a
 * sentinel value.
 *
 * Pure and exported so the three writers below are one line each: there is
 * exactly one place that decides what a change means.
 */
export function applyChanges(
  params: Readonly<Record<string, string>>,
  changes: Record<string, string | null>,
): Record<string, string> {
  const next: Record<string, string> = { ...params };
  for (const [key, value] of Object.entries(changes)) {
    if (value === null || value === "") delete next[key];
    else next[key] = value;
  }
  return next;
}

/**
 * The hash, and the three ways the page changes it.
 *
 * `setParam(key, null)` removes a key, which is how a control says "back to the
 * default" without inventing a sentinel value.
 */
export function useHashState(): {
  mode: Mode;
  params: Readonly<Record<string, string>>;
  chooseMode: (mode: Mode) => void;
  setParam: (key: string, value: string | null) => void;
  setParams: (changes: Record<string, string | null>) => void;
  go: (mode: Mode, changes?: Record<string, string | null>) => void;
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

  /**
   * **A MODE AND SOME PARAMETERS, IN ONE WRITE — the only way to change both.**
   *
   * Calling `chooseMode` and then `setParam` is the bug `setParams` below was
   * written for, one level up: both close over the SAME captured `state`, so
   * the second write starts from the snapshot the first never reached and
   * silently discards it. In practice that is *switch to Sessions and land on
   * an unselected list*, or *select a session and stay on the feed* — depending
   * only on which was called last, and neither of them looks broken.
   *
   * It is what the Recent messages tab navigates with (`go("sessions", { sel })`),
   * and `chooseMode` and `setParams` are now both one line of it, so there is
   * one writer rather than three.
   *
   * **The parameters ride along by default.** Switching to Box health and back
   * should land on the list the way it was left; dropping them would make the
   * mode switch quietly destructive — and it is what makes the browser's own
   * Back button return to a filtered feed with its filters still on.
   */
  const go = useCallback(
    (mode: Mode, changes: Record<string, string | null> = {}) => {
      write({ mode, params: applyChanges(state.params, changes) });
    },
    [state.params, write],
  );

  const chooseMode = useCallback((mode: Mode) => go(mode), [go]);

  /**
   * **SEVERAL KEYS AT ONCE, AND THE REASON IS A BUG THIS SHIPPED WITH.**
   *
   * `setParam` closes over `state.params`. Calling it four times in a row —
   * which is exactly what a panel with four filter controls does when it writes
   * a whole filter object — starts each call from the SAME captured snapshot,
   * so the last write wins and the other three are silently discarded. On the
   * Recent messages tab that meant "Hide tool calls" persisted (it was last)
   * and the session, speaker and text filters reverted on the next render, with
   * nothing on screen to say so.
   *
   * The unit tests missed it because they exercised the pure filter/param
   * converters, which are correct — the fault was in the composition, and no
   * test drove the composition. GPT Sol's P1 on the code review.
   *
   * A `null` value removes its key, exactly as in `setParam`.
   */
  const setParams = useCallback(
    (changes: Record<string, string | null>) => go(state.mode, changes),
    [go, state.mode],
  );

  const setParam = useCallback(
    (key: string, value: string | null) => setParams({ [key]: value }),
    [setParams],
  );

  return { mode: state.mode, params: state.params, chooseMode, setParam, setParams, go };
}
