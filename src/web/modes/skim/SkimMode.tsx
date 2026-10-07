/**
 * **Skim mode's controller.** The owner's band, and the hook underneath
 * it: `?depth=`, `?stop=`, the stop's passage pushed up to the prose, and the
 * handle `Reader` uses for ← / → and for the door after the stop's block.
 *
 * The shape of `modes/<feature>/` (TimelineMode.tsx is the nearest sibling:
 * a passage producer with a selection in the URL), with one thing none of them
 * has — a **controller published upward**, because two things outside the band
 * step the route: the keys, which `useArrowNav` owns, and the door, which lives
 * in the prose `TableView` draws. Both ask this hook, so all three ways of
 * stepping are one rule (src/web/skim-route.ts).
 *
 * **And a visitor twin since 2026-09-29**, `VisitorSkimBand`: the stored
 * route off the public payload, through the same `useSkimMode`, with no
 * `useSkim` under it — so it can neither read the owner's route nor plan
 * one. It was `owners-only` until a signed-out reader of a public article with
 * a built route was told the route would cost a model call
 * (SPIDERYARN-READING2-56,
 * docs/plans/260929c-a-visitor-sees-every-stored-mode-on-a-public-article.md).
 *
 * docs/plans/260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md
 * § The mode (client), docs/project/skim.md.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useQueryStates } from "nuqs";
import type { Block, BlockId, Quote, Tree, SkimDepth, SkimStop } from "../../../types.js";
import type {
  PublicGlossary,
  PublicIdeas,
  PublicTimeline,
  PublicSkim,
} from "../../../public-types.js";
import { blockIndex, sectionNodesOf } from "../../../section-path.js";
import { titleVoice } from "../../tree.js";
import { depthParam, stopParam } from "../../params.js";
import { usePassageLifecycle } from "../../passage-lifecycle.js";
import { useRenderCount } from "../../perf.js";
import { quoteStroke } from "../../QuotesPanel.js";
import { dropPendingFlash, flashBlock } from "../../flash.js";
import { scrollToBlock } from "../../scroll.js";
import { type Found, quoteMarkKey, resolveSkimStop } from "../../search-hits.js";
import {
  DEPTH_LABEL,
  doorAfter,
  firstStopOf,
  locate,
  offeredDepths,
  passCount,
  positionsOf,
  stepStop,
  walkedIn,
} from "../../skim-route.js";
import type { QuotesRead } from "../../useQuotes.js";
import { type WhereRow, whereForBlock } from "../../where.js";
import { useSkim } from "../../useSkim.js";
import { SkimPanel, type SkimPass, type SkimRow } from "../../SkimPanel.js";
import { type CardSources, type CardTarget, gatherStopCard, type StopCard } from "../../stop-card.js";
import type { TermActions } from "../../ProseHoverCard.js";
import type { GlossaryRead } from "../../useGlossary.js";
import { useIdeasRead } from "../../useIdeas.js";
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
export interface SkimControl {
  /** The current stop's block — where the door hangs. `null` if its quote has gone. */
  blockId: BlockId | null;
  /** What the door after it offers — `DoorView`. */
  door: DoorView | null;
  /**
   * ← / →. `false` at the end of the pass, which does not wrap. ← on the first
   * stop goes to the first stop's block again (Greg, SPIDERYARN-READING2-4K).
   */
  step(dir: -1 | 1): boolean;
  /** *Next stop ›*. */
  advance(): void;
  /** *More detail ›* — stop 1 of the next deeper pass. */
  deeper(): void;
}

/**
 * **The door, as the prose draws it** (SkimPanel.tsx § SkimDoor).
 * Mid-pass, *Next stop ›* with the cue of the stop it leads to. At the end of a
 * pass, *More detail ›* when there is a deeper pass, and a line saying which
 * pass just ended — at the deepest, the line alone. *Go round again* went in
 * plan 260929b (SPIDERYARN-READING2-51): ← walks back, to stop 1 and its
 * passage.
 */
export type DoorView =
  | { kind: "next"; cue: string | null }
  | { kind: "end"; pass: string; count: number; deeper: string | null };

/**
 * The one deep-link arrival owned by the reading view, not by this band's
 * mount. Mode switches remount bands while leaving `?stop=` in the address, so
 * the mutable token has to live above that boundary.
 */
export interface SkimArrival {
  stop: string | null;
  /**
   * **Jump to the current stop when the band first has one** — armed by
   * `Reader` when the reader switches into Skim by pressing something, or
   * lands on a Skim address naming no `?stop=` and no `?at=`; never by
   * Back or Forward, which restore an entry rather than make one (plan 260929a
   * § 1, GPT Sol F4). Greg, SPIDERYARN-READING2-4K: *"activating Trajectory
   * mode should automatically jump to the first step … then show one of the
   * little "Back to ..." buttons in case that wasn't what the user wanted."*
   */
  open: boolean;
}

/* A mode-only pop keeps `Reader` mounted, but Back from another page can mount
   it afresh. Remember that navigation above the component boundary too, or a
   fresh `firstSkimArrival` would mistake traversal for an opening and
   push over Forward. The navigation-entry check covers a document restored by
   browser history before this module's listener existed. */
let poppedSkimAddress: string | null = null;
let documentTraversalAddress: string | null =
  typeof window !== "undefined" &&
  (performance.getEntriesByType?.("navigation")[0] as PerformanceNavigationTiming | undefined)?.type ===
    "back_forward"
    ? location.href
    : null;
if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    poppedSkimAddress = location.href;
  });
}

function takeSkimTraversal(): boolean {
  const traversed = poppedSkimAddress === location.href || documentTraversalAddress === location.href;
  poppedSkimAddress = null;
  documentTraversalAddress = null;
  return traversed;
}

/**
 * **The token for the page's first load.** A `?stop=` is a deep link. With no
 * `?stop=` and no `?at=`, a Skim address is an opening — a link to the
 * mode, say — and jumps to stop 1. With `?at=` and no stop it is a reading
 * position (a reload before the first step), which is restored, not overruled.
 */
export function firstSkimArrival(mode: string | null, search: string = location.search): SkimArrival {
  const traversed = takeSkimTraversal();
  if (mode !== "skim") return { stop: null, open: false };
  const q = new URLSearchParams(search);
  /* Back and Forward restore the entry through `?at=` and the browser history;
     neither a surviving `?stop=` nor an otherwise bare address is a new
     arrival. This also covers a traversal that remounted the whole Reader. */
  if (traversed) return { stop: null, open: false };
  const stop = q.get("stop");
  return { stop, open: stop === null && !q.has("at") };
}

/** Arm the opening jump at the press, before nuqs writes the new address. */
export function armSkimOpening(
  arrival: SkimArrival,
  from: string | null,
  to: string | null,
): void {
  /* A direct press is stronger evidence than a remembered traversal to the
     same href, and it owns its own opening token below. */
  poppedSkimAddress = null;
  documentTraversalAddress = null;
  if (from !== "skim" && to === "skim") arrival.open = true;
}

/** A module constant, for `NO_FOUND`'s reason (reader/passages.ts). */
const NO_STOPS: SkimStop[] = [];
const NO_WHERE: WhereRow[] = [];
const NO_QUOTES: Quote[] = [];
const NONE_FOUND: Found[] = [];

export function SkimBand({
  slug,
  blocks,
  tree,
  quotes,
  quoteMarks,
  covers,
  away,
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
  arrival: SkimArrival;
  /** The quotes already marked in the prose — `useQuoteMarks`' `found`. */
  quoteMarks: readonly Found[];
  /** The band is lying over the prose (a narrow window) — `fit.modeW === 0`. */
  covers: boolean;
  /**
   * The band has stepped aside (`onAway`) and is not drawn, so its list has no
   * geometry to measure. When it comes back the list is measured again, to
   * show the stop the reader moved to meanwhile (SPIDERYARN-READING2-54).
   */
  away: boolean;
  /** Get out of the way of the prose. Only meaningful while `covers`. */
  onAway(): void;
  /** A row press is a block jump narrowed to that stop's quote. */
  onJump(id: BlockId, passage?: string): void;
  onFound(found: Found[]): void;
  openKey: string | null;
  onOpenKey(key: string | null): void;
  onControl(control: SkimControl | null): void;
}) {
  useRenderCount("SkimBand");
  /* **The Ideas read comes first, and the route's hook is handed it** (Sol
     F61): since stage 6 the route's own job finds the Ideas when there are
     none, so its completion has to refresh this read — the one the stop card
     draws from — or a fresh article's card shows no Ideas until a reload. */
  const ideas = useIdeasRead(slug);
  const owner = useSkim(slug, quotes, ideas);
  /* **The scrapbook's other sources, read and never written.** The read-only
     hooks carry no job machinery at all, so the card cannot be the reason any
     of these is generated (Sol F22). The glossary is `Reader`'s own read. The
     Ideas are the exception above: made by the route's job, never by the card. */
  const timeline = useTimelineRead(slug);
  const sources = useMemo<CardSources>(
    () => ({
      glossary: { value: glossary.status === "ready" ? glossary.glossary : null, stale: glossary.stale },
      ideas: { value: ideas.status === "ready" ? ideas.ideas : null, stale: ideas.stale },
      timeline: { value: timeline.status === "ready" ? timeline.timeline : null, stale: timeline.stale },
    }),
    [
      glossary.status,
      glossary.glossary,
      glossary.stale,
      ideas.status,
      ideas.ideas,
      ideas.stale,
      timeline.status,
      timeline.timeline,
      timeline.stale,
    ],
  );
  const view = useSkimMode({
    sources,
    /* The read is the owner's two verbs on a term, as it is for the prose card. */
    termActions: glossary,
    onOpen,
    canOpen,
    stops: owner.skim?.stops ?? NO_STOPS,
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
  return <SkimPanel access={{ kind: "owner", owner }} view={view} away={away} />;
}

/** The props both bands take from `Reader` for the walk itself. */
type WalkProps = Pick<
  Parameters<typeof SkimBand>[0],
  | "blocks"
  | "tree"
  | "quoteMarks"
  | "covers"
  | "away"
  | "onAway"
  | "onJump"
  | "onFound"
  | "openKey"
  | "onOpenKey"
  | "onControl"
  | "onOpen"
  | "canOpen"
  | "arrival"
>;

/**
 * **The same walk, for somebody who does not own the article.**
 *
 * Everything came in the page's own payload: the route, the quotes it stops
 * at, and the stop card's sources. No `useSkim`, so no read of
 * `/api/skim/:slug` and no `useAutoRun` — nothing here can plan a route,
 * which is the whole of why this is a second band rather than a flag on the
 * first (src/web/reader-capability.ts; `VisitorTimelineBand` is the sibling).
 * The card's sources are the payload's copies, never `useIdeasRead` or
 * `useTimelineRead`: those are owner reads. A stored artefact on a shared link
 * carries no freshness (src/public-types.ts § `PublicArtefactSet`), so each is
 * handed over as not stale.
 */
export function VisitorSkimBand({
  route,
  quotes,
  glossary,
  ideas,
  timeline,
  ...walk
}: WalkProps & {
  route: PublicSkim;
  quotes: Quote[];
  glossary: PublicGlossary | undefined;
  ideas: PublicIdeas | undefined;
  timeline: PublicTimeline | undefined;
}) {
  useRenderCount("VisitorSkimBand");
  const sources = useMemo<CardSources>(
    () => ({
      glossary: { value: glossary ?? null, stale: false },
      ideas: { value: ideas ?? null, stale: false },
      timeline: { value: timeline ?? null, stale: false },
    }),
    [glossary, ideas, timeline],
  );
  const { away, ...rest } = walk;
  /* `termActions: null`: a visitor may read a term's card and change nothing. */
  const view = useSkimMode({ ...rest, sources, termActions: null, stops: route.stops, quotes });
  return <SkimPanel access={{ kind: "visitor", route }} view={view} away={away} />;
}

/** What the panel draws — see `SkimPanel`. */
export interface SkimView {
  /** The depth drawn, or `null` for a route with no stops. */
  depth: SkimDepth | null;
  /** Each offered depth, its label and how many stops it walks — carried ones included. */
  depths: { depth: SkimDepth; label: string; count: number }[];
  rows: SkimRow[];
  /** 1-based position of the current stop on this pass, or 0 for none. */
  position: number;
  /** What sits under the current stop — src/web/stop-card.ts. `null` without a current stop. */
  card: StopCard | null;
  /**
   * *Dig deeper* and *Hide* on a term chip's card, or `null` for a visitor
   * (SkimPanel.tsx § `TermChip`, plan 261006e).
   */
  termActions: TermActions | null;
  onDepth(depth: SkimDepth): void;
  onRow(quoteId: string): void;
  onStep(dir: -1 | 1): void;
  /** A card link into another mode. */
  onOpen(target: CardTarget): void;
  /** The shared experimental-control rule for the target mode. */
  canOpen(target: CardTarget): boolean;
}

function useSkimMode({
  sources,
  termActions,
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
  termActions: TermActions | null;
  onOpen(target: CardTarget): void;
  canOpen(target: CardTarget): boolean;
  stops: SkimStop[];
  quotes: Quote[];
  blocks: Block[];
  tree: Tree;
  quoteMarks: readonly Found[];
  covers: boolean;
  onAway(): void;
  onJump(id: BlockId, passage?: string): void;
  onFound(found: Found[]): void;
  openKey: string | null;
  onOpenKey(key: string | null): void;
  onControl(control: SkimControl | null): void;
  arrival: SkimArrival;
}): SkimView {
  /* **One `useQueryStates`, so a depth change and the stop it lands on are one
     URL update** — the plan's § URL, F9. The per-call history option decides:
     a depth change pushes, a step replaces. */
  const [asked, setRoute] = useQueryStates({
    depth: depthParam,
    stop: stopParam,
  });

  /* **The stop wins over the depth** (Sol, plan 260929e review F4): a
     `?stop=` is stood on, in the asked pass when the stop is walked there and
     otherwise in its own — a stop can be in more than one since plan 261003l. */
  const { depth, route, current } = useMemo(
    () => locate(stops, asked.depth, asked.stop),
    [stops, asked.depth, asked.stop],
  );

  const byId = useMemo(() => new Map(quotes.map((q) => [q.id, q])), [quotes]);
  const index = useMemo(() => blockIndex(blocks), [blocks]);
  const quote = current ? (byId.get(current.quoteId) ?? null) : null;

  /* **The stop's passage — one `Found`, the quote's own.** `resolveSkimStop`
     hands back the object `useQuoteMarks` already built when there is one, which
     is what lets `proseFound` draw it once (reader/passages.ts). */
  const found = useMemo(() => {
    if (!quote) return NONE_FOUND;
    const one = resolveSkimStop(blocks, quoteMarks, { ...quote, stroke: quoteStroke(quote) });
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
   * the door, a depth change that moves you (Sol F29): the
   * stop's block scrolled near the top and flashed when the glide settles
   * (`arrive`). One helper, so the keys cannot do less than the buttons. A row
   * press is not here: it is a jump, through `onJump`.
   *
   * **It does not step the band aside.** Until 2026-10-03 it did, on a window
   * where the band lies over the prose (`covers`), so on a phone ‹ › showed one
   * stop and then closed the band on the reader:
   *
   * > in this special case, the left and right buttons of skim mode should stay
   * > in skim mode ... if it's showing me a quote and I click on the quote, I
   * > think I do want to be taken to the article.
   * >
   * > — Greg, 2026-10-03 (spya-kudr63)
   *
   * So the rule is one a reader can learn: **a control in the head stays in
   * Skim; a row goes to the article** (`onRow`, below, the only caller of
   * `onAway`). The depth buttons are in the head, so they stay too. The prose
   * still scrolls to the stop underneath, so it is already there when the row
   * is pressed or the band closed, and the flash waits behind the band until
   * then (flash.ts § a flash nobody can see is held). It keys on nothing: with
   * the band beside the prose, or already aside (the door), there was never
   * anything to step. docs/plans/261003l-skim-arrows-stay-in-the-band-and-stops-shared-across-depths.md § Stage 1.
   */
  const moveTo = useCallback((block: BlockId, quoteId: string) => {
    arrive(block, quoteId);
  }, []);

  /**
   * Keep the URL's two coordinates in step when traversal replaces the current
   * entry: the stop, and **the pass being drawn** — not the stop's own, since a
   * carried stop is in more than one (plan 261003l) and a step must not throw
   * the reader out of the pass they are walking. This matters for an old link
   * whose valid `?stop=` disagrees with `?depth=`: `locate` draws a pass the
   * stop is walked in, and the first interaction canonicalises the address to
   * it. Gist keeps the documented absent-depth default.
   */
  const replaceStop = useCallback(
    (quoteId: string) => {
      if (depth === null) return false;
      void setRoute({ depth: depth === 1 ? null : depth, stop: quoteId }, { history: "replace" });
      return true;
    },
    [depth, setRoute],
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
      if (!replaceStop(quoteId)) return false;
      moveTo(block, quoteId);
      return true;
    },
    [blockOf, replaceStop, moveTo],
  );

  const changeDepth = useCallback(
    /** @param land where to stand instead of where a depth change keeps you — *More detail ›*. */
    (to: SkimDepth, land?: string) => {
      if (depth === null) return;
      /* Stop 1 of the new pass (260929e). Since plan 261003l that can be the
         stop the reader is on — a carried stop that comes first in the new
         pass — and then the pass changes and the reader does not move. */
      const next = land ?? firstStopOf(stops, to);
      const moved = next !== null && next !== current?.quoteId;
      const block = moved ? blockOf(next) : null;
      if (moved && block === null) return;
      /* **One update, pushed** — depth and stop together. */
      void setRoute({ depth: to, stop: next }, { history: "push" });
      /* Scroll — and flash — only when the change moved the reader. Landing on
         the stop already stood at is one pushed entry and nothing else. */
      if (block !== null && next !== null) moveTo(block, next);
    },
    [depth, stops, current, setRoute, blockOf, moveTo],
  );

  const step = useCallback(
    (dir: -1 | 1): boolean => {
      /* ← on the first stop goes to it again: the reader asked to be taken to
         the start, and "you are already there" is no answer when the page is
         somewhere else (SPIDERYARN-READING2-4K). → at the end stays a no-op —
         the door is the way on. */
      const next =
        stepStop(route, current?.quoteId ?? null, dir) ?? (dir === -1 ? (route[0]?.quoteId ?? null) : null);
      if (next === null) return false;
      return goStep(next);
    },
    [route, current, goStep],
  );

  const door = depth === null ? null : doorAfter(stops, depth, current?.quoteId ?? null);
  const advance = useCallback(() => {
    if (door?.kind === "next") goStep(door.quoteId);
  }, [door, goStep]);
  const deeper = useCallback(() => {
    if (door?.kind === "end" && door.deeper) changeDepth(door.deeper.depth, door.deeper.first);
  }, [door, changeDepth]);
  /* The door's view as primitives, so the published object below changes only
     when what it draws does. */
  const doorKind = door?.kind ?? null;
  const nextStop = door?.kind === "next" ? stops.find((s) => s.quoteId === door.quoteId) : undefined;
  const doorCue = nextStop ? cueOf(nextStop) : null;
  const passLabel = depth === null ? "" : DEPTH_LABEL[depth];
  const deeperLabel = door?.kind === "end" && door.deeper ? DEPTH_LABEL[door.deeper.depth] : null;
  const passSize = route.length;
  const doorView = useMemo<DoorView | null>(
    () =>
      doorKind === null
        ? null
        : doorKind === "next"
          ? { kind: "next", cue: doorCue }
          : { kind: "end", pass: passLabel, count: passSize, deeper: deeperLabel },
    [doorKind, doorCue, passLabel, passSize, deeperLabel],
  );

  /* ------------------------------------------------ published upward --
     The verbs through a ref, so the published object is stable and changes
     only with the stop's block and the door's words. See `SkimControl`. */
  const latest = useRef({ step, advance, deeper });
  latest.current = { step, advance, deeper };
  const stableStep = useCallback((dir: -1 | 1) => latest.current.step(dir), []);
  const stableAdvance = useCallback(() => latest.current.advance(), []);
  const stableDeeper = useCallback(() => latest.current.deeper(), []);
  const stopBlock = current === null ? null : blockOf(current.quoteId);

  /* **This mount claims the arrival before it waits for data.** The mailbox is
     cleared in a layout effect, while the claimed token stays in this band's
     ref. If the reader leaves before the route or Quotes resolve, the ref goes
     with the band: Back cannot inherit the old press and turn traversal into a
     fresh push. A ref survives StrictMode's synthetic effect replay, so the
     first setup may claim it without the second losing it (code review F2). */
  const claimedArrival = useRef<SkimArrival>({ stop: null, open: false });
  useLayoutEffect(() => {
    /* StrictMode runs this setup twice around a synthetic cleanup. The second
       sees an empty mailbox and must leave the first setup's local claim alone. */
    if (arrival.stop === null && !arrival.open) return;
    claimedArrival.current = { stop: arrival.stop, open: arrival.open };
    arrival.stop = null;
    arrival.open = false;
  }, [arrival]);

  /* **Arriving in the mode: one effect, deep link first** — plan 260929a § 1,
     GPT Sol F4. The mailbox lives on `Reader`'s `arrival`, above the mode
     boundary; this mount has claimed it into `claimedArrival`, so a later mount
     cannot inherit it. The action is consumed the first time a current stop
     resolves to a block (the route and Quotes arrive over the wire), before
     anything is done with it, so a second run — StrictMode, a re-render — finds
     nothing to do. **One-shot, not an effect on `current`**, which would move
     the reader again after every step.

     - **A `?stop=` link** (the plan's stage 5a, Sol F28): brought into view and
       flashed with `arrive` — no push, since `?at=` is the only address the
       reading view restores and the link *is* the entry. A link whose stop
       has gone falls back to the first stop, and is arrived at there, rather
       than leaving the page wherever it opened (Sol F4). The band stays open:
       on a narrow window the flash waits behind it (flash.ts).
     - **Opening the mode**: a jump, through `onJump` → `beginJump` — one
       pushed entry stamped with where the reader was, so the *Back to …* chip
       offers the way home (ReturnChip.tsx), centred, the quote flashed. The
       stop is the band's current one: stop 1 on a fresh opening, or where the
       reader had got to if `?stop=` survived a mode switch. */
  useEffect(() => {
    if (current === null || stopBlock === null) return;
    const claimed = claimedArrival.current;
    if (claimed.stop !== null) {
      claimed.stop = null;
      claimed.open = false;
      arrive(stopBlock, current.quoteId);
      return;
    }
    if (!claimed.open) return;
    claimed.open = false;
    onJump(stopBlock, quoteMarkKey(current.quoteId, stopBlock));
  }, [current, stopBlock, onJump]);

  const control = useMemo<SkimControl | null>(
    () =>
      current === null
        ? null
        : {
            blockId: stopBlock,
            door: doorView,
            step: stableStep,
            advance: stableAdvance,
            deeper: stableDeeper,
          },
    [current, stopBlock, doorView, stableStep, stableAdvance, stableDeeper],
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
      offeredDepths(stops).map((d) => ({ depth: d, label: DEPTH_LABEL[d], count: passCount(stops, d) })),
    [stops],
  );
  const positions = useMemo(() => positionsOf(blocks), [blocks]);
  /* **Which passes each stop is in — the pips** (plan 261003l § The mark), or
     `null` for every row when they are not drawn: on a route offering one
     depth, and on one that carries no stop anywhere, which is every route from
     before `skim/9`. Three pips that never vary would be noise. Asked of
     `walkedIn`, so an `again` naming a depth the route does not offer neither
     fills a pip nor turns the mark on. */
  const passesOf = useMemo<Map<string, SkimPass[]> | null>(() => {
    if (depths.length < 2) return null;
    const all = new Map(
      stops.map((stop) => [
        stop.quoteId,
        depths.map((d) => ({ depth: d.depth, label: d.label, on: walkedIn(stops, stop, d.depth) })),
      ]),
    );
    const carried = [...all.values()].some((passes) => passes.filter((p) => p.on).length > 1);
    return carried ? all : null;
  }, [stops, depths]);
  const rows = useMemo<SkimRow[]>(
    () =>
      route.map((stop, i) => {
        const block = blockOf(stop.quoteId);
        /* The nodes, not `sectionPathOf`'s strings: whose words each title is
           is read off the node, and a string has already forgotten. */
        const path = block ? sectionNodesOf(block, index, tree) : [];
        return {
          quoteId: stop.quoteId,
          n: i + 1,
          place: path.length > 0 ? path.map((node) => ({ title: node.title, voice: titleVoice(node) })) : null,
          cue: cueOf(stop),
          current: stop.quoteId === current?.quoteId,
          /* A stop whose quote is no longer in the Quotes: a row with nowhere
             to go. The stale banner says why. */
          missing: block === null,
          /* How far through the article, in words — the dot on the row (5b). */
          position: block === null ? null : (positions.get(block) ?? null),
          /* The quote's own words, for the row (plan 260928e). */
          words: byId.get(stop.quoteId)?.text ?? null,
          /* Where it sits in the outline, for the position mark's card (260929f § 3). */
          where: block === null ? NO_WHERE : whereForBlock(tree, index, block),
          passes: passesOf?.get(stop.quoteId) ?? null,
        };
      }),
    [route, blockOf, index, tree, current, positions, byId, passesOf],
  );

  /**
   * Choosing a stop in the band: a jump, and on a narrow window the band steps
   * aside. **The only thing in Skim that does** since 2026-10-03 — `moveTo`.
   */
  const onRow = useCallback(
    (quoteId: string) => {
      /* **A row press is a jump, not a step**, as a comment chosen from the
         drawer is (comment-jump.ts): an arbitrary distance, so it pushes one
         entry via `jumpTo`. The stop is queued in the same tick, and nuqs
         upgrades the combined flush to the push, so both land on one entry. */
      const block = blockOf(quoteId);
      if (block === null || !replaceStop(quoteId)) return;
      onJump(block, quoteMarkKey(quoteId, block));
      if (covers) onAway();
    },
    [blockOf, replaceStop, onJump, covers, onAway],
  );
  /* ‹ › — the band's own buttons. The same `step` the keys and the door call,
     and none of them steps a covering band aside (spya-kudr63, `moveTo`). */
  const onStep = useCallback(
    (dir: -1 | 1) => {
      step(dir);
    },
    [step],
  );

  /* **The stop card**, gathered for the current stop only, from what the
     other modes have already written. */
  const card = useMemo(
    () => (stopBlock === null ? null : gatherStopCard({ blockId: stopBlock, blocks, sources })),
    [stopBlock, blocks, sources],
  );

  return {
    depth,
    depths,
    rows,
    position: current ? route.indexOf(current) + 1 : 0,
    card,
    termActions,
    onDepth: changeDepth,
    onRow,
    onStep,
    onOpen,
    canOpen,
  };
}

/**
 * **Arriving at a stop** — by stepping (`moveTo`, above) or by a deep link:
 * the stop's quote centred in view, and flashed once the glide settles, the
 * rule `beginJump` (keynav.ts) follows so a flash never finishes mid-glide.
 * Stepping elsewhere does not flash; a Skim step does, because the route
 * is out of paper order and each step lands anywhere in the article — flash.ts
 * names the exception. The plan's stage 5a.
 *
 * `scrollToBlock`, not `jumpTo`: traversal writes no history entry of its own,
 * and `useReadingPosition` replaces `?at=` when the scroll settles —
 * comment-jump.ts § stepToComment, the same argument. A row press is not here:
 * it is a jump, through `onJump` → `beginJump`, handed the same passage key so
 * its history-pushing arrival flashes the quote too.
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
  /* A landing still held behind a covering band belongs to the step before.
     Since the head's controls stopped stepping the band aside (spya-kudr63)
     this is the ordinary case on a phone, not a rare one: every ‹ › holds its
     flash, and this is what keeps the one that finally plays the last stop's. */
  dropPendingFlash();
  const passage = quoteMarkKey(quoteId, block);
  /* Centred on the quote, as every jump is since plan 260929a § 3 — the
     route lands anywhere in the article, and the reader wants to see what is
     round it (SPIDERYARN-READING2-4M). */
  scrollToBlock(
    block,
    "smooth",
    (outcome) => {
      if (outcome === "settled") flashBlock(block, { passage });
    },
    { align: "centre", passage },
  );
}

/** A stop's cue, or — on a route written before cues — its role. */
function cueOf(stop: SkimStop): string | null {
  return stop.cue ?? stop.role;
}
