/**
 * **Trajectory mode's controller.** The owner's band, and the hook underneath
 * it: `?depth=`, `?stop=`, the stop's passage pushed up to the prose, and the
 * handle `Reader` uses for ← / → and for the door after the stop's block.
 *
 * The shape of `modes/<feature>/` (TimelineMode.tsx is the nearest sibling:
 * a passage producer with a selection in the URL), with one thing none of them
 * has — a **controller published upward**, because two things outside the band
 * step the route: the keys, which `useArrowNav` owns, and the door, which lives
 * in the prose `TableView` draws. Both ask this hook, so all three ways of
 * stepping are one rule (src/web/trajectory-route.ts).
 *
 * No visitor twin: `POLICY.trajectory` is `owners-only` (src/web/visitor.ts).
 *
 * docs/plans/260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md
 * § The mode (client), docs/project/trajectory.md.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useQueryStates } from "nuqs";
import type { Block, BlockId, Quote, Tree, TrajectoryDepth, TrajectoryStop } from "../../../types.js";
import { blockIndex, sectionPathOf } from "../../../section-path.js";
import { depthParam, stopParam } from "../../params.js";
import { usePassageLifecycle } from "../../passage-lifecycle.js";
import { useRenderCount } from "../../perf.js";
import { quoteStroke } from "../../QuotesPanel.js";
import { scrollToBlock } from "../../scroll.js";
import { type Found, resolveTrajectoryStop } from "../../search-hits.js";
import {
  countAt,
  currentStop,
  DEPTH_LABEL,
  doorAfter,
  effectiveDepth,
  offeredDepths,
  stepStop,
  stopAfterDepthChange,
  visibleRoute,
} from "../../trajectory-route.js";
import type { QuotesRead } from "../../useQuotes.js";
import { useTrajectory } from "../../useTrajectory.js";
import { TrajectoryPanel, type TrajectoryRow } from "../../TrajectoryPanel.js";

/**
 * **What `Reader` holds of the band**: where the current stop is, what the door
 * after it says, and the two verbs. Published in a layout effect and cleared in
 * a layout cleanup — `usePassageLifecycle`'s rules 1 and 3, for its reasons —
 * so leaving the mode takes the door and the keys with it.
 *
 * The verbs are **stable for the life of the band** and read the latest route
 * through a ref, so the object changes only when the stop or the door's words
 * do. A fresh closure per render would republish every render, and `Reader`
 * re-rendering the band that republished is a loop.
 */
export interface TrajectoryControl {
  /** The current stop's block — where the door hangs. `null` if its quote has gone. */
  blockId: BlockId | null;
  /** The door's words, or `null` at the end of the deepest pass. */
  door: string | null;
  /** ← / →. `false` at either end of the pass, which does not wrap. */
  step(dir: -1 | 1): boolean;
  /** The door: the next stop, or round again one depth deeper. */
  advance(): void;
}

/** A module constant, for `NO_FOUND`'s reason (reader/passages.ts). */
const NO_STOPS: TrajectoryStop[] = [];
const NO_QUOTES: Quote[] = [];
const NONE_FOUND: Found[] = [];

export function TrajectoryBand({
  slug,
  blocks,
  tree,
  quotes,
  quoteMarks,
  covers,
  onAway,
  onJump,
  onFound,
  openKey,
  onOpenKey,
  onControl,
}: {
  slug: string;
  blocks: Block[];
  tree: Tree;
  /** The Quotes read `OwnedReader` holds — the stops' words and blocks. */
  quotes: QuotesRead;
  /** The quotes already marked in the prose — `useQuoteMarks`' `found`. */
  quoteMarks: readonly Found[];
  /** The band is lying over the prose (a narrow window) — `fit.modeW === 0`. */
  covers: boolean;
  /** Get out of the way of the prose. Only meaningful while `covers`. */
  onAway(): void;
  onJump(id: BlockId): void;
  onFound(found: Found[]): void;
  openKey: string | null;
  onOpenKey(key: string | null): void;
  onControl(control: TrajectoryControl | null): void;
}) {
  useRenderCount("TrajectoryBand");
  const owner = useTrajectory(slug, quotes);
  const view = useTrajectoryMode({
    stops: owner.trajectory?.stops ?? NO_STOPS,
    quotes: quotes.quotes?.quotes ?? NO_QUOTES,
    blocks,
    tree,
    quoteMarks,
    covers,
    onAway,
    onJump,
    onFound,
    openKey,
    onOpenKey,
    onControl,
  });
  return <TrajectoryPanel owner={owner} view={view} quoteCount={quotes.quotes?.quotes.length ?? 0} />;
}

/** What the panel draws — see `TrajectoryPanel`. */
export interface TrajectoryView {
  /** The depth drawn, or `null` for a route with no stops. */
  depth: TrajectoryDepth | null;
  /** Each offered depth, its label and how many stops it shows. */
  depths: { depth: TrajectoryDepth; label: string; count: number }[];
  rows: TrajectoryRow[];
  /** 1-based position of the current stop on this pass, or 0 for none. */
  position: number;
  onDepth(depth: TrajectoryDepth): void;
  onRow(quoteId: string): void;
  onStep(dir: -1 | 1): void;
}

function useTrajectoryMode({
  stops,
  quotes,
  blocks,
  tree,
  quoteMarks,
  covers,
  onAway,
  onJump,
  onFound,
  openKey,
  onOpenKey,
  onControl,
}: {
  stops: TrajectoryStop[];
  quotes: Quote[];
  blocks: Block[];
  tree: Tree;
  quoteMarks: readonly Found[];
  covers: boolean;
  onAway(): void;
  onJump(id: BlockId): void;
  onFound(found: Found[]): void;
  openKey: string | null;
  onOpenKey(key: string | null): void;
  onControl(control: TrajectoryControl | null): void;
}): TrajectoryView {
  /* **One `useQueryStates`, so a depth change and the stop it lands on are one
     URL update** — the plan's § URL, F9. The per-call history option decides:
     a depth change pushes, a step replaces. */
  const [asked, setRoute] = useQueryStates({
    depth: depthParam,
    stop: stopParam,
  });

  const depth = effectiveDepth(stops, asked.depth);
  const route = useMemo(() => (depth === null ? NO_STOPS : visibleRoute(stops, depth)), [stops, depth]);
  const current = currentStop(route, asked.stop);

  const byId = useMemo(() => new Map(quotes.map((q) => [q.id, q])), [quotes]);
  const index = useMemo(() => blockIndex(blocks), [blocks]);
  const quote = current ? (byId.get(current.quoteId) ?? null) : null;

  /* **The stop's passage — one `Found`, the quote's own.** `resolveTrajectoryStop`
     hands back the object `useQuoteMarks` already built when there is one, which
     is what lets `proseFound` draw it once (reader/passages.ts). */
  const found = useMemo(() => {
    if (!quote) return NONE_FOUND;
    const one = resolveTrajectoryStop(blocks, quoteMarks, { ...quote, stroke: quoteStroke(quote) });
    return one ? [one] : NONE_FOUND;
  }, [quote, blocks, quoteMarks]);

  /* The three passage rules — publish before paint, drop a key that names
     nothing, clear on the way out. src/web/passage-lifecycle.ts. */
  usePassageLifecycle({ kind: "keyed", found, openKey, onFound, onOpenKey });

  /* **The stop is always rung.** There is exactly one passage and it is the
     one the reader is standing on, so a ring on nothing would only mean the
     key had not caught up. Timeline's "standing on the first passage", for
     a list of one. */
  const want = found[0]?.key ?? null;
  useEffect(() => {
    if (want !== null && openKey !== want) onOpenKey(want);
  }, [want, openKey, onOpenKey]);

  const blockOf = useCallback((quoteId: string) => byId.get(quoteId)?.blockId ?? null, [byId]);

  /** A step along the route: replaces, and always scrolls the stop near the top. */
  const goStep = useCallback(
    (quoteId: string) => {
      void setRoute({ stop: quoteId }, { history: "replace" });
      /* `scrollToBlock`, not `jumpTo`: traversal writes no history entry of its
         own, and `useReadingPosition` replaces `?at=` when the scroll settles —
         comment-jump.ts § stepToComment, which is the same argument. It puts
         the block's top just under the bars, which is "near the top". */
      const block = blockOf(quoteId);
      if (block) scrollToBlock(block);
    },
    [setRoute, blockOf],
  );

  const changeDepth = useCallback(
    (to: TrajectoryDepth) => {
      if (depth === null) return;
      const next = stopAfterDepthChange(stops, depth, to, current?.quoteId ?? null);
      /* **One update, pushed** — depth and stop together. */
      void setRoute({ depth: to, stop: next }, { history: "push" });
      /* Scroll only when the change moved the reader. Staying put is the
         point of "changing depth keeps your place". */
      if (next !== null && next !== current?.quoteId) {
        const block = blockOf(next);
        if (block) scrollToBlock(block);
      }
    },
    [depth, stops, current, setRoute, blockOf],
  );

  const step = useCallback(
    (dir: -1 | 1): boolean => {
      const next = stepStop(route, current?.quoteId ?? null, dir);
      if (next === null) return false;
      goStep(next);
      return true;
    },
    [route, current, goStep],
  );

  const door = depth === null ? null : doorAfter(stops, depth, current?.quoteId ?? null);
  const advance = useCallback(() => {
    if (door === null) return;
    if (door.kind === "next") goStep(door.quoteId);
    else if (door.kind === "again") changeDepth(door.depth);
  }, [door, goStep, changeDepth]);
  const doorWords =
    door === null || door.kind === "end"
      ? null
      : door.kind === "next"
        ? "Next stop ›"
        : `Go round again — ${DEPTH_LABEL[door.depth]} ›`;

  /* ------------------------------------------------ published upward --
     The verbs through a ref, so the published object is stable and changes
     only with the stop's block and the door's words. See `TrajectoryControl`. */
  const latest = useRef({ step, advance });
  latest.current = { step, advance };
  const stableStep = useCallback((dir: -1 | 1) => latest.current.step(dir), []);
  const stableAdvance = useCallback(() => latest.current.advance(), []);
  const stopBlock = quote?.blockId ?? null;
  const control = useMemo<TrajectoryControl | null>(
    () =>
      current === null
        ? null
        : { blockId: stopBlock, door: doorWords, step: stableStep, advance: stableAdvance },
    [current, stopBlock, doorWords, stableStep, stableAdvance],
  );
  useLayoutEffect(() => {
    onControl(control);
  }, [control, onControl]);
  /* Its own effect, depending on the setter alone, so it runs on unmount and
     only then — passage-lifecycle.ts § Rule 3, and why it is a layout cleanup. */
  useLayoutEffect(() => () => onControl(null), [onControl]);

  /* ------------------------------------------------ the panel's view -- */
  const depths = useMemo(
    () =>
      offeredDepths(stops).map((d) => ({ depth: d, label: DEPTH_LABEL[d], count: countAt(stops, d) })),
    [stops],
  );
  const rows = useMemo<TrajectoryRow[]>(
    () =>
      route.map((stop, i) => {
        const q = byId.get(stop.quoteId);
        const path = q ? sectionPathOf(q.blockId, index, tree) : [];
        return {
          quoteId: stop.quoteId,
          n: i + 1,
          place: path.length > 0 ? path.join(" › ") : null,
          role: stop.role,
          /* A shallower pass's stop, already seen on the way round. */
          seen: depth !== null && stop.depth < depth,
          current: stop.quoteId === current?.quoteId,
          /* A stop whose quote is no longer in the Quotes: a row with nowhere
             to go. The stale banner says why. */
          missing: q === undefined,
        };
      }),
    [route, byId, index, tree, depth, current],
  );

  /** Choosing a stop in the band: a jump, and on a narrow window the band steps aside. */
  const onRow = useCallback(
    (quoteId: string) => {
      /* **A row press is a jump, not a step**, as a comment chosen from the
         drawer is (comment-jump.ts): an arbitrary distance, so it pushes one
         entry via `jumpTo`. The stop is queued in the same tick, and nuqs
         upgrades the combined flush to the push, so both land on one entry. */
      void setRoute({ stop: quoteId }, { history: "replace" });
      const block = blockOf(quoteId);
      if (block) onJump(block);
      if (covers) onAway();
    },
    [setRoute, blockOf, onJump, covers, onAway],
  );
  const onStep = useCallback(
    (dir: -1 | 1) => {
      if (step(dir) && covers) onAway();
    },
    [step, covers, onAway],
  );

  return {
    depth,
    depths,
    rows,
    position: current ? route.indexOf(current) + 1 : 0,
    onDepth: changeDepth,
    onRow,
    onStep,
  };
}
