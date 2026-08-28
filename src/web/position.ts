/**
 * Reading position — the pure half. The DOM half lives in TableView.tsx.
 *
 * Position is stored as a *section*, not as an exact scroll offset. Greg,
 * 2026-08-25:
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
