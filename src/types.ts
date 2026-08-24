/**
 * Shared types for the artefacts on disk. See docs/project/architecture.md#storage
 * and docs/project/granularity-zoom.md#node-shape — this file must stay in sync
 * with the Node shape documented there.
 */

export type NodeId = string; // "n0042"
export type BlockId = string; // "p0012"

/** One top-level flow element of the article. Stage 3 output. */
export interface Block {
  id: BlockId;
  tag: string;
  html: string;
  text: string;
  /** Heading depth (1–6) for heading blocks, else null. */
  level: number | null;
  /** Figures, rules, code — shown verbatim, never summarised. */
  opaque: boolean;
  textHash: string;
}

/** A node of the granularity tree / deeply-nested ToC. Stage 4+5 output. */
export interface TreeNode {
  id: NodeId;
  depth: number; // 0 = whole article
  parent: NodeId | null;
  children: NodeId[]; // [] for leaves
  range: [BlockId, BlockId]; // inclusive, contiguous
  title: string; // 2–6 words
  gist?: string; // ONE sentence; absent on leaves (we render the real text there)
  summary?: string;
  sourceHeading?: string;
}

export interface Tree {
  version: string;
  generator: string;
  slug: string;
  rootId: NodeId;
  nodes: Record<NodeId, TreeNode>;
}

export interface Meta {
  slug: string;
  title: string;
  byline?: string;
  siteName?: string;
  lang?: string;
  url?: string;
}

/** What GET /api/article/:slug returns — everything needed for every zoom level. */
export interface Article {
  meta: Meta;
  blocks: Block[];
  tree: Tree;
}
