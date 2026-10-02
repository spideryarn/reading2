/**
 * **The headings breadcrumb's path — the pure half.** The bar is
 * HeadingsCrumbs.tsx.
 *
 * The path is the tree Structure draws, walked from the root down to the
 * section the reader is in: part › section, or deeper on a deeper tree, and
 * never a paragraph. The tree is `buildSummaryTree` cut at `sectionDepth`, so
 * the walk stops there by running out of children rather than by counting.
 *
 * **One walk, the first containing child at each level** — Structure's rule
 * (structure.ts § `makeRow`, "one selection model"). On a tree with
 * overlapping sibling ranges a second answer would light two crumbs.
 *
 * docs/plans/261002h-headings-breadcrumb-at-the-top-of-the-reading-view.md
 */
import type { BlockId, NodeId } from "../types.js";
import { nodeLabel, type SummaryNode } from "./tree.js";
import type { Voice } from "./voice.js";

export interface Crumb {
  id: NodeId;
  /** "2.3", or empty on the apparatus — tree.ts § `SummaryNode.number`. */
  number: string;
  text: string;
  voice: Voice;
  gist?: string;
  /** The node's first block — where a press on the crumb jumps to. */
  blockId: BlockId;
}

/** Inclusive at both ends, as structure.ts § `contains` says why. */
const contains = (n: SummaryNode, row: number) => row >= n.startRow && row <= n.endRow;

/**
 * The crumbs for the reader standing on `row`, outermost first.
 *
 * A node with no words to show (no title, no navLabel) is skipped rather than
 * drawn as a blank crumb, and the walk carries on beneath it. A row no part
 * contains — a gap in a malformed tree — ends the path where it is.
 */
export function crumbPath(root: SummaryNode | null, row: number): Crumb[] {
  const path: Crumb[] = [];
  let at = root;
  while (at) {
    const next: SummaryNode | undefined = at.children.find((c) => contains(c, row));
    if (!next) break;
    const label = nodeLabel(next, next.title);
    if (label) {
      path.push({
        id: next.node.id,
        number: next.number,
        text: label.text,
        voice: label.voice,
        ...(next.gist !== undefined && { gist: next.gist }),
        blockId: next.node.range[0],
      });
    }
    at = next;
  }
  return path;
}
