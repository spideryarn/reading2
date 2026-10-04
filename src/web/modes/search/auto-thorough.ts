/**
 * **A quick search starts the thorough one by itself, and swaps it in** —
 * plan 261004l.
 *
 * > The quick searches seem much worse than the thorough searches, so I wonder if the
 * > best-of-all-worlds approach is to run a quick search immediately, and and also kick off a thorough
 * > search in the background that will finish a few seconds later.
 * >
 * > — Greg, 2026-10-04
 *
 * Two pure decisions and the hook that carries them out. All of it lives in
 * this tab: no server change, and no promise across a reload
 * (docs/project/search.md § A quick search starts the thorough one).
 *
 * - `launchThorough`: does this finished quick row get its thorough search
 *   now? One per *settled* answer, because a thorough search costs about a
 *   hundred times a quick one and cannot be cancelled once begun.
 * - `settleThorough`: what becomes of a thorough search that is out: wait,
 *   swap it in for its quick row, or throw it away.
 * - `useAutoThorough`: the watch list, the settle timers, the pairs, and the
 *   rows the panel is shown in place of the hook's.
 */
import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import type { MutableRefObject } from "react";
import type { SearchRun } from "../../../types.js";

/**
 * How long a quick answer must stay `done` with the same words before its
 * thorough search starts. Enter and *find* skip it. Greg's Q-settle in the
 * plan: change this one constant if it feels slow.
 */
export const SETTLE_MS = 2000;

/** One thorough search out for one quick row. */
export interface ThoroughPair {
  /** The hidden meaning row, by the id the server is using. */
  meaningId: string;
  quickId: string;
  /** The trimmed words both were asked with. */
  words: string;
  /**
   * The quick row moved on while this was out: new words, pending again, or
   * deleted. It never comes back, so the answer is thrown away when it lands.
   */
  discard: boolean;
}

export type Settled = { type: "wait" } | { type: "swap" } | { type: "drop" };

/**
 * What to do with one pair now.
 *
 * `wait` while the thorough row is `pending`, **always**, even when the pair
 * is discarded: removing the row would release the duplicate guard while the
 * request is still running on the server (review F5). `swap` only when the
 * answer is complete, the quick row is still the one it was asked for, and
 * the box holds no edit that has not been asked yet (review F2: the swap ends
 * the typing session, which would strand that edit). Anything else is `drop`:
 * the thorough row goes, and the quick row is left alone.
 */
export function settleThorough(
  pair: ThoroughPair,
  now: {
    meaning: { status: SearchRun["status"] } | undefined;
    quick: { status: SearchRun["status"]; words: string } | undefined;
    /** The typing session owns the quick row and the box's words differ from it. */
    unasked: boolean;
  },
): Settled {
  if (now.meaning === undefined) return { type: "drop" };
  switch (now.meaning.status) {
    case "pending":
      return { type: "wait" };
    case "error":
      return { type: "drop" };
    case "done": {
      const same =
        now.quick !== undefined && now.quick.status === "done" && now.quick.words === pair.words;
      return !pair.discard && same && !now.unasked ? { type: "swap" } : { type: "drop" };
    }
    default: {
      const never: never = now.meaning.status;
      return never;
    }
  }
}

export type Launch =
  /** Ask the thorough search now. */
  | { type: "launch" }
  /** Not yet: look again in `ms`. */
  | { type: "wait"; ms: number }
  /** Refused for good: record this row and these words as tried. */
  | { type: "never" }
  /** Nothing to do, and nothing to remember. */
  | { type: "idle" };

/**
 * Does a watched quick row get its thorough search now? The plan's § "The one
 * real decision", one rule per line.
 */
export function launchThorough(row: {
  /** The quick row's status, or `undefined` if it is not in the list. */
  status: SearchRun["status"] | undefined;
  /** Enter or *find* was pressed on these words (review F1). */
  submitted: boolean;
  /** How long the row has been `done` with these words. */
  settledMs: number;
  /** The typing session owns the row and the box's words differ from it (review F2). */
  unasked: boolean;
  /** A thorough search for these words is already out from this tab. */
  running: boolean;
  /** This row has already been tried with these words. A failure is not retried by itself. */
  tried: boolean;
}): Launch {
  // A pending or failed quick search is not upgraded; a failed one has its own retry.
  if (row.status !== "done" || row.tried) return { type: "idle" };
  if (!row.submitted && row.settledMs < SETTLE_MS) {
    return { type: "wait", ms: SETTLE_MS - row.settledMs };
  }
  if (row.unasked) return { type: "wait", ms: SETTLE_MS };
  if (row.running) return { type: "never" };
  return { type: "launch" };
}

/**
 * What the hook needs from `SearchBand` that does not exist until after the
 * hook has run: the typing session is made after `useSearchMode`, which needs
 * this hook's rows. Handed over through a ref the band fills on every render,
 * the same way `renameActive` reaches `?runs=` there. Read only in effects.
 */
export interface AutoThoroughWiring {
  /** `useSearch.isRunning(words, "meaning")`. */
  running(words: string): boolean;
  /** Ask the thorough search, quietly and unticked. Returns the id minted. */
  launch(words: string): string;
  /** Remove a thorough row that will not be used. */
  drop(meaningId: string): void;
  /** Does the typing session own this quick row? */
  owns(quickId: string): boolean;
  /** The box's words now, trimmed. */
  boxWords(): string;
  /** Put the thorough row where the quick one is: colour, `?runs=`, then delete the quick row. */
  swap(pair: ThoroughPair): void;
}

const triedKey = (quickId: string, words: string) => `${quickId}\u0000${words}`;

export interface AutoThorough<Run extends SearchRun> {
  /**
   * The rows the reader is shown: no thorough row that is still paired, and a
   * swapped-in row at its quick row's `createdAt` so it keeps its place in a
   * list sorted by that (review F3; this tab only, a reload sorts it by its own).
   */
  visible: Run[];
  /** The paired thorough rows, for the panel's "already running" keys (review F6). */
  hidden: Run[];
  /** Quick rows whose thorough search is out and will replace them. */
  upgrading: ReadonlySet<string>;
  /** The typing session minted this quick row: watch it. */
  watch(quickId: string): void;
  /** Enter or *find* submitted these (trimmed) words, asked or not (review F1). */
  submitted(words: string): void;
  /** `begin` answered under another id. */
  renamed(from: string, to: string): void;
}

/** What the hook keeps that nothing renders from. One object, made once per mount. */
interface Local {
  /** Quick rows this tab's typing session minted. */
  watch: Set<string>;
  /** Since when each watched row has been `done` with its words, and its timer. */
  seen: Map<string, { words: string; since: number; timer: ReturnType<typeof setTimeout> | undefined }>;
  /** (row, words) already launched or refused. */
  tried: Set<string>;
  /** Words Enter or *find* submitted. */
  submitted: Set<string>;
  /** Thorough rows already swapped or dropped, so neither happens twice. */
  acted: Set<string>;
  /** A swapped-in row's place in the list: its quick row's `createdAt` (review F3). */
  place: Map<string, string>;
}

const newLocal = (): Local => ({
  watch: new Set(),
  seen: new Map(),
  tried: new Set(),
  submitted: new Set(),
  acted: new Set(),
  place: new Map(),
});

/** Stop timing a watched row: it is no longer `done` with the words it had. */
function unsee(local: Local, id: string): void {
  clearTimeout(local.seen.get(id)?.timer);
  local.seen.delete(id);
}

/** One look at the list: the rows by id, the wiring, and the clock. */
interface Look {
  local: Local;
  wired: AutoThoroughWiring;
  byId: ReadonlyMap<string, SearchRun>;
  now: number;
  /** Ask for another look later: a settle timer's callback. */
  again(): void;
}

const unasked = ({ wired }: Look, quickId: string, words: string) =>
  wired.owns(quickId) && wired.boxWords() !== words;

/**
 * Step 1: every watched quick row is launched, timed, or left alone. Returns
 * the pairs launched now.
 */
function launchWatched(look: Look): ThoroughPair[] {
  const { local, wired, byId, now } = look;
  const launched: ThoroughPair[] = [];
  for (const id of local.watch) {
    const row = byId.get(id);
    if (row?.status !== "done") {
      unsee(local, id);
      continue;
    }
    const words = row.criterion.trim();
    let seen = local.seen.get(id);
    if (seen?.words !== words) {
      unsee(local, id);
      seen = { words, since: now, timer: undefined };
      local.seen.set(id, seen);
    }
    const key = triedKey(id, words);
    const decision = launchThorough({
      status: row.status,
      submitted: local.submitted.has(words),
      settledMs: now - seen.since,
      unasked: unasked(look, id, words),
      running: wired.running(words),
      tried: local.tried.has(key),
    });
    switch (decision.type) {
      case "idle":
        break;
      case "never":
        local.tried.add(key);
        break;
      case "wait": {
        if (seen.timer !== undefined) break;
        const mine = seen;
        mine.timer = setTimeout(() => {
          mine.timer = undefined;
          look.again();
        }, decision.ms);
        break;
      }
      case "launch":
        // Before the ask, so nothing can ask these words for this row again.
        local.tried.add(key);
        launched.push({ meaningId: wired.launch(words), quickId: id, words, discard: false });
        break;
      default: {
        const never: never = decision;
        return never;
      }
    }
  }
  return launched;
}

/**
 * Step 2: every pair waits, is swapped in, or is dropped. Returns the pairs
 * newly found obsolete (by thorough id), and whether any was settled.
 */
function settlePairs(
  look: Look,
  pairs: readonly ThoroughPair[],
): { discards: Set<string>; settled: boolean } {
  const { local, wired, byId } = look;
  const discards = new Set<string>();
  let settled = false;
  for (const before of pairs) {
    if (local.acted.has(before.meaningId)) continue;
    const quick = byId.get(before.quickId);
    const obsolete =
      quick === undefined || quick.status === "pending" || quick.criterion.trim() !== before.words;
    const pair = obsolete && !before.discard ? { ...before, discard: true } : before;
    const decision = settleThorough(pair, {
      meaning: byId.get(pair.meaningId),
      quick: quick && { status: quick.status, words: quick.criterion.trim() },
      unasked: unasked(look, pair.quickId, pair.words),
    });
    switch (decision.type) {
      case "wait":
        if (pair !== before) discards.add(pair.meaningId);
        break;
      case "swap":
        // Before the calls, so a second pass cannot swap it again.
        local.acted.add(pair.meaningId);
        if (quick) local.place.set(pair.meaningId, quick.createdAt);
        wired.swap(pair);
        settled = true;
        break;
      case "drop":
        local.acted.add(pair.meaningId);
        wired.drop(pair.meaningId);
        settled = true;
        break;
      default: {
        const never: never = decision;
        return never;
      }
    }
  }
  return { discards, settled };
}

/**
 * The watch list, the settle timers and the pairs.
 *
 * **Pairs are React state, and that is deliberate.** They are read beside
 * `runs` in one effect, and a rename moves a row's id in `runs` and in the
 * pairs inside the same batch, so the effect always sees the two agree. Kept
 * in a ref, a rename landing between a commit and its effect would show the
 * effect a pair whose row "has gone", and it would be dropped.
 *
 * The guards against asking or removing twice are in `Local` (`tried`,
 * `acted`), set synchronously before the call they guard, so a replayed
 * effect (StrictMode) or a second pass before the state lands does nothing.
 */
export function useAutoThorough<Run extends SearchRun>({
  slug,
  runs,
  wiring,
}: {
  slug: string;
  /** Every row `useSearch` holds, hidden ones included. */
  runs: Run[];
  wiring: MutableRefObject<AutoThoroughWiring>;
}): AutoThorough<Run> {
  const [pairs, setPairs] = useState<ThoroughPair[]>([]);
  /* A settle timer fired, or Enter was pressed: look again. */
  const [looks, lookAgain] = useReducer((n: number) => n + 1, 0);
  const [local] = useState(newLocal);

  // Another article, or leaving Search mode: stop the timers and forget the pairs.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `slug` is the trigger — a new article forgets everything.
  useEffect(
    () => () => {
      for (const id of [...local.seen.keys()]) unsee(local, id);
      local.watch.clear();
      local.tried.clear();
      local.submitted.clear();
      local.acted.clear();
      local.place.clear();
      setPairs([]);
    },
    [slug, local],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: `looks` is a trigger, not an input — a timer or Enter asks for another look.
  useEffect(() => {
    const look: Look = {
      local,
      wired: wiring.current,
      byId: new Map(runs.map((r) => [r.id, r])),
      now: Date.now(),
      again: lookAgain,
    };
    const launched = launchWatched(look);
    const { discards, settled } = settlePairs(look, pairs);
    /* Applied as a functional update, by id, rather than by replacing the
       list with one built from this effect's `pairs`: a rename queued by a
       stream between this commit and this effect would be overwritten by a
       list that still held the old id. */
    if (settled || discards.size > 0 || launched.length > 0) {
      setPairs((prev) => [
        ...prev
          .filter((p) => !local.acted.has(p.meaningId))
          .map((p) => (discards.has(p.meaningId) && !p.discard ? { ...p, discard: true } : p)),
        ...launched,
      ]);
    }
  }, [runs, pairs, looks, local, wiring]);

  const hiddenIds = useMemo(() => new Set(pairs.map((p) => p.meaningId)), [pairs]);
  const visible = useMemo(
    () =>
      runs
        .filter((r) => !hiddenIds.has(r.id))
        .map((r) => {
          const at = local.place.get(r.id);
          return at === undefined ? r : { ...r, createdAt: at };
        }),
    [runs, hiddenIds, local],
  );
  const hidden = useMemo(() => runs.filter((r) => hiddenIds.has(r.id)), [runs, hiddenIds]);
  const upgrading = useMemo(
    () => new Set(pairs.filter((p) => !p.discard).map((p) => p.quickId)),
    [pairs],
  );

  const watch = useCallback((quickId: string) => void local.watch.add(quickId), [local]);
  const submitted = useCallback(
    (words: string) => {
      if (words === "") return;
      local.submitted.add(words);
      lookAgain();
    },
    [local],
  );
  const renamed = useCallback(
    (from: string, to: string) => {
      if (local.watch.delete(from)) local.watch.add(to);
      setPairs((prev) =>
        prev.some((p) => p.meaningId === from || p.quickId === from)
          ? prev.map((p) => ({
              ...p,
              meaningId: p.meaningId === from ? to : p.meaningId,
              quickId: p.quickId === from ? to : p.quickId,
            }))
          : prev,
      );
    },
    [local],
  );

  return { visible, hidden, upgrading, watch, submitted, renamed };
}
