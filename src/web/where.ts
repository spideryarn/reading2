/**
 * **Where am I in the article** — a fisheye of the outline around one place,
 * for a tooltip. Greg, SPIDERYARN-READING2-5C: *"it might be nice to have a
 * reusable tooltip for the structure mode fish eye that actually would be
 * useful when hovering over the spine to show, okay, this is where I am right
 * now relative to the wider course hierarchy."*
 *
 * Pure, and generic over the node shape, because its two callers hold the
 * outline differently: Skim has the stored `Tree` and a block
 * (`whereForBlock`), the spine has its `OutlineEntry` bands. Both reduce to the
 * same question — the top-level sections, and the path of section ids down to
 * the place — so there is one answer to "where is this", not two
 * (structure.ts's header on what two copies of that cost).
 *
 * What it draws: every top-level section when there are few, else the ones
 * near the path and a "… n more" either side; then, down the path, each
 * level's siblings near the one on the path, the same way, indented. The last
 * node on the path is `here`. Paragraph leaves are never rows — this answers
 * *which section*, and the row the reader is on already shows the words.
 *
 * docs/plans/260929f-trajectory-snippets-in-place-sparkline-and-where-card.md § 3.
 */
import type { Tree, TreeNode } from "../types.js";
import { sectionNodesOf } from "../section-path.js";
import { titleVoice } from "./tree.js";
import type { Voice } from "./voice.js";

export type WhereRow =
  | { kind: "node"; key: string; title: string; voice: Voice; depth: number; onPath: boolean; here: boolean }
  | { kind: "more"; key: string; depth: number; count: number };

export interface WhereShape<N> {
  id(node: N): string;
  title(node: N): string;
  /** Whose words `title(node)` is — the face its row is drawn in (fonts.md). */
  voice(node: N): Voice;
  /** The node's sub-sections — never its paragraphs. */
  sections(node: N): readonly N[];
}

/** A level with at most this many sections is drawn whole. */
export const WHERE_ALL = 8;
/** Otherwise, this many either side of the one on the path. */
export const WHERE_NEAR = 2;

/**
 * The rows, top to bottom. `path` is the section ids from the top level down
 * to the place, outermost first; a path that leaves the outline stops there.
 * `[]` when there is no outline to draw.
 */
export function whereRows<N>(top: readonly N[], path: readonly string[], shape: WhereShape<N>): WhereRow[] {
  const rows: WhereRow[] = [];
  const level = (nodes: readonly N[], depth: number): void => {
    if (nodes.length === 0) return;
    const on = path[depth];
    const at = on === undefined ? -1 : nodes.findIndex((n) => shape.id(n) === on);
    let lo = 0;
    let hi = nodes.length - 1;
    if (nodes.length > WHERE_ALL) {
      const centre = at === -1 ? 0 : at;
      lo = Math.max(0, centre - WHERE_NEAR);
      hi = Math.min(nodes.length - 1, centre + WHERE_NEAR);
    }
    if (lo > 0) rows.push({ kind: "more", key: `more-${depth}-before`, depth, count: lo });
    for (let i = lo; i <= hi; i++) {
      const node = nodes[i]!;
      const onPath = i === at;
      const title = shape.title(node).trim();
      rows.push({
        kind: "node",
        key: shape.id(node),
        title: title || "Untitled section",
        // The stand-in is ours, whoever would have written the title.
        voice: title ? shape.voice(node) : "ui",
        depth,
        onPath,
        here: onPath && depth === path.length - 1,
      });
      if (onPath && depth + 1 < path.length) level(shape.sections(node), depth + 1);
    }
    if (hi < nodes.length - 1) {
      rows.push({ kind: "more", key: `more-${depth}-after`, depth, count: nodes.length - 1 - hi });
    }
  };
  level(top, 0);
  return rows;
}

/* ------------------------------------------------------ the stored tree -- */

const isSection = (node: TreeNode | undefined): node is TreeNode => node !== undefined && node.children.length > 0;

/** The stored tree as `whereRows` reads it: sections only. */
export function treeShape(tree: Tree): WhereShape<TreeNode> {
  return {
    id: (n) => n.id,
    title: (n) => n.title,
    voice: titleVoice,
    sections: (n) => n.children.map((id) => tree.nodes[id]).filter(isSection),
  };
}

/**
 * Where a block sits, from the stored tree — Skim's rows. `[]` for a flat
 * tree (no sections, only paragraphs off the root) or a block the tree does
 * not cover, and the caller then shows no card.
 */
export function whereForBlock(tree: Tree, index: ReadonlyMap<string, number>, blockId: string): WhereRow[] {
  const root = tree.nodes[tree.rootId];
  if (!root) return [];
  const shape = treeShape(tree);
  const top = shape.sections(root);
  if (top.length === 0) return [];
  const path = sectionNodesOf(blockId, index, tree)
    .filter((n) => n.children.length > 0)
    .map((n) => n.id);
  if (path.length === 0) return [];
  return whereRows(top, path, shape);
}
