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
 * ## What it is not
 *
 * Not persisted and not in the URL: reload and everything is open again (plan
 * § Deferred). One article at a time, because there is one prose table.
 */
import { useEffect, useLayoutEffect, useSyncExternalStore } from "react";
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
}

const EMPTY: FoldState = { folded: new Set(), foldable: new Set() };

let article: { key: string; blocks: readonly Block[] } | null = null;
let state: FoldState = EMPTY;
let hidden: ReadonlySet<BlockId> = new Set();
const listeners = new Set<() => void>();

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
  state = { folded, foldable };
  hidden = hiddenBlocks(blocks, folded);
  writeStyle();
  for (const l of listeners) l();
}

/**
 * **Tell the store which article is on screen.** Called by the reader whenever
 * its blocks change. A different `key` (the slug) starts with nothing folded;
 * the same key with new blocks — a re-extraction — keeps the folds whose
 * headings are still foldable.
 */
export function setFoldArticle(key: string, blocks: readonly Block[]): void {
  /* `article !== null` spelled out: `article?.key === key` is true for no
     article and an undefined key, which a test rendering without a slug does. */
  const same = article !== null && article.key === key;
  if (same && article?.blocks === blocks) return;
  article = { key, blocks };
  const foldable = foldableHeadings(blocks);
  state = { folded: state.folded, foldable };
  commit(same ? new Set([...state.folded].filter((id) => foldable.has(id))) : new Set());
}

/** The reader is gone: nothing folded, and the style element removed. */
export function clearFoldArticle(): void {
  article = null;
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
 */
export function revealBlock(id: string): void {
  if (!hidden.has(id as BlockId) || !article) return;
  const opening = new Set(foldsHiding(article.blocks, state.folded, id as BlockId));
  commit(new Set([...state.folded].filter((h) => !opening.has(h))));
}

/** Whether `id`'s row is folded away right now. */
export function isFolded(id: string): boolean {
  return hidden.has(id as BlockId);
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
export function useFoldArticle(key: string, blocks: readonly Block[]): void {
  useLayoutEffect(() => setFoldArticle(key, blocks), [key, blocks]);
  useEffect(() => clearFoldArticle, []);
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
