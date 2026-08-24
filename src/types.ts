/**
 * Shared types for the artefacts on disk, used by both the API loader and the
 * React client. See docs/project/architecture.md#storage.
 *
 * `Block` mirrors the interface exported by src/blocks.ts (pipeline stage 3).
 * It is duplicated rather than imported because blocks.ts pulls in jsdom, which
 * must not reach the browser bundle. If stage 3 changes its shape, change this
 * too.
 *
 * `TreeNode` must stay in sync with docs/project/granularity-zoom.md#node-shape.
 */

export type NodeId = string; // "n0042"
export type BlockId = string; // "spya-k3m9qt" — see docs/project/block-ids.md
export type BlockKind =
  | "heading" | "text" | "quote" | "code" | "media" | "caption" | "other";

/**
 * One block of the article. **Array order in blocks.json IS document order** —
 * ids are random and tell you nothing about position (block-ids.md#why-random-and-not-sequential).
 */
export interface Block {
  id: BlockId;
  tag: string;
  kind: BlockKind;
  /** Heading depth 1–6, on headings only. */
  level?: number;
  text: string;
  words: number;
  html: string;
  /** False for media, rules, code — blocks with no prose to summarise. */
  gistable: boolean;
  note?: string;
}

/** A node of the granularity tree / deeply-nested ToC. Stage 4+5 output. */
export interface TreeNode {
  id: NodeId;
  depth: number; // 0 = whole article
  parent: NodeId | null;
  children: NodeId[]; // [] for leaves
  /** Inclusive, contiguous. Resolved via the blocks.json index, never by string comparison. */
  range: [BlockId, BlockId];
  title: string; // 2–6 words
  /**
   * ONE sentence, shown in the reading view IN PLACE OF the text it compresses.
   * Absent on leaves by design — a summary must never be shown where the real
   * paragraph could be. Never fall back to navLabel when this is missing.
   */
  gist?: string;
  /** Leaves only. Navigation chrome for the ToC and spine; never reading content. */
  navLabel?: string;
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
  note?: string;
}

/** What GET /api/article/:slug returns — everything needed for every zoom level. */
export interface Article {
  meta: Meta;
  blocks: Block[];
  tree: Tree;
}
