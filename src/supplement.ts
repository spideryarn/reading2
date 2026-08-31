/**
 * **The supplement node** — the apparatus, present in the structure and absent
 * from the argument.
 *
 * Greg, 2026-08-28:
 *
 * > I feel there should be a way to see it in the structure of the doc (e.g. in
 * > the Spine, so that I could jump to the Footnotes), but we don't necessarily
 * > need to summarise and include it in the argument etc. Try and get the best
 * > of both worlds.
 *
 * Stage 3 gave every note block `treatment: "supplement"`, which keeps it out of
 * the argument (src/block-policy.ts). What it did not give it is a *place*. The
 * tree's invariants make "notes live outside the tree" unavailable — the root
 * must span every block and every block must be tiled by exactly one leaf
 * (src/tree-invariants.ts) — so the notes were already in the structure, spread
 * across forty unlabelled leaves nobody could see or jump to.
 *
 * This module gives them one internal node instead:
 *
 * ```
 * root
 *   ├── part 1   (gist: generated)
 *   ├── part 2   (gist: generated)
 *   └── Notes    ← supplement: authored title, NO generated gist
 *         ├── leaf: note block 1
 *         └── …
 * ```
 *
 * ## `treatment`, not `role`
 *
 * `TreeNode.treatment` mirrors `Block.treatment` and deliberately does **not**
 * reuse `role`, which on a block means *what kind of content this is* and would
 * come to mean *what the structure excludes* on a node. GPT Sol's decision 11
 * (docs/plans/260828o-footnotes-stage345-upfront-sol.md).
 *
 * ## Built from the body only, then appended
 *
 * The ordering is load-bearing and it is the whole reason a footnote can never
 * be summarised into the argument: `generateHierarchy` builds the tree from the
 * **body blocks alone**, so the structure model never sees a note and no part
 * gist and no root gist can be written about one. The supplement node is then
 * appended mechanically, extending the root's range to the end of the article.
 * No model call is involved: the title is authored — "Notes".
 *
 * ## The one shape this refuses, and why it refuses all of it
 *
 * A supplement node must cover exactly one contiguous range and must contain
 * **every** supplement block (src/tree-invariants.ts, invariants 2 and 4). So a
 * note stranded in the middle of the body — a sidenote whose stamp landed
 * mid-prose — cannot be inside it, and a tree carrying a node that covers only
 * some of the apparatus is a tree `checkTree` must reject.
 *
 * Rather than build a node that is invalid the moment it exists, `splitBlocks`
 * gives up on the whole article: `groups` comes back empty, the tree is built
 * exactly as it was before this stage, and `stranded` says how many blocks
 * caused it. Measured over the committed fixtures before this was written, the
 * fallback fires on none of them — gwern 143–183, wiki_transformer 235–355,
 * acx_footnotes 78–95 and tufte 63–67 are each a single run ending at the last
 * block. The fallback is for the article we have not met yet, and it is
 * reported in the run's stats rather than taken quietly.
 */
import { isBody } from "./block-policy.js";
import type { Block, NodeId, Tree, TreeNode } from "./types.js";

/**
 * The authored title for a run of apparatus, by what the run *is*.
 *
 * Only `"footnote"` is ever assigned in v1 (src/blocks.ts), so in practice
 * there is one entry and one node. The map is here so that the day
 * `"reference"` starts being assigned, a second supplement node is a line in a
 * table rather than a rewrite — which is the brief's "build it so a second is
 * not a rewrite".
 */
const TITLES: Record<string, string> = {
  footnote: "Notes",
  reference: "References",
  acknowledgment: "Acknowledgments",
  credit: "Credits",
  appendix: "Appendix",
};

/** What a run with no `role`, or an unrecognised one, is called. */
const FALLBACK_TITLE = "Notes";

export interface SupplementGroup {
  /** The `Block.role` every block in the run shares. */
  role: string | undefined;
  /** The authored title this run's node wears. */
  title: string;
  blocks: Block[];
}

export interface BlockSplit {
  /** The blocks the tree is generated from. Everything, when there is no tail. */
  body: Block[];
  /** The trailing apparatus, cut into one group per run of a shared `role`. */
  groups: SupplementGroup[];
  /**
   * Supplement blocks outside the trailing run, which is what makes the whole
   * split fall back. Non-zero means `groups` is empty and `body` is every
   * block; see the module comment.
   */
  stranded: number;
}

/**
 * Cut the article into the body and its trailing apparatus.
 *
 * The tail is the **maximal run of supplement blocks that ends at the last
 * block**. Anything else — a supplement block earlier in the article, or an
 * article that is nothing but apparatus — falls back to no split at all.
 */
export function splitBlocks(blocks: readonly Block[]): BlockSplit {
  const none: BlockSplit = { body: [...blocks], groups: [], stranded: 0 };

  let start = blocks.length;
  while (start > 0 && !isBody(blocks[start - 1]!)) start--;
  if (start === blocks.length) return none; // no apparatus at the end

  const stranded = blocks.slice(0, start).filter((b) => !isBody(b)).length;
  /* An article that is entirely apparatus has no body to build a tree from, so
     there is nothing to append a supplement to. Treated as stranded rather than
     as a special case: both are "this article is not the shape this stage
     understands", and both must keep publishing exactly as they do today. */
  if (stranded > 0 || start === 0) return { ...none, stranded: stranded + (start === 0 ? blocks.length : 0) };

  const groups: SupplementGroup[] = [];
  for (const block of blocks.slice(start)) {
    const last = groups.at(-1);
    if (last && last.role === block.role) last.blocks.push(block);
    else {
      groups.push({
        role: block.role,
        title: (block.role && TITLES[block.role]) || FALLBACK_TITLE,
        blocks: [block],
      });
    }
  }
  return { body: blocks.slice(0, start), groups, stranded: 0 };
}

/** Is this node the apparatus rather than the argument? */
export function isSupplementNode(node: Pick<TreeNode, "treatment">): boolean {
  return node.treatment === "supplement";
}

/** Every supplement node of a tree, in the root's own child order. */
export function supplementNodes(tree: Tree): TreeNode[] {
  const root = tree.nodes[tree.rootId];
  if (!root) return [];
  /* **`?? []` even though `children` is a required field.** The type describes
     what this app writes; it does not describe every tree this app is handed.
     This became reachable from `articleStats` (src/web/stats.ts) so the masthead
     would stop counting the apparatus as parts of the argument — which put it on
     the path of every page load, where one root without a `children` array threw
     and took the whole reading view down with it.
     The rule everywhere else here is that a malformed tree renders visibly short
     rather than throwing (src/web/tree.ts § buildChains); a projection helper is
     no place to make an exception. tests/supplement.test.ts § a malformed tree. */
  return (root.children ?? [])
    .map((id) => tree.nodes[id])
    .filter((n): n is TreeNode => !!n && isSupplementNode(n));
}

/**
 * **Node id → the supplement node it belongs to**, itself included.
 *
 * The one thing every consumer of the tree actually needs, because the marker
 * sits on the supplement node and the cells a column draws are its *leaves*.
 * A leaf carries no `treatment` of its own — deliberately, since the leaf layer
 * is grown mechanically and a second copy of the fact could only ever disagree
 * with the first — so "is this row apparatus" is an ancestor question, and this
 * is the answer, computed once.
 *
 * Empty for every tree written before this stage, and for every article with no
 * apparatus, which is what makes each consumer's supplement branch cost nothing
 * on the corpus that has none.
 */
export function supplementIndex(tree: Tree): Map<NodeId, TreeNode> {
  const out = new Map<NodeId, TreeNode>();
  for (const node of supplementNodes(tree)) {
    const stack: NodeId[] = [node.id];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (out.has(id)) continue;
      out.set(id, node);
      const child = tree.nodes[id];
      if (child) stack.push(...(child.children ?? []));
    }
  }
  return out;
}

/**
 * Append one supplement node per group, extending the root's range.
 *
 * Returns a new tree; the input is not touched. New node ids continue the
 * `n0042` sequence `buildTree` mints, so a tree does not carry two id schemes —
 * ids are opaque and positional either way (docs/project/block-ids.md), and the
 * only property that matters is that they do not collide.
 *
 * `groups` empty returns the tree unchanged, which is both the no-apparatus
 * case and the stranded-note fallback.
 */
export function appendSupplement(tree: Tree, groups: readonly SupplementGroup[]): Tree {
  if (groups.length === 0) return tree;
  const root = tree.nodes[tree.rootId];
  if (!root) return tree;

  const nodes: Record<NodeId, TreeNode> = {};
  for (const [id, node] of Object.entries(tree.nodes)) nodes[id] = { ...node, children: [...node.children] };

  let counter = 0;
  for (const id of Object.keys(nodes)) {
    const n = /^n(\d+)$/.exec(id);
    if (n) counter = Math.max(counter, Number(n[1]));
  }
  const nextId = (): NodeId => `n${String(++counter).padStart(4, "0")}`;

  const newRoot = nodes[tree.rootId]!;
  let lastBlockId = newRoot.range[1];

  for (const group of groups) {
    const first = group.blocks[0];
    const last = group.blocks.at(-1);
    if (!first || !last) continue;
    const id = nextId();
    const node: TreeNode = {
      id,
      depth: 1,
      parent: newRoot.id,
      children: [],
      range: [first.id, last.id],
      title: group.title,
      /* No gist, and that is the point: a gist stands in place of the prose it
         compresses (src/types.ts § TreeNode.gist), and the promise this whole
         feature makes is that the notes are shown as written and never
         summarised. `checkTree` states the rule in both directions so that a
         pipeline bug which *drops* a gist can never be mistaken for this. */
      treatment: "supplement",
    };
    nodes[id] = node;
    for (const block of group.blocks) {
      const leafId = nextId();
      nodes[leafId] = {
        id: leafId,
        depth: 2,
        parent: id,
        children: [],
        range: [block.id, block.id],
        title: "",
        /* No navLabel. `isStructural` is false for every one of these blocks,
           so a label here would be the phantom-row failure that predicate
           exists to prevent — one sidebar entry per endnote. */
      };
      node.children.push(leafId);
    }
    newRoot.children.push(id);
    lastBlockId = last.id;
  }

  newRoot.range = [newRoot.range[0], lastBlockId];
  return { ...tree, nodes };
}
