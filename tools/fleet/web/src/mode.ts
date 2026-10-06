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
 * **Back undoes the last deliberate act, not the last write.** The page writes
 * the fragment itself with `history.pushState` or `history.replaceState`, and
 * `historyKindFor` below is the one place that says which: an entry for a mode
 * change and for opening a session from the list, a rewrite of the current
 * entry for everything else. Until 2026-10-06 every write was
 * `window.location.hash =`, which is always a new entry — one per keystroke in
 * the feed's text filter. Still no router: `hashchange` and `popstate` are
 * listened to only for navigation the page did not make.
 *
 * An unrecognised mode — a stale bookmark, a mode that has been renamed — falls
 * back to Sessions rather than rendering nothing. An unrecognised PARAMETER is
 * carried along untouched, which is what lets a link written by a later build
 * survive a round trip through this one.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * `usage` sits next to `health` on purpose: one is the box's body and the other
 * is its budget, and a reader asking "why is everything slow / stalled" checks
 * both. Appending it would have been a smaller diff and a worse dock.
 */
export const MODES = ["sessions", "messages", "health", "usage", "readiness", "overseer", "decisions", "ideas", "deploys", "questions"] as const;

export type Mode = (typeof MODES)[number];

/** The mode an empty or unrecognised hash opens — the one line a different
 *  landing tab would change. Not "the Sessions tab": `go("sessions", …)` means that. */
export const DEFAULT_MODE: Mode = "sessions";

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
  questions: "Questions",
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
  const mode: Mode = (MODES as readonly string[]).includes(name) ? (name as Mode) : DEFAULT_MODE;
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
 * **WHETHER A WRITE IS SOMETHING BACK SHOULD UNDO.**
 *
 * Push for a deliberate act — changing mode, or opening a session when none was
 * open — and replace for everything else: walking from one session to another,
 * closing the detail, an ordering, a limit, every filter. So Back from an open
 * session is the list, and Back never steps through sessions or letters.
 *
 * Closing replaces rather than going back, which leaves two list entries after
 * *open, close*. `history.back()` there would also undo an ordering changed
 * while the detail was open (GPT Sol's F2 on the plan).
 *
 * **Decided here from the two states, so no caller chooses** and a parameter
 * added later is a replace without anybody deciding. An identical state is a
 * replace as well: rewriting an entry with itself adds nothing.
 */
export function historyKindFor(prev: HashState, next: HashState): "push" | "replace" {
  if (prev.mode !== next.mode) return "push";
  const open = (state: HashState): boolean => (state.params["sel"] ?? "") !== "";
  return !open(prev) && open(next) ? "push" : "replace";
}

/**
 * The hash, and the ways the page changes it.
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
  const state = useMemo(() => parseHash(hash), [hash]);

  /**
   * **WHAT THE PAGE IS SHOWING, AS OF THE LAST WRITE RATHER THAN THE LAST
   * RENDER.** Every writer starts from this and updates it before anything
   * else, so two writes in one handler compose. They used to start from the
   * render they were created in, and the second silently discarded the first —
   * the bug `go` and `setParams` were each written to route around, and which
   * now cannot happen between any two of them.
   *
   * It is also not the address. A write the browser refuses (below) leaves the
   * address behind, and this is what the page goes on showing.
   */
  const latest = useRef<HashState>(state);

  /* Navigation the page did not make: Back, Forward, a hand-edited address.
     Both events, because a traversal between two of our own entries is a
     `popstate` and an edited address is a `hashchange`; a traversal that fires
     both adopts the same address twice. The page's own writes fire neither. */
  useEffect(() => {
    const adopt = (): void => {
      latest.current = parseHash(window.location.hash);
      setHash(window.location.hash);
    };
    window.addEventListener("hashchange", adopt);
    window.addEventListener("popstate", adopt);
    return () => {
      window.removeEventListener("hashchange", adopt);
      window.removeEventListener("popstate", adopt);
    };
  }, []);

  /**
   * **THE ONE WRITER.**
   *
   * The local state is set here rather than read back from the address: no
   * event follows a History API write, and the button for a mode already
   * showing must still visibly do something — "nothing at all" is
   * indistinguishable from a broken button.
   *
   * **The History API for both kinds, never `window.location.hash =`.** An
   * assignment queues a `hashchange`; if a later write is refused, that event
   * arrives to find the address still saying the older thing and puts it back
   * on screen (GPT Sol's F10 on the plan).
   *
   * **A refused write is survived, not retried.** Safari throws a
   * `SecurityError` past 100 History API calls in 30 seconds, which only
   * sustained fast typing in a filter reaches. The page keeps what the reader
   * chose and the address stays where it was; the next write that succeeds
   * spells the whole latest state, so what is lost is a reload in between. A
   * debounce would need a protocol against pushes and traversals to buy the
   * same thing.
   *
   * A bare `#fragment` resolves against the current URL, so the path and any
   * real query string are kept.
   */
  const write = useCallback((next: HashState) => {
    const kind = historyKindFor(latest.current, next);
    const spelled = formatHash(next);
    latest.current = next;
    setHash(spelled);
    if (typeof window === "undefined") return;
    try {
      if (kind === "push") window.history.pushState(window.history.state, "", spelled);
      else window.history.replaceState(window.history.state, "", spelled);
    } catch {
      /* Refused — see above. The address is stale until the next write. */
    }
  }, []);

  /**
   * **A MODE AND SOME PARAMETERS, IN ONE WRITE.**
   *
   * It is what the Recent messages tab navigates with (`go("sessions", { sel })`),
   * and `chooseMode` and `setParams` are both one line of it, so there is one
   * writer rather than three. `chooseMode` then `setParam` reaches the same
   * state since both start from `latest`, but as two writes.
   *
   * **The parameters ride along by default.** Switching to Box health and back
   * should land on the list the way it was left; dropping them would make the
   * mode switch quietly destructive — and it is what makes the browser's own
   * Back button return to a filtered feed with its filters still on.
   */
  const go = useCallback(
    (mode: Mode, changes: Record<string, string | null> = {}) => {
      write({ mode, params: applyChanges(latest.current.params, changes) });
    },
    [write],
  );

  const chooseMode = useCallback((mode: Mode) => go(mode), [go]);

  /**
   * **SEVERAL KEYS AT ONCE, AND THE REASON IS A BUG THIS SHIPPED WITH.**
   *
   * `setParam` used to close over `state.params`. Calling it four times in a
   * row — which is exactly what a panel with four filter controls does when it
   * writes a whole filter object — started each call from the SAME captured
   * snapshot, so the last write won and the other three were silently
   * discarded. On the Recent messages tab that meant "Hide tool calls"
   * persisted (it was last) and the session, speaker and text filters reverted
   * on the next render, with nothing on screen to say so.
   *
   * The unit tests missed it because they exercised the pure filter/param
   * converters, which are correct — the fault was in the composition, and no
   * test drove the composition. GPT Sol's P1 on the code review.
   *
   * Four calls would compose now that every writer reads `latest`, but as four
   * writes where this is one.
   *
   * A `null` value removes its key, exactly as in `setParam`.
   */
  const setParams = useCallback(
    (changes: Record<string, string | null>) => go(latest.current.mode, changes),
    [go],
  );

  const setParam = useCallback(
    (key: string, value: string | null) => setParams({ [key]: value }),
    [setParams],
  );

  return { mode: state.mode, params: state.params, chooseMode, setParam, setParams, go };
}
