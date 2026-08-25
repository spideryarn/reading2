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

/**
 * One post of the thread — see docs/plans/tweet-thread-page.md.
 *
 * **No post number.** Position is the array's job and the array already does
 * it; a stored `number` is a second copy of the same fact that can only ever
 * disagree with the first, which is how a page ends up rendering "3/12" twice.
 * Render it as `index + 1`.
 *
 * `chars` is counted by us, and **nothing is truncated to make it fit**: a post
 * over the limit is stored exactly as written and shown as over.
 */
export interface Tweet {
  text: string;
  /** Code points, counted by us. See `countChars` in src/tweets.ts. */
  chars: number;
}

/**
 * The article as a numbered thread. Stage 5c, `data/<slug>/tweets.json`.
 *
 * Generated on demand rather than as part of every ingest — `tweets` is in
 * `STEP_ORDER` but not in `DEFAULT_INGEST_STEPS` (src/pipeline.ts).
 */
export interface TweetThread {
  version: string;
  generator: string;
  slug: string;
  /**
   * Fingerprint of the blocks this was written from, so the page can say the
   * thread describes an older version of the article. The thing their version
   * could not answer — src/tweets.ts `hashBlocks`.
   */
  sourceHash: string;
  /** The per-post character limit `chars` was counted against. One number, one place. */
  limit: number;
  tweets: Tweet[];
  generatedAt: string;
  /** Timed from outside the SDK, whose own timestamps came back empty. */
  elapsedMs: number;
}

/**
 * What `GET /api/tweets/:slug` returns.
 *
 * `stale` is the whole reason this is not just the artefact: the page has to be
 * able to say that the thread describes an older version of the article, which
 * is the thing the original version of this feature could never answer. It is
 * computed at read time from the blocks on disk (`isStale` in src/tweets.ts),
 * not stored — a stored flag would go out of date exactly when it mattered.
 */
export interface ThreadResponse {
  thread: TweetThread;
  stale: boolean;
}

export interface Meta {
  slug: string;
  title: string;
  byline?: string;
  siteName?: string;
  lang?: string;
  url?: string;
  /** When stage 2 fetched the page, ISO. The library sorts on it. */
  fetchedAt?: string;
  /** Readability's own one-or-two-sentence excerpt. A last-resort card blurb. */
  excerpt?: string;
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

/**
 * One article as the library lists it — see docs/project/library.md.
 *
 * Everything here is either metadata or *derived* from the artefacts, and the
 * derived half is the reason this type exists separately from `Meta`: the
 * homepage must not have to download 150KB of blocks.json per article to say
 * how long one is. `GET /api/library` returns these; `GET /api/article/:slug`
 * returns the real thing.
 *
 * Read the shape as a row of a future `articles` table. Every field is a scalar
 * a column could hold, which is the whole discipline — when this moves to
 * Postgres, the counts become columns written once at ingest instead of a
 * directory walk per request, and nothing above this line has to change.
 */
export interface LibraryEntry {
  slug: string;
  title: string;
  byline?: string;
  siteName?: string;
  url?: string;
  /** ISO. `meta.fetchedAt` where stage 2 recorded one, else the mtime of blocks.json. */
  addedAt: string;
  words: number;
  minutes: number;
  blocks: number;
  parts: number;
  sections: number;
  /** How many questions have been asked about it — reader state, not article state. */
  comments: number;
  /** The whole piece in one sentence: the tree root's gist. */
  gist?: string;
  /** The committed `example/` fixture rather than real pipeline output. */
  fixture?: boolean;
}

/**
 * One pipeline stage, as the metadata page reports it.
 *
 * **Not shaped as a row of a future table, and deliberately unlike
 * `LibraryEntry` above.** That one is a row because its fields become columns
 * written once at ingest. Nothing here would ever be stored: "are these files
 * on disk right now" is a question you can only answer by looking, so it is
 * read at request time by definition, and a stored copy would be the second
 * truth this repo keeps warning about.
 *
 * See docs/plans/metadata-page.md, and § What the plan got wrong for why this
 * carries no file sizes, no modification times, and **no staleness verdict**.
 */
export interface StageState {
  step: StepName;
  /** Present tense, from `STEPS` in src/pipeline.ts — "Fetching the page". */
  label: string;
  /** Every file this step writes, repo-relative. */
  outputs: string[];
  /**
   * True only when **all** of `outputs` are present — `stepIsDone`'s rule, and
   * borrowed from it rather than restated. Any-of would call `extract` finished
   * having written the HTML and not `meta.json`.
   */
  done: boolean;
}

/** What GET /api/metadata/:slug returns: which stages have run, and nothing the article payload already carries. */
export interface ArticleMetadata {
  slug: string;
  /** Where the artefacts actually are, repo-relative — `example` for the fixture. */
  dir: string;
  /** In pipeline order — `STEP_ORDER` in src/pipeline.ts. */
  stages: StageState[];
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

/* ----------------------------------------------------------- ingest jobs --
   The queue's wire types live here, not in src/jobs.ts, for the same reason
   `Block` does: src/jobs.ts imports p-queue and node:fs, and the React client
   needs these shapes. One `import type` away from a node module is one careless
   edit away from a broken browser bundle, so the shapes live where both sides
   can reach them and neither side drags anything along.

   See docs/project/ingest-queue.md. */

/**
 * One stage of the pipeline. Ordered by `STEP_ORDER` in src/pipeline.ts.
 *
 * `tweets` is in that order but **not** in `DEFAULT_INGEST_STEPS` — it is a step you
 * can ask for by name, not one a plain "add this URL" runs. See
 * docs/plans/tweet-thread-page.md#the-one-real-snag-stated-precisely.
 */
export type StepName = "fetch" | "extract" | "blocks" | "toc" | "arc" | "tweets";

export type JobStatus = "queued" | "running" | "done" | "error" | "cancelled";
export type StepStatus = "pending" | "running" | "done" | "skipped" | "error";

export interface JobStep {
  name: StepName;
  /** Present tense, naming the actual thing — "Fetching the page", never "Loading". */
  label: string;
  status: StepStatus;
  /** A short line about how it went, or how it is going. Not persisted while running. */
  detail?: string;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
  /** Run even if the artefact is already there — this is what a refresh is. */
  force?: boolean;
}

/**
 * One run of some steps against one article.
 *
 * Read the shape as a row of a future `jobs` table, the same discipline
 * `LibraryEntry` follows above — every field a scalar or a small blob a column
 * could hold. See docs/project/ingest-queue.md#when-this-becomes-postgres.
 */
export interface Job {
  id: string;
  slug: string;
  url?: string;
  /** The article's title once extraction has found one. Until then the slug is all we have. */
  title?: string;
  steps: JobStep[];
  status: JobStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  /** The failure that stopped the job, repeated from the step that raised it. */
  error?: string;
  /** Stop has been pressed and the abort has not landed yet. */
  cancelling?: boolean;
}
