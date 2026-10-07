/**
 * The storage seam: what a store can be asked, with no hint of how it answers.
 *
 * **The shape is deliberately the `src/api.ts` surface, function for
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
 * Most estimates of this migration assumed `src/api.ts` was the storage layer. It
 * was the **read** layer. There are three:
 *
 * 1. `ArticleReader` — everything `src/api.ts` exported. One file to reimplement.
 * 2. `ArtifactWriter` — what the pipeline stages write. Today that is
 *    `PipelineStep.outputs(ctx): string[]`, an interface that returns **file
 *    paths**, implemented across eight stage modules. There is no single file.
 * 3. `CommentStore` and the queue's `JobStore` — reader and queue state, each
 *    with its own module and its own in-memory assumptions. The queue's half
 *    has since landed, and its contract lives in [jobs.ts](jobs.ts), not here:
 *    a second `JobStore` was declared in this file and never implemented, so it
 *    drifted into declaring a different `claim`, `get` and expiry sweep from the
 *    real one, and it has been deleted. Chat and searches belong to this group
 *    and their interfaces are `ChatStore` and `SearchStore`, below.
 *
 *    **Which of these is wired to Postgres is not recorded here**, because that
 *    sentence has already been wrong in both directions — first claiming the two
 *    were declared here when they were not, then saying they had no interface
 *    here four hours before `05b9983a` added both. [index.ts](index.ts) is where
 *    the wiring is decided and the only place that can answer it.
 *    docs/plans/260905b-improve-the-codebase-third-sweep.md has the history.
 *
 * ## What is deliberately NOT in here
 *
 * `describeArticle` in src/library-scalars.ts, which turns artefacts into a `LibraryEntry`.
 * It is already pure and already documented as staying put "when the reads move
 * to SQL", so both adapters call the same function rather than each deriving a
 * word count its own way. Two implementations of one derivation is exactly the
 * divergence this migration is meant to make impossible.
 */

import { isAdmin, type AdminUser } from "../admin.js";
import type { OwnerId } from "../owner.js";
import type { Db } from "../db/client.js";
import type { Assets } from "../assets.js";
import type { DocumentKind } from "../fetch.js";
import type { SpokenTurn } from "../chat.js";
import type { AiCallRow } from "../ai-spend.js";
import type { LookupsByTerm } from "../glossary-lookups.js";
import type { AnswerFinish, MarkPatch, NewComment } from "../comments.js";
import type { ClaimsRun } from "../referee-claims.js";
import type { RefereeCriterionConfig } from "../referee-criteria.js";
import type { SavedCriterion } from "../saved-criteria.js";
import type { ChooseArticle } from "../shelf-terms/choose.js";
import type {
  AdminFeedbackDetail,
  AdminFeedbackPage,
  AdminFeedbackReport,
  Article,
  ArticleMetadata,
  ChatAnchor,
  ChatMessage,
  ChatThread,
  Comment,
  HighlightColour,
  FeedbackCursor,
  FeedbackFrom,
  FeedbackDiagnostics,
  FeedbackEnvironment,
  FeedbackKind,
  GlossaryLookup,
  CitationFind,
  CitationInvestigation,
  SourceGuess,
  GlossaryFound,
  QuotesFound,
  LibraryEntry,
  Meta,
  LibraryTermsResponse,
  LibraryHit,
  ListOptions,
  SearchKind,
  SearchRun,
  ShelfState,
  ArcFound,
  DebateFound,
  CitationsFound,
  IdeasFound,
  IllustratedFound,
  SketchFound,
  QuizFound,
  QuizKeptAnswer,
  QuizQuestionId,
  FaqFound,
  RelationsResponse,
  CrossrefsFound,
  SimpleSummaryFound,
  SkimFound,
  TimelineFound,
  ThreadFound,
  ThreadKind,
  AddedTerm,
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
   *
   * **`maxBytes` is a caller's tighter cap**, and there is one: the bug-report
   * mirror, which sends the document to Sentry only under 10 MiB
   * (src/feedback-article.ts). Over it the read throws `RawObjectTooLarge`
   * (src/store/raw-document.ts) instead of downloading the object to refuse
   * it. It can only lower the store's own ceiling, never raise it.
   */
  loadSource(slug: string, options?: { maxBytes?: number }): Promise<RawSource | null>;

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
   * The FAQ, plus whether it still describes the article — the cited head and
   * the tree, as `loadQuiz`. Two staleness facts: no profile is in this stage's
   * stamp. **Owner-only in v1**, and there is no public twin.
   * docs/plans/260916d-faq-mode.md.
   */
  loadFaq(slug: string): Promise<FaqFound>;

  /**
   * How each paragraph bears on the one before it, plus whether it still
   * describes the article — FAQ's two staleness facts, over FAQ's fingerprint.
   * **Owner-only, and there is no public twin**: a visitor's payload carries no
   * staleness verdict and a relation word has no quote to check (Sol P1-4).
   * docs/plans/261003f-marginalia-relation-words-and-timeline-events.md.
   */
  loadRelations(slug: string): Promise<RelationsResponse>;

  /**
   * The cross-references, plus whether they still describe the article — the
   * cited head and the top-level skeleton, matching the request's own stamp.
   * The owner's read; a visitor gets fresh links inside the public article
   * payload (plan 261001b), by the same `isStale`.
   * docs/plans/260930f-cross-reference-links-between-blocks-with-a-rich-hover-preview.md.
   */
  loadCrossrefs(slug: string): Promise<CrossrefsFound>;

  /**
   * Simple — the plain-words orientation — plus whether it still describes
   * the article (`stale`, shown) and whether an older prompt wrote it
   * (`outdated`, silent). docs/plans/260930i-simple-summaries-eli15-sub-mode.md.
   */
  loadSimpleSummary(slug: string): Promise<SimpleSummaryFound>;

  /**
   * The route through the Quotes, plus whether it still matches them — judged
   * against the Quotes, never the article — and how many quotes it does not
   * stop at. The profile half is the route's. **Owner-only in v1**, and there
   * is no public twin.
   * docs/plans/260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md.
   */
  loadSkim(slug: string): Promise<SkimFound>;

  /**
   * What the rest of the web says about this piece, plus whether the artefact
   * still describes the article.
   *
   * Staleness is answered as `loadIdeas` answers it — at read time, against the
   * blocks, the tree and the **cited** metadata head, because pass B sends
   * `articleWithIds`. Not against the publication date: no date appears in
   * either prompt, so hashing one would spend up to $0.27 every time a publisher
   * re-dated a post.
   *
   * **`searchedAt` is on the artefact and is deliberately not a third staleness
   * fact.** Debate is time-sensitive research and a shared link outlives it, so
   * the panel says *"Searched on …"* — but age is displayed provenance, not
   * invalidity. A visitor opening a year-old article must be able to see how old
   * the search is without the artefact declaring itself unusable.
   *
   * **A 404 is the ordinary case**, like the quiz and the sketch and unlike the
   * timeline: `debate` is off `DEFAULT_INGEST_STEPS`, so most articles have
   * never had one, and the panel's job on a 404 is to offer the button. An
   * artefact with two EMPTY groups, on the other hand, is a perfectly good
   * answer and the commonest one — most pieces have no critical reception at
   * all — so it is a 200 with a sentence, never a 404. `SHAPE.debate`
   * (src/store/artifacts.ts) makes the same call at the store boundary.
   */
  loadDebate(slug: string): Promise<DebateFound>;

  /**
   * **What the article was imported as: its title, its authors and its DOI** —
   * for checking an outside record against it (src/citation-index.ts).
   *
   * **The title is the revision's own, never the reader's rename.** `loadArticle`
   * puts its meta through `titleFor`, so a renamed paper's title is the
   * reader's label, and a correct DOI would then fail a title check (GPT Sol's
   * F2 on plan 261004h). No stored title falls back to the first heading, then
   * the slug, as `metaFrom` does.
   *
   * Owner-scoped like every read here: somebody else's slug is the same 404 as
   * one that does not exist.
   */
  loadArticleIdentity(slug: string): Promise<Pick<Meta, "title" | "byline" | "authors" | "doi">>;

  /**
   * Every work the piece cites, plus whether the list still describes the
   * article — the cited head and the tree, as `loadIdeas`. Two staleness facts,
   * like the timeline's: no profile is in this stage's stamp. **Owner-only in
   * v1**, and there is no public twin. docs/plans/260911g-citations-mode.md.
   */
  loadCitations(slug: string): Promise<CitationsFound>;

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

  /**
   * **This article's image manifest, and nothing else** —
   * docs/project/article-images.md.
   *
   * A read of its own rather than `loadArticle(slug).assets`, for the reason
   * `loadArc` above is one: the route behind it (`sendArticleAsset`,
   * src/routes.ts) runs **once per picture**, so a PDF with eight figures runs
   * it eight times on one page load, and `loadArticle` re-reads every block and
   * the whole tree — the cost
   * docs/plans/260827am-glossary-read-latency.md was written about.
   *
   * **`undefined` is not a fault, and is not the same as a 404.** No manifest
   * means the assets step has never run on this article — every article
   * ingested before it existed — and the caller's answer is *this article holds
   * no such object*, not *there is no such article*. A slug that is not this
   * reader's, or has no current revision, still throws.
   *
   * There is deliberately no staleness here, unlike every artefact read above
   * it: a manifest written against paragraphs that have since changed still
   * describes objects that really are in the bucket, and taking a figure off
   * the page over that would be a refusal the reader cannot act on.
   */
  loadAssets(slug: string): Promise<Assets | undefined>;
}

/**
 * The glossary-document write that does not go through the pipeline, because a
 * reader asked for it rather than a stage producing it.
 *
 * Separate from `ArticleReader` because it is a write, and separate from
 * `ArtifactWriter` because the pipeline does not do it. A term lookup is
 * store-independent orchestration built from `ArticleReader` and
 * `GlossaryLookupStore` in src/term-lookup.ts; it is deliberately not a method
 * on this adapter contract.
 */
export interface GlossaryStore {
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
 * | `colour`                             | `create`, `patchColour` |
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
   * The row's `attempt_id`, and it has to be carried to `patch`: without it a
   * model call this sweep already buried can land on top of the retry the
   * reader is watching arrive. It was `string | undefined` while there was a
   * filesystem store, which had no fence; that store went on 2026-09-05.
   */
  beginAnswer(slug: string, id: string): Promise<{ comment: Comment; attempt: string }>;

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
   * The reader recoloured a highlight, or removed its colour (`null`). Writes
   * `colour`, nothing else — a recolour is not an edit of the words, so
   * `updatedAt` is left alone.
   *
   * Throws `NotAnExplanation(id, "missing")` for an unknown id (404), and
   * `ColourNeedsWords` for a whole-block comment (409): a colour needs words to
   * paint. docs/plans/261003e-span-highlights-with-a-colour.md, review S4.
   */
  patchColour(slug: string, id: string, colour: HighlightColour | null): Promise<Comment>;

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
   * `attempt` is the token `beginAnswer` handed back, and it is required: a
   * caller that merely forgot to carry it would put back the whole race in
   * silence. Exactly `SearchStore.finish`, and for the same reason. The store
   * still refuses a call without one at run time (`MissingAttempt`), for a
   * caller that got round the type.
   *
   * `patch.status` must be `done` or `error` — `AnswerFinish` says so. The
   * attempt ends here either way, so a patch that left the comment `pending`
   * would strip the fence off a row still waiting for an answer, after which
   * anybody's late write can land.
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
    patch: AnswerFinish,
    attempt: string,
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
   * assuming what the write did. **`null` means the owned row was found, but no
   * shelf card was available to return** — for example, an article mid-import,
   * or a concurrent edit moving it to the other archive state before the card
   * is read. Any supplied changes were written. A slug with no owned row still
   * rejects with not-found, including an empty change.
   */
  patch(
    slug: string,
    change: { archived?: boolean; title?: string | null; purpose?: string | null },
  ): Promise<LibraryEntry | null>;

  /**
   * One more open.
   *
   * Returns nothing. This is fire-and-forget from the client's point of view,
   * and a response body would only invite somebody to render a counter that is
   * one behind.
   */
  recordOpen(slug: string): Promise<void>;

  /**
   * **Destroy this article, for good.** The one irreversible act a reader can
   * perform on their own data.
   *
   * `patch({archived: true})` above is the reversible ending, and it was the
   * only one until 2026-09-06 — `src/db/schema.ts` still says *"Never a delete;
   * Greg chose archive + Undo"* about the rest of the store, and that is still
   * the rule everywhere else. This is the exception, decided with the archive
   * in front of it: archive **is** the grace period, so there is no `deleted_at`
   * and no thirty-day purge, because a soft delete would be a second archive
   * under another name and the reader who wanted the thing gone would still
   * have it. docs/plans/260906h-delete-an-article-permanently.md.
   *
   * ## Three answers, and each of them is load-bearing
   *
   * - **404** for a slug that is not the reader's, and for one that is not
   *   there. Never 403: a 403 confirms the article exists, and the whole point
   *   of the owner filter is that a stranger learns nothing. It falls out of
   *   `ownedSlug` rather than being a second decision.
   * - **409** while an import is running on the article. The database will not
   *   refuse this on its own — every foreign key declares an `onDelete`, so a
   *   live job's next write simply lands on a cascaded-away revision — and the
   *   job's quota slot is the thing that cannot be recovered afterwards. See
   *   the implementation for why refusing is the *cheap* answer rather than the
   *   cautious one.
   * - **`{ destroyed }`**, naming the slug that no longer exists.
   *
   * **The article's *finished* jobs go with it**, and that is not merely tidying.
   * `jobs` is keyed by slug text, carries no foreign key, and is invisible to the
   * cascade — and a terminal row keeps the failed attempt's URL, so Retry on one
   * would queue a job for the destroyed slug whose worker calls
   * `lockOrCreateArticle` and remakes the article. GPT Sol's F20; the whole
   * argument, including why a terminal job cannot leak a quota slot where a live
   * one can, is at `deleteTerminalJobs` in src/store/pg-shelf.ts.
   *
   * **Never the entry**, which is what makes this different from `patch`.
   * `patch` returns the card as it now stands, so a caller cannot get away with
   * assuming what the write did; there is no card here, and handing back a
   * `LibraryEntry` for a row that has gone would be a shape the client could
   * render. The slug is the only thing left to say, and the client's next move
   * is to forget it.
   */
  destroy(slug: string, opts?: DestroyOptions): Promise<{ destroyed: string }>;
}

/**
 * **A last word before the row goes, taken under the delete's own locks.**
 *
 * `beforeDelete` runs inside `destroy`'s transaction, after the billing row and
 * the article row are locked and the live-job and stranded-reservation checks
 * have passed, and before anything is deleted. Throwing refuses the delete and
 * rolls everything back. It exists for a caller whose reason to delete was
 * decided earlier and has to be decided again where nothing can move: the
 * never-published tidy (scripts/never-published-tidy.ts, GPT Sol's R1 on plan
 * 261007f), whose eligibility proof would otherwise commit before `destroy`
 * waited for its locks. One deletion path with a hook, not a second copy of
 * `destroy`'s body. The reader's Delete button passes nothing.
 */
export interface DestroyOptions {
  readonly beforeDelete?: (
    tx: Pick<Db, "execute">,
    article: { readonly id: string },
  ) => Promise<void>;
}

/**
 * Finding a passage anywhere in the library — the home page's search box.
 *
 * Deliberately NOT `findPassages` (src/search.ts), which is one article, one
 * model call and a confidence score. This one is a text index: free, instant,
 * and with nothing to be uncertain about.
 *
 * **There is one adapter now, Postgres.** It matches English lexemes, so
 * `writes` finds "writing" and "write-nots" and `the` finds nothing at all (a
 * stop word). Until 2026-09-05 a filesystem adapter stood beside it and matched
 * substrings instead — `the` inside "theory", and no inflections — so the two
 * disagreed on single words, which a cross-family review caught after this
 * comment had called that case safe.
 * See docs/plans/260826k-library-shelf-actions-and-search.md.
 *
 * **`excludeSlug` is not a matching rule** — it is a promise that a named
 * article is absent, and it is kept inside the query, before the cap. See
 * `LibrarySearchOptions`.
 */
export interface LibrarySearch {
  /**
   * @param query what the reader typed, raw. Each adapter parses it its own way.
   * @param limit the most hits to return. The caller says whether the answer was cut.
   * @param opts see `LibrarySearchOptions`. Absent means all active articles.
   */
  searchLibrary(
    query: string,
    limit: number,
    opts?: LibrarySearchOptions,
  ): Promise<{ hits: LibraryHit[]; capped: boolean }>;

  /**
   * How many of the reader's **archived** articles have a passage
   * `searchLibrary` would match — counted, so uncapped. What the shelf says
   * beside a search run with Include archived off (plan 261002b § Part D).
   */
  countArchivedMatches(query: string): Promise<number>;
}

/**
 * **The shelf's filter topics** — `GET /api/library/terms`.
 * docs/plans/260928a-shelf-facet-terms.md; the Postgres half is
 * src/store/pg-shelf-terms.ts, which says why a read may write here.
 */
export interface ShelfTermsStore {
  /**
   * The ambient reader's topics over the shelf proper, or over active **and**
   * archived with `archived: true`. Fills missing candidate rows for at most
   * `budgetMs` (at least one article per call) and says how many are still
   * `pending`.
   */
  terms(scope: { archived: boolean }, opts?: { budgetMs?: number }): Promise<LibraryTermsResponse>;

  /**
   * What `terms` computes its answer from, before the chooser runs: the same
   * owner-scoped set, the same bounded fill. src/shelf-topics.ts chooses from
   * it, with or without a model's scores.
   */
  snapshot(scope: { archived: boolean }, opts?: { budgetMs?: number }): Promise<ShelfTermsSnapshot>;

  /* ---- the model's scores, one row per (owner, scope) — src/shelf-topics.ts ---- */

  /** The ambient reader's stored row for this scope, or `null` if there is none. */
  readScores(scope: TopicScope): Promise<StoredTopicScores | null>;
  /**
   * **Take the refresh, or learn somebody else has it.** One statement: the
   * claim lands only when no live claim exists, `retry_after` has passed, and
   * the stored result is not already for `inputHash`. Returns the claim id to
   * fence the write with, or `null`.
   */
  claimScores(scope: TopicScope, inputHash: string, leaseMs: number): Promise<string | null>;
  /**
   * Store a result, **only if `claimId` is still the row's claim** — so a
   * claimant that outlived its lease cannot write over its successor. Clears the
   * claim and the backoff. `false` when the fence refused.
   */
  writeScores(scope: TopicScope, claimId: string, result: TopicScoresResult): Promise<boolean>;
  /** A failed refresh: clears the claim, counts the failure, and pushes `retry_after` out by the backoff. */
  failScores(scope: TopicScope, claimId: string): Promise<void>;
  /** Give the claim back without counting a failure, and wait `retryAfterMs` before the next — the fuse's answer. */
  releaseScores(scope: TopicScope, claimId: string, retryAfterMs: number): Promise<void>;

  /* ---- the model's topic set, one row per owner — src/shelf-topic-sets.ts ---- */

  /**
   * **Every article on the ambient reader's shelf, active and archived**, as
   * the topic model sees it, newest first. One query and no fill: `textHash`
   * is the stored phrase run's, or null when the article has none yet.
   */
  topicShelf(): Promise<TopicShelfArticle[]>;
  /** The ambient reader's stored topic set, or `null` if there is no row. */
  readTopicSet(): Promise<StoredTopicSet | null>;
  /**
   * **Take the work, or learn somebody else has it.** One statement: the claim
   * lands only when no live claim exists and `retry_after` has passed. Creates
   * the row if there is none. Returns the claim id to fence the write with, or
   * `null`.
   */
  claimTopicSet(leaseMs: number): Promise<string | null>;
  /**
   * Store a whole re-think, **only if `claimId` is still the row's claim**:
   * replaces the topics and every membership, stamps `rethought_at`, clears
   * the claim and the backoff. `false` when the fence refused.
   */
  writeTopicSet(claimId: string, result: TopicSetResult): Promise<boolean>;
  /**
   * Add memberships for newly filed articles to the stored set, **only if
   * `claimId` is still the row's claim**: merges `members` over the stored
   * map (an article filed twice takes the newer answer), stamps `filed_at`,
   * clears the claim and the backoff. `false` when the fence refused.
   */
  fileIntoTopicSet(claimId: string, members: Record<string, string[]>): Promise<boolean>;
  /** A failed re-think or filing: clears the claim, counts the failure, and pushes `retry_after` out by the backoff. */
  failTopicSet(claimId: string): Promise<void>;
  /** Give the claim back without counting a failure, and wait `retryAfterMs` before the next. */
  releaseTopicSet(claimId: string, retryAfterMs: number): Promise<void>;
}

/** One shelf article as the topic model's path sees it. */
export interface TopicShelfArticle {
  /** `articles.id` — what a stored membership is keyed by. */
  articleId: string;
  slug: string;
  archived: boolean;
  /** The reader's rename if they made one, else the revision's title, else the slug. */
  title: string;
  /** `article_revisions.root_gist`, else its `abstract`, else null. */
  gist: string | null;
  /** The stored phrase run's `text_hash` (exact copies share one), or null when there is no run yet. */
  textHash: string | null;
}

/** One topic of a stored set — `TopicNode` in src/shelf-terms/model-topics.ts, which owns the shape. */
export interface StoredTopic {
  id: string;
  key: string;
  label: string;
  parent: string | null;
  depth: number;
}

/** A whole re-think, as stored. */
export interface TopicSetResult {
  model: string;
  promptVersion: number;
  /**
   * sha256 of the reader's normalised profile as the re-think was shown it, or
   * `""` when they had none. The profile is model input, so an edit is a reason
   * to re-think (GPT Sol, v1 review, finding 7).
   */
  profileHash: string;
  topics: StoredTopic[];
  /** article id → topic ids. An article the model placed nowhere has an empty list: it was seen. */
  members: Record<string, string[]>;
  /** How many distinct works the re-think read. */
  works: number;
  /** How many of them it placed in no topic. */
  unplaced: number;
}

export interface StoredTopicSet {
  /** Null until a re-think has succeeded once. */
  result: (TopicSetResult & { rethoughtAt: Date; filedAt: Date | null }) | null;
  /** Work somebody has taken. */
  claim: { until: Date } | null;
  failures: number;
  retryAfter: Date | null;
}

/** `active` is the shelf proper; `all` is active + archived (`?archived=1`). */
export type TopicScope = "active" | "all";

/** What the model is shown of one article. */
export interface ShelfTopicArticle {
  slug: string;
  /** The reader's rename if they made one, else the revision's title, else the slug. */
  title: string;
  /** `article_revisions.root_gist`, or null. */
  gist: string | null;
}

export interface ShelfTermsSnapshot {
  /** Step 2's input: every in-scope article that has been read and not skipped. */
  input: ChooseArticle[];
  /** The same articles as the model sees them, newest first. */
  articles: ShelfTopicArticle[];
  scope: { articles: number; skipped: number };
  /** In-scope articles not yet read. */
  pending: number;
}

/** A model's answer, as stored. */
export interface TopicScoresResult {
  inputHash: string;
  model: string;
  promptVersion: number;
  /** candidate key → 0–3. */
  scores: Record<string, number>;
}

export interface StoredTopicScores {
  /** Null until a refresh has succeeded once. */
  result: (TopicScoresResult & { computedAt: Date }) | null;
  /** A refresh somebody has taken, and the input it was taken for. */
  claim: { hash: string; until: Date } | null;
  failures: number;
  retryAfter: Date | null;
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
  /**
   * Search archived articles too. Off by default, and chat's `search_library`
   * never sets it: archived articles are out of the index unless the reader has
   * asked for them — the shelf's **Include archived** chip
   * (docs/project/library.md; plan 260930d, SPIDERYARN-READING2-72). Each hit
   * says which it is (`LibraryHit.archived`), so a passage from an archived
   * article can be marked as one rather than opening a ghost.
   */
  readonly includeArchived?: boolean;
}

/* ------------------------------------------------- the reader's own state -- */

/**
 * What a stale `pending` row looks like, for both sweeps.
 *
 * **`keep` is this process's live work and `graceMs` is everybody else's.**
 * That split is the whole shape of the problem. The former filesystem stores
 * decided staleness from an in-memory `Set` in `src/routes.ts`, which was right
 * for one server on one disk and silently wrong the moment two processes shared
 * a database: process B sees process A's live row in nobody's set and errors
 * an answer that is still arriving. On Vercel that is not an edge case, it is
 * the ordinary shape.
 *
 * So the stores take both — spare what this process is doing, and
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
 * A question and its reply, as stored, in the thread they now belong to.
 *
 * What `appendSpoken` returns, and the part of a `Turn` that is not the fence:
 * a spoken exchange is written finished, so there is no attempt to carry.
 */
interface StoredExchange {
  readonly thread: ChatThread;
  readonly user: ChatMessage;
  readonly reply: ChatMessage;
}

/**
 * A turn, and the attempt now answering it.
 *
 * `attempt` is the pending reply's token, and `finish` must present it. It
 * was `string | undefined` for two reasons that have both gone: the filesystem
 * store, which had no attempts and was deleted on 2026-09-05, and
 * `appendSpoken`, which has none legitimately and now returns a
 * `StoredExchange` instead of a `Turn` with a hole in it.
 */
export interface Turn extends StoredExchange {
  readonly attempt: string;
}

/**
 * What `ChatStore.markHintOpened` answers. The three refusals are different
 * facts for the route: the message is not there, it is not an answer in a
 * Recall thread, or the answer no longer carries the hint that was pressed.
 */
export type HintOpened =
  | { ok: true; hintOpenedAt: string }
  | { ok: false; reason: "no-such-message" | "not-a-recall-answer" | "hint-changed" };

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
     * `withTurn` in src/chat.ts. A different anchor for a thread that already
     * exists is refused there with a `ChatConflict`, inside the transaction,
     * as well as by the route; the identical one passes.
     */
    turn: {
      threadId: string;
      question: string;
      anchor?: ChatAnchor;
      /**
       * Chat or Learn — like `anchor`, applied **only when this turn creates
       * the thread**. `withTurn` throws `ChatConflict` on one that contradicts
       * an existing thread rather than ignoring it, which is what makes the
       * rule hold under Postgres too: the route's own check runs inside
       * `inTurnOrder`, and that is per-process.
       */
      kind?: ThreadKind;
      /**
       * The reader pressed the "?" rather than typing — written onto the
       * **user** message, in the same write as the pending reply.
       *
       * `retry` and `edit` take no `help` because theirs comes from the
       * **question** they are re-asking, which is the row `withRetry` and
       * `withEdit` already hand back. See `ChatMessage.help`.
       */
      help?: true;
    },
    now?: () => string,
  ): Promise<Turn>;

  /**
   * Patch one message in place. **Never appends**, and bumps the thread's
   * `updatedAt` whenever the *thread* matches — even if the message does not.
   * The panel's ordering depends on that clock.
   *
   * **Pass the `attempt` this answer belongs to.** A retry keeps the message
   * id, so identity cannot say which call is reporting: without the attempt, a
   * model call that a sweep already buried overwrites the retry the reader is
   * watching. So the options are required and so is the attempt in them; the
   * store also refuses a call without one at run time (`MissingAttempt`), for
   * a caller that got round the type.
   */
  finish(
    slug: string,
    threadId: string,
    messageId: string,
    patch: Partial<ChatMessage>,
    opts: { attempt: string; now?: (() => string) | undefined },
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
  appendSpoken(slug: string, spoken: SpokenTurn, now?: () => string): Promise<StoredExchange>;

  rename(slug: string, threadId: string, title: string): Promise<ChatThread[]>;
  remove(slug: string, threadId: string): Promise<ChatThread[]>;

  /**
   * **The reader pressed Hint under a Recall answer.** Stamps
   * `hint_opened_at` once; a second press answers with the first time.
   *
   * `hint` is the hint's own text as the reader's browser split it, and it is
   * the fence: a retry reuses the answer's row, so a press still in flight
   * could otherwise mark the replacement answer as opened. The store stamps
   * only when the stored answer, split by `splitHint`, carries that same hint.
   */
  markHintOpened(slug: string, threadId: string, messageId: string, hint: string): Promise<HintOpened>;

  /** Turn abandoned `pending` answers into `error`. See `SweepOptions`. */
  sweepPending(slug: string, opts: SweepOptions): Promise<ChatThread[]>;
}

/**
 * "Find every passage that…", and the runs the reader has asked for.
 *
 * ## The attempt, and why `begin` hands one back
 *
 * A run is the reader's question and outlives any number of tries at answering
 * it; an **attempt** is one model call. The store keeps attempts on the row,
 * for the reason `SweepOptions` gives: `finish` must be
 * able to say *which* call is reporting, so that a late answer from a call
 * another process already declared dead cannot land on top of the retry the
 * reader is watching. So `begin` returns an opaque attempt token, the caller
 * carries it, and `finish` presents it. Both halves are required in the type.
 *
 * **`finish` returns the run or `undefined`** rather than the whole list. The
 * caller only ever did `.find(…)` on it and 404s when missing, and
 * `UPDATE … RETURNING *` answers that directly — zero rows *is* "deleted while
 * running", or "this attempt is no longer the live one".
 */
/**
 * What a search can end as: the hits, or the sentence saying why not.
 *
 * **Never `pending`**, and nothing but the answer: `finish` releases the
 * attempt whatever the patch says, so a patch leaving the run `pending` would
 * strip the fence off a row still waiting; and `id`, `criterion`, `kind` and
 * `sourceHash` are `begin`'s to set. It was `Partial<SearchRun>` until
 * 2026-10-04, with both rules held only at run time.
 */
export type SearchFinish =
  | { status: "done"; hits: SearchRun["hits"]; model?: string }
  | { status: "error"; error: string };

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
   * only wants the list does not pay for a scan of every block. The routes that
   * need both ask for both in one response, and say why where they do it
   * (`refereeCriteria` and `refereeClaims` in src/routes.ts).
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
   * and the kind match and that row's status is `error`** — all four, and the
   * status is the one this codebase carries a postmortem for. `kind` is
   * required rather than defaulted: a caller that forgot it would otherwise
   * store a quick search as a meaning one, and nothing would say so.
   *
   * **`revises`** (plan 261002h, search-as-you-type): a `wantedId` naming an
   * existing **quick** row, asked as quick, is re-asked in place with the new
   * criterion whatever its status — same id, `createdAt` and colour, a new
   * attempt. Anything else mints, always under a **new** id — an absent id
   * is a row deleted elsewhere, and must not be recreated. `withRun` in
   * src/searches.ts decides.
   *
   * **`sourceHash` is the caller's**: `hashBlocks` of the blocks it is about
   * to send the model, loaded before this call. The store does not read the
   * article's fingerprint itself, so the row cannot be stamped with a
   * different revision from the one answered (plan 261005i § D). Stored on a
   * mint, a retry and a revision alike.
   */
  begin(
    slug: string,
    sourceHash: string,
    criterion: string,
    kind: SearchKind,
    wantedId?: string,
    now?: () => string,
    options?: { revises?: boolean },
  ): Promise<{ run: SearchRun; attempt: string }>;

  /**
   * Write the answer, if this attempt is still the live one.
   *
   * `attempt` is required. Falling back to identity without it would put back
   * exactly the race the column exists to close — a caller that forgot to
   * carry the token would recreate it in full, and nothing would say so. The
   * store still refuses a missing one at run time (`MissingAttempt`), for a
   * caller that got round the type.
   *
   * The patch ends the run — see `SearchFinish`.
   */
  finish(
    slug: string,
    runId: string,
    patch: SearchFinish,
    attempt: string,
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
 * for, because it is the same problem: a run is the referee's question and an
 * attempt is one model call. Read that interface first; only the differences
 * are written out here.
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
/** What a criterion can end as — `SearchFinish`, with results for hits. */
export type CriterionFinish =
  | { status: "done"; results: SavedCriterion["results"]; model?: string }
  | { status: "error"; error: string };

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
   *
   * `sourceHash` is the caller's, of the blocks it is sending —
   * `SearchStore.begin`.
   */
  begin(
    slug: string,
    sourceHash: string,
    criterion: string,
    config: RefereeCriterionConfig,
    wantedId?: string,
    now?: () => string,
  ): Promise<{ row: SavedCriterion; attempt: string }>;

  /**
   * Write the answer, if this attempt is still the live one.
   *
   * `attempt` is required, and the patch ends the criterion — both for
   * `SearchStore.finish`'s reasons.
   */
  finish(
    slug: string,
    id: string,
    patch: CriterionFinish,
    attempt: string,
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
 * The Postgres adapter was built, and src/store/index.ts wires it with
 * `guarded(...)` like every other seam.
 */
/**
 * What a claims run can end as. **Never `pending`**: `finish` releases the
 * attempt token whatever the patch says, so a patch leaving the row `pending`
 * would strip the fence off a row still waiting for an answer.
 * `SearchFinish` and `CriterionFinish` say the same of their stores.
 *
 * **And only the fields a finish writes.** `createdAt` and `sourceHash` are
 * `begin`'s: the adapter ignored them in a patch, silently, so the type now
 * refuses them.
 *
 * **Two arms, like its siblings, since 2026-10-07.** It was one `Partial<Pick>`
 * with a `status` beside it, which let an `error` finish carry claims. Nothing
 * did, and the database now refuses the row (`referee_claims_empty_unless_done`
 * in src/db/schema.ts), so the type refuses it first. The `error` arm may still
 * say `claims: []`, as the route does: typed as the **empty tuple**, so `[]`
 * compiles and anything with a claim in it does not.
 * tests/store-pg-referee-claims.test.ts holds both halves.
 */
export type ClaimsFinish =
  | { status: "done"; claims: ClaimsRun["claims"]; model?: string; claimsOmitted?: number }
  | { status: "error"; error: string; claims?: [] };

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
   * the same paper. src/store/pg-referee-claims.ts § One run per article.
   *
   * `sourceHash` is `hashBlocks` of **the blocks the caller is about to send**,
   * not something the store reads: the caller loaded them before this call, and
   * a re-extraction in between would otherwise stamp the new revision's hash on
   * an answer about the old blocks.
   *
   * `attempt` is this run's token. `finish` needs it, and a later `begin`
   * replaces it — which is what stops a slower, older run writing over a newer
   * one.
   */
  begin(
    slug: string,
    sourceHash: string,
    now?: () => string,
  ): Promise<{ run: ClaimsRun; attempt: string }>;

  /**
   * Write the answer over the `pending` run **this attempt began**.
   *
   * `null` when that run is not there to write to: the row went away, a newer
   * `begin` took it, or the sweep already failed it. Never a resurrection, and
   * never a write over somebody else's run.
   */
  finish(slug: string, patch: ClaimsFinish, attempt: string): Promise<ClaimsRun | null>;

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
   * src/store/pg-referee-claims.ts).
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
/**
 * Where Citations mode's *Find it* keeps a page it found — one row per
 * `(article, entry id)`, the glossary lookups' shape and for their reason.
 * Only a kept find is saved; the read half is `loadCitations`, which attaches
 * each row to its entry. src/citation-find.ts, src/store/pg-citation-finds.ts.
 */
export interface CitationFindStore {
  save(slug: string, entryId: string, find: CitationFind): Promise<void>;
  /**
   * One stored find, or `null` — for *Investigate*, which needs the URL of the
   * page a current *Look it up* read (the row carries its host, not its URL).
   * Owner-scoped: a slug the caller does not own is a 404.
   */
  load(slug: string, entryId: string): Promise<CitationFind | null>;
}

/**
 * **Where Citations' *Investigate* keeps an answer** — one row per `(article,
 * entry)`, overwritten by a second press. The read half is `loadCitations`,
 * which attaches a row only while its fingerprint matches. Owner-scoped.
 * src/store/pg-citation-investigations.ts.
 */
export interface CitationInvestigationStore {
  save(slug: string, entryId: string, investigation: CitationInvestigation): Promise<void>;
}

/**
 * **An uploaded paper's guessed web address: a claim, then an answer** — one
 * row per article, src/store/pg-source-guesses.ts.
 * docs/plans/260929g-canonical-link-for-an-uploaded-paper.md § Decisions 2.
 *
 * Every method is owner-scoped: a slug the caller does not own is a 404 before
 * anything is read or written.
 */
export interface SourceGuessStore {
  /** The guess as the owner's payload carries it, or `undefined` when nobody has looked. */
  read(slug: string): Promise<SourceGuess | undefined>;
  /**
   * **Take the search, or learn why not — in one statement**, so of two
   * concurrent callers exactly one is `claimed`. A `searching` row older than
   * `staleMs` is reclaimed; a claim that would be the third is refused, and the
   * row settles as `none` (`why: "attempts"`).
   */
  claim(slug: string, opts: { staleMs: number }): Promise<SourceGuessClaim>;
  /**
   * Write the answer — **only while this token still holds the claim**
   * (`where status = 'searching' and claim_token = $token`). `false` means a
   * later claim has taken over and this answer was discarded.
   */
  finish(slug: string, token: string, outcome: SourceGuessOutcome): Promise<boolean>;
  /**
   * Give the claim back unanswered, so the next open may reclaim it at once.
   * `refund` also takes back the attempt it counted — for a claim that spent
   * nothing (the allowance refused it). Fenced by the token, like `finish`.
   */
  release(slug: string, token: string, opts: { refund: boolean }): Promise<boolean>;
}

/** At most this many claims per upload; the table's CHECK holds it too. */
export const SOURCE_GUESS_MAX_ATTEMPTS = 2;

export type SourceGuessClaim =
  /** You are searching. `attempt` is 1 or 2; keep `token` for `finish`/`release`. */
  | { kind: "claimed"; token: string; attempt: number }
  /** Somebody else's claim is live. */
  | { kind: "busy" }
  /** Already answered — or just now settled as `none` by the attempt cap. */
  | { kind: "settled"; guess: Extract<SourceGuess, { status: "found" | "none" }> };

export type SourceGuessOutcome =
  | {
      status: "found";
      url: string;
      host: string;
      kind: "canonical" | "matching";
      matchedBy: "doi" | "arxiv" | "content";
      searches: number | null;
      model: string;
    }
  | { status: "none"; why: string; searches: number | null; model: string | null };

export interface GlossaryLookupStore {
  load(slug: string): Promise<LookupsByTerm>;
  save(slug: string, termId: string, lookup: GlossaryLookup): Promise<LookupsByTerm>;
  /**
   * **Add a term the reader looked up to their own glossary**, with the answer
   * they read as its explanation — docs/plans/261002f-glossary-add-a-looked-up-term.md.
   *
   * `quote` is the article's own words the term was found as; "already there"
   * means some entry in the owner's list (the model's or one added before)
   * names exactly those words, and then nothing is written. One transaction
   * that locks the article first, so two tabs adding *attention head* and
   * *attention heads* make one entry, not two. Owner-scoped: a slug the caller
   * does not own is a 404.
   */
  addTerm(
    slug: string,
    term: { name: string; quote: string; lookup: GlossaryLookup },
  ): Promise<AddedTerm>;
}

/**
 * How long the owner has spent on each block of one article, in seconds —
 * docs/plans/260916c-show-where-you-have-spent-time-reading-in-the-spine-and-gutter.md.
 * Both methods are owner-scoped: a slug the caller does not own is a 404.
 */
export interface ReadingTimeStore {
  /** Every block with a total, keyed by block id. Blocks never read are absent. */
  read(slug: string): Promise<Record<string, number>>;
  /**
   * **Adds** each value to that block's running total. Ids this article has
   * never had are dropped silently, so one stale id cannot fail a batch; the
   * caller validates the shape before this is reached.
   */
  add(slug: string, seconds: Record<string, number>): Promise<void>;
}

/**
 * The owner's finished quiz marks on one article — `quiz_attempts`,
 * docs/plans/261005b-quiz-answers-are-kept-and-restored.md. Both methods are
 * owner-scoped: a slug the caller does not own is a 404.
 */
export interface QuizAttemptStore {
  /**
   * **Append one finished mark**, and return when the database says it
   * happened (the row's `created_at`, ISO). Never an upsert: answering again
   * is a second row.
   */
  record(
    slug: string,
    attempt: {
      batchId: string;
      questionId: QuizQuestionId;
      /** The question's words, copied in — the batch they came from can be replaced. */
      question: string;
      answer: string;
      reply: string;
    },
  ): Promise<string>;
  /** The latest kept answer to each question of one batch; other batches' rows are not returned. */
  latestForBatch(slug: string, batchId: string): Promise<QuizKeptAnswer[]>;
}

/**
 * The glossary entries the owner has hidden on one article, for themselves —
 * docs/plans/261002c-glossary-hide-an-entry-dig-deeper-from-the-card-hyphens-match-spaces.md § 2.
 * Both methods are owner-scoped (a stranger's slug is a 404), refuse a
 * malformed id with a 400, and are idempotent. The read is `loadGlossary`,
 * which attaches `hidden: true`; there is no second GET.
 */
export interface GlossaryHiddenStore {
  /** Hide one entry. **A 404 when the current glossary has no entry with that id.** */
  hide(slug: string, entryId: string): Promise<void>;
  /** Show it again. No existence check, so an orphaned row can still be removed. */
  unhide(slug: string, entryId: string): Promise<void>;
}

/**
 * The reader's global profile — "about you", true on every article rather
 * than on one. docs/plans/260826t-reader-profile.md is the design; src/profile.ts
 * is where the two boxes (this one and `ShelfState.purpose`) become one string
 * a prompt can carry.
 *
 * Not article-scoped, unlike everything else in this file — there is one
 * profile per reader, which today means one profile, full stop
 * (docs/project/auth.md). There was a filesystem adapter — a thin wrapper over
 * `loadReaderProfile` / `saveReaderProfile` in src/profile.ts, over one
 * `data/reader.json` — and it went on 2026-09-05 with the rest of the
 * filesystem store. `src/profile.ts` kept the normalising, capping and hashing
 * and lost the file; the adapter is `reader_profiles`, one row per `owner_id`.
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
   * wire (and what the filesystem store held, until 2026-09-05).
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

  /**
   * **Whether an import queues the main-mode jobs for this reader.** `true`
   * for a reader who has never chosen, including one with no row at all.
   *
   * A boolean here and a time in the row (`auto_modes_off_at`): nothing shows
   * when it was switched off, so the contract carries only the answer.
   * docs/plans/261004h-post-import-modes-decided-on-the-server-for-every-import-path.md.
   */
  readAutoModes(): Promise<boolean>;

  /**
   * Switch it on or off, and answer with what is now stored. Off twice keeps
   * the first time; on clears it.
   */
  writeAutoModes(on: boolean): Promise<boolean>;
}

/**
 * Who has signed up, and how much each of them has made.
 *
 * **The one contract in this file that is not about the reader asking**, and
 * the only one whose implementation runs a query with no owner filter on it.
 * It is a contract rather than a bare function for a historical reason: until
 * 2026-09-05 the filesystem store refused it in the same shape everything else
 * was selected in, through an adapter whose only method threw. Today
 * src/store/index.ts wires the one Postgres implementation with `guarded(...)`.
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
  /**
   * `from` is `"readers"` to leave out the administrators' own reports
   * (`FeedbackFrom` in src/types.ts); the cursor carries no filter, so a caller
   * paging under one passes it on every page.
   */
  listFeedbackAcrossOwners(
    limit: number,
    cursor: FeedbackCursor | null,
    from?: FeedbackFrom,
  ): Promise<AdminFeedbackPage>;
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
  /**
   * **Mark one report as ignored, or take the mark back** — for
   * `PATCH /api/admin/feedback/:ownerId/:id`, the one write on this side of the
   * contract. Sets or clears `ignored_at` and nothing else; `null` for a pair
   * that is not a report. src/store/pg-admin-feedback.ts.
   */
  setFeedbackIgnoredAcrossOwners(
    ownerId: string,
    id: string,
    ignored: boolean,
  ): Promise<AdminFeedbackReport | null>;
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
import type { ShareLinkState, Visibility, VisibilityState } from "../types.js";

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
 * **High-powered AI, one article at a time** — `articles.high_power_since`.
 * Postgres only; src/store/pg-high-power.ts, and
 * docs/plans/260930f-high-powered-ai-per-article.md.
 */
export interface HighPowerStore {
  /**
   * Switch it off for one of the caller's own articles. This is deliberately
   * off-only: a reader's switch-on must go through the charged transaction.
   */
  switchOff(slug: string): Promise<{ highPowerSince: string | null }>;
  /**
   * The administrator's exempt switch-on. The implementation checks the
   * ambient owner too, so this cannot become an uncharged reader capability by
   * being called from a new route.
   */
  switchOnForAdmin(slug: string): Promise<{ highPowerSince: string }>;
  /**
   * The column for `slug` owned by `ownerId`, or `{ found: false }` when there
   * is no such row — which, for the job runner, is either a fresh ingest (the
   * row is born by a later step) or something that went wrong, and only the
   * caller can tell which.
   */
  read(
    slug: string,
    ownerId: OwnerId,
  ): Promise<{ found: false } | { found: true; highPowerSince: Date | null }>;
}

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

/**
 * **An article's private link**, for its owner — src/store/pg-share-link.ts.
 *
 * Every method throws 404 for a slug the caller does not own, never 403, as
 * `VisibilityStore.set` does. Each answers the state the link is now in, and
 * that state is the one value in the app that carries the key.
 */
export interface ShareLinkStore {
  /** The link as it stands, so the card can show it again. Changes nothing. */
  read(slug: string): Promise<ShareLinkState>;
  /**
   * Make a link, with a **new** key every time: a key that was on stops
   * working in the same statement. Refuses a paper that has not been read
   * through, as going public does. The route has already refused a request
   * without `rightsConfirmed: true`; the audit row records that it was given.
   */
  create(slug: string): Promise<ShareLinkState>;
  /** Turn it off. Already off changes nothing and records nothing. */
  turnOff(slug: string): Promise<ShareLinkState>;
}

/* -------------------------------------------------------- the AI ledger -- */

/**
 * What a read of the ledger came back with — the rows, **and the two different
 * ways they can be fewer than the calls that were actually made**.
 *
 * Three fields rather than one because a total nobody can tell is short is worse
 * than no total, and because the two shortfalls are not the same fact:
 *
 * - **`unreadable`** — *a row exists and could not be parsed.* A truncated
 *   JSONL tail, a hand-edited line, a row whose `cost_source` disagrees with its
 *   own numbers. The money happened and the evidence is damaged. Always `0` from
 *   Postgres, where a row either parsed on the way in or was never written.
 * - **`lateCalls`** — *a row that should exist was never written at all.* The
 *   money happened and there is no evidence whatsoever.
 *
 * They must not be added together into one "incomplete" count: a reader chasing
 * the first goes and looks at the file, and a reader chasing the second has
 * nothing to look at and must go to the logs. See `totalLedger` in
 * [ai-calls.ts](ai-calls.ts), which is the only sanctioned way to turn this into
 * money, and refuses to hand back a figure called a total when either is set.
 *
 * ## Why `lateCalls` is here at all, and what it does not mean
 *
 * The ledger table cannot know about a call that is still in flight. A row is
 * written when a call *finishes* — `beginSpend` mints its id and adds it to the
 * collector's `active` map before the request goes out, and `recordSpend` is
 * what turns it into a row (src/ai-spend.ts). `collectSpend` sets `closed` on
 * its box **before** draining the writes, deliberately, so anything finishing
 * after the report has already been taken gets a warn line and a bump of
 * `lateCalls()` and **no row, ever**. That is money spent that is in no total,
 * and from the reading end absence is unknowable: the query comes back short,
 * `unreadable: 0`, looking exactly like a cheaper job.
 *
 * So the only honest source is the process-side counter, and the store reads it.
 * **Two things it is not**, both of which have to be said out loud or the number
 * will be misread:
 *
 * 1. **It is not attributable to this read.** `lateCalls()` is process-global
 *    and monotonic — a late call cannot be attributed to a job, because the
 *    whole content of the failure is that nothing was written down about it.
 *    So a non-zero value means *"a call somewhere in this process was never
 *    recorded; this total may be short"*, never *"this job is short by n"*.
 *    Once it is non-zero every later read in that process carries the caveat.
 *    That is the conservative direction, and it is the price of not having the
 *    row.
 * 2. **It only sees this process.** `npm run cost` is a fresh process reading a
 *    ledger the server wrote, so it will read `0` however many calls the server
 *    lost. The caveat reaches the caller that ran the work — which is the one
 *    that printed the wrong bill — and cannot reach anybody else.
 *
 * **The real fix is a row at call-open time**, so that a started call is on disk
 * before it can be lost and a finish updates it — scoped in
 * docs/plans/260827q-ai-cost-tracking.md. This is the honest stopgap until then:
 * it cannot recover the money, but it stops a short figure being quoted as a
 * whole one.
 */
export interface LedgerRead {
  rows: AiCallRow[];
  /** Rows that exist and would not parse. See above; never merged with the next. */
  unreadable: number;
  /**
   * Calls that finished after their collector had reported and so were never
   * written — **process-wide, and not attributable to this read**. Read from
   * `lateCalls()` in [../ai-spend.ts](../ai-spend.ts) at the moment of the query.
   */
  lateCalls: number;
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
   * **and both ways the answer can be short**, because a job total that is short
   * must be able to say so. See `LedgerRead`: rows that would not parse, and
   * rows that were never written because the call outlived its collector.
   *
   * Turn the result into money with `totalLedger`, never by summing the rows: a
   * figure read straight off `rows` is one that cannot tell you it is short, and
   * that is the bug this returns three fields to prevent.
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
  /** GPT-Live only: the text model behind the voice, and the rate card for `backend` reports. */
  backendModel: string | null;
  /** GPT-Live only: OpenAI's id for the session, once its create call has answered. */
  providerSessionId: string | null;
  /**
   * GPT-Live only: the highest cumulative voice-seconds figure already billed.
   * Zero on a Realtime session. **A copy read outside a lock is stale by the
   * time you use it** — only `advanceVoiceSeconds` may act on it.
   */
  voiceSecondsReported: number;
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
 * Deliberately a few narrow methods rather than a general upsert. Every one of
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
  /**
   * The browser was never given a usable ticket. Sets the close time and
   * reason, preserving a known provider id even when accounting failed.
   * Not `close`, which also backfills
   * `connectedAt` on the reasoning that a session which reached its end must
   * have connected; this one did not. First close wins, as there.
   */
  closeUnopened(id: string, ownerId: string, at: string, reason: string, providerSessionId?: string): Promise<void>;
  /**
   * **GPT-Live's voice meter: advance the high-water mark and write the row for
   * the difference, or do neither.**
   *
   * GPT-Live reports voice seconds as a running total, so two reports are not
   * two bills. This locks the session row, hands the locked row to `rowFor`,
   * and — when `rowFor` returns a row — inserts it and moves
   * `voiceSecondsReported` up to `seconds`, all in one transaction. `rowFor`
   * returning `null` means the report adds nothing (a repeat, or an older
   * figure): nothing is written and the mark stays.
   *
   * `rowFor` is a callback because the pricing lives in src/live.ts and must
   * see the mark **as read under the lock**; a copy from an earlier `find`
   * would let two concurrent reports both bill the same seconds. It may throw
   * to refuse the report, which rolls the transaction back.
   *
   * `providerSessionId`, when given, is recorded in the same transaction — the
   * create route's one write after OpenAI answers.
   *
   * Returns the row written, or `null`. Also `null` when there is no such
   * session for this owner, in which case `rowFor` is never called.
   */
  advanceVoiceSeconds(
    id: string,
    ownerId: string,
    opts: {
      seconds: number;
      providerSessionId?: string;
      rowFor: (locked: RealtimeSession) => AiCallRow | null;
    },
  ): Promise<AiCallRow | null>;
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
import type { FeedbackEnding } from "../feedback-ending-values.js";
import type { EarlierFeedback, EarlierFeedbackStatus } from "../types.js";

/** One earlier report as the store reads it: the wire's fields bar `shipped`, which the route adds. */
export type MyFeedback = Omit<EarlierFeedback, "shipped">;

export interface MyFeedbackPage {
  reports: MyFeedback[];
  more: boolean;
  /** Uncapped, unfiltered, and of the same snapshot as `reports`. */
  counts: MyFeedbackCounts;
}

/** Keep only these report ids (`in`), or everything but them (`out`). */
export interface FeedbackIdFilter {
  ids: readonly string[];
  keep: "in" | "out";
}

/** The report ids this build has a note for, under the ending each has (src/feedback-ending.ts). */
export type FeedbackEndingIds = Readonly<Record<FeedbackEnding, readonly string[]>>;

/** One earlier report with what only an admin's list carries from the row: its number, status and mark. */
export interface MyFeedbackWithStatus extends MyFeedback {
  number: number;
  status: EarlierFeedbackStatus;
  /** ISO, or null. */
  ignoredAt: string | null;
}

export interface MyFeedbackStatusPage {
  reports: MyFeedbackWithStatus[];
  more: boolean;
  /** Uncapped, unfiltered, of the same snapshot as `reports`; the four sum to every report the reader filed. */
  counts: Record<EarlierFeedbackStatus, number>;
}

/**
 * **A reply to a question, as the route hands it to the store.** Named field
 * by field, like `NewFeedback`; the owner is `currentOwnerId()`, never here.
 */
export interface NewFeedbackAnswer {
  /** Client-minted, and the idempotency key. A Spideryarn id. */
  id: string;
  /** `q-k3m9qt`. The route has already checked it against the compiled questions. */
  questionId: string;
  body: string;
  /** The server's own, from the mapping a report's comes from. Never the browser's. */
  environment: FeedbackEnvironment;
}

/** A reply as it is stored. No owner and no environment: the caller is the owner, and neither is theirs to read back. */
export interface StoredFeedbackAnswer {
  id: string;
  questionId: string;
  body: string;
  /** ISO. */
  createdAt: string;
}

/**
 * **Three outcomes** (plan 261007d, F15), a union so the route must say which
 * status each is: written; this owner already sent exactly this, so nothing
 * was written and the stored row comes back; or this id is already another
 * reply (a different question or different words), and nothing changed.
 */
export type FeedbackAnswerSubmission =
  | { kind: "created"; answer: StoredFeedbackAnswer }
  | { kind: "duplicate"; answer: StoredFeedbackAnswer }
  | { kind: "conflict" };

/** A report a question is about, as much as the question's card shows of it. */
export interface LinkedFeedbackReport {
  id: string;
  number: number;
  /** The first line of what the reader wrote, cut to a line's length. */
  firstLine: string;
}

/** How many reports this reader has filed, and how many of them are among `countIds`. */
export interface MyFeedbackCounts {
  all: number;
  in: number;
}

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
 * `RefereeCriteriaStore.finish` refuse a call without an attempt rather than
 * falling back to identity: a caller that merely forgot to carry
 * it through would put the whole cross-process race back — a model call the
 * sweep already buried landing on top of the retry the reader is watching
 * arrive — with nothing anywhere reporting it.
 *
 * **The types refuse it first, since 2026-10-04**
 * (docs/plans/261004d-fifth-sweep-cluster-6b-store-contracts-require-the-attempt-and-markers-outlive-finish.md,
 * which is Stage H of
 * docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md):
 * `attempt` was optional in all four signatures for the filesystem store, and
 * is now required. This class stayed, for the caller the compiler does not
 * see — a cast, an `any`, a spread of arguments built elsewhere — because the
 * thing it guards is a silent overwrite and the guard is one comparison.
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
 * **Thirty reports an hour, per owner.**
 *
 * Said plainly, and the plan says it too: this stops a loop and one account
 * hammering. It is not a defence against account farming and does not pretend
 * to be. It is the first authenticated write in this repo with no natural
 * ceiling — a comment is bounded by passages, a job by articles — which is why
 * it has one at all.
 *
 * It was ten until 2026-09-04, when Greg hit it in an afternoon's testing. Ten
 * was low enough to stop the person the button is *for* — somebody who has just
 * found four things wrong on one page — so it is three times that. Nothing about
 * the argument above changes: a loop still runs out, and a farm still would not.
 */
export const FEEDBACK_HOURLY_CAP = 30;

/** The window the cap counts over. */
export const FEEDBACK_WINDOW_MS = 60 * 60 * 1000;

/**
 * The cap this owner is held to, or `null` for **no cap at all**.
 *
 * `null` only for an administrator, and the reason is what the cap is for: it
 * stops a loop and one account hammering, and the account that files reports on
 * purpose all afternoon while testing is the one account we do not need
 * protecting from. Greg, 2026-09-04, having been refused mid-session.
 *
 * **A third value rather than a large number** — `Infinity` would still travel
 * into `.limit()` on the counting query and into a comparison that means
 * something else. `null` is a shape the caller has to narrow, so the whole
 * count-and-compare is skipped rather than made vacuous.
 *
 * The owner id **is** the account id — every `owner_id` in the schema points at
 * `auth.users(id)` — so this asks `isAdmin` the same question src/routes.ts asks
 * of `/api/admin`, and there is no second list of who counts.
 */
export function feedbackHourlyCap(ownerId: string): number | null {
  return isAdmin(ownerId) ? null : FEEDBACK_HOURLY_CAP;
}

/**
 * **A bug report, filed by a reader who is looking at the thing that went
 * wrong.** docs/plans/260831aj-feedback-button-and-bug-reports-to-sentry.md.
 *
 * **Postgres only**, and `guarded(...)` in src/store/index.ts like every other
 * seam. Until 2026-09-05 a filesystem *refusal* stood beside the Postgres
 * implementation, the same asymmetry `AdminStore` and `VisibilityStore` had; a
 * files adapter was never written, and the store it would have sat on is gone
 * (docs/plans/260831b-finish-the-database-move.md).
 *
 * The refusal has to reach the reader as a sentence saying the report was not
 * saved — a button that can only fail is worse than no button, because pressing
 * it is how you find out.
 */
export interface FeedbackStore {
  /**
   * File one report. **Append-only, idempotent, and rate-limited, in one
   * transaction** — rate-limited for everybody `feedbackHourlyCap` gives a
   * number to, which is everybody but the administrator.
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
   * **This reader's own reports, newest first**, at most `limit` of them, and
   * whether there were more — the Feedback dialog's Earlier tab.
   * docs/plans/260916c-your-earlier-feedback-tab-in-the-feedback-dialog.md.
   *
   * Owner-scoped like `read`, and the owner is never an argument. Six fields a
   * report and no more: see `EarlierFeedback` in src/types.ts for why the email,
   * the address, the diagnostics and the screenshot are not among them. `page`
   * and `at` are made from the address here, in the store, by
   * src/feedback-page.ts, so the address itself is never part of the answer.
   *
   * `filter` narrows by report id — kept `in` or left `out` of the list —
   * **beside** the owner predicate, never instead of it; the Earlier tab's
   * shipped/unshipped filter. The store knows nothing of what the ids mean.
   * `shipped` is not the store's to say: the route adds it.
   * docs/plans/260930e-earlier-tab-filters-by-done-from-the-notes.md.
   *
   * `counts` is **how many of this reader's reports there are, and how many are
   * among `countIds`** — the numbers on the Earlier tab's pills — read in the
   * same read-only snapshot as the list, so "50 most recent of N" cannot
   * contradict `more`. `in` is the same predicate as `keep: "in"`, so
   * `all - in` is what `keep: "out"` would list with no cap.
   * docs/plans/261003b-earlier-tab-counts-on-the-pills.md.
   */
  listMine(limit: number, countIds: readonly string[], filter?: FeedbackIdFilter): Promise<MyFeedbackPage>;
  /**
   * **`listMine` with a status and a number on each report** — an admin's
   * Earlier tab, `GET /api/admin/feedback/earlier`.
   * docs/plans/261007d-earlier-tab-says-what-became-of-each-report-numbers-them-and-asks-greg-questions-in-place.md.
   *
   * **Owner-scoped exactly as `listMine` is**, and the owner is never an
   * argument: this is the caller's own list, not a view across owners. That
   * the caller is an admin is the route's namespace's business, not this
   * method's.
   *
   * `endings` is which report ids have a note and how it ended; with the row's
   * `ignored_at` that decides each report's status (`EarlierFeedbackStatus` in
   * src/types.ts has the rule). The status is one SQL expression, used for the
   * row, the filter and the counts, so the three cannot disagree. `show`
   * narrows **before** the cap: the newest `limit` reports of that status.
   * `counts` is per status, uncapped, in the same snapshot as the list.
   */
  listMineByStatus(
    limit: number,
    endings: FeedbackEndingIds,
    show: EarlierFeedbackStatus | "all",
  ): Promise<MyFeedbackStatusPage>;
  /**
   * **Store a reply to a question** — `POST /api/admin/feedback/answers`.
   * Append-only and idempotent on `(owner, id)`; `FeedbackAnswerSubmission`
   * has the three outcomes. The owner is `currentOwnerId()`. No rate limit:
   * the only route that calls it is in the admin namespace.
   */
  submitAnswer(input: NewFeedbackAnswer): Promise<FeedbackAnswerSubmission>;
  /**
   * **This owner's newest reply to each of these questions**, at most one a
   * question; a question they have not replied to is simply absent.
   * Owner-scoped: another admin's reply is never this one's.
   */
  newestAnswers(questionIds: readonly string[]): Promise<StoredFeedbackAnswer[]>;
  /**
   * **The number and first line of these reports, among this owner's own.**
   * An id the owner did not file (another reader's report, or none) is absent,
   * so a question about a stranger's report shows nothing of it.
   */
  linkedReports(ids: readonly string[]): Promise<LinkedFeedbackReport[]>;
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

/* ---------------------------------------------------------- link previews -- */

import type { PagePreview } from "../types.js";

/**
 * **What one row of `link_previews` is**, as a union the compiler can check.
 *
 * The table stores this flattened into columns with a CHECK that keeps them in
 * step (src/db/schema.ts § `linkPreviews`); this is the shape everything above
 * the store speaks in, and the reason it is a union rather than a bag of
 * optionals is that every other combination is unrepresentable nonsense — an
 * `ok` with no content, an alias that also failed, a claim holding a title.
 *
 * **There is no timestamp on it.** The store answers *is this still an answer*
 * itself, so nothing above it can be tempted to return a `fetchedAt` and tell a
 * caller when some prior reader caused a fetch. GPT Sol, 2026-09-05, P1-7.
 */
export type CachedPreview =
  /** Somebody is fetching this right now and holds the claim. */
  | { kind: "pending" }
  /**
   * We have something worth showing.
   *
   * `excerpt` is the opening of the destination's plain text, capped — what
   * stage 3's summariser reads, and **the one field here that never leaves the
   * server**: `answerFrom` in src/link-previews.ts hands the client `page` and
   * nothing else. `null` is ordinary and means *no summary for this address*:
   * a row written before the column existed, or a page whose text Readability
   * could not reach. src/db/schema.ts § `linkPreviews.excerpt`.
   *
   * **Required and nullable rather than optional**, so that a writer which
   * forgets it is a compile error. Forgetting it would otherwise be invisible:
   * previews would go on working and summaries would silently never appear.
   */
  | { kind: "ok"; page: PagePreview; excerpt: string | null }
  /**
   * We asked and could not use the answer. `why` is a `FetchFailureCode` or one
   * of this feature's own classes; it is diagnostic and never reaches a reader.
   *
   * `transient` earns a short expiry and `permanent` a long one — see
   * `PREVIEW_LIFETIMES` in src/link-previews.ts.
   */
  | { kind: "transient"; why: string }
  | { kind: "permanent"; why: string }
  /** This target redirected; the answer lives under `finalTarget`. */
  | { kind: "alias"; finalTarget: string };

/** A row to write, and when it stops being an answer. */
export interface PreviewToStore {
  /** `requestTarget(url)` — never `urlKey`. src/urls.ts. */
  target: string;
  entry: CachedPreview;
  expiresAt: Date;
}

/**
 * **Fetch once for everybody in the ordinary case, and never lose a good answer
 * in the extraordinary one.**
 *
 * The single-flight half is `claim`, and it is the reason this is a store
 * interface rather than two loose queries: the read, the staleness test and the
 * claim have to happen inside one transaction under one lock, or two cold
 * requests both miss, both fetch and both spend. A unique row prevents duplicate
 * *storage* and never duplicate *traffic*. GPT Sol, 2026-09-05, P1-4.
 *
 * **The promise is deliberately weaker than "exactly once", and the first
 * version of this comment claimed more than the code delivers.** A claim has a
 * lease, and a claimant that stalls past its lease still comes back and fetches
 * — nothing here can reach into another process's `await` and stop it. The
 * second review's answer was: either weaken the promise or add real fencing.
 * Both, in the proportion the stage is worth. What is true:
 *
 * - two cold requests arriving inside one lease cause **one** fetch;
 * - a request whose claim has expired may cause a second fetch, and that is the
 *   accepted cost — one duplicate metadata fetch, no model spend, no reader
 *   waiting differently;
 * - **a loser can never destroy a winner**: `release` is fenced on the claim
 *   token, and `fill` refuses to turn a live `ok` row into a failure.
 *
 * The third of those is the one worth machinery, because it is the only failure
 * a reader would ever see — a good preview replaced by a week of nothing.
 */
export interface LinkPreviewStore {
  /**
   * What we already know about this exact request target, following one alias
   * hop, or `null` for "nothing usable".
   *
   * **An expired row reads as nothing**, so a caller cannot accidentally serve
   * a stale answer by forgetting to check a date. A `pending` row whose lease
   * has run out is nothing too.
   *
   * This is the path a cache *hit* takes, and it deliberately takes no lock and
   * consumes no allowance — the steady state must not queue behind anything.
   */
  read(target: string): Promise<CachedPreview | null>;
  /**
   * Read again under the lock, and take the claim if there is nothing there.
   *
   * Returns what the caller should do:
   * - `hit` — somebody filled it while we were waiting for the lock.
   * - `claimed` — you are the one fetching. Write the answer with `fill`, and
   *   if you cannot, `release` so the next caller may try before the lease ends.
   * - `pending` — somebody else is fetching it right now.
   *
   * `leaseMs` is how long the claim is good for. Long enough to cover the fetch
   * deadline with room, short enough that a killed process does not wedge a URL.
   */
  claim(target: string, leaseMs: number): Promise<PreviewClaim>;
  /**
   * Store the answer, and the alias row when the fetch was redirected.
   *
   * **It will not turn a live `ok` row into a failure**, whoever asks — see the
   * `setWhere` in the implementation. That is the one guarantee here that a
   * per-target claim cannot give, because the two writers of a final target need
   * not hold the same claim or even the same lock.
   */
  fill(rows: readonly PreviewToStore[]): Promise<void>;
  /**
   * Give **your own** claim back without an answer, so the next caller may try.
   *
   * The token is not decoration: a claimant that stalled past its lease and woke
   * up would otherwise delete its successor's claim. GPT Sol, 2026-09-05, P1-2.
   */
  release(target: string, claimId: string): Promise<void>;
}

export type PreviewClaim =
  | { kind: "hit"; entry: CachedPreview }
  /**
   * You are fetching. `claimId` is the fencing token — hand it back to
   * `release`, and hold on to it for as long as you might still write.
   */
  | { kind: "claimed"; claimId: string }
  | { kind: "pending" };

/* ------------------------------------------------------- fetch allowance -- */

/**
 * The allowances a caller can spend. A closed set, and every member is in the
 * table's CHECK; the CHECK also still allows the retired `citation-find`, for
 * rows already written (src/db/schema.ts § `rate_limit_events_bucket`).
 *
 * They are separate buckets rather than one, because they bound different
 * things: `link-preview-fetch` bounds how much of somebody else's server a
 * reader's pointer may ask for, and `link-summary-fill` bounds how much money it
 * may spend. A reader who has hovered a hundred cold links has done nothing
 * wrong by the second measure. Citations' `citation-investigate` bounds its
 * whole press, including the lookup (src/citation-investigate.ts), separately
 * from a reader summarising links.
 * `shelf-topics` is the model scoring a reader's candidate topics
 * (src/shelf-topics.ts): money, spent when the shelf changes rather than when
 * anybody presses anything, and bounded so a shelf that changes on every load
 * cannot spend on every load. `upload-source-guess` is the same billed web
 * search for a work's page, spent when an owner opens an upload rather than
 * when they press anything (src/source-guess-run.ts), so it is bounded apart.
 */
export type RateBucket =
  | "link-preview-fetch"
  | "link-summary-fill"
  | "shelf-topics"
  | "upload-source-guess"
  /* Citations' *Investigate* — a streamed, web-searching answer over the whole
     article, several times *Find it*'s cost a press, so its own allowance
     (src/citation-investigate.ts § `INVESTIGATE_RATE_POLICY`). */
  | "citation-investigate"
  /* *Dig deeper* on a glossary entry or a comment — a forced web search and
     an answer on the high-power model over the whole article, per press
     (src/dig-deeper.ts § `DIG_DEEPER_RATE_POLICY`). One bucket for both
     buttons, because it is one action. */
  | "dig-deeper"
  /* The mail to the admin about a reader's feedback — not a fetch and not
     money, but the shared Resend quota auth mail also needs
     (src/feedback-notice.ts § `FEEDBACK_NOTICE_POLICY`, plan 261002j). */
  | "feedback-notice";

/**
 * **How many outbound fetches one reader's pointer may cause.**
 *
 * Keyed solely on the authenticated owner — never on the article or the URL,
 * which an attacker varies freely — and atomic across instances, because
 * `count` then `insert` without a lock is a suggestion rather than a cap. GPT
 * Sol, 2026-09-05, P1-5. src/db/schema.ts § `rateLimitEvents` says what this
 * records about a reader and what it deliberately does not.
 *
 * **Cache hits never come here at all.** The cache absorbs the steady state;
 * this is for the pathological one.
 */
export interface FetchAllowanceStore {
  /**
   * Take one fill's worth of allowance, or refuse.
   *
   * `true` means the caller may fetch and **must** call `finish` with the token
   * afterwards, whatever happened, or it holds a concurrency slot until its
   * lease runs out.
   */
  take(bucket: RateBucket, policy: RatePolicy): Promise<AllowanceTaken>;
  /** The fetch is over. Frees the concurrency slot; the fill still counts. */
  finish(id: string): Promise<void>;
}

export type AllowanceTaken =
  /** `id` is the token to hand back to `finish`. */
  | { kind: "allowed"; id: string }
  /** Too many fills in the window. */
  | { kind: "rate" }
  /** Too many at once. */
  | { kind: "concurrency" }
  /**
   * **Everybody together has spent the day's allowance** — the fuse, not this
   * reader's own limit.
   *
   * Its own member rather than folding into `rate`, because the two send
   * whoever reads the logs to different places: one is a reader hovering a lot
   * of links, the other is the app as a whole being further through the day's
   * money than anybody expected. Only a policy with a `daily.globalFills` can
   * ever answer this.
   */
  | { kind: "global" };

/**
 * The numbers, which are **guesses rather than measurements**.
 *
 * Straight from GPT Sol's review, which said so itself: *"these are starting
 * limits, not numbers established by repository evidence; tune them from
 * telemetry and the maximum acceptable daily loss."* Nothing in this repository
 * has measured how many distinct links a reader hovers in an hour. The noema
 * essay has 62 distinct destinations and both caches absorb every hover after
 * the first, so 120 is roughly "two whole unread articles' worth of links, all
 * cold, in one hour" — which is a reader nobody has yet observed.
 *
 * Recorded as a guess on purpose, so the next person to touch them tunes them
 * from telemetry rather than treating them as established.
 */
export interface RatePolicy {
  /** How many fills in the window. */
  fills: number;
  /** The rolling window, in ms. */
  windowMs: number;
  /** How many fills may be in flight at once. */
  concurrency: number;
  /** How long a fill holds its concurrency slot if nothing releases it. */
  leaseMs: number;
  /**
   * **A second, longer window — and the fuse that goes with it.** Absent for a
   * bucket that has only an hourly cap.
   *
   * One optional object rather than three optional fields, so that a daily
   * per-owner cap with no window, or a fuse with no window to count it over,
   * are states nobody can write. A policy that carries this is counted three
   * times in the one transaction: the hourly cap, this cap for the owner, and
   * this fuse across everybody.
   */
  daily?: {
    /** How many fills one owner gets over `windowMs` below. */
    fills: number;
    /**
     * How many fills **everybody together** gets over the same window.
     *
     * The blast radius, not a fairness rule: it is what stands between a bug or
     * a determined account and a day's worth of model spend. Counted across
     * owners, which is the one query in the limiter that is not per-reader.
     */
    globalFills: number;
    /** The rolling window both of the above are counted over, in ms. */
    windowMs: number;
  };
}

/* -------------------------------------------------------- link summaries -- */

/**
 * **How the destination stands to the piece the reader is holding**, cached per
 * reader, per article, per address, per mention.
 *
 * `LinkPreviewStore` above is the ownerless half — what a page says about
 * itself, fetched once for everybody. This is the owned half, and the two must
 * stay apart: this row is written from the reader's own profile, so a shared one
 * would be a disclosure as well as a wrong answer. src/db/schema.ts §
 * `linkSummaries`.
 *
 * **Deliberately the same shape as the preview store rather than a shared
 * generic.** The claim protocol is the same idea — one advisory lock, a
 * `pending` row with a lease, a `claim_id` that fences the destructive writes —
 * and the *data* is not: a preview is a five-member union keyed by one string, a
 * summary is one string keyed by four and validated against four fingerprints.
 * A generic over both would have to take the columns, the validity test and the
 * key builder as parameters, which is more machinery than the second copy and
 * harder to read than either. The protocol is written down in one place — this
 * comment and `LinkPreviewStore`'s — and copied deliberately.
 */
export interface LinkSummaryStore {
  /**
   * The summary we already hold for this key, or `null` for "nothing usable".
   *
   * **An expired row, a `pending` row and a row whose inputs have moved on all
   * read as nothing**, so no caller can serve a stale summary by forgetting to
   * compare a hash. This is the path a cache hit takes and it takes no lock.
   */
  read(key: SummaryKey, inputs: SummaryInputs): Promise<string | null>;
  /**
   * Read again under the lock, and take the claim if there is nothing there.
   *
   * `hit` — somebody filled it while we waited. `claimed` — you are the one
   * spending, so `fill` the answer or `release` the claim. `pending` — somebody
   * else is generating it right now.
   */
  claim(key: SummaryKey, inputs: SummaryInputs, leaseMs: number): Promise<SummaryClaim>;
  /**
   * Store the answer, **if this claim is still the live one** — and say whether
   * it was.
   *
   * Fenced on the token for `release`'s reason: a claimant that stalled past its
   * lease and woke up must not write its stale answer over the row its successor
   * has already filled.
   *
   * **It returns whether the write landed, and that is not decoration.** The
   * first version returned `void`, so a caller whose claim had been taken away
   * wrote nothing and then handed the reader its own superseded answer anyway —
   * a summary about an older profile or an older version of the article,
   * presented as current, and cached in that reader's tab for the session. The
   * fence stopped the *database* being wrong and let the *screen* be wrong,
   * which is the half a reader can see. GPT Sol, 2026-09-05.
   *
   * `false` means: somebody else owns this key now. Ask again rather than
   * answering.
   */
  fill(key: SummaryKey, claimId: string, summary: string, expiresAt: Date): Promise<boolean>;
  /** Give **your own** claim back without an answer, so the next caller may try. */
  release(key: SummaryKey, claimId: string): Promise<void>;
}

/**
 * Which article, and which address in it.
 *
 * **A slug rather than an article id, and no owner at all** — the store resolves
 * both, through `articleIdForOwned`, exactly as `pgGlossaryLookupStore` does.
 * That keeps the owner-scoped resolution in one place: a caller that assembled
 * its own `ownerId` would be a second answer to "whose article is this", and the
 * one that matters is the one the database enforces.
 */
export interface SummaryKey {
  slug: string;
  /** `requestTarget(url)` — never `urlKey`. */
  target: string;
  /**
   * **The block the hovered anchor sits in**, which is what makes two mentions
   * of one destination two rows rather than one row they take turns rewriting.
   *
   * Always the *resolved* sighting rather than what a client asked for —
   * `linkInArticle`'s `LinkOccurrence` — so a request that named no block is
   * keyed under the first one rather than under a blank. src/db/schema.ts §
   * `linkSummaries`.
   */
  blockId: string;
}

/**
 * **Everything the answer depends on that is not in the key**, so that a change
 * to any of it is a miss rather than a stale row for ever.
 *
 * GPT Sol, 2026-09-05, P1-3: `(owner, article, url)` alone never changes when
 * the article is re-extracted or the reader edits their profile, and both are
 * prompt inputs.
 */
export interface SummaryInputs {
  /** A hash of the destination text the model was given. */
  destHash: string;
  /** A hash of what the reader is currently reading, as the prompt carried it. */
  contextHash: string;
  /** `hashProfile`, or the sentinel for a reader who has written nothing. */
  profileHash: string;
  /** `LINK_SUMMARY_PROMPT_VERSION`. */
  promptVersion: number;
  /** The model id, so a tier change makes every row stale. */
  model: string;
}

export type SummaryClaim =
  | { kind: "hit"; summary: string }
  /** You are spending. `claimId` is the fencing token. */
  | { kind: "claimed"; claimId: string }
  | { kind: "pending" };
