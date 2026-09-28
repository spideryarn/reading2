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
import { dropPendingFlash, flashBlock } from "../../flash.js";
import { scrollToBlock } from "../../scroll.js";
import { type Found, quoteMarkKey, resolveTrajectoryStop } from "../../search-hits.js";
import {
  countAt,
  currentStop,
  DEPTH_LABEL,
  doorAfter,
  effectiveDepth,
  offeredDepths,
  positionsOf,
  stepStop,
  stopAfterDepthChange,
  visibleRoute,
} from "../../trajectory-route.js";
import type { QuotesRead } from "../../useQuotes.js";
import { useTrajectory } from "../../useTrajectory.js";
import { TrajectoryPanel, type TrajectoryRow } from "../../TrajectoryPanel.js";
import { type CardSources, type CardTarget, gatherStopCard, type StopCard } from "../../stop-card.js";
import type { GlossaryRead } from "../../useGlossary.js";
import { useIdeasRead } from "../../useIdeas.js";
import { useFaqRead } from "../../useFaq.js";
import { useTimelineRead } from "../../useTimeline.js";

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
  /**
   * The cue of the stop the door leads to — the next one, or the first new one
   * when it goes round again — drawn under the door. `null` without one.
   */
  doorCue: string | null;
  /** ← / →. `false` at either end of the pass, which does not wrap. */
  step(dir: -1 | 1): boolean;
  /** The door: the next stop, or round again one depth deeper. */
  advance(): void;
}

/**
 * The one deep-link arrival owned by the reading view, not by this band's
 * mount. Mode switches remount bands while leaving `?stop=` in the address, so
 * the mutable token has to live above that boundary.
 */
export interface TrajectoryArrival {
  stop: string | null;
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
  glossary,
  onOpen,
  canOpen,
  arrival,
}: {
  slug: string;
  blocks: Block[];
  tree: Tree;
  /** The Quotes read `OwnedReader` holds — the stops' words and blocks. */
  quotes: QuotesRead;
  /** The glossary read `Reader` already holds for the underlines — the card's terms. */
  glossary: GlossaryRead;
  /** A card link: open that mode on that selection. */
  onOpen(target: CardTarget): void;
  /** Whether that target mode's control is available to this reader. */
  canOpen(target: CardTarget): boolean;
  /** The reading view's one-shot initial `?stop=` token. */
  arrival: TrajectoryArrival;
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
  /* **The Ideas read comes first, and the route's hook is handed it** (Sol
     F61): since stage 6 the route's own job finds the Ideas when there are
     none, so its completion has to refresh this read — the one the stop card
     draws from — or a fresh article's card shows no Ideas until a reload. */
  const ideas = useIdeasRead(slug);
  const owner = useTrajectory(slug, quotes, ideas);
  /* **The scrapbook's other sources, read and never written.** The read-only
     hooks carry no job machinery at all, so the card cannot be the reason any
     of these is generated (Sol F22). The glossary is `Reader`'s own read. The
     Ideas are the exception above: made by the route's job, never by the card. */
  const faq = useFaqRead(slug);
  const timeline = useTimelineRead(slug);
  const sources = useMemo<CardSources>(
    () => ({
      glossary: { value: glossary.status === "ready" ? glossary.glossary : null, stale: glossary.stale },
      ideas: { value: ideas.status === "ready" ? ideas.ideas : null, stale: ideas.stale },
      faq: { value: faq.status === "ready" ? faq.faq : null, stale: faq.stale },
      timeline: { value: timeline.status === "ready" ? timeline.timeline : null, stale: timeline.stale },
    }),
    [
      glossary.status,
      glossary.glossary,
      glossary.stale,
      ideas.status,
      ideas.ideas,
      ideas.stale,
      faq.status,
      faq.faq,
      faq.stale,
      timeline.status,
      timeline.timeline,
      timeline.stale,
    ],
  );
  const view = useTrajectoryMode({
    sources,
    onOpen,
    canOpen,
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
    arrival,
  });
  return <TrajectoryPanel owner={owner} view={view} />;
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
  /** What sits under the current stop — src/web/stop-card.ts. `null` without a current stop. */
  card: StopCard | null;
  onDepth(depth: TrajectoryDepth): void;
  onRow(quoteId: string): void;
  onStep(dir: -1 | 1): void;
  /** A card link into another mode. */
  onOpen(target: CardTarget): void;
  /** The shared experimental-control rule for the target mode. */
  canOpen(target: CardTarget): boolean;
}

function useTrajectoryMode({
  sources,
  onOpen,
  canOpen,
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
  arrival,
}: {
  sources: CardSources;
  onOpen(target: CardTarget): void;
  canOpen(target: CardTarget): boolean;
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
  arrival: TrajectoryArrival;
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

  const blockOf = useCallback(
    (quoteId: string) => {
      const block = byId.get(quoteId)?.blockId ?? null;
      return block !== null && index.has(block) ? block : null;
    },
    [byId, index],
  );

  /**
   * **Every direct movement along the route goes through here** — ‹ ›, ← →,
   * the door, going round again, a depth change that moves you (Sol F29): the
   * stop's block scrolled near the top and flashed when the glide settles
   * (`arrive`), and on a narrow window the band steps aside so the prose it
   * landed on can be seen. One helper, so the keys cannot do less than the
   * buttons. A row press is not here: it is a jump, through `onJump`.
   */
  const moveTo = useCallback(
    (block: BlockId, quoteId: string) => {
      arrive(block, quoteId);
      if (covers) onAway();
    },
    [covers, onAway],
  );

  /** A step along the route: replaces, and moves the reader to the stop. */
  const goStep = useCallback(
    (quoteId: string): boolean => {
      const block = blockOf(quoteId);
      /* A route can arrive before its Quotes read, and a stale Quote can name a
         block the current article no longer has. Do not commit a movement the
         page cannot perform: there would be no later event to supply its flash,
         and an older held flash could then surface under the wrong stop. */
      if (block === null) return false;
      void setRoute({ stop: quoteId }, { history: "replace" });
      moveTo(block, quoteId);
      return true;
    },
    [setRoute, blockOf, moveTo],
  );

  const changeDepth = useCallback(
    (to: TrajectoryDepth) => {
      if (depth === null) return;
      const next = stopAfterDepthChange(stops, depth, to, current?.quoteId ?? null);
      const moved = next !== null && next !== current?.quoteId;
      const block = moved ? blockOf(next) : null;
      if (moved && block === null) return;
      /* **One update, pushed** — depth and stop together. */
      void setRoute({ depth: to, stop: next }, { history: "push" });
      /* Scroll — and flash — only when the change moved the reader. Staying
         put is the point of "changing depth keeps your place", and nothing
         was jumped to. */
      if (block !== null && next !== null) moveTo(block, next);
    },
    [depth, stops, current, setRoute, blockOf, moveTo],
  );

  const step = useCallback(
    (dir: -1 | 1): boolean => {
      const next = stepStop(route, current?.quoteId ?? null, dir);
      if (next === null) return false;
      return goStep(next);
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
  /* **Where the door leads**, in the words of that stop's cue: the next stop,
     or the one going round again lands on — `stopAfterDepthChange`, the rule
     `advance` itself follows, so the line and the press cannot disagree. */
  const doorTarget =
    door === null || depth === null || door.kind === "end"
      ? null
      : door.kind === "next"
        ? door.quoteId
        : stopAfterDepthChange(stops, depth, door.depth, current?.quoteId ?? null);
  const doorStop = doorTarget === null ? undefined : stops.find((s) => s.quoteId === doorTarget);
  const doorCue = doorStop ? cueOf(doorStop) : null;

  /* ------------------------------------------------ published upward --
     The verbs through a ref, so the published object is stable and changes
     only with the stop's block and the door's words. See `TrajectoryControl`. */
  const latest = useRef({ step, advance });
  latest.current = { step, advance };
  const stableStep = useCallback((dir: -1 | 1) => latest.current.step(dir), []);
  const stableAdvance = useCallback(() => latest.current.advance(), []);
  const stopBlock = quote?.blockId ?? null;

  /* **A deep link's stop is brought into view and flashed, once** — the
     plan's stage 5a and Sol F28. `?at=` is the only address the reading view
     restores (useReadingPosition), so without this a link to a stop opened
     wherever the page happened to be. Reader remembers the initial `?stop=`
     above the mode boundary, and the first time a current stop resolves to a
     block (the route and the Quotes arrive over the wire) it is `arrive`d at if
     it is that stop, and forgotten either way — a link whose stop fell back to
     the first one gets nothing. **One-shot, not an effect on `current`**, which
     would move the reader a second time after every step and row press, or
     re-arm when a mode switch remounts this band.

     `arrive`, not `moveTo`: the band does not step aside. A shared link opens
     the band (Reader.tsx § `bandAway`); on a narrow window the flash is held
     behind it and fires when the band steps aside (flash.ts). */
  useEffect(() => {
    if (arrival.stop === null || current === null || stopBlock === null) return;
    const named = arrival.stop === current.quoteId;
    arrival.stop = null;
    if (named) arrive(stopBlock, current.quoteId);
  }, [arrival, current, stopBlock]);

  const control = useMemo<TrajectoryControl | null>(
    () =>
      current === null
        ? null
        : { blockId: stopBlock, door: doorWords, doorCue, step: stableStep, advance: stableAdvance },
    [current, stopBlock, doorWords, doorCue, stableStep, stableAdvance],
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
  const positions = useMemo(() => positionsOf(blocks), [blocks]);
  const rows = useMemo<TrajectoryRow[]>(
    () =>
      route.map((stop, i) => {
        const block = blockOf(stop.quoteId);
        const path = block ? sectionPathOf(block, index, tree) : [];
        return {
          quoteId: stop.quoteId,
          n: i + 1,
          place: path.length > 0 ? path.join(" › ") : null,
          cue: cueOf(stop),
          /* A shallower pass's stop, already seen on the way round. */
          seen: depth !== null && stop.depth < depth,
          current: stop.quoteId === current?.quoteId,
          /* A stop whose quote is no longer in the Quotes: a row with nowhere
             to go. The stale banner says why. */
          missing: block === null,
          /* How far through the article, in words — the dot on the row (5b). */
          position: block === null ? null : (positions.get(block) ?? null),
        };
      }),
    [route, blockOf, index, tree, depth, current, positions],
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
  /* ‹ › — the band's own buttons. Stepping aside is `moveTo`'s, so the keys get it too. */
  const onStep = useCallback(
    (dir: -1 | 1) => {
      step(dir);
    },
    [step],
  );

  /* **The stop card**, gathered for the current stop only, from what the
     other modes have already written. "Also at stop k" counts along this
     pass, so the route goes in as its stops' blocks. */
  const routeBlocks = useMemo(() => route.map((s) => blockOf(s.quoteId)), [route, blockOf]);
  const card = useMemo(
    () => (stopBlock === null ? null : gatherStopCard({ blockId: stopBlock, blocks, route: routeBlocks, sources })),
    [stopBlock, blocks, routeBlocks, sources],
  );

  return {
    depth,
    depths,
    rows,
    position: current ? route.indexOf(current) + 1 : 0,
    card,
    onDepth: changeDepth,
    onRow,
    onStep,
    onOpen,
    canOpen,
  };
}

/**
 * **Arriving at a stop** — by stepping (`moveTo`, above) or by a deep link:
 * the block scrolled near the top, and flashed once the glide settles, the
 * rule `beginJump` (keynav.ts) follows so a flash never finishes mid-glide.
 * Stepping elsewhere does not flash; a Trajectory step does, because the route
 * is out of paper order and each step lands anywhere in the article — flash.ts
 * names the exception. The plan's stage 5a.
 *
 * `scrollToBlock`, not `jumpTo`: traversal writes no history entry of its own,
 * and `useReadingPosition` replaces `?at=` when the scroll settles —
 * comment-jump.ts § stepToComment, the same argument. A row press is not here:
 * it is a jump, through `onJump` → `beginJump`, which already flashes (the
 * whole block — `beginJump` is shared and takes no passage).
 *
 * **What flashes is the quote's own words** (plan 260928a § 7b): the stop is a
 * quote, so `flashBlock` is handed its mark key — the one annotate.ts writes
 * into each fragment's `data-hit` — and falls back to the block if the quote
 * is not drawn. By the time the scroll settles the new stop's passage has been
 * published (usePassageLifecycle, before paint), so the marks are there.
 *
 * **Where it lands is `scrollToBlock`'s to get right, and it now does**: the
 * door hangs in the *current* stop's row and moves to the new one when this
 * step commits, after the press has asked for the scroll — so the destination
 * is re-measured every frame rather than taken from the click.
 * docs/postmortems/260928c-a-scroll-aimed-at-a-pixel-not-at-the-element.md.
 */
function arrive(block: BlockId, quoteId: string): void {
  /* A landing still held behind a covering band belongs to the step before. */
  dropPendingFlash();
  const passage = quoteMarkKey(quoteId, block);
  scrollToBlock(block, "smooth", (outcome) => {
    if (outcome === "settled") flashBlock(block, { passage });
  });
}

/** A stop's cue, or — on a route written before cues — its role. */
function cueOf(stop: TrajectoryStop): string | null {
  return stop.cue ?? stop.role;
}
