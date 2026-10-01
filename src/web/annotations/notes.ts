/**
 * **What Annotations mode puts beside which block** — the pure half.
 *
 * Everything here is drawn from what the article already has: the Socratic
 * question the structure call wrote on the root and each top-level part
 * (src/hierarchy.ts § `questionFor`), the arc, and the ideas where the reader
 * has made them. Nothing is generated for this mode.
 *
 * **Sparse on purpose.** The risk this mode runs against vision.md is a second
 * article down the margin, so it never draws a gist or a label per paragraph:
 * one question per part, a stamp where an idea occurs, and nothing else.
 * docs/plans/261001d-annotations-mode-marginalia-in-a-right-hand-column.md.
 *
 * Ranges are resolved by block position, never by comparing id strings
 * (docs/project/block-ids.md).
 */
import type { Arc, Block, BlockId, Idea, IdeaProvenance, Tree } from "../../types.js";
import { blockIndex, sectionNodesOf } from "../../section-path.js";

export type AnnotationNote =
  /** The question a part — or, at `depth` 0, the whole article — answers. */
  | { kind: "question"; depth: number; text: string }
  /** An idea the piece assumes or introduces, occurring in this block. */
  | {
      kind: "idea";
      ideaId: string;
      name: string;
      statement: string;
      provenance: IdeaProvenance;
    };

/**
 * The notes for every block that has any, in the order they are drawn.
 *
 * Questions first, root before part, then ideas in the artefact's own order
 * (assumed first — src/types.ts § `Ideas.ideas`), each once, beside the first
 * block it occurs in. A node or occurrence naming a block this article no
 * longer has is skipped, so a stale artefact cannot place a note nowhere.
 */
export function annotationNotes(
  tree: Tree | null | undefined,
  blocks: readonly Block[],
  ideas: readonly Idea[] | null | undefined,
): Map<BlockId, AnnotationNote[]> {
  const index = blockIndex(blocks);
  const out = new Map<BlockId, AnnotationNote[]>();
  const add = (blockId: BlockId, note: AnnotationNote) => {
    if (!index.has(blockId)) return;
    const list = out.get(blockId);
    if (list) list.push(note);
    else out.set(blockId, [note]);
  };

  const root = tree?.nodes[tree.rootId];
  if (tree && root) {
    if (root.question) add(root.range[0], { kind: "question", depth: 0, text: root.question });
    for (const id of root.children) {
      const part = tree.nodes[id];
      if (part?.question) add(part.range[0], { kind: "question", depth: 1, text: part.question });
    }
  }

  /* **One stamp per idea, at its first occurrence in the article** — not at
     every one. An Ideas list is three to ten ideas with two to five
     occurrences each, so stamping them all could put fifty notes down the
     margin before a single question: the second article this mode must not
     become. The first is where the reader meets it. GPT Sol, F10. */
  for (const idea of ideas ?? []) {
    let first: BlockId | null = null;
    let firstAt = Number.POSITIVE_INFINITY;
    for (const occurrence of idea.occurrences) {
      const at = index.get(occurrence.blockId);
      if (at !== undefined && at < firstAt) {
        first = occurrence.blockId;
        firstAt = at;
      }
    }
    if (first === null) continue;
    add(first, {
      kind: "idea",
      ideaId: idea.id,
      name: idea.name,
      statement: idea.statement,
      provenance: idea.provenance,
    });
  }
  return out;
}

/**
 * **Where each note goes, given where it wants to be** — the one collision
 * rule, in document order: a note sits level with its block unless the note
 * above it is still in the way, in which case it starts `gap` below that one.
 *
 * O(n), order-preserving, and the rule Gwern's sidenotes and the Tufte
 * variants all use. Pure, so it is tested without a browser.
 */
export function layoutNotes(
  desired: readonly number[],
  heights: readonly number[],
  gap: number,
): number[] {
  const tops: number[] = [];
  let floor = Number.NEGATIVE_INFINITY;
  for (const [i, want] of desired.entries()) {
    const top = Math.max(want, floor);
    tops.push(top);
    floor = top + (heights[i] ?? 0) + gap;
  }
  return tops;
}

/**
 * **The head's path**: the part and the section that hold `blockId`, at most
 * two titles — Sol's "current section title" plus the one ancestor that says
 * where it sits. `[]` above the first part, or where the tree does not cover
 * the block.
 */
export function headPath(
  tree: Tree | null | undefined,
  index: ReadonlyMap<string, number>,
  blockId: BlockId | null,
): string[] {
  if (!tree || blockId === null) return [];
  return sectionNodesOf(blockId, index, tree)
    .slice(0, 2)
    .map((node) => node.title);
}

/** **The arc's sentence for the part holding `blockId`**, or null. */
export function arcAt(
  arc: Arc | null | undefined,
  index: ReadonlyMap<string, number>,
  blockId: BlockId | null,
): string | null {
  if (!arc || blockId === null) return null;
  const at = index.get(blockId);
  if (at === undefined) return null;
  for (const entry of arc.entries) {
    const lo = index.get(entry.range[0]);
    const hi = index.get(entry.range[1]);
    if (lo !== undefined && hi !== undefined && lo <= at && at <= hi) return entry.text;
  }
  return null;
}
