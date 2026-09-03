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
 * See docs/plans/260826e-postgres-storage-implementation.md § The seams, and
 * docs/plans/260825f-postgres-migration.md for why each shape is what it is.
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
 * 3. `CommentStore` and the queue's `JobStore` — reader and queue state, each
 *    with its own module and its own in-memory assumptions. The queue's half
 *    has since landed, and its contract lives in [jobs.ts](jobs.ts), not here:
 *    a second `JobStore` was declared in this file and never implemented, so it
 *    drifted into declaring a different `claim`, `get` and expiry sweep from the
 *    real one, and it has been deleted. Chat and searches belong to this
 *    group and have **no interface here yet**: they still write straight to the
 *    filesystem, which is why `postgres` mode currently serves them from files.
 *    That is item 10 of docs/plans/260826e-postgres-storage-implementation.md, not an
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
import type { DocumentKind } from "../fetch.js";
import type { SpokenTurn } from "../chat.js";
import type { AiCallRow } from "../ai-spend.js";
import type { LookupsByTerm } from "../glossary-lookups.js";
import type { AnswerPatch, MarkPatch, NewComment } from "../comments.js";
import type { ClaimsRun } from "../referee-claims.js";
import type { RefereeCriterionConfig } from "../referee-criteria.js";
import type { SavedCriterion } from "../saved-criteria.js";
import type {
  AdminFeedbackDetail,
  AdminFeedbackPage,
  Article,
  ArticleMetadata,
  ChatAnchor,
  ChatMessage,
  ChatThread,
  Comment,
  FeedbackCursor,
  FeedbackDiagnostics,
  FeedbackEnvironment,
  FeedbackKind,
  GlossaryEntry,
  GlossaryLookup,
  GlossaryFound,
  QuotesFound,
  LibraryEntry,
  LibraryHit,
  ListOptions,
  RememberStance,
  SearchRun,
  ShelfState,
  ArcFound,
  IdeasFound,
  IllustratedFound,
  SketchFound,
  QuizFound,
  TimelineFound,
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
/**
 * **The document an article was made from, ready to be handed back.**
 *
 * `null` from `loadSource` means *this article kept no source document* — an
 * ordinary state, and a 404. It does **not** mean the bytes could not be found:
 * a revision that names a stored object and cannot produce it is a broken
 * invariant, and the adapter throws (`MissingRawObject` / `CorruptRawObject` in
 * src/store/raw-document.ts, both `status: 500`). Collapsing the two would tell an
 * owner their paper never existed because a bucket was misconfigured. GPT Sol
 * made this the third of four blockers on the plan, 2026-08-31.
 */
export interface RawSource {
  bytes: Uint8Array;
  /**
   * **The recorded kind, not a sniffed one**, wherever a record exists.
   *
   * It decides the `Content-Type`, and `raw_content_type` cannot: that column is
   * the *origin's* header, so a perfectly good PDF fetched as
   * `application/octet-stream` would be served as one — with `nosniff` set, which
   * means the browser will not rescue it. GPT Sol, 2026-08-31.
   */
  kind: DocumentKind;
  /**
   * What the reader called the file when they uploaded it, if they uploaded it.
   *
   * Reader-controlled text on its way into a response header, so whoever builds
   * the `Content-Disposition` escapes it — see `contentDisposition` in
   * src/routes.ts. Absent for anything we fetched.
   */
  filename: string | null;
}

export interface ArticleReader {
  /** Everything needed for every zoom level. 404 when there are no artefacts. */
  loadArticle(slug: string): Promise<Article>;

  /**
   * **The raw document this article was made from**, or `null` if it kept none.
   *
   * The one read whose answer is bytes rather than JSON, and the one the reading
   * view's *"view the original"* control is behind. Each adapter answers from
   * where **its own** store keeps them and never from the other's: the
   * filesystem one from `data/<slug>/`, the Postgres one from the object store
   * the revision names. (It used to fall back, inside itself, to a legacy
   * `raw_bytes` column for rows written before references existed; that column
   * was dropped on 2026-09-01.) A Postgres deployment
   * reaching for a local file is how this feature spent its life 404ing on
   * Vercel while working on a laptop.
   */
  loadSource(slug: string): Promise<RawSource | null>;

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

  /**
   * The quotes, plus staleness.
   *
   * Computed at read time like the rest, and `stale` matters more here than
   * anywhere else in the band: a stale quote list holds block ids that may no
   * longer exist *and* words that may no longer be in the piece, so it is the
   * one artefact whose staleness can make it false rather than merely dated.
   * src/quotes.ts § `isStale`.
   */
  loadQuotes(slug: string): Promise<QuotesFound>;


  /**
   * The ideas, plus staleness. Computed at read time like the three above —
   * and against the blocks **and** the tree, which is this artefact's own
   * rule rather than a variation on theirs. src/ideas.ts § `inputFingerprint`.
   */
  loadIdeas(slug: string): Promise<IdeasFound>;

  /**
   * The Sketch picture, plus whether it still describes the article.
   *
   * Staleness is answered exactly as `loadIdeas` answers it — at read time,
   * against the blocks **and** the tree — because the two artefacts are
   * fingerprinted the same way and for the same reason: both prompts show the
   * model the outline before the article.
   *
   * **`stale` here is softer than it is anywhere else**, and the panel is meant
   * to treat it that way. A stale glossary entry points at a paragraph that has
   * gone; a stale sketch is a picture that is still a fair account of an
   * argument which has not changed, drawn over an article whose ids have. It
   * keeps its shape and loses the clicks that no longer resolve, which is
   * `readSketch`'s job on arrival. So: a note, not a refusal to draw.
   */
  loadSketch(slug: string): Promise<SketchFound>;

  /**
   * The Illustrated plates, plus whether they still paint the current Sketch.
   *
   * **Staleness is answered against the SKETCH, not the article**, and this is
   * the only read here that is like that. src/illustrated.ts §
   * `inputFingerprint` has the reasoning; the consequence for an adapter is
   * that it needs the `sketch` alongside the `illustrated`, and needs neither
   * the blocks nor the tree to answer the question its neighbours all use them
   * for.
   *
   * **It is stale if the Sketch itself is stale, too.** A picture painted from
   * a Sketch that has since gone stale is two hops from the article, and
   * reporting it current because nobody has pressed the Sketch button would be
   * the most confident wrong answer in the mode.
   */
  loadIllustrated(slug: string): Promise<IllustratedFound>;

  /**
   * The timeline, plus whether it still describes the article.
   *
   * Staleness is answered as `loadIdeas` answers it — at read time, against the
   * blocks and the tree — **and against one thing no other artefact is judged
   * on: the publication date** (src/timeline.ts § `inputFingerprint`). That is
   * not defensive. The date is the reference frame a year-less "on July 7" is
   * read against, so a publisher re-dating a post changes almost every row of
   * this artefact and not one word of any other.
   *
   * `TimelineFound` has **two** staleness facts where its neighbours have
   * three: there is no `profileChanged`, because this stage was never written
   * for a profile. Who is reading changes what an *idea* is; it does not change
   * when something happened.
   */
  loadTimeline(slug: string): Promise<TimelineFound>;

  /**
   * The questions the piece can ask you back, plus whether they still describe
   * the article.
   *
   * Staleness is answered as `loadIdeas` answers it — at read time, against the
   * blocks, the tree and the **cited** metadata head, because this stage sends
   * `articleWithIds`. Not against the publication date: no date appears in this
   * prompt, so hashing one would spend a paid model call every time a publisher
   * re-dated a post.
   *
   * `QuizFound` has **two** staleness facts where most of its neighbours have
   * three: there is no `profileChanged`, because this stage was not written for
   * a profile. That is a deferral rather than a judgement that a profile would
   * be wrong here — how hard a question is really does depend on who is reading
   * — and it costs no migration to reverse, because `profileHash` would be a
   * field on the JSON artefact.
   * docs/plans/260831al-review-quiz-sub-mode.md § No profile in v1.
   *
   * **Owner-only, and there is no public twin.** A quiz is a private activity,
   * and a record of what somebody did not know is the most private thing in
   * this app after a selection. `timeline` made the same call.
   */
  loadQuiz(slug: string): Promise<QuizFound>;

  /**
   * The arc, plus whether it still describes the article.
   *
   * **A read of its own since 2026-08-29, when the arc stopped being built by
   * every ingest.** The arc still travels inside the article payload for a
   * reader who has one; this is for the reader who does not, and has just asked
   * for it. Refetching `/api/article/:slug` to collect one small artefact
   * re-reads every block and the whole tree — the cost
   * docs/plans/260827am-glossary-read-latency.md was written about.
   *
   * Staleness is computed here at read time, like the four above, and against
   * the blocks, the tree **and** the metadata (src/arc.ts § `inputFingerprint`).
   */
  loadArc(slug: string): Promise<ArcFound>;
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
 * ## Five operations, because five fields have five different lifetimes
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
 * | `criterionId`, `valence`             | `create`, `patchMark`  |
 * | `updatedAt`                          | `patchBody`, `patchMark`, server-set |
 * | `threadId`                           | `linkThread`, once, from absent |
 * | `status`, `answer`, `citations`, `searches`, `model`, `error` | `beginAnswer` and `patch` |
 *
 * Every operation writes a **named allowlist**, never a spread of whatever it
 * was handed. GPT Sol's review of docs/plans/260828a-comments-and-bookmarks.md, which
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
   *
   * ## It also claims an abandoned attempt, which is what makes Retry work
   *
   * A `pending` row whose attempt is **over** — the lease has run out, or there
   * never was one — is claimed here, atomically, in the same statement that
   * refuses a live one. Without that, healing an abandoned comment needed the
   * sweep, the sweep runs only on the comments `GET`, and *Try again* posts
   * straight to the answer endpoint: so a reader whose answering machine died
   * got a 409 from every retry until they reloaded the page. GPT Sol,
   * 2026-09-01. "No lease at all" counts as over for the reason `sweepPending`
   * below gives: an imported row, or one begun before the column existed, and
   * either way its process is long gone.
   *
   * ## The attempt token
   *
   * `undefined` from the filesystem store, which has one process and needs no
   * fence — see `beginAnswer` in src/comments.ts for why that is a property of
   * that store rather than a weaker version of this one. From Postgres it is
   * the row's `attempt_id`, and it has to be carried to `patch`: without it a
   * model call this sweep already buried can land on top of the retry the
   * reader is watching arrive.
   */
  beginAnswer(slug: string, id: string): Promise<{ comment: Comment; attempt: string | undefined }>;

  /**
   * The reader edited their words. Writes `body` and `updatedAt`, nothing else.
   *
   * `null` clears the body, turning a comment back into a bare bookmark. `""`
   * never reaches here: the route trims once and turns an empty string into
   * `null`, so "wrote nothing" has one representation across both stores.
   */
  patchBody(slug: string, id: string, body: string | null): Promise<Comment>;

  /**
   * The referee changed where they put the passage. Writes `criterionId`,
   * `valence` and `updatedAt`, nothing else.
   *
   * **The fifth operation, and it exists because `create` must not be the
   * fourth thing it already is.** A second `create` under a stored id carrying
   * a different placement is refused with a 409, deliberately — a re-score is
   * not a retry, and letting one function mean both would silently overwrite a
   * judgement the referee had already made. So changing one is named, like the
   * other four. docs/plans/260901i-the-referee-places-the-passage-themselves.md
   * § *Overwriting gets an operation of its own*.
   *
   * **Both fields, together, always.** The pair is one value: a `valence` with
   * no `criterionId` is a number against nothing, which is what
   * `comments_valence_needs_criterion` refuses in the database and `markProblem`
   * refuses above the stores. A shape where one could be written without the
   * other would let the two halves of a placement drift apart between two
   * requests. `{ criterionId: null, valence: null }` clears the placement back
   * to a plain reading note, which is already a legal state.
   *
   * `null` rather than absent, and the difference is not cosmetic: `NewComment`
   * says "no placement" by leaving the fields off, because
   * `exactOptionalPropertyTypes` is on and the two stores are compared
   * structurally. A patch cannot say "clear this" with an absent key, so it
   * says it with `null`. `tidyMark` in src/routes.ts validates the pair once
   * and adapts it to whichever of the two shapes the caller needs.
   *
   * Everything the pair may be has already been checked by the route:
   * `criterionId` names a `diverging` criterion of this owner's on this
   * article, and `valence` is a whole number from −100 to +100. **No clamp
   * anywhere on this path** — see `Comment.valence` in src/types.ts for the
   * failure that rule exists to prevent.
   *
   * Throws `NotAnExplanation(id, "missing")` for an unknown id, as `patchBody`
   * does, which src/routes.ts answers with a 404.
   */
  patchMark(slug: string, id: string, mark: MarkPatch): Promise<Comment>;

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
   * Fill in the answer, or the error — **if this attempt is still the live one**.
   *
   * `attempt` is the token `beginAnswer` handed back. It is optional in the
   * type because the filesystem store has none; **the Postgres store refuses a
   * call without it** rather than falling back to identity, because a caller
   * that merely forgot to carry it would put back the whole race in silence.
   * Exactly `SearchStore.finish`, and for the same reason.
   *
   * `patch.status` must be `done` or `error`. The attempt ends here either way,
   * so a patch that left the comment `pending` would strip the fence off a row
   * still waiting for an answer, after which anybody's late write can land.
   *
   * **`undefined` back means "you were superseded"** — the fenced write matched
   * no row, because a sweep buried this attempt and the reader has already
   * begun another. It is not an error: nothing is wrong, this call is simply
   * not the one that gets to answer. `SearchStore.finish` returns `undefined`
   * in the same case. The comments as they now stand come back otherwise.
   *
   * `quiet` suppresses the per-comment log line, for a caller patching a batch
   * of comments with the same reason — one line each would say one thing N
   * times, and N is unbounded while Vercel allows 256 lines per request.
   */
  patch(
    slug: string,
    id: string,
    patch: AnswerPatch,
    attempt?: string,
    opts?: { quiet?: boolean },
  ): Promise<Comment[] | undefined>;

  remove(slug: string, id: string): Promise<Comment[]>;

  /**
   * Turn abandoned `pending` comments into `error`, so they can be retried.
   *
   * ## Why this takes a bare `keep` and not `SweepOptions`
   *
   * The rule `SweepOptions` states is right and this store obeys it: `keep` is
   * this process's live work and something else has to speak for every other
   * process, because **`keep` alone is a cross-process bug**. That is exactly
   * what happened here — `sweepOrphaned` in src/routes.ts filtered a module-scope
   * `Set`, so a `GET` landing on machine B while machine A streamed an answer
   * saw a `pending` row nobody *local* was working on and errored it while the
   * reader watched the words arrive.
   *
   * What differs is *where the clock is*. The other four measure an attempt's
   * age at sweep time against a `graceMs` the caller supplies, because their
   * rows carry an `attempt_started_at`. `comments` carries no start column; it
   * carries `attempt_id` and **`lease_expires_at`**, which the schema comment on
   * the table says outright were put there to "replace the in-process `answering`
   * Set in src/routes.ts". A lease is a deadline, not a start, so the window is
   * stamped on the row by `beginAnswer` rather than measured by the sweep — the
   * shape `jobs` already uses (`leaseIsOver`, src/store/job-fence.ts).
   *
   * So a `graceMs` parameter here would be a number the implementation could not
   * use, and a parameter that is silently ignored is the failure this codebase
   * keeps finding — docs/reusable/silent-success.md. The window is
   * `COMMENT_ANSWER_LEASE_MS` in src/store/pg-comments.ts, next to the write
   * that stamps it, exactly as `CLAIMS_ORPHAN_GRACE_MS` lives beside its own.
   *
   * @param keep bare comment ids — *not* `slug/id`. The key src/routes.ts uses
   * has to stay unique across articles; a store must not be handed a composite
   * it would then have to take apart. `liveComments` there does the conversion,
   * for the reason `liveMessages` does it for chat.
   */
  sweepPending(slug: string, keep: ReadonlySet<string>): Promise<Comment[]>;

  /** For the library card and the metadata page: a count, never the comments. */
  count(slug: string): Promise<number>;
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
   * is the per-article half of docs/plans/260826t-reader-profile.md — see
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
 * comparable. See docs/plans/260826k-library-shelf-actions-and-search.md.
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
 *
 * `CommentStore.sweepPending` obeys the same rule with a different second half —
 * a lease stamped on the row instead of a window supplied by the caller, because
 * `comments` has a `lease_expires_at` column and no attempt clock. See its doc
 * for why it therefore does not take this type.
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
       * Chat or Remember — like `anchor`, applied **only when this turn creates
       * the thread**. `withTurn` throws `ChatConflict` on one that contradicts
       * an existing thread rather than ignoring it, which is what makes the
       * rule hold under Postgres too: the route's own check runs inside
       * `inTurnOrder`, and that is per-process.
       */
      kind?: ThreadKind;
      /**
       * How much a Remember answer should say — written onto the **pending**
       * reply, in the same write as the question.
       *
       * `retry` and `edit` below take no stance, deliberately: theirs comes
       * from the answer they are replacing. See `ChatMessage.stance`.
       */
      stance?: RememberStance;
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

  /**
   * **Append a finished exchange — both rows, both `done`, in one write.**
   *
   * Live conversation's write path. Unlike `begin`/`finish` there is nothing
   * pending in between: the reader spoke, the model answered, and both halves
   * are known before anything is stored.
   *
   * `expectedTailId` is required and may be `null` for "I believe this thread
   * is empty". It is the guard *and* the idempotency: a retried request finds
   * the tail already moved and gets `ChatConflict` rather than appending the
   * turn twice. See `SpokenTurn` in src/chat.ts.
   */
  appendSpoken(slug: string, spoken: SpokenTurn, now?: () => string): Promise<Turn>;

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
 * **A peer reviewer's own criteria, run over the paper** — Referee mode's first
 * sub-mode, docs/plans/260831an-referee-mode-for-peer-reviewers.md § 1.
 *
 * `SearchStore` method for method, including the attempt fence and what it is
 * for, because it is the same problem with the same two stores behind it: a run
 * is the referee's question, an attempt is one model call, and only Postgres
 * has attempts as rows. Read that interface first; only the differences are
 * written out here.
 *
 * - **`begin` takes a config as well as a criterion.** A criterion has a kind,
 *   and `diverging` carries the two poles and the ramp. The whole union goes in
 *   rather than three loose fields, so a half-configured `diverging` row cannot
 *   be assembled from arguments — `criterionProblem` refuses it before it gets
 *   here, and the database's `referee_criteria_diverging_shape` refuses it
 *   again.
 * - **`recolour` is the categorical hue, not the diverging ramp.** Which
 *   criterion a mark in the prose came from, and nothing about which way a
 *   passage cuts. Sol's finding 7: those two channels must not become one.
 */
export interface RefereeCriteriaStore {
  load(slug: string): Promise<SavedCriterion[]>;

  /** The article's fingerprint right now — see `SearchStore.sourceHash`. */
  sourceHash(slug: string): Promise<string | undefined>;

  /**
   * Record a `pending` criterion before the model is called.
   *
   * A `wantedId` naming an existing row is a **retry only when the criterion
   * text matches and that row's status is `error`** — the three-condition rule
   * this repo carries a postmortem for. The config is deliberately not one of
   * the three: a reset adopts the new one, because a `diverging` row whose
   * poles were nonsense is exactly the row a referee fixes and runs again.
   * `withCriterion` in src/referee-criteria-store.ts holds the decision, and
   * both stores call it.
   */
  begin(
    slug: string,
    criterion: string,
    config: RefereeCriterionConfig,
    wantedId?: string,
    now?: () => string,
  ): Promise<{ row: SavedCriterion; attempt: string | undefined }>;

  /**
   * Write the answer, if this attempt is still the live one.
   *
   * `attempt` is optional in the type because the filesystem store has none;
   * the Postgres store **refuses a call without it** rather than falling back
   * to identity, which would put back the cross-process race the column exists
   * to close. `patch.status` must be `done` or `error`.
   */
  finish(
    slug: string,
    id: string,
    patch: Partial<SavedCriterion>,
    attempt?: string,
  ): Promise<SavedCriterion | undefined>;

  remove(slug: string, id: string): Promise<SavedCriterion[]>;

  /** The reader's palette slot for one criterion — `null` puts it back on auto. */
  recolour(slug: string, id: string, colour: number | null): Promise<SavedCriterion[]>;

  /** Turn abandoned `pending` criteria into `error`. See `SweepOptions`. */
  sweepPending(slug: string, opts: SweepOptions): Promise<SavedCriterion[]>;
}

/**
 * **The claims a paper makes up front, and where it takes each one up.**
 *
 * Referee mode's second sub-mode
 * (docs/plans/260831an-referee-mode-for-peer-reviewers.md § 2), and the one
 * contract in this file with **no id in it**: there is one claims run per
 * article, because a referee writes several criteria and asks the paper what
 * *it* claims exactly once. Running it again replaces what is there.
 *
 * **A claims run's real home is a pipeline artefact, and this is not it.** The
 * plan says so and lists the surface: a `StepName`, an `ArtifactKind` and an
 * `article_revisions` column, because a claims run is article-derived and
 * reusable rather than reader state. That is unchanged, and `referee_claims`
 * (drizzle/0051) is an **interim** table, named as one in its own migration.
 *
 * **What changed, and when, because a recorded reason outlives the decision it
 * justified.** Until 2026-09-01 this contract had a filesystem implementation
 * and no Postgres one, and said so — deliberately, on the argument above plus
 * one that has since expired. The expired half was the blocking one:
 * src/store/export.ts was being rewritten in another session that day, so a
 * bespoke table could only have landed *without* an `ARTICLE_TABLE_COVERAGE`
 * entry, which is exactly the accident of the day before — `db:export` had never
 * heard of `referee_criteria` and dropped every criterion from the rollback for
 * a day while reporting success. That file is settled, so the table lands with
 * its entry and with a fixture that inserts a row and requires it back out of
 * the named file.
 *
 * Against the interim stood the cost of not building it, which a cross-family
 * review put plainly: under `SPIDERYARN_STORE=postgres` — the store that
 * deploys — *"'Pull the paper's claims' cannot load, start or persist a run"*.
 * Both adapters are real now, and src/store/index.ts selects between them with
 * `guarded(...)` like every other pair.
 */
export interface RefereeClaimsStore {
  /** The stored run, or `null` when this paper has never been asked. */
  load(slug: string): Promise<ClaimsRun | null>;

  /** The article's fingerprint right now — see `SearchStore.sourceHash`. */
  sourceHash(slug: string): Promise<string | undefined>;

  /**
   * Record a `pending` run before the model is called, **replacing** whatever
   * was stored.
   *
   * There is no `wantedId` and no retry rule, because there is nothing to
   * collide with: a second run is a run, and the answer it overwrites was about
   * the same paper. src/referee-claims-store.ts § What differs.
   */
  begin(slug: string, now?: () => string): Promise<ClaimsRun>;

  /**
   * Write the answer over the `pending` run.
   *
   * `null` when there is no run on disk any more — the article's data went away
   * underneath the call — rather than resurrecting a row nobody has.
   */
  finish(slug: string, patch: Pick<ClaimsRun, "status"> & Partial<ClaimsRun>): Promise<ClaimsRun | null>;

  /**
   * Turn an abandoned `pending` run into an `error`, so it can be run again.
   *
   * `live` is whether *this process* is running it now. Narrower than
   * `SweepOptions`, which carries a set of ids and a grace window, because there
   * is one run and no id to keep a set of.
   *
   * **The grace window still exists; it is just not in this signature.**
   * `SweepOptions` explains why one is needed at all — `keep` alone is a
   * cross-process bug, and process B seeing process A's live row in nobody's set
   * errors an answer that is still arriving. That is as true here as anywhere,
   * and on Vercel it is the ordinary shape. So the Postgres store applies its
   * own window against `referee_claims.created_at`, which `begin` stamps and
   * `finish` never touches (`CLAIMS_ORPHAN_GRACE_MS`,
   * src/store/pg-referee-claims.ts). The filesystem store needs none: two
   * servers sharing one `data/` directory is a thing nobody does.
   */
  sweep(slug: string, live: boolean): Promise<ClaimsRun | null>;
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
 * than on one. docs/plans/260826t-reader-profile.md is the design; src/profile.ts
 * is where the two boxes (this one and `ShelfState.purpose`) become one string
 * a prompt can carry.
 *
 * Not article-scoped, unlike everything else in this file — there is one
 * profile per reader, which today means one profile, full stop
 * (docs/project/auth.md). The filesystem adapter is a thin wrapper over
 * `loadReaderProfile` / `saveReaderProfile` in src/profile.ts, which already
 * does the normalising, capping and atomic write; the Postgres adapter is
 * `reader_profiles`, one row per `owner_id`.
 *
 * **It holds the reader's settings too**, since 2026-08-31 — the switch below
 * is on the same row rather than in a store of its own, for the reason
 * src/db/schema.ts gives beside the column.
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

  /**
   * **Experimental features: when they were switched on, or `null` for off.**
   *
   * An ISO 8601 string rather than a `Date`, because that is what crosses the
   * wire and what the filesystem store holds; a `Date` here would mean one
   * adapter parsing what the other stringifies for no reader's benefit.
   * docs/project/experimental-features.md.
   */
  readExperimental(): Promise<string | null>;

  /**
   * Switch experimental features on or off, and answer with what is now stored.
   *
   * **`true` twice does not move the date.** An already-on switch keeps the
   * date it has, so the value answers *since when* rather than *when did the
   * client last send true* — which is the whole reason this is a timestamp and
   * not a boolean. `false` clears it outright, so on-off-on is honestly a new
   * date: the first spell ended.
   */
  writeExperimental(on: boolean): Promise<string | null>;
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
  /**
   * **Every reader's bug reports, newest first** — `/admin/feedback`.
   * docs/plans/260902l-admin-feedback-page.md.
   *
   * The one method in this file that returns a reader's own sentences, and the
   * one place the admin rule *"counts and dates, never a sentence"* has an
   * exception. What makes it legitimate is consent and nothing else: the reader
   * typed that report into a box labelled with what happens to them.
   * docs/project/feedback.md § The one rule is the boundary; it does not move
   * because a second page found it convenient.
   *
   * **Newest first is promised here**, unlike the users list, and that is not
   * an inconsistency. The users page sorts eleven columns and a store opinion
   * would be a second one; this is an inbox with one order, and `limit` is
   * meaningless without saying which end it cuts.
   *
   * `limit` is capped by the implementation. This is the only table in the app
   * an ordinary account holder can add rows to.
   */
  listFeedbackAcrossOwners(limit: number, cursor: FeedbackCursor | null): Promise<AdminFeedbackPage>;
  /**
   * **One report in full**, including the diagnostics blob the list leaves out
   * — `GET /api/admin/feedback/:ownerId/:id`.
   *
   * Keyed on the **pair**, like everything that addresses a report here: the id
   * is minted by a browser, `feedback`'s primary key is `(owner_id, id)`, and a
   * lookup on the id alone can hand back somebody else's report. GPT Sol caught
   * that in the first draft, 2026-09-02.
   */
  readFeedbackAcrossOwners(ownerId: string, id: string): Promise<AdminFeedbackDetail | null>;
  /**
   * **One report's screenshot bytes, whoever filed it** — for
   * `GET /api/admin/feedback/:ownerId/:id/screenshot`.
   *
   * Keyed on the **pair**, like `readFeedbackAcrossOwners` above and for the
   * same reason.
   *
   * `null` for a report that has none *and* for a pair that is not a report:
   * both are a 404 from the route, and distinguishing them would buy the caller
   * nothing it is allowed to do anything with.
   *
   * **Why this is not `FeedbackStore.read`.** That one is owner-scoped on
   * purpose — another reader's id is simply not found, the same rule as
   * `ownedSlug` — and relaxing it would relax it for the reader's own dialog
   * too. The cross-owner read is a different method, on the contract whose name
   * already says what it does, reached from one gated route.
   */
  readFeedbackScreenshotAcrossOwners(ownerId: string, id: string): Promise<Uint8Array | null>;
}



/* --------------------------------------------- the document it came from -- */

/**
 * **The file this article was made from**, for `GET /api/source/:slug`.
 *
 * It exists for one reason, and it is the reason a scan is shown at all: a
 * transcription of a photographed page has nothing to check it against, so the
 * only real verification available is a person looking at the ink
 * (docs/plans/260826c-pdf-ingestion.md).
 *
 * ## Why it is its own contract rather than a method on `ArticleReader`
 *
 * Because it is the only read in this file whose answer is **bytes**, and the
 * two stores keep those bytes in genuinely different places: the filesystem has
 * `data/<slug>/raw.pdf` beside the manifest that names it, and Postgres has a
 * *reference* — `raw_source_sha256` plus `raw_source_kind` — to a
 * content-addressed object in the `sources` bucket. Everything on
 * `ArticleReader` is JSON assembled from rows; this is one object fetched over
 * a second protocol, and folding it in would give that interface a method whose
 * failure modes nothing else there has.
 *
 * ## Why the method says `Pdf` and not `Document`
 *
 * Because the content type is the security boundary. This is a stranger's file
 * served from our own origin, so the one thing that must never happen is
 * serving it as anything a browser will execute — `text/html` from our origin
 * *is* stored XSS. A method that returned "the source document, whatever kind
 * it is" would put a `Content-Type` decision at the call site, where the next
 * person adding a kind would make it by accident. Named this way, the route
 * writes `application/pdf` because that is the only thing it can be given, and
 * serving anything else has to be a deliberate second method.
 *
 * That is also why a web page's source is simply `null` rather than an error:
 * the route says the same sentence for "no such document" and "not a PDF", so
 * the store need not tell them apart.
 */
/**
 * The PDF and the name to hand it to the reader under.
 *
 * **The filename is not decoration.** `raw_filename` is what the browser sent
 * when somebody uploaded a document, and it is the name they will recognise on
 * their own disk — `<slug>.pdf` is a fallback, not an equivalent. It is also
 * reader-controlled text on its way into a response header, which is why
 * `contentDisposition` in src/routes.ts escapes it rather than interpolating
 * it; see that function for what a name can legally contain.
 *
 * `null` for anything we fetched: there was no reader and no name, and the
 * route falls back to the slug.
 *
 * A pair rather than a bare `Uint8Array` because the alternative was a second
 * store call for one string, and because the name and the bytes come off the
 * same row — asking twice is how they come to be about different revisions.
 */
export interface SourcePdf {
  bytes: Uint8Array;
  filename: string | null;
}

export interface SourceStore {
  /**
   * The PDF and its name, or `null` when this article was not made from one.
   *
   * **`null` is "there is no PDF here", never "I could not fetch it".** A
   * reference that points at nothing, or at bytes that do not hash to their own
   * name, **throws** — see the Postgres adapter. The row asserting an object
   * exists and the object being absent is a fault somebody has to look at, and
   * answering `null` would report an article with a scan as an article with
   * none, to the one reader who is looking at the scan.
   *
   * Owner-filtered where the store has owners at all: the Postgres adapter
   * resolves the slug through `ownedSlug`, so a stranger gets `null` rather than
   * somebody else's paper. `src/routes.ts` authorises through `shelfStore` first
   * regardless, which is the ordering tests/owner-isolation.test.ts pins.
   */
  readPdf(slug: string): Promise<SourcePdf | null>;
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
 * docs/plans/260827q-ai-cost-tracking.md says so out loud so the day it stops being true
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

/* ------------------------------------------------- live conversation -- */

/**
 * **One live conversation this server issued a token for.**
 *
 * The parent every realtime `ai_calls` row hangs off, and — more importantly —
 * the only thing that can say a session reported **nothing**. See
 * `realtimeSessions` in [../db/schema.ts](../db/schema.ts) for why a row exists
 * before any money is known to have been spent.
 *
 * Timestamps are ISO strings on this side of the seam, like `AiCallRow`'s, so
 * that the two adapters cannot disagree about a `Date` and neither of them can
 * hand a caller a mutable one.
 */
export interface RealtimeSession {
  /** Ours, minted before OpenAI is asked for anything. */
  id: string;
  ownerId: string;
  /**
   * The article, by slug — the historical fact a later delete cannot revoke.
   * The Postgres adapter resolves the id beside it; the filesystem one has no
   * ids to resolve, which is why the slug is what crosses this seam.
   */
  articleSlug: string | null;
  threadId: string | null;
  /** The realtime model as OpenAI created it, not as we asked. */
  model: string;
  transcriptionModel: string | null;
  issuedAt: string;
  /** The last instant a usage report is accepted. Server-owned; not the token's expiry. */
  acceptsUntil: string;
  connectedAt: string | null;
  closedAt: string | null;
  closeReason: string | null;
}

/**
 * **The journal of live conversations** — issued, connected, closed.
 *
 * Deliberately four narrow methods rather than a general upsert. Every one of
 * them is a fact arriving at a known moment, and there is no operation here that
 * rewrites what a session was: `markConnected` and `close` set a timestamp that
 * was null, and a second call must not move it. A general `update` would make
 * "the browser said it connected twice" a silent overwrite of the first, more
 * truthful, time.
 *
 * **Every read takes the owner.** Not because a reader is untrusted —
 * docs/project/security-map.md says plainly that they are not — but because the
 * session id travels through the browser and comes back on a request, and a
 * lookup that did not carry the owner would answer for *any* session whose id
 * somebody had. That is the same discipline `ownedSlug` enforces on articles,
 * and the reason it exists is that `articles.slug` is globally unique and the
 * unfiltered lookup reads exactly like a working one.
 */
export interface RealtimeSessionStore {
  /**
   * Write the session row. **Called after OpenAI has minted the client secret
   * and before the token reaches the browser** — if this throws, the token is
   * never released, because a usable token with no journal row is spend nothing
   * can ever see.
   */
  issue(session: RealtimeSession): Promise<void>;
  /** One session, or `null` — for this owner only. */
  find(id: string, ownerId: string): Promise<RealtimeSession | null>;
  /**
   * The data channel opened. **Idempotent, and it keeps the earliest time**: a
   * usage report backfills this too, in case the connected event was lost, and
   * a later backfill must not overwrite the moment the channel really opened.
   */
  markConnected(id: string, ownerId: string, at: string): Promise<void>;
  /**
   * The conversation ended, as far as the browser could tell. **Best-effort by
   * nature** — a closed laptop says nothing — so a session with no `closedAt`
   * is the ordinary case rather than an error, and nothing downstream may treat
   * its absence as a session still running.
   */
  close(id: string, ownerId: string, at: string, reason: string | null): Promise<void>;
}

/* ------------------------------------------------------------- feedback -- */

/**
 * `read`, `add`, `profile`… — **re-exported from [src/types.ts](../types.ts)**,
 * like `Visibility` above, so a caller already importing the rest of a report's
 * shape from this file does not have to know where the vocabulary lives. The
 * dialog imports the same names from `types.ts` directly, because nothing under
 * src/web/ may import this file.
 */
export type {
  FeedbackDiagnostics,
  FeedbackEnvironment,
  FeedbackKind,
} from "../types.js";

/**
 * **What the reader filed** — everything the row is built from, and nothing
 * else.
 *
 * A closed, named shape rather than a bag off the wire, because this is the one
 * channel on which a reader's own words leave this machine on purpose and the
 * rule at that seam is the one `safeEvent` follows: *build the payload, do not
 * clean it*. Nothing here is spread from a request body; the route names each
 * field.
 *
 * `null` rather than optional throughout, deliberately. `exactOptionalPropertyTypes`
 * is on, so "absent" and "null" would be two spellings of the same fact, and
 * every one of these fields is a column that is genuinely nullable.
 */
export interface NewFeedback {
  /**
   * **Client-minted, and the idempotency key.** A double-clicked Save and a
   * retried POST carry the id the browser already has, and must file one
   * report — see `FeedbackSubmission` below for what the second one gets back.
   * A Spideryarn id (`spya-k3m9qt`), so the CHECK in the schema is the same one
   * every other minted id is held to.
   */
  id: string;
  /**
   * **The gate's email, snapshotted.** Not a join onto `auth.users`, which is
   * not ours and where an address can change: what we want months later is the
   * address this reader had when they wrote to us. Never a value the browser
   * supplied — src/routes.ts has a `VerifiedUser` at the seam that sets the
   * owner.
   */
  reporterEmail: string;
  /**
   * **What the reader wrote**, in one box. Length-capped at
   * `MAX_FEEDBACK_ANSWER_CHARS`, non-empty, and `not null` — a report with
   * nothing in it is not a report, and that is the column's type rather than a
   * rule somebody remembers.
   */
  body: string;
  /**
   * *A problem* or *a suggestion*, or **null for a reader who did not say**.
   * Greg asked for the toggle to start unset, so absence is an answer here
   * rather than a missing one — src/types.ts § `FEEDBACK_KINDS`.
   */
  kind: FeedbackKind | null;
  /**
   * Whether the reader ticked *Send extra diagnostics*. Recorded as its own
   * fact rather than inferred from `diagnostics` being present: "they said yes
   * and there was nothing to collect" and "they said no" are different, and
   * only one of them is a bug in the collector.
   */
  consented: boolean;
  /**
   * **The address they were at, whole.** `routeKind`, a name from a closed
   * list, until 2026-09-02 — src/db/schema.ts § `url` has why it changed.
   * Validated by the route with `isWebUrl` and capped at
   * `MAX_FEEDBACK_URL_CHARS`. `null` from a bundle loaded before the change —
   * src/db/schema.ts says why an old report is filed rather than refused.
   */
  url: string | null;
  /** The article they were on, where there was one. Validated by the route. */
  slug: string | null;
  /** `__SPIDERYARN_BUILD_COMMIT__` — the string the release and the source maps went up under. */
  buildCommit: string | null;
  environment: FeedbackEnvironment;
  /**
   * `x-vercel-id` for **this submit**, so the report names a line in the Vercel
   * log even when the reader sent no diagnostics at all. The ids of the
   * requests that went *wrong* ride in the diagnostics blob, behind the
   * tick-box.
   */
  requestVercelId: string | null;
  /** The opt-in blob, versioned. `null` unless `consented`, which the database also enforces. */
  diagnostics: FeedbackDiagnostics | null;
  /** A screenshot the reader pasted in. Decoded bytes, capped by the schema. */
  screenshot: Uint8Array | null;
}

/**
 * **A report as it was stored** — the durable half, which is the authoritative
 * one. The screenshot's bytes are deliberately not read back: nothing that has
 * the row wants them, and a report list that drags 300 KB per row through
 * memory to show a tick is the wrong default. `screenshotBytes` says whether
 * one exists and how big it was.
 */
export interface FeedbackReport extends Omit<NewFeedback, "screenshot"> {
  /** ISO. */
  createdAt: string;
  screenshotBytes: number | null;
  /**
   * ISO, and `null` until the report was **handed to** Sentry.
   *
   * The half of the old `mirroredAt` that was always true. See `markMirrorAttempted`.
   */
  mirrorAttemptedAt: string | null;
  /** ISO, and `null` until Sentry **acknowledged** it. See `markMirrored`. */
  mirroredAt: string | null;
  sentryEventId: string | null;
}

/**
 * **Three answers, and they are genuinely different things** — so a union, not
 * a row plus two booleans nobody checks.
 *
 * Only `created` may be mirrored to Sentry: feedback events are *not* deduped
 * there (verified against the SDK — see the plan), so mirroring a retry would
 * file the same report twice. Making that a type the caller must narrow is the
 * point; `{ report, wasDuplicate }` would let the mirror forget.
 */
export type FeedbackSubmission =
  /** Written. This one, and only this one, gets mirrored. */
  | { kind: "created"; report: FeedbackReport }
  /**
   * This id is already filed for this reader, and **nothing was written**. The
   * report handed back is the one that is stored, not the one just submitted —
   * so a retry that differs in its text is reported as the retry it is rather
   * than silently overwriting what the reader first sent.
   */
  | { kind: "duplicate"; report: FeedbackReport }
  /** The per-owner hourly cap. `retryAfterMs` is until the oldest report in the window ages out. */
  | { kind: "limited"; retryAfterMs: number };

/**
 * **A fenced write that arrived without its fence** — a caller's bug, in four stores.
 *
 * `SearchStore.finish`, `CommentStore.patch`, `ChatStore.finish` and
 * `RefereeCriteriaStore.finish` all take `attempt` as optional, because the
 * filesystem store has no such token. The Postgres side refuses a call without
 * one rather than falling back to identity: a caller that merely forgot to carry
 * it through would put the whole cross-process race back — a model call the
 * sweep already buried landing on top of the retry the reader is watching
 * arrive — with nothing anywhere reporting it. Stage H of
 * docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md
 * is where `attempt` stops being optional and this class stops being reachable.
 *
 * ## Why it is a class, and why its message names no slug
 *
 * All four threw a bare `Error` until 2026-09-03, and the message carried the
 * slug. That was invisible for as long as it was: through `src/store/index.ts`
 * the store is guarded, so `guardDbStore` scrubbed the sentence to *"this app
 * asked its database for something it would not do"* — a true-ish sentence that
 * drops the entire content of the refusal, which is **what the caller forgot**.
 * The tests covering it passed because they imported the adapter directly, and
 * the adapter's export was not guarded yet. That is the shape of
 * docs/postmortems/260901d-a-409-and-a-404-arrived-as-500.md exactly, and it
 * surfaced the moment every Postgres store went behind the guard at its export.
 *
 * `IllegalTransition` (src/store/uploads.ts) is the precedent and was added for
 * the identical trigger — *"found by tests/store-uploads-parity.test.ts the
 * moment `pgUploadStore` went behind this guard"*. Like it, this is a caller's
 * bug either way and the whole point of it is to name what was asked for.
 *
 * **So the message is built only from literals we chose.** The slug is gone on
 * purpose: `src/store/db-errors.ts` says a candidate whose message can contain a
 * URL, a title, a quote or a model's answer does not belong on that allowlist
 * however well-behaved its class is, and a slug is a URL path segment derived
 * from a title. Which article it was is in the request the log already carries.
 */
export class MissingAttempt extends Error {
  /**
   * **Door 1, not the allowlist**, which is what `src/store/db-errors.ts` asks
   * for: *"Adding another closed class: don't. Give it a `status` instead."* The
   * three sibling refusals beside it — `must end a run`, `must end an answer`,
   * `must end a criterion` — carry a status too, so the whole family goes
   * through one door rather than two.
   *
   * `500` because it is always a bug in our own caller and never anything the
   * reader did.
   */
  readonly status = 500;

  constructor(
    /** The method that refused, e.g. `"SearchStore.finish"`. A literal, always. */
    operation: string,
    /** The method that handed the token out, e.g. `"begin()"`. A literal, always. */
    origin: string,
  ) {
    super(
      `${operation} needs the attempt that ${origin} returned. ` +
        "Without it a model call the sweep already buried can overwrite the retry.",
    );
    this.name = "MissingAttempt";
  }
}

/**
 * **Ten reports an hour, per owner.**
 *
 * Said plainly, and the plan says it too: this stops a loop and one account
 * hammering. It is not a defence against account farming and does not pretend
 * to be. It is the first authenticated write in this repo with no natural
 * ceiling — a comment is bounded by passages, a job by articles — which is why
 * it has one at all.
 */
export const FEEDBACK_HOURLY_CAP = 10;

/** The window the cap counts over. */
export const FEEDBACK_WINDOW_MS = 60 * 60 * 1000;

/**
 * **A bug report, filed by a reader who is looking at the thing that went
 * wrong.** docs/plans/260831aj-feedback-button-and-bug-reports-to-sentry.md.
 *
 * **Postgres only.** Not `guarded(...)` like the reads: there is a Postgres
 * implementation and a filesystem *refusal*, the same asymmetry `AdminStore`
 * and `VisibilityStore` have. A files adapter would be twenty lines written
 * against a module that docs/plans/260831b-finish-the-database-move.md deletes
 * this week, plus a parity obligation to keep two implementations agreeing until
 * one of them goes.
 *
 * The refusal has to reach the reader as a sentence saying the report was not
 * saved — a button that can only fail is worse than no button, because pressing
 * it is how you find out.
 */
export interface FeedbackStore {
  /**
   * File one report. **Append-only, idempotent, and rate-limited, in one
   * transaction.**
   *
   * The owner comes from `currentOwnerId()`, like every other write here; it is
   * never an argument, so a caller cannot file a report as somebody else.
   */
  submit(input: NewFeedback): Promise<FeedbackSubmission>;
  /**
   * One report of **this reader's**, or `null`. Owner-scoped like everything
   * else: another reader's id is simply not found, which is the same rule as
   * `ownedSlug` and for the same reason — 404 rather than a 403 that confirms.
   */
  read(id: string): Promise<FeedbackReport | null>;
  /**
   * **We handed it over.** Written the moment `captureFeedback` returns an
   * event id, which is a thing we know.
   *
   * It is *not* delivery, and the two used to be one column, which was wrong:
   * the SDK sends asynchronously, `sendEvent` does not return the send promise,
   * and `sendEnvelope` swallows every transport failure and resolves an empty
   * result. So a network failure, a rate limit or a disabled transport all
   * wrote `mirrored_at` for a report that went nowhere — GPT Sol's code review,
   * 2026-08-31, and precisely the shape docs/reusable/silent-success.md warns
   * about, in the one column that finds a stranded report.
   */
  markMirrorAttempted(id: string): Promise<void>;
  /**
   * **Sentry acknowledged it** — a 2xx from the transport, carried by the SDK's
   * `afterSendEvent` hook. Written after the mirror, never before.
   *
   * Together with the column above this makes
   * `mirror_attempted_at is not null and mirrored_at is null` a trustworthy
   * query for a report Sentry did not take. The crash window between the insert
   * and either write is accepted rather than engineered away — an outbox is more
   * machinery than an alpha feedback button is worth.
   *
   * **Conditional on `mirrored_at` being null**, and it answers whether a row
   * actually changed: a second mark must not silently overwrite the first, and a
   * mark that matched nothing must not look like one that did.
   *
   * `sentryEventId` may be `null` — the SDK does not always hand one back, and
   * "mirrored, id unknown" is a truer row than "not mirrored".
   */
  markMirrored(id: string, sentryEventId: string | null): Promise<boolean>;
}
