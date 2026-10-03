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
 * The spine's band card is the shorter version: the same rows under
 * `SPINE_LIMITS`, because a tooltip there cannot scroll and already carries a
 * gist and a list (plan 261003d; GPT Sol's F2 on 260929f, F1 on 261003d).
 *
 * docs/plans/260929f-trajectory-snippets-in-place-sparkline-and-where-card.md § 3.
 */
import type { Tree, TreeNode } from "../types.js";
import { sectionNodesOf } from "../section-path.js";
import { nodeLabel, type OutlineEntry, titleVoice } from "./tree.js";
import type { Voice } from "./voice.js";

export type WhereRow =
  | {
      kind: "node";
      key: string;
      title: string;
      voice: Voice;
      depth: number;
      onPath: boolean;
      here: boolean;
      /** Where in its trimmed level this row sits — only under `elided: "count"`. 0-based. */
      of?: { index: number; total: number };
    }
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

export interface WhereLimits {
  /** A level with at most this many sections is drawn whole. */
  all: number;
  /** Otherwise, this many either side of the one on the path. */
  near: number;
  /**
   * What a trimmed level says about the sections it left out: a *"… n more"*
   * row either side, or *"3 of 8"* on the row on the path, which costs no
   * height.
   */
  elided: "rows" | "count";
}

/** Skim's: room for a wider view, in a card opened on purpose. */
export const WHERE_LIMITS: WhereLimits = { all: WHERE_ALL, near: WHERE_NEAR, elided: "rows" };

/**
 * The spine's: at most three rows a level and no more-rows, so its two levels
 * add six lines at most to a band card that cannot scroll (plan 261003d).
 */
export const SPINE_LIMITS: WhereLimits = { all: 3, near: 1, elided: "count" };

/** The inclusive slice of one level that fits its fisheye budget. */
function levelBounds(length: number, at: number, limits: WhereLimits) {
  const trimmed = length > limits.all;
  const centre = at === -1 ? 0 : at;
  return {
    trimmed,
    lo: trimmed ? Math.max(0, centre - limits.near) : 0,
    hi: trimmed ? Math.min(length - 1, centre + limits.near) : length - 1,
  };
}

/**
 * The rows, top to bottom. `path` is the section ids from the top level down
 * to the place, outermost first; a path that leaves the outline stops there.
 * `[]` when there is no outline to draw.
 */
export function whereRows<N>(
  top: readonly N[],
  path: readonly string[],
  shape: WhereShape<N>,
  limits: WhereLimits = WHERE_LIMITS,
): WhereRow[] {
  const rows: WhereRow[] = [];
  const level = (nodes: readonly N[], depth: number): void => {
    if (nodes.length === 0) return;
    const on = path[depth];
    const at = on === undefined ? -1 : nodes.findIndex((n) => shape.id(n) === on);
    const { trimmed, lo, hi } = levelBounds(nodes.length, at, limits);
    const moreRows = limits.elided === "rows";
    if (moreRows && lo > 0) rows.push({ kind: "more", key: `more-${depth}-before`, depth, count: lo });
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
        ...(trimmed && onPath && !moreRows && { of: { index: i, total: nodes.length } }),
      });
      if (onPath && depth + 1 < path.length) level(shape.sections(node), depth + 1);
    }
    if (moreRows && hi < nodes.length - 1) {
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

/* ------------------------------------------------------ the spine's rail -- */

/**
 * What a spine band is called: its own title, else its nav label, else its
 * place in its part (*Section 2 of 4*), because two untitled bands side by side
 * must still read as two places (`revistes-ub-30977`; Spine.tsx § bandLabel
 * calls this). `place` is absent for a top-level part, and an unlabelled part
 * comes back `""` for the caller's own stand-in. `index` is 0-based.
 */
export function spineLabel(
  entry: OutlineEntry,
  place?: { index: number; total: number },
): { text: string; voice: Voice } {
  const own = nodeLabel(entry);
  if (own) return own;
  return { text: place ? `Section ${place.index + 1} of ${place.total}` : "", voice: "ui" };
}

/** A band, labelled in its place — the shape `whereForBand` hands `whereRows`. */
interface Placed {
  id: string;
  title: string;
  voice: Voice;
  sections: Placed[];
}

const placedShape: WhereShape<Placed> = {
  id: (n) => n.id,
  title: (n) => n.title,
  voice: (n) => n.voice,
  sections: (n) => n.sections,
};

/**
 * Where a spine band sits, found by the band's own node id and never through
 * a block — a block descends into whichever child holds the section's first
 * paragraph (GPT Sol's F1 on 260929f). The rail's bands are the parts and
 * their children, so the outline is placed two levels deep; a section's own
 * children are paragraphs and are never rows. `[]` for an id it does not have.
 */
export function whereForBand(
  outline: readonly OutlineEntry[],
  bandId: string,
  limits: WhereLimits = SPINE_LIMITS,
): WhereRow[] {
  const place = (entries: readonly OutlineEntry[], top: boolean): Placed[] =>
    entries.map((e, index) => {
      const { text, voice } = spineLabel(e, top ? undefined : { index, total: entries.length });
      return { id: e.node.id, title: text, voice, sections: top ? place(e.children, false) : [] };
    });
  const parts = place(outline, true);
  for (const part of parts) {
    if (part.id === bandId) return whereRows(parts, [part.id], placedShape, limits);
    if (part.sections.some((s) => s.id === bandId)) return whereRows(parts, [part.id, bandId], placedShape, limits);
  }
  return [];
}
