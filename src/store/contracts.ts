/**
 * The storage seam: what a store can be asked, with no hint of how it answers.
 *
 * **The shape is deliberately the existing `src/api.ts` surface, function for
 * function and type for type.** That is not laziness — it is the property that
 * makes the cutover safe. If the contract were "better" than what routes.ts
 * already calls, then every route would change on the same day the store
 * changed, and a bug afterwards could be either. Keeping the surface identical
 * means the Postgres adapter is a drop-in, and the only variable in the
 * experiment is the storage.
 *
 * See docs/plans/postgres-storage-implementation.md § The seams, and
 * docs/plans/postgres-migration.md for why each shape is what it is.
 *
 * ## The three seams are not one seam
 *
 * Most estimates of this migration assume `src/api.ts` is the storage layer. It
 * is the **read** layer. There are three:
 *
 * 1. `ArticleReader` — everything `src/api.ts` exports. One file to reimplement.
 * 2. `ArtifactWriter` — what the pipeline stages write. Today that is
 *    `PipelineStep.outputs(ctx): string[]`, an interface that returns **file
 *    paths**, implemented across eight stage modules. There is no single file.
 * 3. `CommentStore` and `JobStore` — reader and queue state, each with its own
 *    module and its own in-memory assumptions. Chat and searches belong to this
 *    group and have **no interface here yet**: they still write straight to the
 *    filesystem, which is why `postgres` mode currently serves them from files.
 *    That is item 10 of docs/plans/postgres-storage-implementation.md, not an
 *    oversight — but this list said `ChatStore` and `SearchStore` were declared
 *    here when they were not, which is worse than saying nothing.
 *
 * ## What is deliberately NOT in here
 *
 * `describeArticle` in src/api.ts, which turns artefacts into a `LibraryEntry`.
 * It is already pure and already documented as staying put "when the reads move
 * to SQL", so both adapters call the same function rather than each deriving a
 * word count its own way. Two implementations of one derivation is exactly the
 * divergence this migration is meant to make impossible.
 */

import type { NewComment } from "../comments.js";
import type {
  Article,
  ArticleMetadata,
  Comment,
  GlossaryEntry,
  GlossaryResponse,
  Job,
  LibraryEntry,
  LibraryHit,
  ListOptions,
  ShelfState,
  SummariesResponse,
  ThreadResponse,
} from "../types.js";

/**
 * Reading an article, in every shape the client asks for it.
 *
 * Every method takes a slug and every one of them may throw a tagged error —
 * `status: 404` for "no such article", `status: 400` for a slug that is not a
 * slug. Routes.ts turns those into responses and **the Postgres adapter must
 * tag them the same way**: an untagged throw becomes a 500, so an article that
 * simply does not exist would start reporting as a server fault. That is the
 * kind of divergence a parity test on the happy path never sees.
 */
export interface ArticleReader {
  /** Everything needed for every zoom level. 404 when there are no artefacts. */
  loadArticle(slug: string): Promise<Article>;

  /**
   * The shelf. Never throws for an empty library — that is `[]`, not a fault.
   *
   * `{ archived: true }` asks for the other half. One method rather than two,
   * so both halves come out of the same walk (or the same `SELECT`) and cannot
   * disagree with each other about what counts as an article.
   */
  listArticles(opts?: ListOptions): Promise<LibraryEntry[]>;

  /** Which stages have run. See the note on `StageState` about what this means under Postgres. */
  articleMetadata(slug: string): Promise<ArticleMetadata>;

  /** The article as a numbered thread, plus whether it still describes the article. */
  loadTweets(slug: string): Promise<ThreadResponse>;

  /** The glossary, plus staleness. Computed at read time, never stored. */
  loadGlossary(slug: string): Promise<GlossaryResponse>;

  /** The summaries at every rung, plus staleness. */
  loadSummaries(slug: string): Promise<SummariesResponse>;
}

/**
 * The two glossary writes that do not go through the pipeline, because a reader
 * asked for them rather than a stage producing them.
 *
 * Separate from `ArticleReader` because they are writes, and separate from
 * `ArtifactWriter` because the pipeline does not do them. `deleteGlossary` is
 * the odd one out in today's code too — the one write that goes through
 * `src/api.ts` — and docs/project/glossary.md says why it has to.
 */
export interface GlossaryStore {
  /** Ask the web about one term and store the answer beside the entry. */
  lookUpTerm(slug: string, termId: string, signal?: AbortSignal): Promise<{ entry: GlossaryEntry }>;

  /** Throw the glossary away so it can be regenerated. */
  deleteGlossary(slug: string): Promise<{ deleted: boolean }>;
}

/**
 * A reader's questions about one article.
 *
 * **Anchored to the block identity, never to the current revision's rows.** A
 * re-extraction that drops a paragraph must not destroy the question about it —
 * `src/web/comment-nav.ts` already sorts such a comment to the end rather than
 * dropping it, because "it is still the reader's question". The Postgres
 * adapter gets this for free from the `comments_identity_fk` foreign key; the
 * filesystem one gets it for free from having no referential integrity at all.
 * Both must behave the same, and there is a test for it.
 */
export interface CommentStore {
  load(slug: string): Promise<Comment[]>;

  /**
   * Store a comment as `pending`, **before** the model is called, so a crash
   * leaves a question that never got answered rather than a selection that
   * quietly evaporated.
   *
   * **Idempotent on `input.id`.** The client mints the id so the dialog and
   * `?note=` have a real one from the first frame; a retry sends the id it
   * already has, and that must RESET the existing comment rather than append a
   * second one. A second row would leave the failed original behind, drawing a
   * second mark over the same words that nothing can clear — and would make a
   * double-clicked POST a way to spend two model calls and orphan one.
   *
   * Returns the one comment. `patch` and `remove` return the whole list. That
   * asymmetry is inherited from src/comments.ts rather than tidied: changing it
   * would mean editing routes.ts on the same day as the store, and then a bug
   * afterwards could be either.
   */
  create(slug: string, input: NewComment): Promise<Comment>;

  /**
   * Fill in the answer, or the error.
   *
   * `quiet` suppresses the per-comment log line, for the sweep that patches
   * every orphan with the same reason — one line each would say one thing N
   * times, and N is unbounded while Vercel allows 256 lines per request.
   */
  patch(
    slug: string,
    id: string,
    patch: Partial<Comment>,
    opts?: { quiet?: boolean },
  ): Promise<Comment[]>;

  remove(slug: string, id: string): Promise<Comment[]>;

  /** For the library card and the metadata page: a count, never the comments. */
  count(slug: string): Promise<number>;
}

/**
 * The ingest queue's records.
 *
 * The interface a Postgres implementation has to satisfy is wider than the
 * filesystem one's, and the difference is the whole point: `claim` exists
 * because more than one server process can run. Today's queue is a p-queue and
 * an in-memory Map, which cannot survive a second instance — see
 * docs/project/ingest-queue.md.
 */
export interface JobStore {
  list(): Promise<Job[]>;
  get(id: string): Promise<Job | undefined>;
  create(job: Job): Promise<Job>;
  /** Patch a job. Fenced by `attemptId` so a stale worker cannot overwrite a newer state. */
  update(id: string, patch: Partial<Job>, attemptId?: string): Promise<Job>;

  /**
   * Take the next queued job, if this process may run one.
   *
   * **Concurrency 1 globally**, which `SELECT … FOR UPDATE SKIP LOCKED LIMIT 1`
   * does NOT give you — that lets two workers claim two *different* queued
   * jobs. The singleton `queue_state` row, locked `FOR UPDATE`, is the
   * guarantee. Returns `undefined` when another worker holds the queue.
   */
  claim(attemptId: string, leaseMs: number): Promise<Job | undefined>;

  /** Extend the lease of a job this process is running. */
  heartbeat(id: string, attemptId: string, leaseMs: number): Promise<boolean>;

  /** Return jobs whose lease expired mid-run to the queue, or fail them. */
  rescueExpired(): Promise<number>;
}

/**
 * What the reader has done to the card: archived it, renamed it, opened it.
 *
 * A store of its own rather than three more methods on `ArticleReader`, because
 * these are **writes**, and the one thing the read seam has going for it is
 * that it cannot change anything. See src/shelf.ts for why a renamed title is
 * an override rather than a rewrite.
 */
export interface ShelfStore {
  /** What the reader has done to this card. Never throws for an untouched one. */
  read(slug: string): Promise<ShelfState>;

  /**
   * Change one or both of "is it on the shelf" and "what do I call it", **in one
   * write**.
   *
   * One method rather than `archive` and `rename`, and that is not tidiness. A
   * route that validated and wrote each field in turn could rename an article
   * and then answer 400 for the other field — a failed request that changed
   * your data. And two writes are two chances for a concurrent reader to see
   * half of one act. So the caller assembles the whole change and this applies
   * it atomically: one serialised file edit, or one `UPDATE`.
   *
   * An absent key means "leave it alone". `title: null` is not absent — it
   * means clear the override and go back to the extractor's title.
   *
   * Returns the entry as it now stands, so a caller cannot get away with
   * assuming what the write did.
   */
  patch(slug: string, change: { archived?: boolean; title?: string | null }): Promise<LibraryEntry>;

  /**
   * One more open.
   *
   * Returns nothing. This is fire-and-forget from the client's point of view,
   * and a response body would only invite somebody to render a counter that is
   * one behind.
   */
  recordOpen(slug: string): Promise<void>;
}

/**
 * Finding a passage anywhere in the library — the home page's search box.
 *
 * Deliberately NOT `findPassages` (src/search.ts), which is one article, one
 * model call and a confidence score. This one is a text index: free, instant,
 * and with nothing to be uncertain about.
 *
 * **The two adapters do not agree, and a parity test over this would be wrong
 * to demand that they do.** This said they agreed on the *set* of block ids for
 * a single-word query. That was false, and a cross-family review caught it:
 * Postgres matches English lexemes, so `writes` finds "writing" and "write-nots"
 * and `the` finds nothing at all (a stop word); the filesystem adapter matches
 * substrings, so it finds `the` inside "theory" and misses every inflection.
 * They disagree on single words, which was exactly the case the old claim
 * called safe.
 *
 * What they DO share is written down and is what a test may hold them to: an
 * exact word that appears verbatim, is not a stop word, and has no inflections
 * in the corpus is found by both, in the same blocks. Ranking is never
 * comparable. See docs/plans/library-shelf-actions-and-search.md.
 */
export interface LibrarySearch {
  /**
   * @param query what the reader typed, raw. Each adapter parses it its own way.
   * @param limit the most hits to return. The caller says whether the answer was cut.
   */
  searchLibrary(query: string, limit: number): Promise<{ hits: LibraryHit[]; capped: boolean }>;
}
