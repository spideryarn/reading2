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

/* --------------------------------------------------------------- glossary --
   Stage 5d: the terms this piece uses in a non-obvious way, defined from the
   piece itself. `data/<slug>/glossary.json`, and a **mode** in the band between
   the spine and the prose rather than a page of its own.

   Two of these fields exist because of bugs in the version this was borrowed
   from — `aliases` and `blocks`. See docs/project/glossary.md, and
   docs/project/original-version/glossary.md for what went wrong over there. */

/**
 * What sort of thing an entry is.
 *
 * Shorter than theirs, which had eleven values including both `concept` and
 * `definition` — a distinction nobody could apply consistently, and the model
 * did not. `date` went too: a date is not a term a glossary explains, and
 * anything worth an entry is the *event* on that date.
 *
 * Anything the model returns that is not in this list becomes `other` rather
 * than failing the parse. A glossary of thirty good entries must not be thrown
 * away because one of them came back as `"technology"`.
 */
export type GlossaryKind =
  | "person"
  | "place"
  | "organization"
  | "event"
  | "work"
  | "concept"
  | "term"
  | "other";

/**
 * One term, and what this piece means by it.
 *
 * **`aliases` is the field that makes the feature work at all**, and it is the
 * one their prompt got exactly right: *"Try to make the aliases distinctive, so
 * that a regex using the aliases finds all and only references to the entity
 * (if possible)."* That is a concrete, testable target for something prompts
 * usually hand-wave, and `blocks` below is what tests it.
 *
 * **`blocks` is computed by us, never by the model.** It is every block whose
 * text uses the name or one of the aliases, in document order, found by
 * `findOccurrences` in src/glossary.ts. Asking the model for block ids would
 * invite it to invent them; matching the text cannot. Three things fall out of
 * that one choice: the panel can jump the article to a term, the prose can
 * underline it while it is selected, and an entry whose `blocks` is **empty** is
 * visible as what it is — a term the model named that this article does not
 * actually use in those words.
 */
export interface GlossaryEntry {
  /** Minted by `mintId`, so it is a block id by construction and `?term=` validates for free. */
  id: string;
  /**
   * The canonical form, in their prompt's words *"the canonical and unambiguous
   * way to refer to it (usually the longest or official form, e.g. \"United
   * States of America\" rather than \"America\")"*.
   *
   * Which is also what the dedup rule preserves: where two entries collide, the
   * **richer** name survives and the poorer one becomes an alias of it. Theirs
   * kept whichever appeared first in the document, which systematically deleted
   * the more specific phrase — see src/glossary.ts § `dedupe`.
   */
  name: string;
  kind: GlossaryKind;
  /** Other forms the piece uses. Never includes `name`; lower-cased and de-duplicated. */
  aliases: string[];
  /**
   * What **this author** means by the term, where the sentences around it do
   * not give it to you: the narrowed sense, the coinage, the ordinary word
   * bent. From the article and only the article.
   *
   * **Absent is a real answer**, and the most important one this field has. A
   * person simply quoted, a work simply named — the article's use of those is
   * plain once you know what the thing is, and an entry that restates it is a
   * description of a page the reader is looking at. That was the Lamport bug:
   * see docs/plans/glossary-entries-worth-reading.md.
   *
   * Plain text, never Markdown.
   */
  senseHere?: string;
  /**
   * What the reader has to bring **to** the piece — who this person is, what
   * this work or event is, what the term ordinarily means outside this
   * article. The model's own knowledge, and labelled as such in the panel.
   *
   * Two or three facts that make *this* article's use of it land, not a
   * biography. Absent when the model does not know: an entry with only a
   * `senseHere` is visibly missing its background, where a plausible invented
   * one is not.
   */
  background?: string;
  /**
   * **Superseded on 2026-08-26, and still read.** The single blended prose
   * field `senseHere` and `background` replaced, kept because artefacts
   * written before that date have it and the panel renders them unchanged
   * until somebody regenerates. Never written by a `glossary/2` pass.
   */
  gloss?: string;
  /** Superseded with `gloss`, and read for the same reason. */
  detail?: string;
  /** Validated as a real URL at build time, and dropped rather than trusted if it isn't one. */
  url?: string;
  /**
   * 0–1, the model's own judgment, and **never the order the list is in**.
   *
   * Greg's call, 2026-08-25: keep both numbers, list in document order, and let
   * the reader choose to sort. The middle option of three — our own review of
   * the original recommended dropping them outright, on the grounds that
   * ranking terms by importance is the model doing the reader's prioritising
   * (vision.md § Principles). Keeping them but never sorting by them silently
   * is the answer to that: the ranking is available and it is asked for.
   */
  difficulty?: number;
  centrality?: number;
  /**
   * **Superseded on 2026-08-26, and still read** — same as `gloss` above.
   *
   * It was a boolean over a blob: true when *any part* of the entry drew on
   * knowledge outside the article. The failure that retired it is that a flag
   * over prose has no dose and no location — it fired on the Lamport entry,
   * whose two sentences contained nothing from outside at all, and when it
   * fires correctly it still cannot say *which two words*.
   *
   * What replaced it is not a better flag. It is the field split: `senseHere`
   * is from the article, `background` is not, and the labels on those two
   * sections answer "which bits" exactly. Provenance the model **writes into**
   * rather than **reports about** — see
   * docs/plans/glossary-entries-worth-reading.md § Provenance is structural.
   */
  fromOutside?: boolean;
  /**
   * What came back when the reader asked us to check this term on the web.
   *
   * **Absent until somebody presses the button**, and that is the design rather
   * than a limitation. The batch call that writes an entry does not search: it
   * is one call over a whole article, already capped and paginated because
   * output tokens caused 504s in the previous version, and a dozen serialised
   * searches inside it would spend money on entries nobody opens. So the web is
   * per entry, reader-initiated, and its result lands here beside the
   * remembered `background` rather than replacing it — *checked* has to stay
   * visibly different from *remembered*.
   *
   * See docs/plans/glossary-entries-worth-reading.md § The web.
   */
  lookup?: GlossaryLookup;
  /** Every block that uses this term, in document order. Found by us. Empty is meaningful. */
  blocks: BlockId[];
}

/**
 * One answer from the web, and where it came from.
 *
 * The same four fields a `Comment` stores, because it is the same call — see
 * `explain` in src/explain.ts. That is not a coincidence being exploited: our
 * review of the version this was borrowed from argued a glossary should be *the
 * same mechanism as comments with a different prompt* rather than a second
 * system, and docs/project/glossary.md § What is still open has been carrying
 * that as an open question since the feature landed. This is the first half of
 * it paid off.
 */
export interface GlossaryLookup {
  answer: string;
  /** What the model actually cited. Every URL passed `safeUrl` before it was stored. */
  citations: Citation[];
  /**
   * How many web searches the model chose to run — **`0` is a real answer**,
   * not a missing one. The model decides per call, so an answer with no
   * searches means it judged it already knew, and the panel says so rather than
   * leaving the reader to guess which kind of answer they are looking at.
   */
  searches: number;
  model: string;
  /** ISO 8601. An answer is about the web on the day it was asked. */
  at: string;
}

/**
 * The article's glossary. Stage 5d, `data/<slug>/glossary.json`.
 *
 * Generated on demand rather than as part of every ingest — `glossary` is in
 * `STEP_ORDER` but not in `DEFAULT_INGEST_STEPS` (src/pipeline.ts).
 */
export interface Glossary {
  version: string;
  generator: string;
  slug: string;
  /** Fingerprint of the blocks it was written from — `hashBlocks`, src/source-hash.ts. */
  sourceHash: string;
  /**
   * In document order: first use in the article first.
   *
   * The reader's own order through the piece, which is a real order rather than
   * a judgment. Sorting by difficulty or centrality is a thing the panel offers
   * and the reader chooses; it is not what is stored.
   */
  entries: GlossaryEntry[];
  /**
   * How many model calls have contributed to this list.
   *
   * **The whole reason this feature paginates.** Extraction in the original
   * version hit 504s in production, and the cause was not the article going in
   * — it was the number of **output** tokens coming back, because every entry
   * carries two explanations. Their fix was a cap per call plus a "Load More"
   * that feeds the existing entries back so the model does not repeat itself.
   * Ours is the same shape: "Find more terms" runs another pass and appends.
   * See docs/project/original-version/glossary.md § Bug one.
   */
  passes: number;
  generatedAt: string;
  /** Total across every pass. Timed from outside the SDK, whose own timings came back empty. */
  elapsedMs: number;
}

/**
 * What `GET /api/glossary/:slug` returns.
 *
 * `stale` for the same reason `ThreadResponse` carries one, and computed the
 * same way at read time: a flag stored at generation time is right until the
 * moment it matters.
 */
export interface GlossaryResponse {
  glossary: Glossary;
  stale: boolean;
  /**
   * The list was written by an older version of the prompt — a different fact
   * from `stale`, and it needed its own field because it needs its own
   * sentence. `stale` means *the article moved underneath these terms*;
   * `outdated` means *the article is the same and we would write these
   * differently now*.
   *
   * **It is here because it was briefly nowhere.** `isStale` compares source
   * hashes and nothing else, so bumping `PROMPT_VERSION` for `glossary/2` did
   * not make one single glossary read as stale — the panel went on showing an
   * old list with no banner and no offer to rewrite it, while the plan that
   * bumped the version claimed the opposite. Found in review; see
   * docs/plans/glossary-entries-worth-reading.md § What review caught.
   */
  outdated: boolean;
}

/* -------------------------------------------------------------- summaries --
   The article, and each of its parts and sections, at more than one length —
   `data/<slug>/summary.json`, and a **mode** in the band between the spine and
   the prose. Stage 5e. See docs/project/summaries.md.

   The shape is the original version's, taken deliberately: a **named length
   ladder** rather than a token count, generated for every rung in one call
   rather than one call per rung. What is not theirs is where the ladder is
   wired. They generated nine granularities of the whole document and showed one
   hardcoded rung in one tooltip; here every level of the tree carries the
   ladder, which is the gap their own docs record
   (docs/project/original-version/summaries.md). */

/**
 * A rung of the ladder, above the gist.
 *
 * `gist` is not in here on purpose: it is one sentence, it lives on the tree
 * node (stage 4), and nothing about it is this stage's to write. The panel
 * offers it as the shortest rung by reading the tree, so the ladder the reader
 * sees has three steps while only two are generated.
 *
 * **Named, not numbered, and the steps are not even.** One sentence, then a few
 * sentences, then a paragraph or more. That unevenness is a finding rather than
 * a shrug — theirs ran 10, 15, 25, 30, 50, 100, 200, 400, 800 tokens, fine at
 * the bottom and geometric at the top, because the difference between a phrase
 * and a sentence changes what a line can *do* while the difference between two
 * long summaries is just more of the same.
 */
export type SummaryRung = "short" | "long";

/**
 * One node's summaries, anchored the way the arc is: **by block range, never by
 * node id.**
 *
 * Node ids are positional, so a re-run of `npm run toc` renumbers them and
 * every summary would silently move one node sideways — a plausible paragraph
 * against the wrong section, which is a lie the reader has no way to detect.
 * A range that no longer matches a node is dropped instead. Same rule, and the
 * same reasoning, as `ArcEntry` above.
 */
export interface SummaryEntry {
  /** Inclusive, contiguous — resolved through the blocks index, never by string compare. */
  range: [BlockId, BlockId];
  /** The depth of the node this was written for. Kept for the panel's indentation. */
  depth: number;
  /** A few sentences. Absent when the batch that should have carried it came back malformed. */
  short?: string;
  /** A paragraph for a section, more for a part, about a page for the whole piece. */
  long?: string;
}

/**
 * The article's summaries. Stage 5e, `data/<slug>/summary.json`.
 *
 * Generated on demand rather than as part of every ingest — `summary` is in
 * `STEP_ORDER` but not in `DEFAULT_INGEST_STEPS` (src/pipeline.ts), for the
 * same reason `tweets` and `glossary` are not.
 */
export interface Summaries {
  version: string;
  generator: string;
  slug: string;
  /** Fingerprint of the blocks it was written from — `hashBlocks`, src/source-hash.ts. */
  sourceHash: string;
  /** Document order, coarse before fine — the order the panel renders them in. */
  entries: SummaryEntry[];
  /**
   * What the reader asked these summaries to lean towards, if they asked
   * anything.
   *
   * Kept on the artefact rather than only in the request, so that a summary
   * written to a steer **says so**. A steered summary that looks like an
   * ordinary one is a summary the reader cannot weigh, and the whole risk of
   * the feature is that a request quietly bends what the article is reported
   * to say (src/summarise.ts § IF THE READER ASKS FOR SOMETHING IN PARTICULAR).
   * It is also what the panel puts back in the box next time.
   */
  guidance?: string;
  /**
   * Nodes whose batch came back unusable and were written without text.
   *
   * **Counted rather than hidden, because their version discarded eight good
   * summaries when the ninth was malformed.** Salvaging partials is the fix;
   * the number is what stops a half-empty artefact reading as a complete one.
   */
  missing: number;
  generatedAt: string;
  /** Timed from outside the SDK, whose own timing fields came back empty over there. */
  elapsedMs: number;
}

/**
 * What `GET /api/summary/:slug` returns.
 *
 * `stale` for the same reason `GlossaryResponse` carries one, and computed the
 * same way at read time: a flag stored at generation time is right until the
 * moment it matters.
 */
export interface SummariesResponse {
  summaries: Summaries;
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
  /**
   * How many questions have been asked about this article.
   *
   * A count and not the comments themselves, and that distinction is the whole
   * point: the metadata page must NOT fetch the comments (docs/plans/metadata-page.md
   * § The shell — `useComments` fetches on mount, so sharing it would buy a
   * drawer nobody opened). But this endpoint is already walking this article's
   * directory, so one more read answers "7 questions asked" for free, and the
   * page gets the line its plan sketched without paying for the drawer.
   */
  comments: number;
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
 * `tweets`, `glossary` and `summary` are in that order but **not** in
 * `DEFAULT_INGEST_STEPS` — they are steps you can ask for by name, not ones a
 * plain "add this URL" runs. Each costs model calls over the whole article and
 * each belongs to a page or a mode you have to go to. See
 * docs/plans/tweet-thread-page.md#the-one-real-snag-stated-precisely,
 * docs/project/glossary.md and docs/project/summaries.md.
 */
export type StepName =
  | "fetch" | "extract" | "blocks" | "toc" | "arc" | "tweets" | "glossary" | "summary";

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
  /**
   * A free-text steer for the steps that take one. Only `summary` does today.
   *
   * On the job rather than in a step's own options because the queue is what
   * survives a restart, and a job resumed from disk with its guidance dropped
   * would run the plain prompt and report success — the reader's steer silently
   * not applied, with a green tick over it.
   *
   * It is part of what makes two jobs different work: see `sameWork` in
   * src/jobs.ts, where leaving it out would let a second, differently-steered
   * request be answered with the first one's job.
   */
  guidance?: string;
}

/* ------------------------------------------------------------------ chat --
   A conversation about one article. Reader state, so it lives beside the
   article in `data/<slug>/chat.json` exactly as comments.json does.

   See docs/plans/chat-mode.md, and note the one rule that separates this from
   the chatbot vision.md names as an anti-goal: **an assistant message must
   carry block ids**, so every claim has a way back to the passage it came
   from. That contract is enforced in the prompt (src/converse.ts) and rendered
   as clickable chips (src/web/ChatPanel.tsx). */

/**
 * One turn of a conversation.
 *
 * `status` exists on assistant messages for the same reason it exists on a
 * Comment: the row is written to disk *before* the model is called, so a crash
 * mid-answer leaves a visible unfinished turn rather than a question that
 * silently evaporated. A user message is `done` the moment it is stored.
 */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  status: "pending" | "done" | "error";
  /** Web pages the model cited, when it chose to search. Assistant turns only. */
  citations?: Citation[];
  /** How many web searches it ran. 0 means it answered from the article. */
  searches?: number;
  model?: string;
  error?: string;
  /**
   * The reader pressed stop, so this answer is short on purpose.
   *
   * A flag rather than a fourth `status`, and the distinction is the whole
   * point: a stopped answer is `done`. It is not a failure — nothing went
   * wrong, the reader had read enough — so it must not render as one, and it
   * must not be swept, retried, or apologised for. What it does need is to say
   * so, because an answer that ends mid-sentence with nothing to explain it
   * reads exactly like a bug.
   *
   * Assistant turns only. Kept in the history sent back to the model: it said
   * those words, and pretending otherwise would have it contradict itself.
   */
  stopped?: boolean;
  /**
   * When the reader last rewrote this message. User turns only.
   *
   * Editing a question discards every turn after it and asks again, so this is
   * the only trace that the conversation above once went somewhere else. The
   * old text is **not** kept — see docs/plans/chat-mode.md § Editing a question.
   */
  editedAt?: string;
}

/**
 * One conversation, and there may be several per article.
 *
 * `title` is derived from the first thing the reader typed rather than asked
 * for — a dialog demanding a name before the first question is a tax on
 * starting, and a list of "Untitled" is worse than a list of opening lines.
 * It can be renamed afterwards.
 */
export interface ChatThread {
  id: string;
  title: string;
  createdAt: string;
  /** Bumped on every stored message, so the list can show recent first. */
  updatedAt: string;
  messages: ChatMessage[];
}

/* ---------------------------------------------------------------- search --
   Finding a passage by what it says. Reader state, so a saved search lives
   beside the article in `data/<slug>/searches.json`, exactly as comments.json
   and chat.json do.

   See docs/project/search.md. Note that only the *meaning* half of the feature
   has a stored shape at all: matching on the letters you typed happens in the
   browser, costs nothing, and is fully described by `?find=` in the URL. There
   is nothing to persist about a substring match, and a stored one would be a
   cache of an instant computation. */

/**
 * One passage the model says matches the reader's criterion.
 *
 * The anchor is `blockId` plus `quote` — id first, text second, offsets never —
 * which is the contract in docs/project/block-ids.md and the same one a
 * `Comment` follows. `start` is a *hint* for choosing between repeats of the
 * same words within one block, and it is measured in `block.text`'s offset
 * space because that is the string the server can see; the client re-finds the
 * quote in the rendered text rather than trusting it (src/quote-match.ts).
 */
export interface SearchHit {
  blockId: BlockId;
  /** The exact words the model pointed at, inside that block. */
  quote: string;
  /**
   * How sure the model is, **0–100, integer, and one unit everywhere**.
   *
   * The version this is borrowed from had a genuine bug here: its API documented
   * this field as 0–1 and its highlighting code read it as 0–100, so somewhere
   * between fetch and render there was an undocumented conversion
   * (docs/project/original-version/highlighting.md). A unit that changes
   * silently as it crosses a boundary is a bug waiting for someone to move a
   * line of code, so this one is stated on the type, enforced in src/search.ts,
   * and never rescaled anywhere else.
   */
  confidence: number;
  /** One line on why this passage matches. Shown in the list, under the quote. */
  reasoning: string;
  /** Where `quote` sat in `block.text` — a disambiguator, never the anchor. */
  start?: number;
}

/**
 * One meaning-search: what the reader asked for, and what came back.
 *
 * `status` exists for the reason it exists on a `Comment`: the row is written
 * to disk *before* the model is called, so a crash mid-search leaves a visible
 * unfinished run rather than a criterion that silently evaporated.
 */
export interface SearchRun {
  id: string;
  /** What the reader typed, in their own words. Never logged — it is prose. */
  criterion: string;
  createdAt: string;
  status: "pending" | "done" | "error";
  hits: SearchHit[];
  model?: string;
  error?: string;
}
