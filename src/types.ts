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

/**
 * One article-level sentence per part: where the argument stands there.
 *
 * Stage 5b, in its own `arc.json` rather than as a field on the tree — see
 * src/arc.ts for why, and docs/project/granularity-zoom.md#the-arc for what an
 * arc sentence is and how it differs from a gist.
 */
export interface ArcEntry {
  /** The part this belongs to, as its block range. Matched by range, never by node id. */
  range: [BlockId, BlockId];
  text: string;
}

export interface Arc {
  version: string;
  generator: string;
  slug: string;
  entries: ArcEntry[];
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
  /** Absent until `npm run arc` has been run — the L0 column falls back to the root gist. */
  arc?: Arc;
}

/** A source the model consulted, from OpenRouter's `annotations`. See src/explain.ts. */
export interface Citation {
  url: string;
  title?: string;
}

/**
 * A reader's question about a stretch of prose, and the model's answer.
 *
 * Stored in `data/<slug>/comments.json` — reader state, so it lives beside the
 * article rather than in it. See docs/project/comments.md.
 *
 * The anchor is `blockId` plus the exact `quote`; `start` only picks between
 * repeats of the same words within the block. That ordering matters: an offset
 * alone would silently drift the moment the paragraph changed, which is the
 * failure random block ids exist to prevent (docs/project/block-ids.md).
 */
export interface Comment {
  id: string;
  blockId: BlockId;
  quote: string;
  /** Where `quote` sat in the block's rendered text when the comment was made. */
  start: number;
  createdAt: string;
  /** `pending` is written to disk *before* the model call, so a crash is visible rather than silent. */
  status: "pending" | "done" | "error";
  answer?: string;
  citations?: Citation[];
  /** How many web searches the model chose to run. 0 means it was sure. */
  searches?: number;
  model?: string;
  error?: string;
}
