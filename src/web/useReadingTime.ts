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
 * Seconds live in plain variables inside the effect. React state is only the
 * level map, set only when some block crosses a step, so `Reader` re-renders a
 * few times a minute while you read rather than once a second.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { BlockId } from "../types.js";
import { apiFetch, leavingFetch, readJson } from "./lib/api.js";
import { firstOnScreen, type ReadLevel, readLevel, type RowBox, shareVisible } from "./reading-time.js";
import { stickyOffset } from "./scroll.js";

/** No input for this long and the reader is taken to have walked away. Fable, 2026-09-16. */
export const IDLE_MS = 300_000;
/** The heartbeat. */
export const TICK_MS = 1_000;
/** How often what has been credited is sent. */
export const FLUSH_MS = 60_000;
/** The most one tick may credit, in seconds. */
export const MAX_TICK_S = 2;
/** How often the cached row list is read again even when it looks intact. */
const ROWS_STALE_MS = 10_000;

/** The spelling of a block's row every other reader of this table uses — Spine.tsx, keynav.ts. */
const ROW_SELECTOR = "tbody tr[data-block]";

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

function sendReadingTime(path: string, init: RequestInit): void {
  let writes = writesInFlight.get(path);
  if (!writes) {
    writes = new Set();
    writesInFlight.set(path, writes);
  }
  const request = apiFetch(path, init).then(
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

export interface ReadingTime {
  /** Blocks with a level above zero. Stable identity until one changes. */
  levels: ReadonlyMap<BlockId, ReadLevel>;
  /** `Reader`'s gate: is the prose on screen right now. Off until it says so. */
  setCounting: (on: boolean) => void;
}

const NO_LEVELS: ReadonlyMap<BlockId, ReadLevel> = new Map();

/**
 * The rows between `viewTop` and `viewBottom`, with their boxes.
 *
 * A binary search for the first, then top-down until one starts below the view:
 * about log₂ n rect reads plus a screenful, each row read at most once, and
 * nothing written to the DOM in between.
 */
function rowsOnScreen(rows: readonly HTMLElement[], viewTop: number, viewBottom: number): RowBox[] {
  const boxes = new Map<number, DOMRect>();
  const rect = (i: number): DOMRect => {
    let r = boxes.get(i);
    if (!r) {
      r = (rows[i] as HTMLElement).getBoundingClientRect();
      boxes.set(i, r);
    }
    return r;
  };
  const out: RowBox[] = [];
  for (let i = firstOnScreen(rows.length, (j) => rect(j).bottom, viewTop); i < rows.length; i++) {
    const r = rect(i);
    if (r.top >= viewBottom) break;
    const id = (rows[i] as HTMLElement).dataset.block;
    if (id) out.push({ id, top: r.top, bottom: r.bottom });
  }
  return out;
}

export function readingTimePath(slug: string): string {
  return `/api/reading-time/${encodeURIComponent(slug)}`;
}

/**
 * Records while `enabled`, and draws from what the server had plus what this
 * page has credited since.
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
  const counting = useRef(false);
  const wordsRef = useRef(words);
  wordsRef.current = words;

  const setCounting = useCallback((on: boolean) => {
    counting.current = on;
  }, []);

  useEffect(() => {
    setLevels(NO_LEVELS);
    if (!enabled) return;

    const path = readingTimePath(slug);
    /* What the server said at open, and what this page has credited since.
       Kept apart so that a GET answering late cannot swallow local credit. */
    const server = new Map<BlockId, number>();
    const local = new Map<BlockId, number>();
    let pending = new Map<BlockId, number>();
    let shown = new Map<BlockId, ReadLevel>();

    let lastActive = Date.now();
    let lastTick = Date.now();
    let rows: HTMLElement[] = [];
    let rowsReadAt = 0;
    let gone = false;
    let opening = true;
    let flushAfterOpening = false;

    const recompute = (ids: Iterable<BlockId>) => {
      let next: Map<BlockId, ReadLevel> | null = null;
      for (const id of ids) {
        const level = readLevel((server.get(id) ?? 0) + (local.get(id) ?? 0), wordsRef.current.get(id) ?? 0);
        if ((shown.get(id) ?? 0) === level) continue;
        next ??= new Map(shown);
        if (level === 0) next.delete(id);
        else next.set(id, level);
      }
      if (next && !gone) {
        shown = next;
        setLevels(next);
      }
    };

    const freshRows = (now: number): HTMLElement[] => {
      const first = rows[0];
      const last = rows[rows.length - 1];
      if (!first || !last || !first.isConnected || !last.isConnected || now - rowsReadAt > ROWS_STALE_MS) {
        rows = Array.from(document.querySelectorAll<HTMLElement>(ROW_SELECTOR));
        rowsReadAt = now;
      }
      return rows;
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
        leavingFetch(path, init);
        return;
      }
      /* Dropped on failure, never re-queued — see the file header. `apiFetch`
         records the failure in the client log buffer, which is what a bug
         report carries. */
      sendReadingTime(path, init);
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
      } catch {
        /* Nothing to draw from the server is not a reason to stop recording. */
      } finally {
        opening = false;
        if (flushAfterOpening && !gone) flush(false);
      }
    })();

    return () => {
      gone = true;
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
  }, [slug, enabled]);

  return { levels: enabled ? levels : NO_LEVELS, setCounting };
}
