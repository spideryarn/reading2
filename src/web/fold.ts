/**
 * **Folding a heading's section away** — which rows a folded heading hides, and
 * the one store that says which headings are folded.
 *
 * Greg, spya-skqwg8, 2026-10-02: *"a little icon that would hide that heading's
 * section"*, and ⌘⌥T / ⌥-click for all of them at once.
 * docs/plans/261002e-collapsible-headings-and-fold-all.md has the reasoning.
 *
 * ## Why the cells are hidden and not the row
 *
 * Nearly everything in the reading view measures rows — the spine's bands, the
 * reading position, the arrow keys, "is it on screen". A `tr` with
 * `display: none` reports a zero rectangle at the top of the viewport, which
 * breaks the "row tops are in order" assumption `activeSectionIndex` and the
 * spine are built on. A `tr` whose *cells* are `display: none` stays in the
 * table at zero height, at the top of the next visible row (measured in
 * Chrome, plan § Is it substantial), so every one of them keeps working and a
 * folded section is simply a section of zero height.
 *
 * ## Why a style element, written synchronously
 *
 * Two reasons, both about not going through React. Folding a section must not
 * re-render the prose table (several hundred memoised rows), so the rule is a
 * stylesheet like `ReadingTimeStyle`'s. And `revealBlock`, which
 * `scrollToBlock` calls before it measures, has to have changed the layout by
 * the time it returns — a reveal that waited for the next React commit would
 * aim the glide's first frame at a zero-height row. React only hears about the
 * change for the chevrons, through `useFold`.
 *
 * ## The masthead's echo: hidden here, and not a fold
 *
 * The leading blocks that only repeat the masthead (masthead-echo.ts; Greg,
 * spya-t6cdve) are hidden by this store too, always, because a zero-height row
 * only keeps working for the consumers that ask the store about it.
 * `isFolded` is true for them; they are never foldable and never revealed.
 * The one way they differ from a fold is `isFoldedAway`, below.
 * docs/plans/261007b-the-title-is-drawn-once-and-the-masthead-loses-its-back-arrow.md
 * § How a row is hidden, and what has to know.
 *
 * ## The front matter: hidden here, shut on arrival, and openable
 *
 * The run of byline blocks under the title (front-matter.ts; Greg,
 * spya-duh4w3: *"default collapse them so that you kind of jump straight into
 * the article itself"*) is the third kind of hiding. It starts shut for every
 * article on every load. Unlike the echo it can be opened, all of it at once:
 * by the masthead's control (`toggleFrontMatter`) and by `revealBlock`, so a
 * jump to one of its blocks shows them. Like the echo, a row in it is not
 * `isFoldedAway`, and a heading in it is never foldable. `visibleFrom` is the
 * question it adds, for the callers that would otherwise jump to one of its
 * rows without meaning to open it.
 * docs/plans/261007d-front-matter-folded-by-default-and-arxiv-html-authors.md
 * § How the rows are hidden.
 *
 * ## What it is not
 *
 * Not persisted and not in the URL: reload opens every real fold and shuts the
 * front matter again. One article at a time, because there is one prose table.
 */
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import type { Block, BlockId } from "../types.js";
import { isModAltChord, isTyping } from "./key-chord.js";
import { SAFE_ID } from "./reading-time.js";

/** The level a heading with no recorded level is folded as: the narrowest. */
const NO_LEVEL = 6;

/** A heading's level for folding, or `null` when the block is not a heading. */
function headingLevel(block: Block): number | null {
  return block.kind === "heading" ? (block.level ?? NO_LEVEL) : null;
}

/**
 * **Where each heading's section ends** — the index one past its last block.
 *
 * A heading at level L owns every following block up to, not including, the
 * next heading whose level is L or coarser. So an H3 under an H2 is part of
 * the H2's section, and folding the H2 hides it along with everything else.
 */
function sectionEnds(blocks: readonly Block[]): Map<BlockId, number> {
  const ends = new Map<BlockId, number>();
  /** Headings whose section is still open, coarsest first. */
  const open: { id: BlockId; level: number }[] = [];
  blocks.forEach((block, i) => {
    const level = headingLevel(block);
    if (level === null) return;
    while (open.length > 0 && open[open.length - 1]!.level >= level) ends.set(open.pop()!.id, i);
    open.push({ id: block.id, level });
  });
  for (const h of open) ends.set(h.id, blocks.length);
  return ends;
}

/**
 * The headings that have something to hide — at least one block before their
 * section ends. A heading straight followed by its sibling gets no button,
 * because a control that does nothing reads as broken.
 */
export function foldableHeadings(blocks: readonly Block[]): Set<BlockId> {
  const index = new Map(blocks.map((b, i) => [b.id, i]));
  const out = new Set<BlockId>();
  for (const [id, end] of sectionEnds(blocks)) if (end > index.get(id)! + 1) out.add(id);
  return out;
}

/**
 * **Every block a set of folded headings hides.** The headings themselves stay
 * visible; a folded heading inside another folded section is hidden like any
 * other block of it. Ids in `folded` that are not headings of this article are
 * ignored.
 */
export function hiddenBlocks(blocks: readonly Block[], folded: ReadonlySet<BlockId>): Set<BlockId> {
  const ends = sectionEnds(blocks);
  const out = new Set<BlockId>();
  let hideUntil = -1;
  blocks.forEach((block, i) => {
    if (i < hideUntil) out.add(block.id);
    if (folded.has(block.id)) hideUntil = Math.max(hideUntil, ends.get(block.id) ?? -1);
  });
  return out;
}

/**
 * The folded headings that hide `id` — the ones `revealBlock` unfolds. Only
 * those: a jump into one subsection leaves its folded siblings folded.
 */
export function foldsHiding(
  blocks: readonly Block[],
  folded: ReadonlySet<BlockId>,
  id: BlockId,
): BlockId[] {
  const at = blocks.findIndex((b) => b.id === id);
  if (at < 0) return [];
  const ends = sectionEnds(blocks);
  const out: BlockId[] = [];
  for (let i = 0; i < at; i++) {
    const h = blocks[i]!.id;
    if (folded.has(h) && (ends.get(h) ?? -1) > at) out.push(h);
  }
  return out;
}

/* ------------------------------------------------------------- the store -- */

/** What `useFold` hands a component. Replaced whole on every change. */
export interface FoldState {
  /** The headings currently folded. */
  folded: ReadonlySet<BlockId>;
  /** The headings that have something to fold — the ones that get a button. */
  foldable: ReadonlySet<BlockId>;
  /** How many blocks the front matter is. Zero when the article has none. */
  front: number;
  /**
   * Whether the front matter is on screen: the reader opened it and no fold
   * covers any of it. What its control draws, so that a press always changes
   * what the reader sees.
   */
  frontOpen: boolean;
}

const EMPTY: FoldState = { folded: new Set(), foldable: new Set(), front: 0, frontOpen: false };
const NO_ECHO: ReadonlySet<BlockId> = new Set();
const NO_FRONT: readonly BlockId[] = [];

let article: {
  key: string;
  blocks: readonly Block[];
  echo: ReadonlySet<BlockId>;
  /** The front matter, in document order, and the same ids as a set. */
  front: readonly BlockId[];
  inFront: ReadonlySet<BlockId>;
  /** The first block after the front matter, or `null` when it ends the article. */
  afterFront: BlockId | null;
} | null = null;
let state: FoldState = EMPTY;
/** Whether the reader has opened the front matter. Shut for every new article and every new run. */
let frontWanted = false;
/** Every row whose cells the stylesheet hides: the echo, the shut front matter, and `foldedAway`. */
let hidden: ReadonlySet<BlockId> = new Set();
/** The rows a folded heading hides, the echo not among them unless a fold covers it too. */
let foldedAway: ReadonlySet<BlockId> = new Set();
const listeners = new Set<() => void>();
/* The mounted TableView that most recently installed this singleton. A route
   change replaces keyed Readers: the new table's layout effect runs before the
   old table's passive cleanup, so an unconditional cleanup would erase the new
   article. The token makes that stale cleanup a no-op. */
let mountedBy: symbol | null = null;

/** The attribute the store's own `<style>` carries, so it can find it again. */
export const FOLD_STYLE_ATTR = "data-fold";

/**
 * The rule that hides a row's cells. Unescaped for the reason `gutterCss`
 * gives (reading-time.ts): a block id is a closed format, and one that fails
 * it is not ours, so it is skipped rather than escaped.
 */
export function foldCss(ids: Iterable<BlockId>): string {
  let css = "";
  for (const id of ids) if (SAFE_ID.test(id)) css += `tr[data-block="${id}"]>td{display:none}\n`;
  return css;
}

function writeStyle(): void {
  if (typeof document === "undefined") return;
  let el = document.head.querySelector<HTMLStyleElement>(`style[${FOLD_STYLE_ATTR}]`);
  if (hidden.size === 0) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement("style");
    el.setAttribute(FOLD_STYLE_ATTR, "");
    document.head.appendChild(el);
  }
  el.textContent = foldCss(hidden);
}

function commit(folded: ReadonlySet<BlockId>): void {
  const blocks = article?.blocks ?? [];
  const foldable = state.foldable;
  foldedAway = hiddenBlocks(blocks, folded);
  const echo = article?.echo ?? NO_ECHO;
  const front = article?.front ?? NO_FRONT;
  const shut = frontWanted ? NO_FRONT : front;
  state = {
    folded,
    foldable,
    front: front.length,
    frontOpen: frontWanted && !front.some((id) => foldedAway.has(id)),
  };
  /* The echo first and the front matter after it: they are the first rows of
     the article in that order, so the rules stay in document order. */
  hidden =
    echo.size === 0 && shut.length === 0 ? foldedAway : new Set([...echo, ...shut, ...foldedAway]);
  writeStyle();
  for (const l of listeners) l();
}

/**
 * **Tell the store which article is on screen.** Called by the reader whenever
 * its blocks change. A different `key` (the slug) starts with nothing folded;
 * the same key with new blocks — a re-extraction — keeps the folds whose
 * headings are still foldable.
 *
 * `echo` is the masthead's echo (masthead-echo.ts): rows hidden for as long as
 * this article is on screen. **It is part of what "the same article" means
 * here**, compared by what is in it: renaming an article changes its echo and
 * leaves the `blocks` array the very same object, and without this the rename
 * would not show until a reload (GPT Sol, plan review of 261007b, F8). An echo
 * heading is not foldable: it has no row to put a chevron on, and Fold all
 * would otherwise shut the whole article behind a control nobody can see.
 *
 * `front` is the front matter (front-matter.ts), in document order. **When it
 * is shut again:** for a different article, and for the same article with a
 * different run (a re-extraction, or `meta` changing what counts as a name).
 * The same run stays as the reader left it whatever else changes, a rename
 * included (GPT Sol, plan review of 261007d, F10). A heading in it is never
 * foldable, open or shut, so no fold can be made inside it and Fold all does
 * not count it (F5).
 */
export function setFoldArticle(
  key: string,
  blocks: readonly Block[],
  echo: ReadonlySet<BlockId> = NO_ECHO,
  front: readonly BlockId[] = NO_FRONT,
): void {
  /* `article !== null` spelled out: `article?.key === key` is true for no
     article and an undefined key, which a test rendering without a slug does. */
  const same = article !== null && article.key === key;
  const sameFront = same && sameRun(article?.front ?? NO_FRONT, front);
  if (sameFront && article?.blocks === blocks && sameIds(article.echo, echo)) return;
  if (!sameFront) frontWanted = false;
  const last = front[front.length - 1];
  const afterFront =
    last === undefined ? null : (blocks[blocks.findIndex((b) => b.id === last) + 1]?.id ?? null);
  article = { key, blocks, echo, front, inFront: new Set(front), afterFront };
  const foldable = foldableHeadings(blocks);
  for (const id of echo) foldable.delete(id);
  for (const id of front) foldable.delete(id);
  state = { ...state, foldable };
  commit(same ? new Set([...state.folded].filter((id) => foldable.has(id))) : new Set());
}

/** The same blocks in the same order: what "the same run" means. */
function sameRun(a: readonly BlockId[], b: readonly BlockId[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

function sameIds(a: ReadonlySet<BlockId>, b: ReadonlySet<BlockId>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

/** The reader is gone: nothing folded, and the style element removed. */
export function clearFoldArticle(): void {
  mountedBy = null;
  article = null;
  frontWanted = false;
  state = EMPTY;
  commit(new Set());
}

/** Fold or unfold one heading. A heading with nothing to fold is ignored. */
export function toggleFold(id: BlockId): void {
  if (!state.foldable.has(id)) return;
  const next = new Set(state.folded);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  commit(next);
}

/**
 * **Fold everything, or open everything** — open if anything is folded, and
 * fold every foldable heading otherwise. One press, so it can be undone by the
 * same press.
 */
export function toggleFoldAll(): void {
  commit(state.folded.size > 0 ? new Set() : new Set(state.foldable));
}

/**
 * **Unfold whatever hides `id`**, synchronously, so the caller can measure its
 * row on the next line. `scrollToBlock` calls this before every jump: a jump
 * to a block is a request to see it.
 *
 * **An echo row is not revealed, and asking opens nothing.** It stays hidden,
 * and `scrollToBlock` sends a jump to it to the top of the page, where the
 * masthead is the visible copy of its words.
 */
export function revealBlock(id: string): void {
  if (!article || article.echo.has(id as BlockId)) return;
  /* A block of the front matter: show all of it, as its control does. */
  if (article.inFront.has(id as BlockId)) {
    if (!state.frontOpen) openFrontMatter();
    return;
  }
  if (!foldedAway.has(id as BlockId)) return;
  const opening = new Set(foldsHiding(article.blocks, state.folded, id as BlockId));
  commit(new Set([...state.folded].filter((h) => !opening.has(h))));
}

/**
 * Show the front matter: mark it wanted, and unfold every real fold that
 * covers any of it. After a rename block 0's heading is an ordinary foldable
 * heading and can be folded over the whole article; a control that then did
 * nothing would read as broken (GPT Sol, plan review of 261007d, F5).
 */
function openFrontMatter(): void {
  if (!article) return;
  frontWanted = true;
  const opening = new Set<BlockId>();
  for (const id of article.front) {
    for (const h of foldsHiding(article.blocks, state.folded, id)) opening.add(h);
  }
  commit(new Set([...state.folded].filter((h) => !opening.has(h))));
}

/**
 * **Show the front matter, or put it away again**: the masthead's control
 * (FoldToggle.tsx § `FrontMatterButton`). Does nothing on an article with none.
 *
 * It goes by what is on screen (`FoldState.frontOpen`), not by what was last
 * asked for: front matter the reader opened and then folded a section over is
 * shown by the next press, not shut where nobody can see it.
 */
export function toggleFrontMatter(): void {
  if (!article || article.front.length === 0) return;
  if (!state.frontOpen) {
    openFrontMatter();
    return;
  }
  frontWanted = false;
  commit(state.folded);
}

/**
 * **Where a jump to `id` should go if it is not meant to open the front
 * matter**: the first block after the run while `id` is in the shut run, and
 * `id` itself otherwise.
 *
 * A section can start inside the run and carry on past it: the Structure
 * prompt invites one node for the byline and the abstract together
 * (src/paperwork.ts). Its first block is a hidden row and the rest of it is on
 * screen. `scrollToBlock` opens the run for whatever it is sent to, so two
 * callers that name a section by its first block ask this first:
 *
 * - `step` in keynav.ts, so ↑ and ↓ land on the section's first visible row
 *   and step over a section that is wholly inside the run;
 * - the reading position (useReadingPosition.ts), so `?at=` names such a
 *   section by its first visible block. Written as the hidden one, a reload or
 *   a turned phone would restore it through `scrollToBlock` and open the front
 *   matter under a reader who was in the abstract.
 *
 * A run that ends the article has nothing visible to land on, and answers
 * `null`: a wholly hidden section is not a navigation stop.
 */
export function visibleFrom(id: string): string | null {
  if (!article || frontWanted || !article.inFront.has(id as BlockId)) return id;
  return article.afterFront;
}

/**
 * **Whether `id`'s row is hidden right now**: inside a folded section, one of
 * the masthead's echo rows, or in the front matter while that is shut. The question for anything that measures a row,
 * draws on it or puts something in its cell.
 */
export function isFolded(id: string): boolean {
  return hidden.has(id as BlockId);
}

/** Whether `id` is one of the leading rows represented by the masthead. */
export function isMastheadEcho(id: string): boolean {
  return article?.echo.has(id as BlockId) ?? false;
}

/**
 * **Whether the section that starts at `id` is folded away**: true only when a
 * fold hides the row. An echo alone is false, and so is a row of the shut
 * front matter; either inside a real fold is true, because navigation must
 * still skip a row the fold covers.
 *
 * Two questions, because the two kinds of hiding differ in what else is gone.
 * A fold hides a whole section, so a section whose start row is folded has
 * nothing on screen and must not be named, focused or stepped to. An echo on
 * its own hides one row whose section is still on screen, and that row is block 0:
 * the start of the first section of every article. Asked `isFolded`, the
 * reading position wrote `?at=` as the second section while the reader was in
 * the first, Structure marked the second as current, and ↑ could not reach the
 * start of the article. So the three callers that ask about a section's start
 * ask this: `useReadingPosition`, `useColumnContext`, and `step` in keynav.ts.
 * An echo row that is hidden only because it is an echo needs no skipping
 * there: it has no height and sits at the top of the first visible row, which
 * is in its own section. A real fold can still cover that row, in which case
 * this function returns true.
 *
 * The shut front matter is the same case further down: a section may start on
 * one of its rows and carry on into the abstract, so its start has no height
 * and sits at the top of that section's first visible row. A section wholly
 * inside the run ties with the next section's start and loses to it, as a
 * folded one does. What the front matter adds is `visibleFrom`, above.
 * docs/plans/261007b-the-title-is-drawn-once-and-the-masthead-loses-its-back-arrow.md
 */
export function isFoldedAway(id: string): boolean {
  return foldedAway.has(id as BlockId);
}

/**
 * Be told whenever a fold changes — for a measurer that has no other way to
 * hear it: folding moves rows without scrolling the page, so a scroll-driven
 * spy would otherwise keep naming a section that has just folded away.
 */
export function subscribeFold(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
const subscribe = subscribeFold;

/** The fold state, for a component that draws a chevron or a fold-all button. */
export function useFold(): FoldState {
  return useSyncExternalStore(subscribe, () => state, () => EMPTY);
}

/**
 * **The prose table's half: which article is on screen, and ⌘⌥T.**
 *
 * A layout effect, so a different article's folds are gone before it paints.
 * Unmounting the table — leaving the article — opens everything and removes
 * the style element, because the store outlives the component.
 *
 * The chord keeps every rule ⌘-K keeps (keyboard.md § The one chord that is
 * not an arrow): not while typing, not over an open dialog, not once a handler
 * nearer the press has claimed it, and `preventDefault()` only when there is
 * something to fold.
 */
export function useFoldArticle(
  key: string,
  blocks: readonly Block[],
  echo: ReadonlySet<BlockId> = NO_ECHO,
  front: readonly BlockId[] = NO_FRONT,
): void {
  const mounted = useRef(Symbol("fold article"));
  useLayoutEffect(() => {
    mountedBy = mounted.current;
    setFoldArticle(key, blocks, echo, front);
  }, [key, blocks, echo, front]);
  useEffect(
    () => () => {
      if (mountedBy === mounted.current) clearFoldArticle();
    },
    [],
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isModAltChord(e, "KeyT") || e.defaultPrevented) return;
      if (isTyping(document.activeElement)) return;
      if (document.querySelector("dialog[open]") !== null) return;
      if (state.foldable.size === 0) return;
      e.preventDefault();
      toggleFoldAll();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
