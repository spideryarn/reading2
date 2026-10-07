/**
 * **Where you have spent time reading** — the half that watches and sends.
 * `reading-time.ts` is the arithmetic; the plan is
 * docs/plans/260916c-show-where-you-have-spent-time-reading-in-the-spine-and-gutter.md.
 *
 * > perhaps what we could do is a heartbeat every second that makes a note of
 * > which blocks are fully or partially, maybe you get partial points for being
 * > partially visible. And every so often, maybe not every second, maybe every
 * > minute, we send an update to the server with the latest data from this
 * > heartbeat.
 * >
 * > — Greg, 2026-09-12
 *
 * **Owner only, by where it is mounted**: `OwnedReader` calls it and hands the
 * result down through the owner arm of `ReaderCapability`, so a visitor never
 * runs it and never asks the server anything.
 *
 * ## What counts as a second
 *
 * All four, on every tick:
 *
 *  - **`setCounting(true)`** — `Reader`'s word that the prose is on screen: text
 *    is shown and no band is lying over it. Only `Reader` knows that; the
 *    `.band-covers` class does not, because it is also set with no band open.
 *  - **The page is visible.**
 *  - **The reader has been active in the last `IDLE_MS`** — and arriving counts
 *    as activity (mounting, becoming visible, `pageshow`, `focus`), or opening
 *    an article and reading its first screen hands-off would record nothing.
 *  - **Elapsed time is measured**, and capped at `MAX_TICK_S`, so a throttled
 *    timer or a sleeping laptop does not arrive as one enormous credit.
 *
 * ## Sent at most once
 *
 * The server **adds** what it is sent. A batch the server committed and whose
 * answer was lost would be counted twice if it were retried — so pending
 * seconds are taken and cleared *before* each send, and a failed send is
 * dropped. Normally that loses at most a minute of reading; the first batch can
 * also contain however long the opening read took. GPT Sol's finding 2 on the
 * plan, 2026-09-16.
 *
 * The opening GET is ordered before this mount's first ordinary flush, and
 * after any cleanup POST from the preceding mount of the same article. Without
 * both halves, the snapshot can include seconds still held in `local` (drawn
 * twice), or miss seconds whose cleanup write it overtook (not drawn until the
 * next reload). A real teardown still sends immediately; a bfcache page is
 * still live and keeps the ordering.
 *
 * ## What re-renders
 *
 * Seconds live in plain variables inside the effect. React state is two maps:
 * `levels`, set only when some block crosses one of the four steps, and
 * `reach`, the spine's own measure (reading-time.ts § `readReach`), set when
 * one crosses a sixteenth. **Each keeps its identity when only the other
 * moved**, so the gutter's style sheet and the quiz, which read `levels`, are
 * not woken by a reach step. `Reader` itself re-renders on either — more often
 * than it did before 2026-10-03, and at log-spaced intervals rather than a
 * fixed one — which is why nothing it hands `memo(TableView)` may depend on
 * the capability object.
 * docs/plans/261003j-reading-time-on-the-spine-drawn-as-an-area-chart.md, F2.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { BlockId } from "../types.js";
import { apiFetch, leavingFetch, readJson } from "./lib/api.js";
import { useMadeFor } from "./lib/made-for.js";
import { rowCache, rowsOnScreen } from "./on-screen.js";
import {
  expectedSeconds,
  type ReadLevel,
  type ReadReach,
  readLevel,
  readReach,
  shareVisible,
} from "./reading-time.js";
import { stickyOffset } from "./scroll.js";

/** No input for this long and the reader is taken to have walked away. Fable, 2026-09-16. */
export const IDLE_MS = 300_000;
/** The heartbeat. */
export const TICK_MS = 1_000;
/** How often what has been credited is sent. */
export const FLUSH_MS = 60_000;
/** The most one tick may credit, in seconds. */
export const MAX_TICK_S = 2;

const ACTIVITY_EVENTS = ["scroll", "wheel", "keydown", "pointerdown", "pointermove", "touchstart"] as const;

/**
 * Ordinary writes still in flight, by article path.
 *
 * A reader can leave the reading view for Metadata and come straight back. The
 * old mount's cleanup POST and the new mount's opening GET must not race: if the
 * GET wins, the just-read seconds disappear from the display until another
 * reload. Writes may overlap each other because Postgres adds them atomically;
 * an opening read waits for all of them.
 */
const writesInFlight = new Map<string, Set<Promise<void>>>();

function sendReadingTime(path: string, init: RequestInit, madeFor: string | null): void {
  let writes = writesInFlight.get(path);
  if (!writes) {
    writes = new Set();
    writesInFlight.set(path, writes);
  }
  /* Both arms swallow, a refusal for another reader (`NotThisReader`) included. */
  const request = apiFetch(path, init, madeFor).then(
    () => undefined,
    () => undefined,
  );
  writes.add(request);
  void request.finally(() => {
    writes.delete(request);
    if (writes.size === 0 && writesInFlight.get(path) === writes) writesInFlight.delete(path);
  });
}

async function waitForReadingTimeWrites(path: string): Promise<void> {
  /* A write can join while an earlier one is settling, so observe until the set
     is empty rather than taking one snapshot and assuming it was final. */
  for (;;) {
    const writes = writesInFlight.get(path);
    if (!writes?.size) return;
    await Promise.all(writes);
  }
}

/**
 * Whether `levels` can be believed yet — which is not the same as whether it
 * is empty.
 *
 * `off`: not recording for this reader at all — a visitor, since 2026-10-05,
 * and nobody else until there is a setting to turn it off. `loading`: the
 * opening read has not answered for *this* run of the effect (a slug, or
 * `enabled` going off and on again, is a new run). `failed`: it never will, so the levels hold only
 * what this page has credited since. Only `loaded` means an empty map is "read
 * nothing". GPT Sol's findings 1 and 3 on
 * docs/plans/260930e-quiz-only-asks-about-what-you-have-read.md, which is what
 * reads it.
 */
export type ReadingTimeStatus = "off" | "loading" | "loaded" | "failed";

/** What one block has had, and what it takes to read, in seconds. */
export interface BlockReadingTime {
  seconds: number;
  expected: number;
}

/**
 * **The seconds behind a block's level**, for the line's card (BlockLinkCard.tsx
 * § `ReadingCard`). Null while not recording. Stable identity, and live: it
 * reads the running totals each call, so a caller that asks again a second
 * later sees the second.
 */
export type ReadingTimeFor = (id: BlockId) => BlockReadingTime | null;

export interface ReadingTime {
  /** Blocks with a level above zero. Stable identity until one changes. */
  levels: ReadonlyMap<BlockId, ReadLevel>;
  /**
   * The same blocks, by how far across the spine's rail each reaches, in
   * sixteenths. Stable identity until one changes — and a change here that
   * stays inside a level leaves `levels` the map it was.
   */
  reach: ReadonlyMap<BlockId, ReadReach>;
  status: ReadingTimeStatus;
  timeFor: ReadingTimeFor;
  /** `Reader`'s gate: is the prose on screen right now. Off until it says so. */
  setCounting: (on: boolean) => void;
}

const NO_LEVELS: ReadonlyMap<BlockId, ReadLevel> = new Map();
const NO_REACH: ReadonlyMap<BlockId, ReadReach> = new Map();

/**
 * `next` with `id` at `value`, copying `shown` only the first time something
 * differs — so a pass in which nothing moved hands back the `null` it was
 * given, and the caller sets no state. Zero is "not in the map".
 */
function withValue<V extends number>(
  shown: ReadonlyMap<BlockId, V>,
  next: Map<BlockId, V> | null,
  id: BlockId,
  value: V,
): Map<BlockId, V> | null {
  if ((next ?? shown).get(id) === value || (value === 0 && !(next ?? shown).has(id))) return next;
  const out = next ?? new Map(shown);
  if (value === 0) out.delete(id);
  else out.set(id, value);
  return out;
}

export function readingTimePath(slug: string): string {
  return `/api/reading-time/${encodeURIComponent(slug)}`;
}

/**
 * Records while `enabled`, and draws from what the server had plus what this
 * page has credited since.
 *
 * **Its one caller passes `true`** since 2026-10-05: every owner is recorded,
 * whatever the experimental switch says (docs/project/reading-time.md § Who
 * gets it). The parameter stays because a reader's own off switch, which is
 * not built, would arrive through it, and the tests of turning it off are the
 * tests that switch will need.
 *
 * `words` is each block's word count, which is what a level is measured
 * against; a block missing from it is measured as having none.
 */
export function useReadingTime(
  slug: string,
  words: ReadonlyMap<BlockId, number>,
  enabled: boolean,
): ReadingTime {
  const [levels, setLevels] = useState<ReadonlyMap<BlockId, ReadLevel>>(NO_LEVELS);
  const [reach, setReach] = useState<ReadonlyMap<BlockId, ReadReach>>(NO_REACH);
  /* Keyed to the slug it answers for, so a render between a slug change and
     this effect's reset cannot report the previous article's `loaded`. */
  const [opened, setOpened] = useState<{ slug: string; status: "loading" | "loaded" | "failed" }>({
    slug,
    status: "loading",
  });
  const counting = useRef(false);
  const wordsRef = useRef(words);
  wordsRef.current = words;

  const setCounting = useCallback((on: boolean) => {
    counting.current = on;
  }, []);
  /* Whichever run of the effect is live puts its own lookup here, and takes it
     away on cleanup — so `timeFor` never answers from a previous article, or
     after the switch went off, however long a card stays open. */
  const lookup = useRef<ReadingTimeFor | null>(null);
  const timeFor = useCallback<ReadingTimeFor>((id) => lookup.current?.(id) ?? null, []);
  /* The reader these seconds are for (lib/made-for.ts). Both flushes that
     matter are made late: the cleanup's runs as the view unmounts, which a
     change of reader causes, and `pagehide`'s uses whatever token the tab
     holds. Unnamed, one reader's seconds were counted for the next.
     docs/plans/261006f-every-request-is-bound-to-the-reader-at-its-start.md § Stage 2. */
  const madeFor = useMadeFor();

  useEffect(() => {
    setLevels(NO_LEVELS);
    setReach(NO_REACH);
    setOpened({ slug, status: "loading" });
    lookup.current = null;
    if (!enabled) return;

    const path = readingTimePath(slug);
    /* What the server said at open, and what this page has credited since.
       Kept apart so that a GET answering late cannot swallow local credit. */
    const server = new Map<BlockId, number>();
    const local = new Map<BlockId, number>();
    let pending = new Map<BlockId, number>();
    let shown = new Map<BlockId, ReadLevel>();
    let shownReach = new Map<BlockId, ReadReach>();
    const ownLookup: ReadingTimeFor = (id) => ({
      seconds: (server.get(id) ?? 0) + (local.get(id) ?? 0),
      expected: expectedSeconds(wordsRef.current.get(id) ?? 0),
    });
    lookup.current = ownLookup;

    let lastActive = Date.now();
    let lastTick = Date.now();
    /* The row list and `rowsOnScreen` are on-screen.ts, shared with the band's
       on-screen block links. */
    const freshRows = rowCache();
    let gone = false;
    let opening = true;
    let flushAfterOpening = false;

    const recompute = (ids: Iterable<BlockId>) => {
      let next: Map<BlockId, ReadLevel> | null = null;
      let nextReach: Map<BlockId, ReadReach> | null = null;
      for (const id of ids) {
        const seconds = (server.get(id) ?? 0) + (local.get(id) ?? 0);
        const words = wordsRef.current.get(id) ?? 0;
        /* Two independent comparisons, and no early `continue` on an equal
           level: either scale can move while the other stays put. */
        next = withValue(shown, next, id, readLevel(seconds, words));
        nextReach = withValue(shownReach, nextReach, id, readReach(seconds, words));
      }
      if (gone) return;
      if (next) {
        shown = next;
        setLevels(next);
      }
      if (nextReach) {
        shownReach = nextReach;
        setReach(nextReach);
      }
    };

    const tick = () => {
      const now = Date.now();
      const elapsed = Math.min(MAX_TICK_S, Math.max(0, (now - lastTick) / 1000));
      lastTick = now;
      if (!counting.current) return;
      if (document.visibilityState !== "visible") return;
      if (now - lastActive > IDLE_MS) return;
      if (elapsed === 0) return;

      const viewTop = stickyOffset();
      const viewBottom = window.innerHeight;
      const onScreen = rowsOnScreen(freshRows(now), viewTop, viewBottom);

      const shares = shareVisible(onScreen, viewTop, viewBottom);
      for (const [id, share] of shares) {
        const credit = share * elapsed;
        local.set(id, (local.get(id) ?? 0) + credit);
        pending.set(id, (pending.get(id) ?? 0) + credit);
      }
      recompute(shares.keys());
    };

    /** Take what is pending, clear it, send it once. `leaving` is `pagehide`. */
    const flush = (leaving: boolean) => {
      /* Until the opening snapshot is known, an ordinary POST can land before
         the GET reads. Its seconds would then be present in both `server` and
         `local`. A cleanup has no live display left to corrupt and must not
         wait for a continuation owned by the component being removed. */
      if (!leaving && opening && !gone) {
        flushAfterOpening = true;
        return;
      }
      if (pending.size === 0) return;
      const batch = pending;
      pending = new Map();
      const seconds: Record<BlockId, number> = {};
      for (const [id, s] of batch) {
        const rounded = Math.round(s * 1000) / 1000;
        if (rounded > 0) seconds[id] = rounded;
      }
      if (Object.keys(seconds).length === 0) return;
      const init = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seconds }),
      };
      if (leaving) {
        // `void`: it never rejects, and nothing may wait on it (api.ts § `leavingFetch`).
        void leavingFetch(path, init, madeFor);
        return;
      }
      /* Dropped on failure, never re-queued — see the file header. `apiFetch`
         records the failure in the client log buffer, which is what a bug
         report carries. */
      sendReadingTime(path, init, madeFor);
    };

    const active = () => {
      lastActive = Date.now();
    };
    const visibility = () => {
      if (document.visibilityState === "visible") {
        active();
        /* Time spent hidden is not a tick's worth of credit. */
        lastTick = Date.now();
      } else {
        flush(false);
      }
    };
    const leave = (event: PageTransitionEvent) => {
      /* A bfcache page is not leaving: this effect and its opening GET resume
         with it. Sending before that GET settles would recreate the double-count
         race on Back. A real teardown has no display left and must send now. */
      if (event.persisted && opening) {
        flushAfterOpening = true;
        return;
      }
      flush(true);
    };

    for (const name of ACTIVITY_EVENTS) window.addEventListener(name, active, { passive: true, capture: true });
    window.addEventListener("pageshow", active);
    window.addEventListener("focus", active);
    window.addEventListener("pagehide", leave);
    document.addEventListener("visibilitychange", visibility);
    const ticker = window.setInterval(tick, TICK_MS);
    const flusher = window.setInterval(() => flush(false), FLUSH_MS);

    void (async () => {
      try {
        /* A cleanup POST from the preceding mount is part of the snapshot this
           GET must see. This also makes StrictMode's simulated first mount
           disappear before it spends a request. */
        await waitForReadingTimeWrites(path);
        if (gone) return;
        const body = await readJson<{ seconds: Record<BlockId, number> }>(await apiFetch(path));
        if (gone) return;
        for (const [id, s] of Object.entries(body.seconds ?? {})) {
          if (typeof s === "number" && Number.isFinite(s) && s > 0) server.set(id, s);
        }
        recompute(new Set([...server.keys(), ...local.keys()]));
        if (!gone) setOpened({ slug, status: "loaded" });
      } catch {
        /* Nothing to draw from the server is not a reason to stop recording. */
        if (!gone) setOpened({ slug, status: "failed" });
      } finally {
        opening = false;
        if (flushAfterOpening && !gone) flush(false);
      }
    })();

    return () => {
      gone = true;
      if (lookup.current === ownLookup) lookup.current = null;
      for (const name of ACTIVITY_EVENTS) window.removeEventListener(name, active, { capture: true });
      window.removeEventListener("pageshow", active);
      window.removeEventListener("focus", active);
      window.removeEventListener("pagehide", leave);
      document.removeEventListener("visibilitychange", visibility);
      window.clearInterval(ticker);
      window.clearInterval(flusher);
      /* Leaving the article inside the app: the page is still alive, so the
         ordinary request. */
      flush(false);
    };
  }, [slug, enabled, madeFor]);

  const status: ReadingTimeStatus = !enabled ? "off" : opened.slug === slug ? opened.status : "loading";
  return {
    levels: enabled ? levels : NO_LEVELS,
    reach: enabled ? reach : NO_REACH,
    status,
    setCounting,
    timeFor,
  };
}
