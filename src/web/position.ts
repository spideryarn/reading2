/**
 * Reading position — the pure half. The DOM half lives in TableView.tsx.
 *
 * **`?at=` always holds a block id.** Ordinary scrolling writes the first block
 * of the section in view; a deliberate jump may name a finer block, and the spy
 * preserves it while the reader stays inside that block's section
 * (§ positionToWrite, at the bottom of this file). What follows is about the
 * first of those, which is the unit the *spy* works in. Greg, 2026-08-25:
 *
 * > store the section rather than the exact position?
 *
 * Which is the right call for three reasons beyond the obvious tidiness:
 *
 *  - It collapses the update rate. The example article is 139 blocks but only
 *    36 sections, and the URL only changes when you cross a boundary, so most
 *    scrolling writes nothing at all.
 *  - It gives the URL meaning. `?at=spya-tgnssb` is "the section that starts
 *    here", which survives the article being re-extracted at a different
 *    length. A pixel offset would be a lie the moment anything reflowed — and
 *    it reflows constantly here, because toggling a granularity column changes
 *    every row height.
 *  - It is a block id, so it obeys the one contract
 *    (AGENTS.md § The one contract that matters, docs/project/block-ids.md).
 *
 * The cost, stated plainly: reopening a link puts you at the top of the section
 * you were in, not at the paragraph you were on. Within a section that is a few
 * paragraphs of backtracking.
 *
 * What it is NOT is a node id. Node ids (`n0003`) are handed out sequentially
 * when the tree is generated and are regenerated whenever `tree.json` is
 * rebuilt — a URL holding one would silently point somewhere else after the
 * next run. Block ids are minted once and preserved. Hence: the id of the first
 * *block* of the section, never the id of the node.
 */
import type { Block, BlockId, NodeId } from "../types.js";
import { navigableItems, type Geometry } from "./tree.js";

export interface Section {
  /** Index into `blocks` of this section's first row. */
  row: number;
  /** That block's id — this is what goes in the URL. */
  blockId: BlockId;
  nodeId: NodeId;
  title: string;
}

/**
 * The depth we treat as "a section": the deepest level that still has titles
 * and gists, i.e. one above the leaves.
 *
 * The leaves are one node per block, so using them would be storing the exact
 * position under another name. Depth 1 ("Parts") is far too coarse — nine of
 * them across the example article. `leafDepth - 1` is depth 2 for a normal
 * three-deep tree, which is what columnLabel already calls "Sections", and it
 * follows the article if a deeper or shallower tree gets generated. Clamped at
 * 1 so a pathologically shallow tree can never select the root, which spans
 * everything and would never change.
 */
export function sectionDepth(geometry: Geometry): number {
  return Math.max(1, geometry.leafDepth - 1);
}

/**
 * Every section in document order, with the row it starts on.
 *
 * The section column already holds one cell per section with a `rowSpan`
 * covering its range, so running the spans up gives the start rows directly —
 * no second walk of the tree, and no chance of disagreeing with what is on
 * screen.
 */
export function buildSections(geometry: Geometry, blocks: Block[]): Section[] {
  const column = geometry.cells[sectionDepth(geometry)] ?? [];
  const sections: Section[] = [];
  /* `navigableItems`, not the raw cells. At the section depth the apparatus is
     one leaf cell per endnote, each with an empty title, so a reader who stops
     in the notes would have `?at=` stepping through forty nameless sections and
     the panel naming none of them. Collapsed, the notes are one section called
     "Notes" whose id is its first block — and that is the same item keynav
     steps to and the fisheye marks current, which is the agreement this
     projection exists to guarantee. src/web/tree.ts § navigableItems. */
  for (const item of navigableItems(column, geometry.supplementOf)) {
    const block = blocks[item.startRow];
    if (!block) continue;
    sections.push({
      row: item.startRow,
      blockId: block.id,
      nodeId: item.node.id,
      title: item.node.title,
    });
  }
  return sections;
}

/**
 * Which section the reader is standing in, given each section's distance from
 * the top of the viewport and the line we measure against.
 *
 * `tops` is in document order, so this is the last one that has already gone
 * past the line. Above the first section it clamps to 0 rather than returning
 * -1: there is always a section you are in, even if it hasn't reached the top
 * of the screen yet.
 */
export function activeSectionIndex(tops: number[], line: number): number {
  let active = 0;
  // `.entries()` rather than an index loop: it hands out the value already
  // typed, so there is no indexing to bounds-check.
  for (const [i, top] of tops.entries()) {
    if (top > line) break;
    active = i;
  }
  return active;
}

/**
 * **Which section a block sits inside**, as an index into `sections`.
 *
 * `rowOf` is the article's block → row index. A block it does not know is not a
 * position we can place, and the answer is `null` rather than a guess: an id
 * the article no longer has must not pin the reader's position forever — nor,
 * since 2026-09-06, name a section on the return chip (ReturnChip.tsx).
 *
 * Split out of `sectionContaining` below because its two callers want different
 * things out of the same walk: the spy wants the section's **first block**,
 * which is how the address spells it, and the chip wants its **title**, which
 * is the only part of it a reader recognises. One walk, so the two cannot come
 * to disagree about which section a block is in.
 */
export function sectionIndexContaining(
  sections: readonly Section[],
  rowOf: ReadonlyMap<BlockId, number>,
  blockId: BlockId | null,
): number | null {
  if (blockId === null) return null;
  const row = rowOf.get(blockId);
  if (row === undefined) return null;
  const index = activeSectionIndex(sections.map((s) => s.row), row);
  return sections[index] === undefined ? null : index;
}

/**
 * **The section a block sits inside** — that section's own first block, which
 * is the id the address uses for it.
 */
export function sectionContaining(
  sections: Section[],
  rowOf: ReadonlyMap<BlockId, number>,
  blockId: BlockId | null,
): BlockId | null {
  const index = sectionIndexContaining(sections, rowOf, blockId);
  return index === null ? null : sections[index]?.blockId ?? null;
}

/**
 * **What the scroll spy should write into `?at=`, or `null` for "leave the
 * address alone".**
 *
 * An object means write `at` — where `at: null` is the top of the article, and
 * is why this cannot simply return the id: `null` has to mean two different
 * things and only one of them is a value.
 *
 * Three rules, and the middle one is the fix for a reported bug.
 *
 * **A jump of ours in flight writes nothing at all.** `glide` (scroll.ts)
 * animates by calling `window.scrollTo` on every frame, so a long jump fires
 * exactly the scroll events a reader's own hand would. Without this the spy
 * names every section the page flies *over* on the way, and lands holding the
 * destination's section rather than the block the jump was aimed at. This is
 * not the "was that scroll mine or theirs?" guess the rest of this app refuses
 * to make: `glideTarget()` is the animation's own handle, and the reader taking
 * over with a wheel or a finger clears it (scroll.ts § cancel). It comes
 * **before** the top-of-the-article branch, because a jump that passes near the
 * top would otherwise clear the address on its way past. GPT Sol, 2026-08-30.
 *
 * **A reader still inside the section the address already names has not gone
 * anywhere the address needs to say**, so a finer value stands. That is the
 * whole of the springback fix: `?at=` is a section, but a jump is allowed to
 * put a *paragraph* there — the diagram panel's ↑ / ↓ buttons do, because on
 * Trail and Drift a rung is one paragraph (diagram.ts § stepStops). Comparing
 * the measured section against the *held value* rather than against the section
 * the held value is *in* found them different, wrote the section's first block
 * over the paragraph when the queued position write landed, and left
 * the next press computing from the top of the section again — so it moved
 * nothing. tests/reading-position.test.ts § two presses.
 *
 * **The section is derived here, every time, rather than remembered.** A
 * remembered one goes stale the moment `sections` changes under it — a column
 * toggle, a granularity change, a re-extraction — and a stale section is a spy
 * that has quietly stopped writing. Also GPT Sol, same review.
 */
export function positionToWrite(opts: {
  sections: Section[];
  rowOf: ReadonlyMap<BlockId, number>;
  /** Each section's distance from the top of the viewport, in document order. */
  tops: number[];
  /** The line we measure against — under the sticky bars. */
  line: number;
  /** Whether a jump we started is still animating. `glideTarget() !== null`. */
  jumpInFlight: boolean;
  /** Whether the reader is above the first section, where nothing is named. */
  atTop: boolean;
  /** What `?at=` says now. */
  held: BlockId | null;
}): { at: BlockId | null } | null {
  const { sections, rowOf, tops, line, jumpInFlight, atTop, held } = opts;
  if (jumpInFlight) return null;
  // Above the first section there is no section to name, and saying so keeps
  // ?at= out of the URL until the reader has actually moved.
  if (atTop) return held === null ? null : { at: null };
  const visible = sections[activeSectionIndex(tops, line)]?.blockId ?? null;
  if (visible === null) return null;
  if (visible === sectionContaining(sections, rowOf, held)) return null;
  return { at: visible };
}
