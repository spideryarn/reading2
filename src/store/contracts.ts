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

import type { AdminUser } from "../admin.js";
import type { AiCallRow } from "../ai-spend.js";
import type { LookupsByTerm } from "../glossary-lookups.js";
import type { AnswerPatch, NewComment } from "../comments.js";
import type {
  Article,
  ArticleMetadata,
  ChatAnchor,
  ChatMessage,
  ChatThread,
  Comment,
  GlossaryEntry,
  GlossaryLookup,
  GlossaryFound,
  Job,
  LibraryEntry,
  LibraryHit,
  ListOptions,
  ReviewStance,
  SearchRun,
  ShelfState,
  SummariesFound,
  IdeasFound,
  ThreadFound,
  ThreadKind,
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
  loadTweets(slug: string): Promise<ThreadFound>;

  /** The glossary, plus staleness. Computed at read time, never stored. */
  loadGlossary(slug: string): Promise<GlossaryFound>;

  /** The summaries at every rung, plus staleness. */
  loadSummaries(slug: string): Promise<SummariesFound>;

  /**
   * The ideas, plus staleness. Computed at read time like the three above —
   * and against the blocks **and** the tree, which is this artefact's own
   * rule rather than a variation on theirs. src/ideas.ts § `inputFingerprint`.
   */
  loadIdeas(slug: string): Promise<IdeasFound>;
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
 * A reader's marks on one article — their bookmarks, their notes, and the
 * explanations the model wrote for them before 2026-08-28.
 *
 * **Anchored to the block identity, never to the current revision's rows.** A
 * re-extraction that drops a paragraph must not destroy the mark on it —
 * `src/web/comment-nav.ts` already sorts such a comment to the end rather than
 * dropping it, because "it is still the reader's". The Postgres adapter gets
 * this for free from the `comments_identity_fk` foreign key; the filesystem one
 * gets it for free from having no referential integrity at all. Both must
 * behave the same, and there is a test for it.
 *
 * ## Four operations, because four fields have four different lifetimes
 *
 * There used to be one writer for everything — `create`, which meant both "make
 * this" and "redo this". That was safe only while making one cost a model call
 * and the only caller was a retry. Now that a comment is free, a colliding id
 * is an *ordinary* event rather than a retry, and one reset would silently
 * overwrite somebody's anchor. So the allowed writes are named:
 *
 * | field                                | may be written by      |
 * |--------------------------------------|------------------------|
 * | `blockId`, `quote`, `start`, `createdAt` | `create` only       |
 * | `body`                               | `create`, `patchBody`  |
 * | `updatedAt`                          | `patchBody`, server-set |
 * | `threadId`                           | `linkThread`, once, from absent |
 * | `status`, `answer`, `citations`, `searches`, `model`, `error` | `beginAnswer` and `patch` |
 *
 * Every operation writes a **named allowlist**, never a spread of whatever it
 * was handed. GPT Sol's review of docs/plans/comments-and-bookmarks.md, which
 * found that "insert-only" was too blunt a rule to describe three of these.
 */
export interface CommentStore {
  load(slug: string): Promise<Comment[]>;

  /**
   * Store a **free** comment — the reader's mark on a passage. No model call.
   *
   * `status: "none"`, which is what keeps it out of `sweepOrphaned`: a bookmark
   * is not an answer that never arrived.
   *
   * **Idempotent on `input.id`, and idempotent means *return the one you have*.**
   * The client mints the id so the dialog and `?note=` have a real one from the
   * first frame. Same id with the same anchor and the same body ⇒ the stored
   * row comes back, which makes a double-clicked Save and a retried POST
   * harmless. Anything else under that id ⇒ throws `CommentIdTaken`, because
   * the alternative is overwriting a comment the reader made in another tab.
   *
   * Returns the one comment. `patch` and `remove` return the whole list. That
   * asymmetry is inherited from src/comments.ts rather than tidied: changing it
   * would mean editing routes.ts on the same day as the store, and then a bug
   * afterwards could be either.
   */
  create(slug: string, input: NewComment): Promise<Comment>;

  /**
   * Reset a legacy explanation for another attempt at the model call.
   *
   * **Takes an id and nothing else.** The anchor comes from the stored row
   * rather than from the request, which closes the hole where a retry could
   * quietly move a comment to a different passage. `body`, `updatedAt`,
   * `threadId`, the anchor and `createdAt` all survive; only the answer fields
   * go, because they belong to the attempt being replaced.
   *
   * Throws `NotAnExplanation` for an unknown id, and for a `none` comment — a
   * bookmark was never a question, and the retired explanation path must not be
   * reachable from one.
   */
  beginAnswer(slug: string, id: string): Promise<Comment>;

  /**
   * The reader edited their words. Writes `body` and `updatedAt`, nothing else.
   *
   * `null` clears the body, turning a comment back into a bare bookmark. `""`
   * never reaches here: the route trims once and turns an empty string into
   * `null`, so "wrote nothing" has one representation across both stores.
   */
  patchBody(slug: string, id: string, body: string | null): Promise<Comment>;

  /**
   * Point a comment at the conversation it started. Compare-and-set from absent.
   *
   * A second call with the same thread id is a no-op; a different one throws.
   * The id must be the one the **server** confirmed — `useChat.send` mints an
   * optimistic id and may be handed a different one back, and linking the guess
   * is a link to a thread that does not exist.
   */
  linkThread(
    slug: string,
    id: string,
    threadId: string,
    /**
     * The passage the conversation is about, which the comment must match.
     *
     * `sourceCommentId` arrives on a request, so on its own it names *any*
     * comment this reader owns on this article. Passing the anchor makes the
     * link a compare-and-set on the passage as well as on the thread, in one
     * statement rather than a read-check-write with a gap in it.
     */
    expect: { blockId: string; quote: string; start: number },
  ): Promise<Comment>;

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
    patch: AnswerPatch,
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
   * Change any of "is it on the shelf", "what do I call it" and "why am I
   * reading it", **in one write**.
   *
   * One method rather than `archive` and `rename`, and that is not tidiness. A
   * route that validated and wrote each field in turn could rename an article
   * and then answer 400 for the other field — a failed request that changed
   * your data. And two writes are two chances for a concurrent reader to see
   * half of one act. So the caller assembles the whole change and this applies
   * it atomically: one serialised file edit, or one `UPDATE`.
   *
   * An absent key means "leave it alone". `title: null` is not absent — it
   * means clear the override and go back to the extractor's title. `purpose`
   * follows the identical rule: absent leaves it, `null` clears it. `purpose`
   * is the per-article half of docs/plans/reader-profile.md — see
   * src/shelf.ts for why it lives here rather than being edited in place.
   *
   * Returns the entry as it now stands, so a caller cannot get away with
   * assuming what the write did.
   */
  patch(
    slug: string,
    change: { archived?: boolean; title?: string | null; purpose?: string | null },
  ): Promise<LibraryEntry>;

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
 *
 * **`excludeSlug` is the one thing they must agree about exactly**, because it
 * is not a matching rule — it is a promise that a named article is absent. Both
 * adapters keep it the same way: inside the query, before the cap. See
 * `LibrarySearchOptions`.
 */
export interface LibrarySearch {
  /**
   * @param query what the reader typed, raw. Each adapter parses it its own way.
   * @param limit the most hits to return. The caller says whether the answer was cut.
   * @param opts see `LibrarySearchOptions`. Absent means the whole library.
   */
  searchLibrary(
    query: string,
    limit: number,
    opts?: LibrarySearchOptions,
  ): Promise<{ hits: LibraryHit[]; capped: boolean }>;
}

/**
 * Narrowing what a library search looks at.
 *
 * **Why this is an argument and not a filter the caller applies afterwards.**
 * Chat's `search_library` tool exists to show the reader their *other* articles;
 * the one they have open is already in the prompt in full, so a hit in it is a
 * paragraph the model can see anyway and presenting it as "something else you
 * have read" is actively wrong. Removing it after the search sounds equivalent
 * and is not: the store caps the list first, so an article that supplies every
 * hit in the capped list leaves the caller with nothing while a perfectly good
 * match from another article sits one place below the cut. The tool reported
 * "nothing found" and the reader had no way to know it had been lied to.
 *
 * That was mitigated by asking for four times as many hits and filtering — a
 * fix with a hole in it, since one article can supply more than four times the
 * cap on its own. `excludeSlug` closes it rather than narrowing it, and both
 * `capped` and the hit count then mean what they say. `tests/chat-library-exclusion.test.ts`
 * is the test the mitigation could not pass.
 */
export interface LibrarySearchOptions {
  /**
   * An article to leave out of the search entirely — not out of the results.
   *
   * The same distinction archiving already makes: it is not in the index, so
   * it cannot use up a place in the list. An unknown slug is not an error; it
   * simply excludes nothing.
   */
  readonly excludeSlug?: string;
}

/* ------------------------------------------------- the reader's own state -- */

/**
 * What a stale `pending` row looks like, for both sweeps.
 *
 * **`keep` is this process's live work and `graceMs` is everybody else's.**
 * That split is the whole shape of the problem. The filesystem stores decide
 * staleness from an in-memory `Set` in `src/routes.ts`, which is exactly right
 * for one server on one disk and silently wrong the moment two processes share
 * a database: process B sees process A's live row in nobody's set and errors
 * an answer that is still arriving. On Vercel that is not an edge case, it is
 * the ordinary shape.
 *
 * So the Postgres stores take both — spare what this process is doing, and
 * spare anything young enough that some *other* process is plausibly still on
 * it. `keep` alone is a cross-process bug; `graceMs` alone would error a run
 * this very process has been streaming for four minutes.
 */
export interface SweepOptions {
  /** Ids this process is actively writing. Never swept, whatever their age. */
  readonly keep: ReadonlySet<string>;
  /**
   * How old an attempt must be before another process may declare it dead.
   * The filesystem stores ignore this — they have no attempt clock to read.
   */
  readonly graceMs: number;
}

/**
 * A conversation with the model about one article.
 *
 * ## Why this is not `src/chat.ts`'s surface, function for function
 *
 * `contracts.ts` argues elsewhere that copying today's shape is what makes
 * cutover safe, and that argument is about not *improving* things under cover
 * of a migration. These departures are different: each is a return value the
 * caller already throws away, free on a filesystem and a whole extra query in
 * SQL.
 *
 * - **`update(slug, mutate)` becomes `sweepPending`.** A callback over the
 *   whole array can only be implemented in SQL as select-everything, diff,
 *   write-everything — which is precisely the read-modify-write the table
 *   exists to delete. There is one caller and it does one thing, so the method
 *   is that thing.
 * - **`finishTurn` returns nothing.** Both call sites discard the list today,
 *   and returning it costs a full read of every thread in the article on every
 *   streamed answer.
 *
 * `begin` / `retry` / `edit` keep the thread *with its messages*, because
 * `streamChat` builds the model's history from `thread.messages.slice(0, -2)`.
 * That one is not negotiable.
 *
 * Every method takes the clock, so a parity test can drive both stores from one
 * fixed sequence and compare the wire form at every step.
 */
/**
 * A turn, and the attempt now answering it.
 *
 * `attempt` is `undefined` from the filesystem store, which has no such thing
 * and never will: the whole point of an attempt is to be compared across
 * processes, and two servers sharing one `data/` directory is a thing nobody
 * does. Under shared Postgres, multi-process is the ordinary case.
 */
export interface Turn {
  readonly thread: ChatThread;
  readonly user: ChatMessage;
  readonly reply: ChatMessage;
  readonly attempt: string | undefined;
}

export interface ChatStore {
  load(slug: string): Promise<ChatThread[]>;

  /**
   * Append a question and an empty `pending` answer, creating the thread if
   * this is its first question.
   */
  begin(
    slug: string,
    /**
     * `anchor` is applied **only when this turn creates the thread** — see
     * `withTurn` in src/chat.ts, which both stores call. An anchor for a thread
     * that already exists is refused by the route, not quietly dropped here.
     */
    turn: {
      threadId: string;
      question: string;
      anchor?: ChatAnchor;
      /**
       * Chat or review — like `anchor`, applied **only when this turn creates
       * the thread**. `withTurn` throws `ChatConflict` on one that contradicts
       * an existing thread rather than ignoring it, which is what makes the
       * rule hold under Postgres too: the route's own check runs inside
       * `inTurnOrder`, and that is per-process.
       */
      kind?: ThreadKind;
      /**
       * How much a review answer should say — written onto the **pending**
       * reply, in the same write as the question.
       *
       * `retry` and `edit` below take no stance, deliberately: theirs comes
       * from the answer they are replacing. See `ChatMessage.stance`.
       */
      stance?: ReviewStance;
    },
    now?: () => string,
  ): Promise<Turn>;

  /**
   * Patch one message in place. **Never appends**, and bumps the thread's
   * `updatedAt` whenever the *thread* matches — even if the message does not,
   * which is what the filesystem does and what the panel's ordering depends on.
   *
   * **Pass the `attempt` this answer belongs to.** A retry keeps the message
   * id, so identity cannot say which call is reporting: without the attempt, a
   * model call that a sweep already buried overwrites the retry the reader is
   * watching. The Postgres store refuses a `finish` with no attempt for exactly
   * that reason; the filesystem store has no attempts and ignores it.
   */
  finish(
    slug: string,
    threadId: string,
    messageId: string,
    patch: Partial<ChatMessage>,
    /* `| undefined` explicitly, not just `?`. `exactOptionalPropertyTypes` is
       on, and the value a caller has is `Turn.attempt`, which IS `string |
       undefined` because the filesystem store has no attempts. Writing
       `attempt?: string` would force every call site to branch on a difference
       that does not exist for them. The Postgres store is where `undefined`
       becomes an error, which is the layer that can do something about it. */
    opts?: { attempt?: string | undefined; now?: (() => string) | undefined },
  ): Promise<void>;

  /**
   * Blank the last answer so the model can have another go at the same
   * question. Throws `ChatConflict` when the client's view is stale.
   */
  retry(slug: string, threadId: string, messageId: string, now?: () => string): Promise<Turn>;

  /**
   * Rewrite a question and discard everything after it.
   *
   * `expectedTailId` is the guard, and it is the narrow answer to a real bug
   * rather than a version column: a stale tab editing an old question deletes
   * every turn added since it last looked, and today nothing notices. Naming
   * the message the client believes is last means the only edits refused are
   * the ones whose discard set has changed underneath them. `retry` has always
   * had this guard implicitly, by insisting on the thread's actual last
   * message.
   */
  edit(
    slug: string,
    threadId: string,
    messageId: string,
    question: string,
    opts?: { expectedTailId?: string; now?: () => string },
  ): Promise<Turn & { discarded: number }>;

  rename(slug: string, threadId: string, title: string): Promise<ChatThread[]>;
  remove(slug: string, threadId: string): Promise<ChatThread[]>;

  /** Turn abandoned `pending` answers into `error`. See `SweepOptions`. */
  sweepPending(slug: string, opts: SweepOptions): Promise<ChatThread[]>;
}

/**
 * "Find every passage that…", and the runs the reader has asked for.
 *
 * ## The attempt, and why `begin` hands one back
 *
 * A run is the reader's question and outlives any number of tries at answering
 * it; an **attempt** is one model call. Only the Postgres store has attempts as
 * rows, and it needs them for the reason `SweepOptions` gives: `finish` must be
 * able to say *which* call is reporting, so that a late answer from a call
 * another process already declared dead cannot land on top of the retry the
 * reader is watching. So `begin` returns an opaque attempt token, the caller
 * carries it, and `finish` presents it.
 *
 * The filesystem store returns `undefined` and ignores it, which is today's
 * behaviour exactly: fenced by identity alone.
 *
 * **`finish` returns the run or `undefined`** rather than the whole list. The
 * caller only ever did `.find(…)` on it and 404s when missing, and
 * `UPDATE … RETURNING *` answers that directly — zero rows *is* "deleted while
 * running", or "this attempt is no longer the live one".
 */
export interface SearchStore {
  load(slug: string): Promise<SearchRun[]>;

  /**
   * The fingerprint of the article **right now**, to judge a saved run against.
   *
   * A run carries the hash of the blocks it was answered over (`SearchRun.
   * sourceHash`). Comparing it against this one is what lets the panel say a
   * search is out of date — `isStale` in src/searches.ts holds the comparison,
   * so both stores share one rule as well as one hash.
   *
   * **A method rather than a field on what `load` returns**, so a caller that
   * only wants the list does not pay for a scan of every block. The read seam
   * asks for both together (`readSearches`).
   *
   * `undefined` when the article has no readable blocks. That is not "current"
   * — `isStale` counts it as stale, because not knowing and knowing it is fine
   * are different answers.
   */
  sourceHash(slug: string): Promise<string | undefined>;

  /**
   * Record a `pending` run before the model is called.
   *
   * A `wantedId` naming an existing row is a **retry only when the criterion
   * matches and that row's status is `error`** — all three, and the third is
   * the one this codebase carries a postmortem for.
   */
  begin(
    slug: string,
    criterion: string,
    wantedId?: string,
    now?: () => string,
  ): Promise<{ run: SearchRun; attempt: string | undefined }>;

  /**
   * Write the answer, if this attempt is still the live one.
   *
   * `attempt` is optional in the type because the filesystem store has none.
   * **The Postgres store refuses a call without it** rather than silently
   * falling back to identity, which would put back exactly the race the column
   * exists to close — a caller that forgets to carry the token would recreate
   * it in full, and nothing would say so.
   *
   * `patch.status` must be `done` or `error`. The attempt ends here either way,
   * so a patch that leaves the run `pending` would strip the fence off a row
   * that is still waiting for an answer.
   */
  finish(
    slug: string,
    runId: string,
    patch: Partial<SearchRun>,
    attempt?: string,
  ): Promise<SearchRun | undefined>;

  remove(slug: string, runId: string): Promise<SearchRun[]>;

  /**
   * **The reader's colour choice for one run** — `null` puts it back on auto.
   *
   * The whole list comes back, the same shape as `remove`, because a colour is
   * a property of the *set* rather than of one row: slots are assigned by
   * walking the list (`assignSlots`, src/web/hit-colours.ts), so pinning this
   * search to slot 3 can push the search that had slot 3 onto slot 4. The
   * panel does not in fact read the response — it does that walk itself, over
   * runs it already holds (src/web/useSearch.ts § recolour) — but a store
   * whose answer was one row would make any *other* caller wrong, and the two
   * writes beside this one already answer with a list.
   *
   * The number is stored and never interpreted. Neither store knows how many
   * hues there are or what they look like — see `SearchRun.colour`. Both check
   * only `isStorableColour` (src/searches.ts), and an id that names no run is
   * a no-op rather than a 404: a second tab can have deleted it.
   */
  recolour(slug: string, runId: string, colour: number | null): Promise<SearchRun[]>;

  /** Turn abandoned `pending` runs into `error`. See `SweepOptions`. */
  sweepPending(slug: string, opts: SweepOptions): Promise<SearchRun[]>;
}

/**
 * What the reader has asked the web about, one answer per glossary entry.
 *
 * Keyed by entry id, which is why the Postgres table is keyed
 * `(article_id, entry_id)` and why `save` is an upsert rather than a rewrite of
 * the map. Not a tidiness win: the file's read-modify-write is serialised only
 * *within one process*, so two servers on one database can both merge their own
 * term into the same map and one reader's answer vanishes with both writes
 * reporting success. A row per term cannot do that.
 */
export interface GlossaryLookupStore {
  load(slug: string): Promise<LookupsByTerm>;
  save(slug: string, termId: string, lookup: GlossaryLookup): Promise<LookupsByTerm>;
}

/**
 * The reader's global profile — "about you", true on every article rather
 * than on one. docs/plans/reader-profile.md is the design; src/profile.ts
 * is where the two boxes (this one and `ShelfState.purpose`) become one string
 * a prompt can carry.
 *
 * Not article-scoped, unlike everything else in this file — there is one
 * profile per reader, which today means one profile, full stop
 * (docs/project/auth.md). The filesystem adapter is a thin wrapper over
 * `loadReaderProfile` / `saveReaderProfile` in src/profile.ts, which already
 * does the normalising, capping and atomic write; the Postgres adapter is
 * `reader_profiles`, one row per `owner_id`.
 */
export interface ReaderStore {
  /** `null` when the reader has not written one yet — not a fault. */
  readProfile(): Promise<string | null>;

  /**
   * Write the profile, or clear it with `null`. Returns what was actually
   * stored (normalised), so a caller cannot get away with assuming its own
   * input survived unchanged.
   *
   * **Refused, not truncated**, past `MAX_PROFILE_CHARS` — see src/profile.ts.
   */
  writeProfile(text: string | null): Promise<string | null>;
}

/**
 * Who has signed up, and how much each of them has made.
 *
 * **The one contract in this file that is not about the reader asking**, and
 * the only one whose implementation runs a query with no owner filter on it.
 * It is a contract rather than a bare function so that the filesystem store can
 * refuse it in the same shape everything else is selected in — see
 * src/store/index.ts, where `files` gets an adapter whose only method throws.
 * There are no users on a filesystem: `data/` is one directory per slug and
 * nothing in it records that a person exists.
 *
 * Read-only, and it should stay that way. Nothing here bans, deletes or spends;
 * an admin *page* that can only look is a much smaller thing to get wrong than
 * one that can act. docs/project/admin.md § Not now.
 */
export interface AdminStore {
  /**
   * Every account that could sign in, newest sign-up first is **not** promised
   * — the page sorts, and a store that also sorted would be a second opinion
   * about the default order.
   */
  listUsersAcrossOwners(): Promise<AdminUser[]>;
}

/* ------------------------------------------------------------- sharing -- */

/**
 * `private` or `public` — **defined in [src/types.ts](../types.ts)** since
 * 2026-08-28, and re-exported here so that every file already importing it from
 * this one goes on working.
 *
 * It had to move because `ArticleMetadata` gained a `visibility` field, and that
 * is a shape the browser reads. This file reaches the whole store layer; a
 * client importing it would drag pino and `process.env` into the bundle, which
 * tests/client-imports.test.ts exists to prevent.
 */
export type { Visibility } from "../types.js";
/* Imported as well as re-exported, because the two contracts below *use* the
   name and a bare `export … from` does not bring it into this module's scope. */
import type { Visibility, VisibilityState } from "../types.js";

/**
 * What the switch answers with — **defined in [src/types.ts](../types.ts)**
 * since 2026-08-28, and re-exported here like `Visibility` beside it.
 *
 * It moved for the same reason: `ArticleMetadata` now carries one, and that is
 * a shape the browser reads. Reusing it there rather than restating it is the
 * point — the sharing card reads the toggle's reply and the page load with the
 * same line.
 */
export type { VisibilityState } from "../types.js";

/**
 * May a stranger read this article?
 *
 * **Not `guarded(...)` like the reads above it**, and the asymmetry is the same
 * one `AdminStore` has: there is a Postgres implementation and a filesystem
 * *refusal*. `data/` has one directory per slug and nowhere to record that a
 * document is shared — so the `files` side cannot be written, only declined.
 * See src/store/index.ts.
 */
export interface VisibilityStore {
  /**
   * Make it so, and say what is now true.
   *
   * **Idempotent.** Asking for the state the article is already in returns the
   * current representation and changes nothing — no new `public_at`, no second
   * event. That is what makes the change log a history rather than a count of
   * button presses.
   *
   * `rightsConfirmed` is recorded rather than checked here: the route refuses a
   * publish that does not carry it (src/routes.ts), and this records what the
   * owner said, which is the thing a complaint would ask about.
   *
   * Throws 404 for a slug this reader does not own — never 403, which would
   * confirm that somebody else's article exists.
   */
  set(slug: string, to: Visibility, rightsConfirmed: boolean): Promise<VisibilityState>;
}

/* -------------------------------------------------------- the AI ledger -- */

/**
 * What a read of the ledger came back with — the rows, **and how many lines it
 * could not read**.
 *
 * Two fields rather than one because a total nobody can tell is short is worse
 * than no total. A truncated JSONL tail or a row that will not parse has to
 * reach the report rather than quietly reduce it.
 */
export interface LedgerRead {
  rows: AiCallRow[];
  unreadable: number;
}

/**
 * **Every model call this app has paid for.** One row per call, written when the
 * call finishes and never amended.
 *
 * A contract with two implementations for the reason
 * [ai-calls-fs.ts](ai-calls-fs.ts) gives at length: the default configuration is
 * `files`, and a cost tracker that records nothing in the default configuration
 * is the worst property on offer. Neither adapter ever falls back to the other.
 *
 * The queries are deliberately thin — read a range, read one job — and every
 * total is computed in TypeScript on the way out. **One implementation of the
 * arithmetic**, rather than a `group by` in one store and a `reduce` in the
 * other quietly disagreeing about what a BYOK call is worth. The table is small
 * enough that this is not a performance question yet, and
 * docs/plans/ai-cost-tracking.md says so out loud so the day it stops being true
 * is a decision rather than a surprise.
 */
export interface CostStore {
  /** Where the rows are, for `npm run cost` to print. A path, or the table's name. */
  describe(): string;
  /** Write one finished call. Called by the spend collector's sink, never directly. */
  record(row: AiCallRow): Promise<void>;
  /**
   * Every call started in `[since, until)`. Both bounds optional, both ISO,
   * **half-open** — so two adjacent months cannot both claim the same call.
   */
  read(since?: string, until?: string): Promise<LedgerRead>;
  /**
   * Every call made by one pipeline job, across all the advances that ran it —
   * **and how much of the ledger could not be read while looking**, because a
   * job total that is short must be able to say so.
   */
  forJob(jobId: string): Promise<LedgerRead>;
  /** How big the ledger has got, in bytes, or `null` where that is not a question. */
  size(): Promise<number | null>;
}
