/**
 * The HTTP surface: article reads, and the comment endpoints.
 *
 * Connect-shaped (`req`, `res`) but not Vite-specific — vite.config.ts mounts
 * this as dev middleware today, and the standalone Node server that
 * architecture.md § Server and client defers will mount the same function. The
 * actual work stays in src/store/index.ts, src/comments.ts and src/explain.ts; this file
 * is only routing, parsing and status codes.
 *
 *   GET    /api/library         every article on the shelf, for the homepage
 *                                `?archived=1` for the other half
 *   GET    /api/library/search   `?q=…&limit=…` → passages from every article at once
 *   PATCH  /api/library/:slug    { archived?: boolean, title?: string | null, purpose?: string | null }
 *                                 → { entry, purpose } — see `patchShelf` for why purpose is beside it
 *   DELETE /api/library/:slug    destroy it, for good → { destroyed: slug }. 409 while an
 *                                 import is running; no body, and nothing to undo
 *   POST   /api/library/:slug/open   one more open, for the shelf's tooltip
 *   GET    /api/models           which model writes what
 *                                 → { tasks: [{ task, model, id, provider, source, effort? }] }
 *   GET    /api/reader           `?slug=` → { profile, purpose, hasProfile, experimentalSince }
 *                                 — purpose is null without a slug
 *   PATCH  /api/reader           { profile?: string | null, experimental?: boolean }
 *                                 → { profile, experimentalSince }, both always
 *   GET    /api/link-preview    `?slug=&url=` → what that destination says about itself
 *   GET    /api/link-summary    `?slug=&url=&block=` → SSE: how it stands to the piece being read
 *   GET    /api/article/:slug    meta + blocks + tree, one payload
 *   GET    /api/source/:slug     the PDF an article was made from, for a reader to check it
 *   GET    /api/asset/:slug/:hash.:ext   one picture of that article, out of our own bucket
 *   GET    /api/export/:slug     everything we hold for one article, as a zip to download
 *   GET    /api/metadata/:slug   what the pipeline wrote, and whether any of it is stale
 *   GET    /api/tweets/:slug     the article as a numbered thread, and whether it is stale
 *   GET    /api/glossary/:slug   the terms this piece uses, and whether they are stale
 *   DELETE /api/glossary/:slug   throw the list away, so the next run starts over
 *   POST   /api/glossary/:slug/:id/lookup   check one term on the web, and keep the sources → SSE
 *   POST   /api/glossary/:slug/ask   find a term the reader typed and explain it → SSE; stores nothing
 *   GET    /api/ideas/:slug      the propositions the piece needs you to hold, and staleness
 *   GET    /api/timeline/:slug   when the piece says things happened, and staleness
 *   GET    /api/quiz/:slug       the questions the piece can ask you back, and staleness
 *   GET    /api/debate/:slug     what the rest of the web says about this piece, and staleness
 *   POST   /api/quiz/:slug/mark  one answer, marked against one question — SSE, stateless
 *   GET    /api/quotes/:slug     the lines worth keeping, in the article's own words, and staleness
 *   GET    /api/arc/:slug        one sentence per part, and whether it still fits the article
 *   GET    /api/comments/:slug   every stored comment for the article
 *   POST   /api/comments/:slug   { blockId, quote, start, body?, criterionId?, valence? }
 *                                → the stored comment. `criterionId` + `valence` are the referee's
 *                                  own placement of the passage — `tidyMark`
 *   PATCH  /api/comments/:slug/:id        { body } — the reader's words, `null` clears them.
 *                                  The key is required: a patch that never mentions the body
 *                                  is a 400, not a silent wipe
 *   PATCH  /api/comments/:slug/:id/mark   { criterionId, valence } — both keys, always, each a
 *                                  value or `null`; both `null` clears the placement
 *   DELETE /api/comments/:slug/:id
 *   GET    /api/chat/:slug       every stored conversation for the article
 *   POST   /api/chat/:slug       → **a stream**, see `streamChat`. Three bodies:
 *                                  { threadId, question, at? }      ask
 *                                  { threadId, retry: messageId }   answer again
 *                                  { threadId, edit: messageId, question, at? }
 *   POST   /api/chat/:slug/:threadId/stop  { messageId } → { stopped }
 *   POST   /api/chat/:slug/live-tool  { name, args } → one chat tool, for a live session
 *   POST   /api/chat/:slug/:threadId/live  → an ephemeral realtime secret, a session
 *                                            id, the thread as seed items, and the tail
 *   POST   /api/chat/:slug/:threadId/spoken { question, answer, expectedTailId, … }
 *                                          → { thread }, one exchange appended
 *   POST   /api/live/:sessionId/connected  → the data channel opened
 *   POST   /api/live/:sessionId/usage      { kind, providerEventId, … } → one ledger row
 *   POST   /api/live/:sessionId/close      { reason? } → the conversation ended
 *   PATCH  /api/chat/:slug/:threadId   { title }
 *   DELETE /api/chat/:slug/:threadId
 *   GET    /api/search/:slug     every saved meaning-search for the article
 *   POST   /api/search/:slug     { id?, criterion } → **a stream**, see `search`
 *   PATCH  /api/search/:slug/:id  { colour } — the reader's palette slot, or null for auto
 *   DELETE /api/search/:slug/:id
 *   GET    /api/referee/criteria/:slug      every saved criterion for the article
 *   POST   /api/referee/criteria/:slug      { id?, criterion, kind, poles?, scale? } → **a stream**,
 *                                           see `runRefereeCriterion`
 *   PATCH  /api/referee/criteria/:slug/:id  { colour } — the palette slot, or null for auto
 *   DELETE /api/referee/criteria/:slug/:id
 *   GET    /api/referee/claims/:slug        the paper's claims run, or null
 *   POST   /api/referee/claims/:slug        no body → **a stream**, see `runRefereeClaims`.
 *                                           One run per article; a second POST replaces the first
 *   POST   /api/referee/mirror/:slug        no body → **a stream**, see `runMirror`. Reads the
 *                                           referee's own comments back to them; never the paper
 *   GET    /api/referee/scan/:slug          the deterministic injection scan of the stored raw
 *                                           source — no model, no cost, and no verdict
 *   POST   /api/uploads          { filename, bytes, sha256 } → where to PUT a PDF, and for how long
 *   GET    /api/uploads/:id      what became of one upload, and whether its bytes have arrived
 *   DELETE /api/uploads/:id      the reader pressed Stop: pending → expired
 *   GET    /api/jobs             every ingest job this server knows about
 *   POST   /api/jobs             { url } | { uploadId } | { slug, steps?, force? }
 *   GET    /api/jobs/:id         one job, for the progress indicator to poll
 *   DELETE /api/jobs/:id         forget a finished job's record
 *   POST   /api/jobs/:id/cancel
 *   POST   /api/jobs/:id/retry   the same steps again, skipping what succeeded
 *   POST   /api/jobs/:id/advance run the next step this job has not done yet
 *   GET    /api/billing/usage    which plan, how much of it is used, what may be bought
 *   POST   /api/billing/checkout { tierId, currency? } → a hosted Checkout, or the Portal
 *   POST   /api/billing/portal   → a hosted Customer Portal session
 *   POST   /api/billing/confirm  { sessionId } → prove a finished Checkout is yours, then sync
 *
 * The job routes return immediately; the work happens on the queue in
 * src/jobs.ts. See docs/project/comments.md, docs/project/library.md and
 * docs/project/ingest-queue.md.
 */
import { randomUUID } from "node:crypto";
/* **No `node:fs` and no `node:path` here any more, as of 2026-08-31**, and that
   is worth keeping. The last reader of the disk in this file was `sendSource`,
   which went to `data/<slug>/raw.pdf` whatever the store said — so the route
   worked on a laptop and 404d on Vercel, which has no such disk, for as long as
   it existed. Every route now reaches its bytes through a store, and a fresh
   `readFile` in this file is that bug coming back.
   docs/plans/260831b-finish-the-database-move.md. */
import type { IncomingMessage, ServerResponse } from "node:http";
/* From the store rather than from src/api.ts directly, so no route has to know
   which store it is talking to. That was written when there were two and a flag
   between them; there is one since 2026-09-05, and the indirection is what made
   deleting the other one a change to `src/store/index.ts` and not to this file.
   docs/plans/260826e-postgres-storage-implementation.md */
import {
  articleMetadata,
  chatStore,
  deleteGlossary,
  librarySearch,
  listArticles,
  readerStore,
  refereeClaimsStore,
  refereeCriteriaStore,
  searchStore,
  shelfStore,
  loadArticle,
  loadGlossary,
  lookUpTerm,
  askAboutTerm,
  loadArc,
  loadAssets,
  loadIdeas,
  loadQuotes,
  loadIllustrated,
  loadSketch,
  loadQuiz,
  loadDebate,
  loadTimeline,
  loadTweets,
} from "./store/index.js";
/* **Pure functions only**, and that is the whole reason this import survived
   step 10 while the writes beside it did not. `withRetry` and `withEdit` take a
   snapshot and return what the result would be, so they can be run as a gate
   here and thrown away; `ChatConflict` is what they throw and what this file
   turns into a 409. Nothing here touches a file, so nothing here has to know
   which store is live. Every write goes through `chatStore` above. */
import { ChatConflict, withEdit, withRetry } from "./chat.js";
import { shortenedSpokenLabel } from "./spoken-label.js";
import { CommentIdTaken, NotAnExplanation, type AnswerPatch, type MarkPatch } from "./comments.js";
import { findPassagesStream, SEARCH_TIMEOUT_MS } from "./search.js";
/* Referee mode's Criteria sub-mode — the model call, and the rules a request
   has to satisfy before one is made. `referee-criteria.js` is pure (it reaches
   nothing but `quote-match`, `types` and `urls`), so importing its validators
   here drags nothing along; `referee-criteria-run.js` is the paying call, and
   it is imported for the same reason `findPassagesStream` above is. */
import {
  LITERATURE_TIMEOUT_MS,
  runCriterionStream,
} from "./referee-criteria-run.js";
import {
  criterionProblem,
  DEFAULT_DIVERGING_SCALE,
  type DivergingScale,
  isDivergingScale,
  isRefereeCriterionKind,
  /* **The referee's own placement, checked by the function that knows it is
     signed.** Deliberately not anything on the confidence path: `validateHits`
     clamps a negative to zero, so a −80 sent that way arrives as "no strong
     feeling" and the referee is shown the opposite of what they said.
     `markProblem` is the same rule `comments_valence_needs_criterion` and
     `comments_valence_range` hold in the database. */
  markProblem,
  type RefereeCriterionConfig,
  type RefereeResult,
} from "./referee-criteria.js";
import type { SavedCriterion } from "./saved-criteria.js";
/* Referee mode's Claims sub-mode. `referee-claims.js` is pure — it reaches
   `quote-match` and `types` and nothing else — so the shapes and the copy come
   in for free; `referee-claims-run.js` is the paying call, imported for the same
   reason `findPassagesStream` and `runCriterionStream` above are. */
import { runClaimsStream } from "./referee-claims-run.js";
import type { Claim, ClaimsRun } from "./referee-claims.js";
/* Referee mode's rule 5, and the one thing under it that costs nothing: the
   deterministic scan of the stored raw source. No model, no gateway, no spend
   attribution — src/source-scan.ts is the caller and src/injection-scan.ts is
   the scanner. */
import { scanArticleSource } from "./source-scan.js";
/* Referee mode's Mirror sub-mode. The generator, and only the generator: the
   waiting version beside it (`mirror`) exists for the eval, and a route that
   used it would trade the reader's first sentence for a spinner. */
import { mirrorStream } from "./referee-mirror.js";
/* A pure predicate, so importing it here does not drag the filesystem store
   into a file that must work with either one — the same rule the `withEdit` /
   `withRetry` import above states. The palette's *size* is deliberately not in
   it: see `SearchRun.colour`. */
import { isStorableColour } from "./searches.js";
/* Through the store, so comments and articles stay together.
   They cannot be split: a comment anchors to a block id, and leaving the
   questions on disk while the paragraphs they point at come from Postgres puts
   the two halves in stores nothing keeps in step. */
/* The one media type this route serves, from the file that names it for the
   writer too — so what goes into the bucket and what comes out of it cannot be
   described two different ways. */
import type { IllustratedImage } from "./illustrated-plate.js";
import { blobStore, CONTENT_TYPE } from "./store/blobs.js";
/* The download's two halves: the zip itself, and the one error a route has to
   turn into a 404 rather than let travel to the catch-all as a 500. Both come
   straight from the store, so this file adds no data model of its own. */
import { articleBundle } from "./store/export-bundle.js";
import { ArticleNotFound } from "./store/article-rows.js";
import {
  adminStore,
  commentStore,
  feedbackStore,
  realtimeSessionStore,
  sourceStore,
  visibilityStore,
} from "./store/index.js";
/* **The shape of a report's two loose ends**, and it imports nothing — so the
   dialog can build the diagnostics blob from the same declaration this file
   validates it against. Two independent allowlists, one declaration; the
   `dataCollection` argument in src/monitoring.ts, applied one seam over. */
import {
  FEEDBACK_DIAGNOSTICS_VERSION,
  MAX_FEEDBACK_DIAGNOSTICS_JSON_BYTES,
  parseFeedbackDiagnostics,
} from "./feedback-payload.js";
/* The screenshot's own module, and server-only: it needs `node:zlib`, which
   nothing the dialog imports may pull behind it. Every byte we store or forward
   is written by `reencodeScreenshot` rather than passed through — read its
   header, which is where the argument for that lives. */
import {
  type FeedbackScreenshot,
  MAX_SCREENSHOT_EDGE,
  reencodeScreenshot,
} from "./feedback-image.js";
/* The Sentry half. It cannot throw and it cannot fail this request — read its
   header before calling it from anywhere else, because the scope handling in it
   is the part that is easy to get wrong and impossible to see wrong. */
import { mirrorFeedback } from "./feedback.js";
import { CHAT_TIMEOUT_MS, converse } from "./converse.js";
import { runTool, type ToolOutcome, type ToolRun } from "./chat-tools.js";
import { explainStream } from "./explain.js";
import { markAnswerStream } from "./quiz-mark.js";
import { similarBlocks } from "./similar.js";
import { projectArticle } from "./projection.js";
import { EmbeddingFailure } from "./embeddings.js";
import { isSpideryarnId, isUuid } from "./ids.js";
/* **The one exception to "every paid call goes through OpenRouter"**, and it is
   Greg's, weighed rather than slipped past: OpenRouter has no realtime API at
   all. src/live.ts holds the whole of it, including the only use of
   OPENAI_API_KEY in the app. Nothing here touches that key — this file asks for
   a session and gets back a short-lived secret for the browser. */
import {
  acceptRealtimeUsage,
  LIVE_MODEL,
  LIVE_SERVER_TOOLS,
  LIVE_TRANSCRIBER,
  type LiveToken,
  liveSeedItems,
  liveSession,
  mintLiveToken,
  parseRealtimeUsage,
  realtimeCloseReason,
  REPORT_WINDOW_MS,
  SHOW_PASSAGE_TOOL,
} from "./live.js";
import { vocabularyTermsFor } from "./vocabulary-sources.js";
import { isWebUrl } from "./urls.js";
/* The fourth thing a link card can say: what the destination says about itself,
   fetched by us once and cached for everybody. src/link-previews.ts. */
import { linkPreview } from "./link-previews.js";
/* The other half of the same card, and the half we wrote — a model call with a
   reader hovering, so it streams. src/link-summary.ts, docs/project/links.md. */
import { linkSummaryStream } from "./link-summary.js";
import { isSlug, normaliseUrl, slugFromFilename, slugFromUrl } from "./ingest.js";
import {
  advanceJob,
  cancelJob,
  enqueue,
  forgetJob,
  getJob,
  listJobs,
  retryJob,
} from "./jobs.js";
import { describeAdminMiss, isAdmin } from "./admin.js";
import type { NewFeedback, Visibility } from "./store/contracts.js";
import { ADMIN_FEEDBACK_DEFAULT_LIMIT, decodeFeedbackCursor } from "./types.js";
import { assertVerifiedUser, requireUser, type VerifiedUser, type Verifier } from "./auth.js";
import {
  placingFailed,
  UPLOAD_MISSING,
  UPLOAD_STILL_ARRIVING,
  UPLOAD_UNAVAILABLE,
} from "./messages.js";
import { WEBHOOK_PATH, serveStripeWebhook } from "./billing/webhook.js";
import {
  confirmCheckout,
  openPortal,
  parseCheckoutRequest,
  startCheckout,
} from "./billing/checkout.js";
import { readBillingSummary } from "./billing/summary.js";
import {
  refuseUploadWithoutQuota,
  withIngestSlot,
  withRetrySlot,
  type IngestSlot,
} from "./billing/admission.js";
import { isPublicNamespace, servePublicApi } from "./public/routes.js";
import { currentOwnerId, runInRequest, setRequestOwner } from "./owner.js";
import {
  collectSpend,
  currentSpend,
  emptySpend,
  spendFields,
  withSpendAttribution,
} from "./ai-spend.js";
import { costStore } from "./store/ai-calls.js";
import { canonicalKey, stagingKey } from "./source.js";
import { storedAssetFor } from "./asset-delivery.js";
import { uploadGrants } from "./store/blobs.js";
import { uploadProblem } from "./uploads.js";
import {
  asOf,
  cancelUpload,
  claimUpload,
  isUploadId,
  mintUpload,
  noteSlug,
  readUpload,
  recordsSurviveTheRequest,
  type UploadRecord,
} from "./upload-records.js";
import { errorFields, log, since } from "./log.js";
import { processSingleton } from "./process-state.js";
import { captureFailure, setMonitoringUser } from "./monitoring.js";
import { isStepName, type StepName } from "./pipeline.js";
import { hashProfile, normaliseProfileText, profileIsStale, renderProfile } from "./profile.js";
import {
  type ArticleStage,
  NON_TASK_MODELS,
  type Provider,
  STAGE_EFFORT,
  TASK_TIER,
  displayName,
  effortFor,
  resolveModel,
} from "./models.js";
import {
  MAX_AUDIO_BASE64,
  isAudioFormat,
  parseWhere,
  tooLongMessage,
  transcribe,
} from "./transcribe.js";
import type {
  Block,
  ChatAnchor,
  ChatThread,
  Comment,
  FeedbackEnvironment,
  FeedbackKind,
  LibraryEntry,
  GlossaryResponse,
  Job,
  LibrarySearchResponse,
  ShelfState,
  IdeasResponse,
  QuizFound,
  QuotesResponse,
  IllustratedResponse,
  SketchResponse,
  LibraryResponse,
  RememberStance,
  ThreadKind,
  ThreadResponse,
  ThreadSummary,
  SearchHit,
  SearchRun,
} from "./types.js";
/* Values, not types: the list a placement off the wire is checked against, and
   the guard that does the checking. Both live in types.ts because the browser
   needs the same union and cannot import src/live.ts. */
import { isMicPlacement, MIC_PLACEMENTS } from "./types.js";
/* Values again, and the same argument one field over: the three thread kinds
   and the guard that checks one off the wire. src/types.ts § THREAD_KINDS. */
import { isThreadKind, THREAD_KINDS } from "./types.js";
/* Values, for the same reason: the two closed vocabularies a report's location
   is checked against, and the two caps the dialog and this route must agree on.
   src/types.ts § feedback. */
import {
  FEEDBACK_ENVIRONMENTS,
  FEEDBACK_KINDS,
  MAX_FEEDBACK_URL_CHARS,
  MAX_FEEDBACK_ANSWER_CHARS,
  MAX_FEEDBACK_SCREENSHOT_BYTES,
  /* A value, and the same number the panel's textarea counts against — one
     declaration, so the button that disables itself and the route that answers
     413 cannot drift apart. */
  MAX_QUIZ_ANSWER_CHARS,
} from "./types.js";
/* A value, not a type — the one list the stance is validated against, shared
   with the client's picker so a fifth stance cannot be accepted here and
   missing from the menu. src/types.ts § REMEMBER_STANCES. */
import { REMEMBER_STANCES } from "./types.js";

/** Big enough for any selection, small enough that nothing can wedge the server. */
const MAX_BODY_BYTES = 64 * 1024;

/**
 * The one route that carries more than that, and the reason it is a **parameter
 * on `readBody` rather than a raised constant**.
 *
 * A dictation is a few hundred kilobytes of base64 audio, which is four figures
 * past what any other body here needs. Raising `MAX_BODY_BYTES` to fit it would
 * raise it for the forty-odd routes that need nothing of the kind — and the
 * limit exists precisely so that no single request can wedge the server, so
 * widening it everywhere to admit one caller is giving away the thing it was
 * for. `src/transcribe.ts` owns the number; this is it plus room for the JSON
 * wrapper and the slug around it.
 */
const MAX_AUDIO_BODY_BYTES = MAX_AUDIO_BASE64 + 16 * 1024;

/**
 * The second one, and the same argument as the first.
 *
 * A bug report may carry a screenshot the reader pasted in, which is ~300 KB
 * downscaled and 400 KB at the ceiling the database enforces — four figures past
 * what the other forty routes need. So it is a parameter on `readBody` too, and
 * `MAX_BODY_BYTES` stays where it is: widening the shared limit to admit one
 * caller gives away the thing the limit was for.
 *
 * **Derived from the schema, term by term, because the guessed version was too
 * small.** It used to be the screenshot's base64 expansion plus 96 KB of
 * headroom "for the lot", and GPT Sol's code review, 2026-08-31, constructed a
 * body that satisfied every inner limit at 662,501 bytes against an outer limit
 * of 631,640 — refused by `readBody` with a bare 413 before the validator could
 * explain anything. The largest report the validator accepts has to fit through
 * the door in front of it, or the door is the limit and nothing says so.
 *
 * So each term is the worst case of a thing that is separately capped:
 *
 * - the screenshot, base64, which is four characters per three bytes;
 * - the reader's answer at `MAX_FEEDBACK_ANSWER_CHARS`, at the six bytes per
 *   UTF-16 unit `JSON.stringify` can produce for a control character — times
 *   three, because a stale client still sends the old three answers and folding
 *   them into one `body` must not be refused before it is read;
 * - the diagnostics blob, whose own ceiling is computed in
 *   src/feedback-payload.ts from the caps that file enforces;
 * - the rest of the envelope — the id, the slug, the build stamp, the keys.
 *
 * The headroom is gone deliberately: every term is now a number with a reason,
 * so a limit that changes anywhere moves this one with it.
 * tests/feedback-route.test.ts posts the largest valid body there is and
 * watches it through.
 */
const MAX_FEEDBACK_BODY_BYTES =
  Math.ceil(MAX_FEEDBACK_SCREENSHOT_BYTES / 3) * 4 +
  3 * MAX_FEEDBACK_ANSWER_CHARS * 6 +
  MAX_FEEDBACK_DIAGNOSTICS_JSON_BYTES +
  /* The id, the URL, the slug, the build stamp, the two booleans, every key,
     and the braces and commas around all of it. The URL replaced the route kind
     on 2026-09-02 and is capped at `MAX_FEEDBACK_URL_CHARS` (2048), which the
     4KB below still covers. */
  4 * 1024;

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

/**
 * **The document this article was made from** — today, only a PDF.
 *
 * It exists for one reason, and it is the reason a scan is shown at all: a
 * transcription of a photographed page has nothing to check it against, so the
 * only real verification available is a person looking at the ink. Every record
 * carries its page number even though v1's reader does not show it, and the raw
 * file is kept, so handing the reader the original costs one route. A second
 * machine's opinion would have cost a page-reconstruction aligner and would
 * still not have been verification. docs/plans/260826c-pdf-ingestion.md.
 *
 * `inline`, not `attachment`: the reader pressed *view the original*, and a
 * browser that can show a PDF should show it — the browser's own PDF viewer is
 * the point. Raised by GPT Sol, 2026-08-31. That decision belongs to this route
 * rather than to `contentDisposition`, which is why the disposition is passed in
 * below: a download route wants `attachment` and must not inherit this one's
 * answer. And `X-Content-Type-Options: nosniff` because this is a stranger's
 * file being served from our origin — the one place a wrong content type
 * becomes script.
 */
async function sendSource(res: ServerResponse, slug: string): Promise<void> {
  /* **Ask the store whose article this is, before reading a byte.**
   *
     This route was authenticated and *not* authorised: it took a slug, went
     straight to `data/<slug>/raw.pdf` and returned it, never once asking the
     store whether the caller owns that article. So the whole of the ownership
     work landed and Bob could still download Alice's private paper by naming
     its slug — and until the jobs list was closed too, he could read the slugs
     off it. GPT Sol found the pair, 2026-08-27.

     `shelfStore.read` rather than a new query, because it is the same
     owner-filtered lookup every other route already goes through, and it throws
     the same 404. A second way of asking is a second thing to get wrong: this
     one is right whenever `ownedSlug` is right, which is the property worth
     having. The answer is discarded — it is asked as a question, not read.

     **Kept even though `sourceStore.readPdf` is owner-filtered too** (it joins
     through `ownedSlug`). Two independent refusals on the one route that hands
     back somebody's private document is worth the round trip. */
  await shelfStore.read(slug);

  /* **The store, not the disk** — and until 2026-08-31 this was the disk.

     It read `fsLocations(slug)` and `data/<slug>/raw.pdf` whatever
     `SPIDERYARN_STORE` said: the last unconditional filesystem read in this
     file, found twice independently (docs/plans/260831b-finish-the-database-move.md
     § What the inventory found). Under `postgres` that answered *"this article
     did not come from a PDF"* about a PDF sitting in the `sources` bucket, and
     deployed it was the jobless `dataRoot()` caller that
     src/store/data-root.ts (deleted 2026-09-05) named by route — where that
     function deliberately threw, because both available answers were wrong. So
     the feature worked on a laptop and 404d on every production request, for
     as long as it existed.

     `readPdf`, not "read the source document", because the content type is the
     boundary: an HTML source served from our own origin is stored XSS, so the
     store hands back the one kind this route may set a type for.
     src/store/contracts.ts § SourceStore.

     **`null` is the only "there is nothing here".** A revision that names a
     stored object and cannot produce it, or whose object hashes to something
     else, **throws** with `status: 500`, so it arrives as a server fault rather
     than as "this article never had a source". Telling an owner their paper does
     not exist because a bucket is misconfigured is the failure GPT Sol made a
     blocker of, 2026-08-31. src/store/pg-source.ts owns both refusals; the same
     rule and the same two error types live in src/store/raw-document.ts for
     `db:export`. */
  const source = await sourceStore.readPdf(slug);
  if (!source) throw httpError(404, "That article did not come from a PDF.");

  res.statusCode = 200;
  /* **A constant, never `raw_content_type`.** That column is the *origin's*
     header, and plenty of perfectly good PDFs arrive as
     `application/octet-stream` — which, served back with `nosniff` below, is a
     document the browser will refuse to open and will not rescue. GPT Sol,
     2026-08-31. It is a constant rather than a decision because `readPdf` can
     only hand back a PDF: the narrowness of the store method is what makes one
     literal here correct. */
  res.setHeader("Content-Type", CONTENT_TYPE.pdf);
  res.setHeader(
    "Content-Disposition",
    contentDisposition(source.filename ?? `${slug}.pdf`, "inline"),
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  /* The bytes actually being written, not a stored count. They are the same
     number whenever both exist, and the one that is true when they are not. */
  res.setHeader("Content-Length", String(source.bytes.byteLength));
  res.end(Buffer.from(source.bytes));
}

/**
 * **One plate of an Illustrated diagram, as bytes** —
 * docs/project/diagram.md § Illustrated.
 *
 * The only binary route in this file besides `sendSource`, and it is the one
 * with a rule that has to be stated rather than followed by habit:
 *
 * > **The key is rebuilt from the artefact, never taken from the path.**
 *
 * Plates live in a **content-addressed store shared by every article and every
 * reader** — `sha256/<hash>.jpeg`, the same bucket the articles' own figures
 * are in. So a route that concatenated the caller's string into a blob key
 * would be an arbitrary-object read: name any hash you can guess or have seen
 * and get the object, whoever owns the article it belongs to. That is the rule
 * docs/project/security.md owns, and it is why the hash in the path is used
 * **only to look a plate up in this article's own artefact**. What reaches the
 * store is `canonicalKey(plate.image.sha256, "jpeg")`, built here from the
 * value we wrote.
 *
 * Two consequences worth keeping:
 *
 *  - a hash that is a real plate of **somebody else's** article is a 404, not a
 *    picture, even though the object exists and the key is well-formed;
 *  - a hash that is a plate of an **older revision** of this article is a 404
 *    too, because `loadIllustrated` reads the current revision. That is right:
 *    the panel only ever asks for hashes it has just been given.
 *
 * Ownership is checked the way `sendSource` checks it — `shelfStore.read`,
 * which is the same owner-filtered lookup every other article route goes
 * through, and which throws the same 404. It is asked as a question and its
 * answer discarded.
 *
 * `blobStore()` and **not** `postgresBlobStore()`, for the reason
 * src/fetch.ts § *Why `blobStore()`* gives about the raw document: the bytes
 * were *written* through `blobStore()` (src/illustrated-image.ts), so selecting
 * differently here would be a split brain by construction — the process that
 * painted and the process that serves looking in two different buckets.
 *
 * **Immutable, and it can be**: the URL contains the hash of its own contents,
 * so the bytes at it can never change. `private` because the article is one
 * reader's — a shared cache must not hold it.
 */
async function sendPlate(
  res: ServerResponse,
  slug: string,
  hash: string,
  ext: string,
): Promise<void> {
  /* Ownership first, before the artefact is read and long before a byte moves —
     `sendSource`'s rule, and the failure it was written after. */
  await shelfStore.read(slug);

  const found = await loadIllustrated(slug);
  const plates = (found.illustrated as { plates?: { image?: IllustratedImage }[] }).plates ?? [];
  /* **The stored record, not the caller's string.** Everything below is built
     from `plate.image`; `hash` and `ext` are never used again after these two
     lines. The extension has to *match* rather than be ignored: since 2026-09-04
     an article can hold JPEG plates drawn by the old illustrator beside PNG ones
     drawn by the new, so serving a `.jpeg` URL from a PNG record would be this
     route telling a cache one thing and the `Content-Type` header another. */
  const image = plates.find((p) => p.image?.sha256 === hash)?.image;
  if (!image || image.ext !== ext) throw httpError(404, "No such plate.");

  const bytes = await blobStore().get(canonicalKey(image.sha256, image.ext));
  if (!bytes) {
    /* The artefact names an object the store has not got. A 500 rather than a
       404, on `sendSource`'s reasoning: telling a reader their picture does not
       exist because a bucket is misconfigured is the wrong sentence, and this
       is a dangling reference rather than an absence. */
    throw httpError(500, "That plate's picture could not be read back.");
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", CONTENT_TYPE[image.ext]);
  res.setHeader("Content-Length", String(bytes.byteLength));
  /* A stranger's model drew these bytes and they are served from our origin —
     the one place a wrong content type becomes script. Same reason
     `sendSource` sets it. */
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
  res.end(Buffer.from(bytes));
}

/**
 * **One of an article's own pictures, as bytes** —
 * docs/project/article-images.md.
 *
 * `sendPlate` above is the template and its comments carry the reasoning; this
 * is the same shape pointed at a different artefact, and the differences are
 * the only things worth reading here.
 *
 * ## It serves *an article's images*, not PDF figures
 *
 * `storedAssetFor` (src/asset-delivery.ts) searches both collections in the
 * manifest — the article's own `<img src>`s and the figures a PDF came with —
 * so this route is generic by construction rather than by intention. PDF
 * figures are simply the only ones flowing through it today; **stage E of
 * docs/plans/260906a-figures-from-a-pdf-are-placeholders-with-no-image.md turns
 * the article's own images on, and it needs no edit here.** GPT Sol, I-1.
 *
 * ## The rule, restated because it is the whole authorisation
 *
 * > **The key is rebuilt from the manifest entry, never taken from the path.**
 *
 * Assets are content-addressed in a bucket shared by every article and every
 * reader (`canonicalKey`, src/source.ts), so the hash in the URL is used **only
 * to look an entry up in this article's own manifest** and is never seen again.
 * A hash that is a real asset of somebody else's article is a 404; **a hash
 * that is in the bucket but not in this manifest is a 404 for the article's own
 * owner too**, which is the case worth stating because it is the one that feels
 * wrong: owning an article entitles you to the objects it lists, not to the
 * bucket. GPT Sol, I-5.
 *
 * ## Why `loadAssets` and not `loadArticle`
 *
 * This runs once per picture — eight times on the PDF this was built for — and
 * `loadArticle` re-reads every block and the whole tree each time.
 * `ArticleReader.loadAssets` (src/store/contracts.ts) is one `jsonb` column.
 *
 * `blobStore()` and **not** `postgresBlobStore()`, for the reason `sendPlate`
 * gives: the bytes were *written* through `blobStore()` (src/collect-assets.ts,
 * src/collect-pdf-figures.ts), so selecting differently here would be a split
 * brain by construction.
 *
 * **Immutable, and it can be**: the URL contains the hash of its own contents.
 * `private` because the article is one reader's — a shared cache must not hold
 * it. The public twin deliberately answers `no-store` instead: `sendBytes`
 * (src/public/routes.ts) sets no `Cache-Control` at all, because `serveApi` has
 * already set `no-store` across the whole public namespace before dispatch, and
 * that function's header says why the two answers must differ.
 */
async function sendArticleAsset(
  res: ServerResponse,
  slug: string,
  hash: string,
  ext: string,
): Promise<void> {
  /* Ownership first, before the manifest is read and long before a byte moves —
     `sendSource`'s rule, and the failure it was written after. `loadAssets` is
     owner-filtered too (it goes through `ownedSlug`), and this is the same
     belt-and-braces pair that route keeps: two independent refusals on a route
     that hands back somebody's private picture is worth the round trip. */
  await shelfStore.read(slug);

  const found = storedAssetFor(await loadAssets(slug), hash, ext);
  if (!found) throw httpError(404, "No such image.");

  const bytes = await blobStore().get(canonicalKey(found.sha256, found.ext));
  if (!bytes) {
    /* The manifest names an object the store has not got. A 500 rather than a
       404, on `sendSource`'s and `sendPlate`'s reasoning: telling a reader their
       picture does not exist because a bucket is misconfigured is the wrong
       sentence, and this is a dangling reference rather than an absence. */
    throw httpError(500, "That image could not be read back.");
  }

  res.statusCode = 200;
  /* **From the entry, not from `CONTENT_TYPE[ext]`.** The manifest records what
     the bytes were *sniffed* to be (src/assets.ts § `sniffImage`), which is the
     whole discipline of this feature: a name that does not describe its
     contents is the one thing content addressing must never store. The two
     agree today; the entry is the one that stays true. */
  res.setHeader("Content-Type", found.contentType);
  res.setHeader("Content-Length", String(bytes.byteLength));
  /* A publisher's file, or a picture cut out of a stranger's upload, served
     from our origin — the one place a wrong content type becomes script. Same
     reason `sendSource` sets it. */
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
  res.end(Buffer.from(bytes));
}

/**
 * **One article's data as a zip the reader downloads.**
 *
 * The bundle is built in [`src/store/export-bundle.ts`](store/export-bundle.ts)
 * and this function is only the HTTP half of it: a status, four headers and the
 * bytes. Two decisions live here rather than there, both because they are about
 * a response and not about a zip.
 *
 * **Ownership is not re-checked here, deliberately.** `articleBundle` →
 * `readArticleRows` predicates on `ownedSlug(slug)`, which is slug *and* the
 * current request owner in one `where`, so there is no window in which this
 * route holds an article it may not have. A second check written here would be
 * a second thing to get wrong, and `sendSource`'s belt-and-braces pair exists
 * for a reason that does not apply: that route reads a bucket object through a
 * store half of which has no owner column at all.
 *
 * What *does* have to happen here is the translation. `ArticleNotFound` is a
 * plain throw as far as this file's status plumbing is concerned, and an
 * untranslated one is a **500** — telling the reader the server is broken when
 * the honest answer is that, as far as they can see, there is no such article.
 * `httpError` is how every other route in this file says so.
 *
 * **`attachment`, not `inline`** — the opposite of `sendSource`'s answer, and
 * the reason `contentDisposition` stopped defaulting. A zip has nothing to
 * display, and the filename only survives the trip if the header carries it.
 */
async function sendExport(res: ServerResponse, slug: string): Promise<void> {
  const bundle = await articleBundle(slug).catch((err: unknown) => {
    /* Not this reader's article, or one with no current revision — the two are
       deliberately one answer, because saying which would confirm that a slug
       they cannot see exists. src/store/article-rows.ts. */
    if (err instanceof ArticleNotFound) throw httpError(404, "No such article.");
    throw err;
  });

  /* **Assembled, and too big to send.** A buffered Vercel response tops out at
     4.5 MB and stored HTML artefacts may be 32 MiB, so this is a real outcome
     rather than a defensive line — and the platform's own answer to it is a
     truncated download, which is worse than a refusal because it looks like a
     file. `overCap` is the flag `overBundleCap` set, read rather than
     recomputed: two `>` in two files is how one of them ends up `>=`.

     The prose is the reader's, not ours (docs/project/copy.md): it says what
     happened, and that retrying is not the way out. Streaming is the named fix
     if this ever fires. */
  if (bundle.overCap) {
    throw httpError(
      413,
      "This article is too big to download in one file. That is a limit on our side, " +
        "not something you did, and trying again will not help — tell us about it and " +
        "we will raise it.",
    );
  }

  res.statusCode = 200;
  /* A literal, and not a `CONTENT_TYPE` entry: that record is keyed by
     `StoredKind` — the kinds the blob store holds — and a zip we assemble per
     request is never stored, so widening it would put a type in the bucket's
     vocabulary that nothing there can produce. */
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", contentDisposition(`${slug}.zip`, "attachment"));
  /* A zip served from our own origin, holding the reader's own prose. `nosniff`
     for the same reason `sendSource` sets it: the one place a wrong content
     type becomes script. */
  res.setHeader("X-Content-Type-Options", "nosniff");
  /* **The response least suited to sitting in a disk cache**, and the same
     reasoning as `/api/admin/users` above: one reader's entire article — prose,
     comments, notes, every conversation they had about it — in one file, on a
     URL that is nothing but a slug. Nothing of ours would store it (the offline
     cache in src/web/lib/api.ts keeps to an allowlist this route is not on, and
     a zip is not JSON), but an intermediary or a shared browser has no way to
     know that unless the response says so, and "our own cache has good manners"
     is not the guarantee to rest a whole article on. */
  res.setHeader("Cache-Control", "private, no-store");
  /* The bytes actually being written. `bundle.byteLength` is the same number,
     and this is the one that stays true if it ever is not. */
  res.setHeader("Content-Length", String(bundle.bytes.byteLength));
  res.end(Buffer.from(bundle.bytes));
}

/** The two things a `Content-Disposition` can ask a browser to do with a file. */
export type ContentDispositionType = "inline" | "attachment";

/**
 * **A `Content-Disposition` for a filename a reader chose.**
 *
 * The name comes off `raw_filename`, which is whatever the browser sent when
 * somebody uploaded a PDF — so it is reader-controlled text on its way into a
 * response header, and it may hold quotes, backslashes, newlines or any of
 * Unicode. Interpolating it raw produces a malformed header at best.
 *
 * Two parameters, which is what RFC 6266 asks for and what every browser
 * implements:
 *
 *  - `filename=` carries an ASCII fallback with everything awkward replaced, for
 *    a client that does not read the second one.
 *  - `filename*=` carries the real name, percent-encoded, per RFC 5987. A client
 *    that understands it must prefer it.
 *
 * **`disposition` is required, and deliberately has no default.** It used to be
 * hard-coded `inline`, because the only caller was *view the original* and a
 * browser that can show a PDF should show it (GPT Sol, 2026-08-31) — that
 * reasoning now lives on `sendSource`, where the decision actually belongs. A
 * second caller wants `attachment` for a zip, and a default would have let it
 * inherit an answer that is wrong for a download without anything saying so. A
 * union rather than a boolean or a free string: the two legal values are the
 * two RFC 6266 types, and both a wrong flag polarity and a typo are then things
 * the compiler refuses.
 */
export function contentDisposition(
  filename: string,
  disposition: ContentDispositionType,
): string {
  /* **Well-formed first, or `encodeURIComponent` throws.** A lone UTF-16
     surrogate is a legal JavaScript string and an illegal Unicode scalar, and
     it can arrive here — the name came off a stranger's filesystem through a
     browser. Without this, an imported filename turns *view the original* into
     a `URIError` and a 500, which is the failure landing furthest from its
     cause. GPT Sol, 2026-08-31.

     Written out rather than `String.prototype.toWellFormed`, which does exactly
     this and is ES2024: `tsconfig.json` sets `lib: ["ES2022"]`, and widening
     the whole project's lib to reach one method is a change with a much larger
     blast radius than five characters of regex. The alternation is the two
     halves of "a surrogate with nothing on the other side of it". */
  const safe = filename.replace(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
    "\uFFFD",
  );
  /* Anything outside printable ASCII, plus the two characters that would end
     the quoted string early. `_` rather than dropping them, so a name made
     entirely of them is still a name. */
  const ascii = safe.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  /* **`encodeURIComponent` is not RFC 5987 on its own.** It leaves `'`, `(`,
     `)` and `*` alone, and none of those is in the `attr-char` set an extended
     parameter is defined over — so `O'Brien (draft)*.pdf` produces a value a
     strict client is entitled to reject, falling back to the lossy ASCII half
     for a name that did not need it. Four characters, escaped by hand. */
  const extended = encodeURIComponent(safe).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${extended}`;
}

/** An error carrying the HTTP status it should be reported as. */
function httpError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

/**
 * **What the two pictures that read passages for meaning answer with when they
 * cannot** — Force's dotted lines, and Drift and Trail's dots.
 *
 * One function because both routes want the identical three decisions and, when
 * they each made them separately, they disagreed: `projection` let a bug of ours
 * fall through to the catch-all and `similar` reported it as an outage.
 *
 * The three decisions:
 *
 * 1. **Is this even about embedding?** Only an `EmbeddingFailure` is. Everything
 *    after the model call is our own arithmetic — principal components, k-means,
 *    the ranking in src/similar.ts — and rewriting a bug in it as "could not
 *    reach the model" sends whoever is debugging to a status page for a fault in
 *    this repo. Anything else is rethrown untouched, and the catch-all reports a
 *    500 with a stack. GPT Sol's finding, 2026-08-27.
 * 2. **Whose fault, and therefore which status.** `config` is **500**: this
 *    server is misconfigured, and a 502 would claim it is a healthy gateway
 *    whose upstream let it down, which is the opposite of true. ⟨Sol⟩ `busy` is
 *    our own admission control, which is what 503 means. Only `provider` is a
 *    real 502.
 * 3. **What the reader is told**, from src/messages.ts — never the thrown
 *    message. What `embedBatch` throws names the key in use and an account
 *    setting: useful to whoever runs the server, meaningless and slightly
 *    sensitive to a reader. The real thing goes in the log, and it goes there
 *    with its `reason` *and* the provider's `status`, so a search for a settings
 *    problem does not have to match on prose.
 *
 * The status is passed to `placingFailed` as well as used here, because a
 * refusal the provider gave a number to gets that number's own sentence — see
 * `placingFailed`, and the reason a 401 must not be answered with "try again".
 */
export function embeddingHttpError(err: unknown, slug: string): Error {
  if (!(err instanceof EmbeddingFailure)) return err as Error;
  log("model").error(
    { slug, reason: err.reason, providerStatus: err.status, ...errorFields(err) },
    err.reason === "config"
      ? "this app is not configured to use the embedding model"
      : err.reason === "busy"
        ? "too many articles are being embedded at once"
        : "the embedding provider failed",
  );
  const status = err.reason === "config" ? 500 : err.reason === "busy" ? 503 : 502;
  return httpError(status, placingFailed(err.reason, err.status).message);
}

async function readBody(req: IncomingMessage, limit = MAX_BODY_BYTES): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw httpError(413, "Request body too large");
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    // Without this the client is told 404, and goes looking for a missing
    // article instead of the malformed body it actually sent.
    throw httpError(400, "Request body is not valid JSON");
  }
}

/**
 * A request body as a bag of fields — anything that is not a JSON object is an
 * empty one.
 *
 * `readBody` answers whatever the client sent, which may be a string, a number,
 * `null` or an array, and `"key" in raw` is a **TypeError** on the first two —
 * a 500 for a request that deserves a 400. A route that asks *did they send
 * this key?* has to ask *is this even a bag of fields?* first, and this is
 * where that question is answered once. Destructuring never needed it, which is
 * why it did not exist until a route started asking about a key's presence.
 */
function fields(body: unknown): Record<string, unknown> {
  return typeof body === "object" && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}

/**
 * The same test as `fields` above, but a **400 instead of a coercion** — for
 * the routes where a body that is not an object is a malformed request rather
 * than an empty patch.
 *
 * `fields` is right where an absent key means something ("this patch does not
 * mention the body"), and it deliberately reads `null` as `{}`. A `PATCH` that
 * must name a field cannot use it: `null` would become `{}` and be refused for
 * the wrong reason, or worse, be destructured directly.
 *
 * **Destructuring `readBody`'s result without this is a 500.** A bare JSON
 * `null` is a valid body, destructuring it throws a `TypeError`, and the
 * generic handler turns that into a server fault — a malformed request reported
 * as "this app is broken", which is the one thing validation must never do, and
 * which would be reported as our bug because it is the shape a client bug takes.
 *
 * There were four hand-written copies of this check (`patchShelf`,
 * `patchReader`, and the search and criterion `PATCH`es) and one route that
 * needed it and had none — renaming a chat thread, which 500'd on `null` until
 * 2026-09-02. The search PATCH's comment had said since 2026-08-27 that "the
 * same hole is latent in the other PATCH routes here", and it stayed latent for
 * as long as the sentence was the only thing enforcing it.
 * docs/reusable/written-down-is-not-checked.md.
 */
function objectBody(body: unknown): Record<string, unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw httpError(400, "Expected a JSON object");
  }
  return body as Record<string, unknown>;
}

/**
 * The comments this process is answering right now, as `slug/id`.
 *
 * `pending` on disk does not mean "an answer is coming" — it is written
 * *before* the model call precisely so a crash leaves evidence. Which means the
 * two cases look identical on disk: an answer genuinely in flight, and one that
 * died with the process that was writing it. The reader sees the same spinner
 * for both, and for the dead one it spins for ever.
 *
 * Only the running process can tell them apart, so it keeps the list.
 */
const answering = new Map<string, number>();

/**
 * Mark a comment as being answered right now, and hand back the release.
 *
 * **A count rather than a flag, and that is not defensive padding.** It was a
 * `Set` while the only way to re-answer a comment was the "Try again" link on a
 * failed one, so two requests for the same id could not overlap. The deep-search
 * button removed that guarantee: it sits on an answered comment, and the obvious
 * way to press it twice is to press it twice. With a `Set`, the first request to
 * finish deletes the key while the second is still streaming, and the next
 * `GET /api/comments` sees a `pending` row nobody is working on and sweeps it —
 * telling the reader "the server stopped before this was answered" about an
 * answer that is arriving as they read it.
 *
 * Chat needed `Live` and `settleThread` for the same problem. This is the small
 * version: nothing here can stop or supersede anything, it only stops the sweep
 * from lying.
 */
function beganAnswering(key: string): () => void {
  answering.set(key, (answering.get(key) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return; // a double release must not decrement someone else's
    released = true;
    const left = (answering.get(key) ?? 1) - 1;
    if (left > 0) answering.set(key, left);
    else answering.delete(key);
  };
}

/**
 * What this process is answering *in this article*, as bare comment ids.
 *
 * `answering` is keyed `slug/id` because the key has to stay unique across
 * articles — ids are unique per article, not globally, so handing every live id
 * in the process to one article's sweep would spare a row that merely shares an
 * id with one being written elsewhere. `CommentStore.sweepPending` takes bare
 * ids because that is what a row is called. Exactly `liveMessages` below, for
 * exactly the same reason.
 */
function liveComments(slug: string): Set<string> {
  const prefix = `${slug}/`;
  const ids = new Set<string>();
  for (const key of answering.keys()) {
    if (!key.startsWith(prefix)) continue;
    const id = key.slice(prefix.length);
    if (id) ids.add(id);
  }
  return ids;
}

/**
 * Turn abandoned `pending` comments into `error`, so they can be retried.
 *
 * Run on read rather than at startup: it is the same answer either way, and a
 * read is the only moment anyone cares. The retry path for `error` already
 * exists, so nothing in the client changes.
 *
 * **The rule itself lives in the store now**, and that is the fix rather than a
 * tidy-up. This function used to filter `answering` here — a module-scope `Map`
 * that knows only this process — so a `GET` landing on a second Vercel machine
 * saw a `pending` row nobody *local* was working on and errored it while the
 * reader watched the words arrive. What is left here is the half only a running
 * server knows: which rows this process is writing. The half that every machine
 * agrees on is a lease on the row, stamped by `beginAnswer` in
 * src/store/pg-comments.ts. `SweepOptions` in src/store/contracts.ts sets out
 * why neither half is sufficient alone; `CommentStore.sweepPending` says why
 * comments carry their window on the row instead of taking it from here.
 */
function sweepOrphaned(slug: string): Promise<Comment[]> {
  return commentStore.sweepPending(slug, liveComments(slug));
}

/**
 * How often an open stream says something even when it has nothing to say.
 *
 * The number is chosen against the client's clock rather than on its own: the
 * reader's side (`readEvents` in src/web/lib/sse.ts) gives up after
 * `STREAM_STALL_MS`, so this has to be comfortably shorter than that or a
 * healthy stream would be killed for being quiet. Three beats of headroom.
 */
export const SSE_HEARTBEAT_MS = 15_000;

/**
 * Keep an open stream making noise, so that silence means something.
 *
 * Nothing on the reader's side can tell a stream that is thinking from a stream
 * that is dead — a TCP connection that has gone away without being closed
 * delivers no bytes and no error, and `reader.read()` simply never settles. The
 * only fix is for the live case to keep proving it is live, which is what this
 * does: an SSE **comment** (`: ping`) every `SSE_HEARTBEAT_MS`, which the spec
 * says a client must ignore and which `parseFrame` on our side duly drops. The
 * bytes are the message.
 *
 * That matters more here than in most streaming apps, because the silences on a
 * *healthy* chat stream are long and legitimate: a tool can run for 45 seconds
 * (`MEANING_TIMEOUT_MS` in src/chat-tools.ts) between its two `tool` frames, and
 * a round can spend ten seconds thinking before its first word. Without a
 * heartbeat the client's clock would have to be longer than the longest of
 * those, which means a dead connection is not noticed for a minute and a half.
 *
 * It also stops an idle-timeout proxy — thirty or sixty seconds is a common
 * default — closing a stream that was about to deliver.
 *
 * `unref()` so a stray interval cannot hold the process open, and the interval
 * is cleared on `close` as well as by the returned function, because the two
 * callers reach the end by different routes.
 */
export function heartbeat(
  res: ServerResponse,
  alive: () => boolean,
  /* Only a test passes this. It is here because the alternative is a
     fifteen-second test, and a heartbeat that silently never fires is exactly
     the failure docs/reusable/silent-success.md is about — the answer still
     arrives, and only the dead connections take a minute longer to notice. */
  everyMs: number = SSE_HEARTBEAT_MS,
): () => void {
  /* **The reader may already have gone, and then `close` has already fired.**
     `sse` calls this after a handler's reads — three of them in `markOneAnswer`
     — so a reader who shuts the tab during those is gone before there is any
     listener to notice, and the `res.on("close", stop)` below would be
     registered for an event that will never come again. The interval that
     starts here would then run, unreferenced, until the process exits: it can
     never write, because `alive()` is already false, so it costs nothing and
     shows nothing, which is why it survived two reviews as a recorded leftover.
     Asking the socket what it is, rather than waiting to be told — the same
     question, in the same words, as the guard in `sse`. */
  if (res.destroyed || res.writableEnded) return () => {};
  const timer = setInterval(() => {
    if (!alive()) return;
    try {
      res.write(": ping\n\n");
    } catch {
      // The socket went away between the guard and the write. Nothing to do
      // and nobody to tell: the stream is over either way.
    }
  }, everyMs);
  timer.unref?.();
  const stop = () => clearInterval(timer);
  res.on("close", stop);
  return stop;
}

/**
 * Server-sent events on a response that is otherwise a plain Node one.
 *
 * Shared by chat and by comments, which were the only two things in this app a
 * reader waited on when this was extracted. It now also serves meaning-search,
 * quiz marking, both referee runs, the mirror, link summaries and both glossary
 * term routes. **No count here any more:** it was corrected three times as new
 * callers arrived, which is the ordinary way a count in prose goes wrong. Note
 * that `streamChat` writes its own SSE headers rather than coming through here,
 * so a grep for callers of this function still undercounts the streams in this
 * file by one.
 *
 * Extracted from `streamChat`, where every line of it was
 * already written — see the note on `res.on("close")` there for the one trap it
 * carries.
 */
function sse(res: ServerResponse): {
  frame(event: string, data: unknown): void;
  alive(): boolean;
  /**
   * Fires when the reader's connection closes — the same event `alive()` is
   * built on, in the form a model call can be handed.
   *
   * Here rather than in each caller because the two answers must be the same
   * answer. `alive()` stops us *writing* to a dead socket, which is only half
   * of what "the reader has gone" should mean: without a signal on the model
   * call, closing the tab leaves OpenRouter generating, and being paid for,
   * until it finishes on its own — and a retry then starts a second paid call
   * beside the first. A caller that wants only the frames can ignore this.
   */
  gone: AbortSignal;
} {
  /* Has the reader gone?

     `res.on("close")`, **not** `req.on("close")`, and the difference is a real
     trap rather than a preference. Node documents the request's `close` as
     "the request has been completed, **or** its underlying connection was
     terminated" — and `readBody` consumes the request stream to its end, so
     "completed" is already true before the model is ever called. Listening
     there means that on any Node version which takes the first reading, every
     frame is dropped and the reader watches a spinner while a perfectly good
     answer is written to disk behind them. The response's `close` has one
     meaning: this connection is finished. */
  let open = true;
  /* One listener, two consumers: the boolean the writes are guarded by, and the
     signal the model call is cancelled by. Two listeners could disagree about
     the moment the reader left; one cannot. */
  const left = new AbortController();
  res.on("close", () => {
    open = false;
    left.abort();
  });
  /* **And if they left before we got here, the event has already fired.**
     `sse` is called after a handler's reads — three of them in
     `markOneAnswer` — so a reader who closes the tab during those is gone
     before there is any listener to notice, and a signal created afterwards
     would be live and stay live: the paid call starts anyway, on a response
     that is already destroyed, and nothing ever cancels it. Asking the socket
     what it is rather than waiting to be told. GPT Sol's second review of the
     quiz code found this; it applies to every streaming route here. */
  if (res.destroyed || res.writableEnded) {
    open = false;
    left.abort();
  }
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // Nginx and friends buffer a response body by default, which for a stream
    // means the reader gets everything at once at the end — i.e. exactly the
    // spinner this feature exists to remove, with none of the symptoms.
    "X-Accel-Buffering": "no",
  });
  // Before the model call, so the browser's `fetch` resolves immediately and
  // the client is reading the stream while the first token is still being
  // thought about.
  res.flushHeaders?.();
  const alive = () => open && !res.writableEnded && !res.destroyed;
  // Started here rather than left to the caller, so that every stream this
  // helper opens is one the reader can tell apart from a dead one.
  heartbeat(res, alive);
  return {
    frame(event, data) {
      if (!alive()) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    alive,
    gone: left.signal,
  };
}

/**
 * The reader's own words, as the store may hold them: trimmed, or nothing.
 *
 * **One place, so `""` and absent cannot both mean "wrote nothing".** The
 * database has a check constraint saying the same thing and the type has
 * `body?: string` saying it a third time; this is the function that makes all
 * three agree, and it is the only thing that may build the value.
 */
function tidyBody(body: unknown): string | null {
  /* **Absent and `null` mean "no body"; anything else is a bad request.**
     Coercing a number, an array or an object to `null` made `{ body: {…} }`
     silently mean "bookmark this" — a client bug stored as a deliberate act,
     with nothing anywhere disagreeing. GPT Sol, reviewing the built code. */
  if (body === undefined || body === null) return null;
  if (typeof body !== "string") throw httpError(400, "body must be a string or null [cmt-type]");
  const trimmed = body.trim();
  if (!trimmed) return null;
  /* A limit, because this is the reader's own text going into a `text` column
     and a JSON file and every archive of both. Generous enough that nobody
     writing a note about a paragraph meets it. The message says the limit and
     **never the text** — an `httpError` message is logged as `reason`, and
     redaction here is path-based and cannot reach a string. */
  if (trimmed.length > MAX_BODY_CHARS) {
    throw httpError(400, `A comment can be at most ${MAX_BODY_CHARS} characters [cmt-long]`);
  }
  return trimmed;
}

/** Room for a few paragraphs of thinking about one passage, and no more. */
const MAX_BODY_CHARS = 4000;

/**
 * **The referee's own mark on a passage, as the store may hold it** — which
 * criterion, and where on its scale they put the passage.
 *
 * Greg, 2026-08-31: *"I'm keen to also include some kind of ranked red, green,
 * and/or red-green-spectrum … perhaps harmonising with the ability for the user
 * to comment (perhaps quantitatively) on things."* This is the second half of
 * that — the referee's own quantitative judgement, which is the anchoring
 * antidote in the design: they record what *they* think rather than only
 * reading what the model thought.
 *
 * ## The one rule this function exists to keep
 *
 * **A negative valence must survive.** `SearchHit.confidence` is a 0–100 match
 * strength whose validator clamps negatives to zero (`validateHits`,
 * src/search.ts), so a placement that travelled any confidence-shaped path
 * would arrive as `0` — *"no strong feeling"* — with nothing erroring and
 * nothing looking odd. So there is **no clamp here at all**: an out-of-range
 * number is a bad request, not a rounded one. Rejecting is the honest answer
 * because the referee typed a number and clamping silently answers a different
 * question. `markProblem` (src/referee-criteria.ts) is the rule, and it is the
 * same one `comments_valence_range` and `comments_valence_needs_criterion` hold
 * in the database.
 *
 * ## And the criterion has to be theirs
 *
 * `criterionId` comes off a request, so on its own it names any string. It is
 * checked against `refereeCriteriaStore.load(slug)`, which is scoped to this
 * article **and** to the requesting owner (`ownedSlug`, src/store/pg.ts), so a
 * criterion belonging to somebody else — or to another article, or to nothing —
 * is refused rather than stored. `comments_criterion_fk` refuses it a second
 * time, but a foreign-key error is a 500 with a Postgres message in it, and the
 * filesystem store has no constraint at all: the two stores agree only because
 * this check is above both of them.
 *
 * ## And it has to be a criterion with two ends
 *
 * The criterion is loaded before `markProblem` rather than after, because the
 * last of that function's rules is about its `kind`: only a `diverging`
 * criterion has poles, so only a `diverging` criterion can hold a signed
 * number. `−80` on a `single` or a `literature` criterion is signed against
 * nothing and the panel has no ends to draw it between. **The database cannot
 * refuse this one** — a `CHECK` cannot read another table — so unlike the range
 * and the needs-a-criterion rules, this route is the only place it can be
 * caught. GPT Sol's finding 6,
 * docs/plans/260831an-referee-mode-stage3b5c-review-sol.md.
 *
 * No message built here may contain the reader's prose — same rule as
 * `createFree` below, whose header says why.
 */
async function tidyMark(slug: string, raw: Record<string, unknown>): Promise<MarkPatch> {
  const { criterionId, valence } = raw;

  /* Absent and `null` both mean "no mark"; anything else is a bad request.
     Coercing here is what made `{ body: {…} }` silently mean "bookmark this" —
     see `tidyBody`. */
  if (criterionId !== undefined && criterionId !== null && typeof criterionId !== "string") {
    throw httpError(400, "criterionId must be a criterion id or null [cmt-criterion-type]");
  }
  if (valence !== undefined && valence !== null && typeof valence !== "number") {
    throw httpError(400, "valence must be a number or null [cmt-valence-type]");
  }
  const id = typeof criterionId === "string" ? criterionId : null;
  /* `Number.isFinite` before `markProblem`, because a NaN compares false
     against every bound and would slip through the range test as valid. */
  const placed = typeof valence === "number" && Number.isFinite(valence) ? valence : null;
  if (typeof valence === "number" && placed === null) {
    throw httpError(400, "valence must be a finite number [cmt-valence-type]");
  }
  if (id !== null && !isSpideryarnId(id)) {
    throw httpError(400, "criterionId must be a criterion id [cmt-criterion-type]");
  }

  /* The criterion is resolved **before** the rules, because one of the rules is
     about which kind it is and there is no way to know that from the request.
     A read only happens when an id was sent at all, so an ordinary reading note
     still costs nothing. */
  let named: SavedCriterion | undefined;
  if (id !== null) {
    const criteria = await refereeCriteriaStore.load(slug);
    named = criteria.find((c) => c.id === id);
    if (!named) {
      throw httpError(400, "criterionId is not one of your criteria on this article");
    }
  }

  /* The rules — a placement needs a criterion, it is a whole number from −100
     to +100, and it goes only on a criterion that has two ends — from the
     module that owns them, so the route and the database cannot drift into two
     different definitions of a placement. The kind rule is the route's alone to
     keep: a CHECK constraint cannot reach `referee_criteria` to read a kind, so
     `comments_valence_range` and `comments_valence_needs_criterion` hold the
     other two and nothing in the database holds this one. GPT Sol's finding 6. */
  const problem = markProblem({ criterionId: id, valence: placed, config: named?.config ?? null });
  if (problem) throw httpError(400, `${problem} [cmt-valence-range]`);

  return { criterionId: id, valence: placed };
}

/**
 * The same placement, in the shape `create` takes: absent keys, not `null`s.
 *
 * **One validator, two shapes, and the two shapes are not interchangeable.**
 * `NewComment` says "no placement" by leaving the fields off, because
 * `exactOptionalPropertyTypes` is on and the two stores are compared
 * structurally — a `null` on one side against an absent key on the other is a
 * real failure, not a cosmetic one. An *edit* has to be able to say "clear
 * this", which an absent key cannot say, so `patchMark` takes `null`s. Adapting
 * here rather than validating twice is what keeps one definition of what a
 * placement is: a second copy of `markProblem`'s rules is the thing that drifts.
 */
function asNewComment(mark: MarkPatch): { criterionId?: string; valence?: number } {
  return {
    ...(mark.criterionId === null ? {} : { criterionId: mark.criterionId }),
    ...(mark.valence === null ? {} : { valence: mark.valence }),
  };
}

/**
 * Store a **free** comment — the reader's mark on a passage. No model call.
 *
 * This is what selecting text does since 2026-08-28. Until then, selecting text
 * bought an explanation, and this route was `answer` below; the two split
 * because a colliding id means opposite things to them (a retry to one,
 * somebody else's comment to the other) and one function could not safely be
 * both. docs/plans/260828a-comments-and-bookmarks.md.
 *
 * ## The anchor is checked against the article, here
 *
 * `checkAnchor` exists for chat and is **weaker than it looks**: it verifies the
 * quote is *somewhere* in the block, not that it is at the offset given, and on
 * its own it would accept an empty quote because every string contains `""`.
 * GPT Sol pointed that out reviewing this plan. So the checks are written out
 * rather than borrowed, and `start` is bounded as well as non-negative — a
 * `start` past the end of the block draws the mark in the wrong place, which
 * reads as a styling glitch rather than as bad data.
 *
 * **No message built here may contain the quote or the body.** Both are the
 * reader's, `httpError` messages are logged as `reason`, and redaction matches
 * key names rather than values, so the only thing keeping prose out of the log
 * is not putting it in. Same rule as the top of src/comments.ts.
 */
async function createFree(slug: string, body: unknown): Promise<Comment> {
  const raw = (body ?? {}) as Record<string, unknown>;
  const { id, blockId, quote, start, body: text } = raw;

  if (typeof blockId !== "string" || typeof quote !== "string" || typeof start !== "number") {
    throw httpError(400, "Expected { blockId, quote, start }");
  }
  if (!isSpideryarnId(blockId)) throw httpError(400, "blockId must be a block id");
  if (id !== undefined && (typeof id !== "string" || !isSpideryarnId(id))) {
    throw httpError(400, "id must be a block id");
  }
  if (!quote.trim()) throw httpError(400, "quote must not be empty");
  if (quote.length > MAX_QUOTE_CHARS) {
    throw httpError(400, `A quote can be at most ${MAX_QUOTE_CHARS} characters [cmt-quote]`);
  }
  if (!Number.isInteger(start) || start < 0) {
    throw httpError(400, `start must be a non-negative integer, got ${start}`);
  }
  const tidied = tidyBody(text);

  // Before anything is written, so a slug that is not an article is a clean 404
  // with nothing left behind.
  const article = await loadArticle(slug);
  const block = article.blocks.find((b) => b.id === blockId);
  if (!block) throw httpError(400, "blockId is not a block of this article");
  if (start > block.text.length) throw httpError(400, "start is past the end of that block");
  /* Folded, because `quote` came from a DOM selection and `block.text` from the
     extractor, and the two disagree about runs of whitespace — the same fold
     `checkAnchor` uses, for the same reason. */
  if (!foldSpace(block.text).includes(foldSpace(quote))) {
    throw httpError(400, "quote is not in that block");
  }

  /* After the anchor checks, so a request that is wrong about the passage does
     not first pay for a criteria read — and before the write, so a bad
     placement leaves nothing behind. */
  const mark = asNewComment(await tidyMark(slug, raw));

  return commentStore.create(slug, {
    blockId,
    quote,
    start,
    ...(tidied === null ? {} : { body: tidied }),
    ...(typeof id === "string" ? { id } : {}),
    ...mark,
  });
}

/** A selection, not an essay. Long enough for a run-on sentence and no more. */
const MAX_QUOTE_CHARS = 2000;

/**
 * Collapse runs of whitespace, for comparing a selection against a block.
 *
 * **One of these, used by both anchor checks.** A quote comes from a DOM
 * selection and `block.text` comes from the extractor, and the two disagree
 * about runs of whitespace — see the note in src/blocks.ts. `checkAnchor` had
 * its own copy of this line; two copies of a normaliser is how a chat anchor
 * and a comment anchor end up disagreeing about the same passage.
 */
const foldSpace = (t: string) => t.replace(/\s+/g, " ").trim();

/**
 * Answer a **legacy explanation** a few words at a time, and store the answer.
 *
 * Reached only as `POST /api/comments/:slug/:id/answer`, and only by *Try
 * again* and *Search the web properly* on a comment that already has an answer
 * or an error. Since 2026-08-26 a selection opens a conversation rather than
 * buying one of these, and since 2026-08-28 it makes a free comment; nothing
 * creates a new explanation, and this route cannot.
 *
 * **It takes an id and no anchor.** `beginAnswer` reads the stored passage
 * rather than accepting one, which closes the hole where a retry could quietly
 * move a comment to different words — and it refuses a `status: "none"` row,
 * so a bookmark cannot be dragged into the retired path.
 *
 * **Validation happens before a single header is written**, so a bad request is
 * still an ordinary JSON 400 — the thrown `httpError` never reaches a
 * half-opened stream. Everything after `sse(res)` is frames, including failure.
 *
 * Three writes, deliberately: `pending` lands before the model call so a crash
 * leaves evidence, and the terminal state is written before the last frame so
 * the disk and the reader can never disagree. A model failure is a `done` frame
 * carrying a comment whose status is `error` — the request *did* succeed at what
 * it was for; the dialog shows the failure and offers a retry.
 *
 * Frames: one `begin`, then any number of `delta`, then exactly one `done`.
 */
async function answer(
  slug: string,
  id: string,
  body: unknown,
  res: ServerResponse,
): Promise<void> {
  const { deep, useProfile } = (body ?? {}) as Record<string, unknown>;
  /* Anything other than `true` is not deep. A 400 here would be a validation
     message built from the request body, which is the one thing `httpError`
     messages must never be — they are logged as `reason`, and redaction is
     path-based and cannot reach a string. */
  const deeper = deep === true;
  /* `!== false`, the mirror of the line above and deliberately not the same
     rule. Deep search is an extra the reader asks for, so absent means no; the
     profile is the default this app now writes with, so absent means yes and
     only an explicit refusal turns it off. */
  const wantsProfile = useProfile !== false;

  // Before the row is touched, so a slug that is not an article is a clean 404.
  const article = await loadArticle(slug);
  if (!isSpideryarnId(id)) throw httpError(400, "id must be a comment id");

  /* **The profile is read before the row is claimed, and the order is the
     point.** `beginAnswer` stamps a lease — `COMMENT_ANSWER_LEASE_MS` in
     src/store/pg-comments.ts — and that lease is sized as the model's own
     deadline plus half a minute for the store write after it. Anything slow
     between the claim and `explainStream` therefore eats a window that was
     never budgeted for it: a profile lookup stalling past the deadline (there
     is no query timeout on it) lets another machine's `GET` sweep a row whose
     model call has not even started. GPT Sol, 2026-09-01.

     So the slow read happens first, and the lease begins a few lines above the
     call it is measuring. The alternative was a second write to renew the lease
     just before the model call, which is one more store method and one more
     UPDATE per answer for the same effect. This is free.

     The fence in `commentStore.patch` is what makes an expired lease merely
     expensive rather than wrong; this is what stops it being either.

     One consequence, and it is an improvement: a profile read that *fails* now
     fails the request before a header is written, so it is an ordinary JSON 500
     and the comment is left exactly as it was. It used to happen inside the
     stream and be recorded as a failed answer on the reader's own question. */
  const profile = wantsProfile ? await resolveProfile(slug) : null;

  /* Throws `NotAnExplanation` for an unknown id and for a bookmark, which
     `serveApi`'s error mapping turns into a 404 and a 409. The anchor comes
     back off the stored row — the request never gets to name one. */
  const { comment, attempt } = await commentStore.beginAnswer(slug, id);
  const { blockId, quote } = comment;
  const key = `${slug}/${comment.id}`;
  const release = beganAnswering(key);

  const { frame } = sse(res);
  frame("begin", comment);

  /**
   * Send the `done` frame, carrying **what the store actually holds**.
   *
   * `commentStore.patch` answers `undefined` when this attempt is no longer the
   * live one — a sweep buried it and the reader has begun another. Framing our
   * own answer then would put it back on their screen, which is the overwrite
   * the fence exists to prevent, one layer up: `useComments.ts` calls `put` on
   * whatever the `done` frame carries. So on a refusal the row is read back and
   * framed instead, and the reader's panel ends up agreeing with the database.
   *
   * **A frame either way**, unlike `pgSearchStore.finish`'s caller, which
   * simply stays silent. The comment client turns a stream that ends without a
   * `done` into "The answer stopped arriving. Try again." and writes that error
   * over the row — so silence here would clobber the newer attempt in the UI
   * with a message about an older one.
   *
   * The fallback is our own patch, for the case where the read finds nothing:
   * the comment was deleted mid-answer, and `useComments` already knows what to
   * do with a `done` frame for an id it has deleted.
   */
  const settle = async (patch: AnswerPatch): Promise<void> => {
    const kept = await commentStore.patch(slug, comment.id, patch, attempt);
    if (kept) {
      frame("done", { ...comment, ...patch });
      return;
    }
    let stored: Comment | undefined;
    try {
      stored = (await commentStore.load(slug)).find((c) => c.id === comment.id);
    } catch (readErr) {
      // The write was refused and the read-back failed too. Say so, then fall
      // back — a `done` frame the reader can act on beats a stream that stops.
      log("store").error(
        { ...errorFields(readErr), slug, id: comment.id },
        `could not read back a superseded explanation for ${slug}`,
      );
    }
    frame("done", stored ?? { ...comment, ...patch });
  };

  let text = "";
  try {
    for await (const event of explainStream({
      meta: article.meta,
      blocks: article.blocks,
      blockId,
      quote,
      deep: deeper,
      profile,
    })) {
      if (event.type === "delta") {
        text += event.text;
        frame("delta", { text: event.text });
        continue;
      }
      await settle({
        status: "done" as const,
        answer: event.answer,
        citations: event.citations,
        searches: event.searches,
        model: event.model,
      });
    }
  } catch (err) {
    /* **Reported here or nowhere.** Once `sse(res)` has sent the headers this
       function owns the response and the outer catch never sees the error — so
       a failure inside a stream is invisible to the seam in `serveApi`, and a
       stream is exactly where a model call fails. Same reasoning at the two
       other streams below. */
    captureFailure(err, { route: "explain", slug });
    /* The partial answer is kept, exactly as chat keeps one. Half an
       explanation and a reason beats a spinner that turns into nothing, and the
       reader has already read the half. */
    const patch = {
      status: "error" as const,
      error: (err as Error).message,
      ...(text.trim() ? { answer: text.trim() } : {}),
    };
    /* **Nothing past `sse(res)` may throw.** The headers are gone, so an escaped
       error would reach the outer handler, which would try to `send` a JSON 500
       onto a response that is already an open event stream — and the reader
       would see the stream simply stop. A store that cannot record the failure
       is a worse thing than a failure, and it is worth its own line. */
    try {
      await settle(patch);
    } catch (storeErr) {
      log("store").error(
        { ...errorFields(storeErr), slug, id: comment.id },
        `could not record a failed explanation for ${slug}`,
      );
      /* The secondary failure, and worth its own issue rather than a footnote
         on the first: one of these means a model call failed, two mean the
         store is broken too, and only the second is an emergency. */
      captureFailure(storeErr, { route: "explain", slug, phase: "record-failure" });
      /* `settle` frames the `done` itself, so this is the one path that still
         has to: the store could not be told, and the reader must still be. */
      frame("done", { ...comment, ...patch });
    }
  } finally {
    release();
    res.end();
  }
}

/**
 * **How the page on the other end of a hyperlink stands to the piece being
 * read** — `GET /api/link-summary?slug=…&url=…&block=…`, streamed.
 *
 * AGENTS.md's rule (*stream any model call a person is waiting on*) and
 * `explain.ts` is the shape. The plan originally argued for a non-streaming v1
 * and the review overturned it: the cited precedent is itself a stream whose
 * batch interface drains the same generator, so this is the existing shape
 * rather than extra machinery.
 *
 * **The two reads that can throw happen before a single header is written**, and
 * that is `answer`'s rule one section up rather than a preference. `loadArticle`
 * is owner-scoped and 404s on somebody else's slug; the profile is two queries
 * with no timeout on them. Once `sse(res)` has run, a throw is a stream that
 * stops, which the reader cannot tell from a model that failed.
 *
 * Frames are the `LinkSummaryEvent` members by name: any number of `delta`, then
 * exactly one of `ready`, `unavailable`, `refused` or `pending`.
 *
 * **A failure ends as `pending`, and that is a decision rather than a
 * convenience.** The client's rule — stage 2's P2-1, applied to the same four
 * outcomes — is that it remembers what is a property of the *link* and forgets
 * what is a property of *this moment*. A failure here is the second kind, and
 * the commonest one measured on 2026-09-05 was not our bug at all: OpenRouter
 * answering `429 … temporarily rate-limited upstream` in the middle of a
 * perfectly good stream. Framing that as `unavailable` would silence that link
 * for the rest of the session over a busy minute; framing nothing would do the
 * same, because a stream with no terminal frame is cached as nothing. So the
 * reader gets the same blank card either way and the *next* hover asks again.
 *
 * It is still reported: `captureFailure` runs first, so a real bug of ours is in
 * Sentry rather than quietly retried for ever. The cost of being wrong this way
 * is bounded by the limiter — a hard failure spends one fill per hover until the
 * reader's allowance runs out and then refuses.
 */
async function streamLinkSummary(
  slug: string,
  url: unknown,
  /**
   * **Which of that URL's mentions the pointer is on**, or `null` when the
   * client did not say. Validated where the article is — src/link-summary.ts —
   * because that is the only place that can tell a block of this article
   * carrying this link from any other string.
   */
  blockId: string | null,
  res: ServerResponse,
): Promise<void> {
  const article = await loadArticle(slug);
  /* Always the reader's own, never the client's word for it — `useProfile` above
     says why that flag exists on the routes that have one, and this route
     deliberately has none: there is no control on the card to turn it off, so
     offering the client a way to would be a switch nobody can see. */
  const profile = await resolveProfile(slug);

  const { frame, gone } = sse(res);
  try {
    for await (const event of linkSummaryStream({
      slug,
      article,
      url,
      blockId,
      profile,
      signal: gone,
    })) {
      frame(event.kind, event);
    }
  } catch (err) {
    /* **Reported here or nowhere.** Once `sse(res)` has sent the headers this
       function owns the response and the outer catch never sees the error — the
       same note `answer` carries, and a stream is exactly where a model call
       fails. */
    captureFailure(err, { route: "link-summary", slug });
    /* And then `pending`, so the client forgets rather than remembers — see the
       header. `frame` is a no-op on a socket the reader has already left. */
    frame("pending", { kind: "pending" });
  } finally {
    res.end();
  }
}

/**
 * **Explain a term the reader typed into the glossary's box, a few words at a
 * time** — `POST /api/glossary/:slug/ask`, body `{ term }`, SSE out.
 *
 * `answer`'s rule, and `streamLinkSummary`'s: **every refusal is decided before
 * a header is written.** `askAboutTerm` settles ownership, the term's validity,
 * the no-prose case and the anchor and only then resolves, so each of those is
 * still the ordinary JSON 400/404/409 with its `[gl-ask-…]` code that the box
 * already reads. Once `sse(res)` has run, a throw is a frame.
 *
 * Frames: one `begin` carrying where the term was found — `term`, `blockId`,
 * and the **article's** characters as `quote`, never the reader's — then any
 * number of `delta`, then exactly one of `done` (the whole `AskedTermAnswer`,
 * the shape the JSON route used to send) or `error` (`{ error }`, the
 * reader-facing sentence). **No partial text rides on `error`**, unlike quiz's:
 * nothing about an asked term is kept, so a half-answer has nowhere to go but
 * away. docs/plans/260910g-stream-glossary-answers-as-they-arrive.md.
 *
 * `gone` goes to the model call, so a reader who changes the question or leaves
 * the article cancels the paid call rather than only the frames — the client
 * aborts its `fetch` on both.
 */
async function streamAskedTerm(slug: string, term: unknown, res: ServerResponse): Promise<void> {
  const { found, stream } = await askAboutTerm(slug, term);

  const { frame, gone } = sse(res);
  frame("begin", found);
  try {
    for await (const event of stream(gone)) {
      if (event.type === "delta") {
        frame("delta", { text: event.text });
        continue;
      }
      frame("done", event.answer);
    }
  } catch (err) {
    /* **Reported here or nowhere** — the note on `answer`. A reader who left
       is not a failure worth an issue, and `frame` is a no-op on their closed
       socket anyway. */
    if (!gone.aborted) captureFailure(err, { route: "glossary-ask", slug });
    frame("error", { error: (err as Error).message });
  } finally {
    res.end();
  }
}

/**
 * **Check one glossary entry on the web, a few words at a time, and keep the
 * answer** — `POST /api/glossary/:slug/:id/lookup`, SSE out.
 *
 * `streamAskedTerm`'s shape: the 404 and the two 409s are decided by
 * `lookUpTerm` before a header is written, then any number of `delta` and
 * exactly one `done` (`{ entry }`, the JSON route's old body) or `error`.
 * **`done` is written only after the lookup is stored** — a save that fails
 * after the words arrived is an `error`, so the panel never draws an answer as
 * kept when it was not.
 *
 * **The one difference from its sibling, and it is deliberate: `gone` is not
 * passed to the model call.** The panel tells the reader they can carry on
 * reading because the answer is saved against the term either way, and that
 * was true of the JSON route only because nothing stopped the server when the
 * tab went. Cancelling here would turn a closed band into a paid call thrown
 * away and a promise broken; letting it finish buys the stored answer the
 * reader was told they would get. The asked term cancels, because nothing it
 * produces outlives the page. `answer` above makes the same choice for the
 * same reason. docs/plans/260910g-stream-glossary-answers-as-they-arrive.md.
 */
async function streamTermLookup(slug: string, termId: string, res: ServerResponse): Promise<void> {
  const { stream } = await lookUpTerm(slug, termId);

  const { frame } = sse(res);
  try {
    for await (const event of stream()) {
      if (event.type === "delta") {
        frame("delta", { text: event.text });
        continue;
      }
      frame("done", { entry: event.entry });
    }
  } catch (err) {
    captureFailure(err, { route: "glossary-lookup", slug });
    frame("error", { error: (err as Error).message });
  } finally {
    res.end();
  }
}

/* ----------------------------------------------------------------- quiz --
   The second reader-facing model call in this file, after `answer` above, and
   the second deliberate exception to "LLM calls happen in the pipeline, not in
   request handlers" — for the same reason as the first: the input is the
   reader's own answer, which does not exist until they write it.
   docs/plans/260831al-review-quiz-sub-mode.md § Marking. */

/**
 * The two 409s a mark can meet, in the order they have to be asked.
 *
 * **Stale first, then the batch**, because the two failures have different
 * sentences and the staler fact is the more useful one: a reader told "the
 * questions were rewritten" when in fact the *article* moved would go and press
 * the wrong button.
 *
 * A function because `markOneAnswer` asks twice — once on the quiz it read, and
 * again after reading the article, which is a second resolution of "the current
 * revision". Written inline both times, the two copies would eventually give
 * the reader two different accounts of one event.
 */
function refuseAMovedQuiz(found: QuizFound, batchId: string): void {
  if (found.stale) {
    throw httpError(
      409,
      "The article has changed since these questions were written, so this answer " +
        "cannot be marked against them. Write the questions again.",
    );
  }
  if (found.quiz.batchId !== batchId) {
    throw httpError(
      409,
      "These questions have been rewritten since you opened them, so this answer " +
        "belongs to a batch that no longer exists. Reload to get the current ones.",
    );
  }
}

/**
 * Mark one answer against one question, a few words at a time.
 *
 * `POST /api/quiz/:slug/mark`, body `{ batchId, questionId, answer }`, SSE out.
 *
 * ## The body carries three ids and the reader's words, and nothing else
 *
 * **The question, the reference answer and the evidence are read out of the
 * artefact here**, never taken from the request. A body that could carry them
 * would let a tampered client make the model mark against a question the
 * article never asked, and — much more likely than an attack — would let a
 * stale tab mark against a reference answer that no longer exists.
 *
 * ## And the lookup is bound to the batch
 *
 * A `questionId` is unique within a batch and is minted fresh on every run,
 * because this stage inherits no ids (src/pipeline.ts § the `quiz` step). So a
 * forced regeneration between the reader seeing a question and pressing Answer
 * replaces every reference answer in the column while nothing about the request
 * looks wrong. Three refusals, and none of them falls forward:
 *
 * - a `batchId` that is not the current one → **409**, saying the questions
 *   were rewritten;
 * - a source-stale quiz → **409**, rather than a mark against an article that
 *   has moved underneath the question;
 * - a `questionId` that is not in the current batch → **404**.
 *
 * Falling forward to "the question with that id in the current batch" would be
 * the tempting repair and is the bug: the ids are minted per batch, so a match
 * across batches is a coincidence rather than the same question.
 *
 * **And all three are asked twice**, because reading the quiz and reading the
 * article are two separate resolutions of "the current revision" —
 * `refuseAMovedQuiz` below the second read, and the comment there.
 *
 * ## The stream has to be able to say it failed
 *
 * Zero or more `delta` frames, then **exactly one terminal frame** — `done` on
 * success, `error` on anything else. Every failure `markAnswerStream` can reach
 * (timeout, stall, provider error, truncation, empty output, a stream that ends
 * without finishing) arrives here as a throw and leaves as `error`, carrying
 * whatever partial text had already been shown so the reader is not left
 * wondering whether the half-sentence in front of them is the whole reply.
 *
 * The one case with **no** terminal frame is the reader leaving: `sse`'s `gone`
 * aborts the model call, `markAnswerStream` ends without a `done`, and there is
 * nobody on the other end of the socket to tell either way.
 *
 * **The client ticks a question answered only on `done`.** A stream that simply
 * stops — a dropped connection, a killed instance — produces neither frame, and
 * that is the case a mocked complete transcript cannot test:
 * tests/quiz-mark-stream.test.ts emits two deltas and then closes.
 *
 * **Validation happens before a single header is written**, so a bad request is
 * an ordinary JSON 400/404/409 and the thrown `httpError` never reaches a
 * half-opened stream. Everything after `sse(res)` is frames, including failure.
 *
 * **Nothing is stored.** No attempt row, no thread, no `pending` write to
 * recover — which is why this handler has none of `answer`'s three writes. A
 * reload starts the quiz fresh; the questions persist because they are an
 * artefact. docs/plans/260831al-review-quiz-sub-mode.md § Attempts are not stored.
 */
async function markOneAnswer(slug: string, body: unknown, res: ServerResponse): Promise<void> {
  const { batchId, questionId, answer } = (body ?? {}) as Record<string, unknown>;
  if (typeof batchId !== "string" || !batchId) throw httpError(400, "batchId must be a string");
  if (typeof questionId !== "string" || !questionId) {
    throw httpError(400, "questionId must be a string");
  }
  /* **Trimmed before it is measured, and refused when empty.** An answer of
     whitespace is a button the reader pressed by accident, and paying for a
     model call to be told "you have written nothing" is worse than a message.
     The messages here never quote the body — they are logged as `reason`, and
     redaction is path-based and cannot reach a string. */
  if (typeof answer !== "string") throw httpError(400, "answer must be a string");
  const written = answer.trim();
  if (!written) throw httpError(400, "answer must not be empty");
  if (written.length > MAX_QUIZ_ANSWER_CHARS) {
    throw httpError(413, `answer must be at most ${MAX_QUIZ_ANSWER_CHARS} characters`);
  }

  /* Both reads before anything is written, so a slug that is not an article is
     a clean 404 and a stale batch is a clean 409. `loadQuiz` throws 404 when
     nobody has written the questions yet — which is the right answer to a mark
     against a quiz that does not exist. */
  const found = await loadQuiz(slug);
  refuseAMovedQuiz(found, batchId);
  const at = found.quiz.questions.findIndex((q) => q.id === questionId);
  const question = found.quiz.questions[at];
  if (!question) throw httpError(404, "questionId is not a question in this quiz");

  const article = await loadArticle(slug);
  /* **And asked again, because that was a second read.**

     The checks above were made against whatever revision `loadQuiz` resolved;
     `loadArticle` then resolves the current revision all over again. A publication
     landing between the two awaits gets the model revision A's question,
     reference answer and evidence beside revision B's prose — a 200, a
     plausible mark, and the guard whose whole job is to prevent it having
     already passed. Asking again closes it: a quiz is stale the moment the
     article's fingerprint moves, so a revision in that gap makes this read say
     so (or, if the questions were rewritten too, changes the batch).

     **This is a re-check, not a snapshot, and the difference is worth being
     honest about.** What the review asked for was all four inputs from one
     revision, which needs a revision-scoped read the `ArticleReader` contract
     does not have — every read there takes a slug and resolves "current"
     itself. Adding one would be a second way to read an article, for a window
     of microseconds, so it was not worth it now: what is left is a revision
     that lands *and* is superseded by one with an identical fingerprint, both
     inside one handler.

     **That ABA window is accepted, on a second review that named it.** The
     remedy offered was to compare `found.quiz.sourceHash` against the
     fingerprint of the article actually loaded, which is the right shape — it
     binds the question to the exact prose being sent — and does not compute:
     `Article.meta` has been through `titleFor`/`metaFrom`, which synthesise a
     title from the h1, the slug or a shelf rename, while the store's
     fingerprint uses `metaFingerprintOf`, which returns `null` when
     `revision.title` is null. Renamed articles would 409 on every mark, and so
     would untitled ones — bar the coincidence of one whose synthesised title
     lands exactly on what was stored. **A mark that silently refuses for a whole class of articles is
     a worse lie than a window this narrow**, and the honest fix is a
     fingerprint input both sides can agree on — the plan's stage 6, not a patch
     here. */
  refuseAMovedQuiz(await loadQuiz(slug), batchId);

  const { frame, gone } = sse(res);
  let text = "";
  try {
    for await (const event of markAnswerStream({
      meta: article.meta,
      blocks: article.blocks,
      /* The three things the request may not name. */
      question: question.question,
      referenceAnswer: question.referenceAnswer,
      evidence: question.evidence,
      answer: written,
      /* **The reader leaving cancels the paid call, not just the frames.**
         Without this, closing the tab left OpenRouter generating a mark nobody
         would ever see, and being paid for it, until it finished on its own —
         and a reader who came back and pressed Answer again started a second
         one beside the first. There is no stop button in the quiz panel and no
         attempt row to reconcile, so this is the only cancellation there is.
         `markAnswerStream` tells this signal apart from its own deadline and
         stall clocks and ends the mark without a `done`. */
      signal: gone,
      telemetry: {
        /* Content-free, all five of them: three ids, an ordinal and the slug.
           `markAnswerStream` writes the one line per mark and adds the counts.
           Never the answer, the question, the reference answer or the reply — a
           quiz answer is a record of what somebody did not know.
           docs/project/logging.md. */
        attemptId: randomUUID(),
        batchId: found.quiz.batchId,
        questionId: question.id,
        ordinal: at + 1,
        slug,
      },
    })) {
      if (event.type === "delta") {
        text += event.text;
        frame("delta", { text: event.text });
        continue;
      }
      /* **The one explicit `done`**, and the only frame that lets the client
         tick this question answered.

         `verdict` rides here and only here — never on a `delta` — so the word
         that decides how hard the next question is cannot reach the reader's
         screen even by accident, because nothing renders this frame's fields
         except the tick. It is often absent, which is normal: the ladder reads
         absence as *hold the band*. docs/plans/260907d-make-the-quiz-adaptive.md. */
      frame("done", {
        reply: event.reply,
        model: event.model,
        ...(event.verdict ? { verdict: event.verdict } : {}),
      });
    }
  } catch (err) {
    /* **Reported here or nowhere.** Once `sse(res)` has sent the headers this
       function owns the response and the outer catch never sees the error — so
       a failure inside a stream is invisible to the seam in `serveApi`, and a
       stream is exactly where a model call fails. Same reasoning as `answer`
       and `streamChat`. */
    captureFailure(err, { route: "quiz-mark", slug });
    /* The partial reply travels with the failure, exactly as chat's does. Half
       a mark and a reason beats a spinner that turns into nothing, and the
       reader has already read the half — but it arrives as `error`, so the
       question stays un-ticked and the reply stays retryable. */
    frame("error", { error: (err as Error).message, text });
  } finally {
    res.end();
  }
}

/* ----------------------------------------------------------------- chat --
   The one endpoint in this file that does not answer with JSON.

   See docs/plans/260826a-chat-mode.md. Everything here mirrors the comment endpoints
   above — a `pending` row written before the model call, an orphan sweep on
   read, a terminal state written before the reply — with the differences that
   streaming forces, each called out where it happens. */

/**
 * The assistant messages this process is streaming right now, as
 * `slug/threadId/messageId`.
 *
 * Exactly the job `answering` does for comments, and for exactly the same
 * reason: `pending` on disk does not mean "an answer is coming", because it is
 * written *before* the model call so that a crash leaves evidence. Only the
 * running process can tell an answer in flight from one that died with the
 * process that was writing it.
 */
interface Live {
  /**
   * Fired when the reader presses stop, and when an edit or a retry supersedes
   * this answer. src/converse.ts tells it apart from its own deadline and stall
   * signals and finishes the turn normally rather than throwing.
   */
  stop: AbortController;
  /**
   * Resolves when this stream has finished writing — not when it was aborted.
   *
   * The reason it exists is a race that only shows up under a retry.
   * `retryTurn` reuses the answer's row, id and all, so an aborted stream whose
   * `finishTurn` lands *after* the reset would put the stopped half-answer back
   * over the fresh `pending` row — and then nothing would ever clear it, because
   * the retry's own stream is writing to the same id and will simply overwrite
   * a row it thinks it owns. Aborting is not enough; the supersede has to wait
   * for the writer to let go. See `settleThread`.
   */
  done: Promise<void>;
  /**
   * Which *attempt* at this row this is.
   *
   * The key of `streaming` names a row, and a retry deliberately reuses the
   * row — see `withRetry` in src/chat.ts. So the key alone cannot tell one
   * attempt from the next, and a stop is a request about one particular
   * attempt: the reader pressed it while watching *those* words arrive. Press
   * stop, have the answer finish before the request lands, press retry, and the
   * stop would arrive to find a different answer under the name it was given
   * and abort that one instead. Rare in one tab, ordinary across two.
   *
   * So `/stop` carries the token back and `stopChat` refuses a mismatch.
   *
   * **A random token rather than a counter**, and the first version of this was
   * a counter with a comment claiming it was never reused. It is not reused
   * *within one process*, which is not the claim that matters: two servers on
   * one `data/` directory both start at 1, so A's stale stop for attempt 1
   * matches B's live attempt 1 exactly and aborts an answer nobody asked to
   * stop — the same failure this field exists to prevent, wearing the fix as a
   * disguise. A token nobody can guess cannot collide with another process's.
   * Found by a GPT-5.6 review, 2026-08-26.
   *
   * A request with no token at all still stops whatever is there, and that is
   * deliberate rather than an oversight: a tab that reloaded mid-answer has
   * seen no `begin` frame and so has no token for the row, and it must still be
   * able to stop the answer it is watching. The hole that leaves — an old
   * client aborting a replacement — needs both a tokenless client and a live
   * replacement, and is smaller than a stop button that does nothing after a
   * reload.
   */
  attempt: string;
}

/**
 * **Two jobs, and only one of them has a durable half.**
 *
 * The one that is easy to see: `liveMessages` turns this into the `keep` set for
 * `ChatStore.sweepPending`, and `SweepOptions` (src/store/contracts.ts) is
 * explicit that `keep` alone is a cross-process bug and that something durable
 * must speak for every other process. That half is fine, and it is why a sweep
 * of this file's registries can wrongly conclude this one is safe.
 *
 * The one that has nothing behind it: **this map is also where each live
 * stream's `AbortController` and `done` promise live**, and there is no second
 * copy of those anywhere. `settleThread` aborts superseded streams through it,
 * and the stop route finds the stream to abort through it. So on a module
 * re-evaluation — same process, second copy, request still running — a reader
 * pressing **Stop** reaches an empty map, is told `{ stopped: false }`, and the
 * paid model call keeps running and keeps being billed. A retry or an edit
 * likewise supersedes nothing and writes over a row a live stream still holds.
 *
 * Found by GPT Sol reviewing docs/plans/260903d-improve-the-codebase-second-sweep.md,
 * which had checked the `keep` role, found it protected, and called the whole
 * registry clean. **Checking the role a comment names is not checking the
 * object** — see that plan's § T2.1.
 *
 * Preserving it is the right shape rather than a workaround: the old copy's
 * `AbortController` still aborts the real call and its `done` still settles,
 * because a re-evaluation replaces the module and not the running request
 * ([src/process-state.ts](process-state.ts)).
 */
const streaming = processSingleton<Map<string, Live>>(
  "routes.streaming",
  "2026-09-03-live",
  () => new Map(),
);

/**
 * One turn at a time per conversation, across deciding *and* writing it.
 *
 * `settleThread` below stops the streams a retry or an edit is about to write
 * over, and waits for them. What it could not do is stop a *new* turn arriving
 * during that wait — and one that did was appended by `beginTurn`, streamed
 * happily, and was then truncated away by the edit that had been waiting. Its
 * `finishTurn` found no row and, by design, wrote nothing at all; the tab that
 * asked watched a complete answer arrive that was not anywhere. Found by a
 * GPT-5.6 review, 2026-08-26.
 *
 * The lock is held for the settle and the write and **released before the model
 * is called**, so a long answer blocks nothing. It cannot deadlock against
 * `settleThread`: the streams it waits for are past this lock already.
 *
 * It does *not* make two conversations independent, and an earlier version of
 * this comment said it did. The store's own `update` in src/chat.ts is one
 * queue for the whole process, so every write to every article still lines up
 * behind every other. This lock is narrower than that queue, not wider: it
 * holds a conversation still across *several* of those writes, which is the
 * thing the queue cannot do.
 *
 * Per process, like everything else here. Two servers on one `data/` directory
 * remains the unfixed problem in docs/plans/260826a-chat-mode.md § What is still open.
 *
 * **"Per process" is what this has to mean, and a plain module-scope `Map` did
 * not deliver it.** Saving any server module makes Vite re-evaluate every one of
 * them *inside the same process*, without cancelling the request in flight — so
 * for the length of that request there were two maps, and a turn arriving
 * through the second copy did not wait for the one running in the first.
 * Reproduced in tests/turn-order-across-reload.test.ts, which was red before
 * this line and is the only reason it is here. `processSingleton` is the
 * one-process answer ([src/process-state.ts](process-state.ts)); the
 * two-*servers* problem above is a different one and is still open.
 *
 * This is a narrower hole than it sounds, and worth saying so rather than
 * letting the next reader assume the cost storm: the lock is released before the
 * model is called, so what could interleave is a settle and a write, not an
 * eight-minute answer.
 *
 * Exported for its tests and for nothing else. The wiring — that every write in
 * `streamChat` and the thread DELETE go through it — is checked by reading;
 * what tests/turn-order.test.ts checks is that the thing they go through
 * actually excludes, actually keeps its order, and actually survives a throw.
 */
const turnOrder = processSingleton<Map<string, Promise<void>>>(
  "routes.turnOrder",
  "2026-09-03-map",
  () => new Map(),
);

export async function inTurnOrder<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const before = turnOrder.get(key) ?? Promise.resolve();
  /* **The tail is what keeps the chain alive**, and it is worth being exact
     about which line does the work. `mine` rejects when `fn` does, and that
     rejection belongs to the caller and nobody else; what the *next* turn waits
     on is `tail`, which swallows both outcomes. Without that, one refused
     request would reject every later turn in this conversation with a
     stranger's error for the life of the process.

     This was first written as `before.then(fn, fn)` with a comment saying the
     second handler was what saved the chain. It was dead code — `before` is a
     tail and a tail never rejects — and the comment was pointing at the wrong
     line for a property the code did genuinely have. */
  const mine = before.then(fn);
  const tail = mine.then(
    () => {},
    () => {},
  );
  turnOrder.set(key, tail);
  try {
    return await mine;
  } finally {
    // Only the last writer clears the key, or the map grows one entry per
    // conversation for the life of the process.
    if (turnOrder.get(key) === tail) turnOrder.delete(key);
  }
}

/**
 * How long a `pending` answer is left alone before a sweep calls it abandoned.
 *
 * **The `streaming` Set only knows about this process.** Two `npm run dev`
 * servers on one `data/` directory is not hypothetical — it happened during
 * this feature's own development, when a second Vite picked port 5275 — and
 * server B's sweep cannot see that server A is mid-answer, so it marks A's live
 * message `error` while the reader is watching the words arrive.
 *
 * A grace period does not make that correct, and nothing short of a lock would:
 * see docs/plans/260826a-chat-mode.md § What is still open. What it does is make the
 * window small enough to matter rarely and recover cleanly — an answer younger
 * than this is assumed to be in flight *somewhere*, and if it really did die,
 * the next read after two minutes releases it. Longer than any answer the
 * deadline in converse.ts permits (120s), plus room for the write.
 */
/**
 * How long an abandoned `pending` answer is left alone before a sweep calls it
 * a failure.
 *
 * Exported for one test, which asserts that the client watches for at least
 * this long — see `RECOVER_MARGIN_MS` in src/web/useChat.ts. A client that gave
 * up first would declare a failure over a row this server was about to turn
 * into an answer, and the two numbers drifting apart is invisible from either
 * side on its own.
 */
export const CHAT_ORPHAN_GRACE_MS = 150_000;

/**
 * The window must outlive the longest a model call can legally take, and here
 * is where that is checked rather than assumed.
 *
 * **There is no heartbeat.** An attempt is written once when it starts and
 * once when it ends, and nothing in between says "still going". So the grace
 * window is the *only* thing standing between another process's live answer
 * and a sweep that buries it — and an attempt that outlives the window is
 * buried while it is still running, with the reader watching the words arrive.
 *
 * `CHAT_TIMEOUT_MS` is 120s (src/converse.ts), which is the hard deadline on
 * the whole turn including every tool round. 150s leaves 30s for the write and
 * for a clock the two processes do not share exactly. If that deadline ever
 * goes up, this has to go up with it, which is what this assertion is for: it
 * fails at import, on every machine, rather than turning into a rare answer
 * that disappears.
 */
if (CHAT_ORPHAN_GRACE_MS <= CHAT_TIMEOUT_MS) {
  throw new Error(
    `CHAT_ORPHAN_GRACE_MS (${CHAT_ORPHAN_GRACE_MS}ms) must be longer than CHAT_TIMEOUT_MS ` +
      `(${CHAT_TIMEOUT_MS}ms), or a sweep buries answers that are still being written. ` +
      "There is no heartbeat, so this window is the only thing protecting them.",
  );
}

/**
 * The same number for a meaning-search, and it is a different number because
 * the deadline it has to clear is a different deadline.
 *
 * `SEARCH_TIMEOUT_MS` is 60s (src/search.ts) — a search is one call with no
 * tool rounds, so it is bounded much tighter than a chat turn. 90s leaves the
 * same 30s of room for the article read that happens after `begin`, the write
 * that happens after the model, and two processes' clocks.
 *
 * **The filesystem store ignores it entirely**, and that is today's behaviour
 * rather than an oversight: it errors any `pending` run this process did not
 * start, immediately. Only Postgres has other processes to be wrong about.
 */
export const SEARCH_ORPHAN_GRACE_MS = 90_000;

if (SEARCH_ORPHAN_GRACE_MS <= SEARCH_TIMEOUT_MS) {
  throw new Error(
    `SEARCH_ORPHAN_GRACE_MS (${SEARCH_ORPHAN_GRACE_MS}ms) must be longer than SEARCH_TIMEOUT_MS ` +
      `(${SEARCH_TIMEOUT_MS}ms), or a sweep buries searches that are still running.`,
  );
}

/**
 * Stop whatever this process is streaming into a thread, and wait for it to
 * finish writing.
 *
 * Called before an edit or a retry, both of which rewrite rows a live stream
 * may be about to write to. Aborting alone leaves the interleaving open — see
 * `Live.done` — so this awaits.
 *
 * **Nothing here bounds that wait**, and an earlier version of this comment
 * claimed otherwise. What bounds it in practice is inside the answer being
 * waited for: converse.ts gives every stream a 120s deadline and a 45s stall
 * timer, and `streamChat`'s `finally` resolves `done` on every path out. A body
 * that neither yields nor errors would hang the reader's stop or edit here with
 * nothing to say why. A timeout would not fix it — proceeding anyway is exactly
 * the interleaving this function exists to prevent — so the honest answer is
 * that this depends on those two timers, and they are where to look if a stop
 * ever hangs.
 *
 * Like `streaming` itself this only knows about **this process**; a second
 * server streaming into the same file is the unfixed problem recorded in
 * docs/plans/260826a-chat-mode.md § What is still open, and it is the same problem, not
 * a new one.
 */
async function settleThread(slug: string, threadId: string): Promise<void> {
  const prefix = `${slug}/${threadId}/`;
  const live = [...streaming.entries()].filter(([k]) => k.startsWith(prefix)).map(([, v]) => v);
  if (live.length === 0) return;
  for (const l of live) l.stop.abort(new Error("superseded"));
  await Promise.all(live.map((l) => l.done));
}

/**
 * What this process is answering *in this article*, as bare message ids.
 *
 * `streaming` is keyed `slug/threadId/messageId` because that is what a stop
 * request names; `SweepOptions.keep` is a set of message ids because that is
 * what a row is called. Converting here rather than changing either is
 * deliberate — the key has to stay unique across articles, and the store must
 * not be handed a composite it would then have to take apart.
 *
 * **Filtered by slug.** Handing over every live id in the process would spare a
 * row in *this* article that happens to share an id with one being written in
 * another, which is possible: ids are unique per article, not globally.
 */
function liveMessages(slug: string): Set<string> {
  const prefix = `${slug}/`;
  const ids = new Set<string>();
  for (const key of streaming.keys()) {
    if (!key.startsWith(prefix)) continue;
    const id = key.slice(key.lastIndexOf("/") + 1);
    if (id) ids.add(id);
  }
  return ids;
}

/**
 * Turn abandoned `pending` answers into `error`, so the reader can ask again.
 *
 * The rule itself lives in the store now — `pgChatStore.sweepPending`, an
 * `UPDATE … WHERE` — and what is left here is the
 * half only a running server knows: which rows this process is writing, and
 * how long another process's row is allowed to be silent. See `SweepOptions`
 * in src/store/contracts.ts for why neither half is sufficient alone.
 */
function sweepChat(slug: string): Promise<ChatThread[]> {
  return chatStore.sweepPending(slug, {
    keep: liveMessages(slug),
    graceMs: CHAT_ORPHAN_GRACE_MS,
  });
}

/**
 * Answer a question, streaming the words out as they arrive.
 *
 * **Server-sent events**, so the frames are `event: <name>` + `data: <json>`.
 * The contract is the same one src/converse.ts offers: one `begin`, then any
 * number of `delta` and `tool` in whatever order they happen, then exactly one
 * of `done` or `error`.
 *
 * A `tool` frame is `{ index, run }` and is sent **twice per tool** — once when
 * it starts and once when it finishes, both under the same `index`, so the
 * client assigns into an array rather than matching a start to an end. See
 * docs/project/chat-tools.md.
 *
 * Four things here are not obvious:
 *
 * 1. **`X-Accel-Buffering: no`.** A reverse proxy that buffers a response
 *    defeats the entire feature *without failing* — the answer still arrives,
 *    all at once, at the end. That is indistinguishable from a slow model, so
 *    nobody would ever file it as a bug. Vite's dev middleware does not buffer;
 *    this is for wherever this is deployed.
 *
 * 2. **Headers are flushed before the model is called.** Otherwise Node holds
 *    them until the first write, and the first write is however long the model
 *    thinks for — so the browser sits on an unresolved `fetch` and the panel
 *    cannot even show that it is waiting.
 *
 * 3. **A reader who leaves does not cancel the answer.** The model call runs to
 *    completion and the answer is stored, so coming back to the thread finds it
 *    waiting. The alternative — abort on disconnect — throws away a nearly
 *    finished answer that has already been paid for, and switching threads
 *    while the model is thinking is a completely ordinary thing to do. What the
 *    disconnect does stop is *writing*: `alive()` is checked before every frame,
 *    because writing to a closed socket throws EPIPE and would take down the
 *    turn that is otherwise about to succeed.
 *
 * 4. **A stream that breaks keeps its words.** src/converse.ts hands back the
 *    text so far when it throws, and that partial answer is stored with the
 *    error on it rather than discarded. See the note in `sweepChat`.
 */
async function streamChat(slug: string, body: unknown, res: ServerResponse): Promise<void> {
  const {
    threadId,
    question,
    at,
    retry,
    edit,
    expectedTailId,
    useProfile,
    anchor,
    kind,
    stance,
    help,
    sourceCommentId,
  } = (body ?? {}) as Record<string, unknown>;
  if (typeof threadId !== "string") throw httpError(400, "Expected { threadId, … }");
  /* **Validated, never coerced.** An unknown value is a 400 rather than a
     silent fall back to the default: a client that sends `stance: "socratik"`
     and gets a 200 has no way to learn that every answer it receives was
     `balanced`, and neither has the reader. Same reasoning as the `kind` check
     below, and the same reason `REMEMBER_STANCES` is one exported list rather
     than a set of string literals written out again here. */
  if (stance !== undefined && !REMEMBER_STANCES.includes(stance as RememberStance)) {
    throw httpError(400, `stance must be one of: ${REMEMBER_STANCES.join(", ")}`);
  }
  /* The message names the wire values, because that is what a client has to
     send, and the list is `THREAD_KINDS` rather than a chain of `!==` written
     out here — src/types.ts. It was that chain until 2026-09-01, and the chain
     is what a third kind has to be remembered in: Candidates would have been
     refused by a route that had no opinion about it, with a sentence naming two
     kinds and offering no clue that a third existed.

     `remember` was spelled `review` until 2026-09-01 and there is no alias: the
     rename moved the wire value, the CHECK constraint and the rows in one step
     (drizzle/0048_rename_review_thread_kind.sql), so an old client sending
     `review` gets this 400 rather than a thread of the wrong kind.
     docs/plans/260901d-rename-review-mode-to-remember-mode-everywhere.md § Stages. */
  if (kind !== undefined && !isThreadKind(kind)) {
    throw httpError(400, `kind must be one of: ${THREAD_KINDS.join(", ")}`);
  }
  /* **Absent or literally `true`, and nothing else.** Same rule as `stance` and
     `kind` above, and the same reason: a client that sends `help: "yes"` and
     gets a 200 has no way to learn that the answer it received was written with
     the ordinary prompt, and neither has the reader. `false` is refused too
     rather than treated as absent — a client sending it has a bug, and accepting
     it quietly is how the bug survives to the next release.

     Checked before anything is read or written, so a bad body is an ordinary
     JSON 400 rather than an `error` frame inside a 200 stream. */
  if (help !== undefined && help !== true) {
    throw httpError(400, "help must be true, or left out entirely");
  }
  const wantedKind = kind as ThreadKind | undefined;
  /* Absent means yes, as it does everywhere the profile is offered. Per turn
     rather than per thread, because the composer's checkbox is per turn — a
     reader may reasonably want one answer written plainly in the middle of a
     conversation that is otherwise theirs. */
  const wantsProfile = useProfile !== false;
  /* Three ways to start a turn, one endpoint, one stream.

     A retry and an edit could each have had a route of their own, and each
     would then have needed its own copy of the header flush, the `begin` frame,
     the delta loop, the two terminal frames and the four things that must not
     throw after the headers are gone. That code is the hard part and it is
     identical in all three cases; what actually differs is one question — which
     rows does the model answer *from*, and which row does it write *into*. So
     that is the only thing branched on, and it is branched on before a byte
     goes out. */
  const wantsRetry = typeof retry === "string";
  const wantsEdit = typeof edit === "string";
  if (wantsRetry && wantsEdit) throw httpError(400, "Send retry or edit, not both");
  /* **Neither a retry nor an edit may name a kind or a stance**, and both are
     refused rather than ignored — the rule the anchor check below already
     follows, for the same reason.

     Their thread already has a kind, and the answer they are replacing already
     has a stance: `withRetry` carries it over from the row it blanks, and
     `withEdit` from the answer being replaced. A stance in one of these bodies
     could only mean "answer this stored question differently from how it was
     asked", which is a thing a reader might want and is not what a button
     labelled "have another go" does. If it arrives it will be an explicit
     control with its own name. GPT Sol's review of docs/plans/260827ah-review-mode.md,
     finding 4. */
  if ((wantsRetry || wantsEdit) && (kind !== undefined || stance !== undefined)) {
    throw httpError(400, "A retry or an edit takes its kind and stance from the conversation");
  }
  /* **And neither may claim to be a help press**, for a sharper version of the
     same reason — sharper because here the client would be *right* and still
     must not be believed. A retry re-asks a stored question, and whether that
     question was a "?" press is recorded on the row itself. Taking the body's
     word for it would let a stale tab retry an ordinary question as an
     explanation, or an explanation as an ordinary question, with the stored
     metadata and the prompt that was actually used disagreeing and nothing on
     screen saying so. The row is authoritative; see `converse({ help })` below.

     A separate check from the one above so the sentence can say which field. */
  if ((wantsRetry || wantsEdit) && help !== undefined) {
    throw httpError(400, "A retry or an edit takes its help flag from the stored question");
  }
  if (!wantsRetry && (typeof question !== "string" || question.trim() === "")) {
    throw httpError(400, "Expected { threadId, question }");
  }
  /* Two limits, chosen by what the box actually is — see `MAX_REMEMBER_CHARS`.

     **The request's kind is not enough**, and reading only it was a bug: an
     edit sends no kind at all (it is refused one, just above), so every edit
     was measured against chat's 4,000 and a 4,001-character Remember turn could be
     created and then never rewritten. So the *thread's* kind decides whenever
     there is a thread, and the request's is the fallback for the turn that
     creates one. GPT Sol's review of the built code, finding 5.

     Cheap: `chatStore.load` is called a few lines down anyway. And a smuggled
     `kind: "remember"` on a thread that is a chat buys nothing — the 409 below
     refuses it before any model call. */
  const storedKind = (await chatStore.load(slug)).find((t) => t.id === threadId)?.kind;
  const askingRemember = (storedKind ?? wantedKind) === "remember";
  const cap = askingRemember ? MAX_REMEMBER_CHARS : MAX_QUESTION_CHARS;
  if (typeof question === "string" && question.length > cap) {
    throw httpError(
      413,
      askingRemember
        ? `What you wrote may be at most ${MAX_REMEMBER_CHARS} characters`
        : `A question may be at most ${MAX_QUESTION_CHARS} characters`,
    );
  }
  /* **A stance is meaningless on a chat, so it is refused rather than stored.**
     The check constraint only says "assistant rows only"; without this, a
     request naming a stance and no kind writes one onto a chat answer, where
     nothing reads it and the transcript looks right. An invariant the database
     cannot express is one the route has to. GPT Sol's review, finding 7. */
  if (stance !== undefined && !askingRemember) {
    throw httpError(400, "A stance only applies in Remember mode");
  }
  /* **An anchor belongs to a turn that creates a thread, and to no other.**
     `withRetry` and `withEdit` do not go through `withTurn` at all, so an
     anchor sent with either would be dropped without a word — and the reader
     would have a conversation the database says is about a passage they never
     chose. Refused rather than ignored. */
  /* **The comment this conversation was started from, if it was.**
     Travels with the anchor and under the same rule, because it means the same
     kind of thing: a fact about the turn that *creates* a thread. It exists so
     the link can be written **server-side, with the real thread id** — the
     client mints an optimistic one and only finds out it was overruled if it
     was, so a client-side link is a race it cannot see it has lost.
     docs/plans/260828a-comments-and-bookmarks.md § the Save & ask choreography. */
  if (sourceCommentId !== undefined && !isSpideryarnId(String(sourceCommentId))) {
    throw httpError(400, "sourceCommentId must be a comment id");
  }
  if (sourceCommentId !== undefined && (wantsRetry || wantsEdit)) {
    throw httpError(400, "A source comment can only be sent with a new question");
  }
  if (anchor !== undefined && (wantsRetry || wantsEdit)) {
    throw httpError(400, "An anchor can only be sent with a new question");
  }
  /* **Only a chat may be anchored**, and the rule is stated that way round on
     purpose. A Remember turn is about the whole piece and a Candidates turn is
     about the whole paper; neither has a gesture that starts one from a
     selection, because the paragraph and selection buttons both open a chat. So
     an anchor arriving with either kind is a client that has confused them.

     Refused rather than dropped, and worth more than tidiness: an unanchored
     thread of another kind draws no mark in the prose, which is what lets the
     reading view go on treating every mark it draws as a chat. Written as
     `!== "chat"` rather than as a list of the other kinds, so that a fourth kind
     is anchor-less by default and has to argue its way in. */
  if (wantedKind !== undefined && wantedKind !== "chat" && anchor !== undefined) {
    throw httpError(400, `A ${wantedKind} conversation is about the whole article and cannot be anchored`);
  }
  const wanted = parseAnchor(anchor);
  /* **`help: true` has a meaning, and the meaning is checked, not just the
     shape.**

     Far above, `help` is validated as absent-or-literally-`true`. That is the
     wire; this is the contract, and it is one sentence — `ChatMessage.help` in
     src/types.ts: *the paragraph "?" button created this thread*. Without these
     three checks the flag was accepted on a later turn of an existing
     conversation, on an unanchored one, on a selection chat, and on a Remember
     or Candidates thread. Every one of those stores a press nobody made **and**
     answers the request with the teaching prompt, so the row and the answer are
     both wrong and agree with each other.

     Refused rather than dropped, which is the posture the anchor rule just
     above takes and for the same reason: a client whose request is silently
     reinterpreted has no way to learn that it was, and neither has the reader.

     All three are checked here, before `loadArticle` and before anything is
     written, so a bad body is an ordinary JSON 400 rather than an `error` frame
     inside a 200 stream — and the first of them is stated a second time under
     `inTurnOrder`, where the read is safe from a thread appearing between the
     look and the write. `help === true` is the only truthy value that can reach
     here.

     The real client sends exactly what these allow: `helpAboutBlock` in
     src/web/reader/Reader.tsx mints a draft with `{ blockId }`, no kind, and `help: true`
     on the send that creates the thread — pinned by *still lets through the
     thing the real client sends* in tests/chat-help-route.test.ts, so tightening
     this any further goes red rather than quiet.

     GPT Sol's review of the built code, finding 1. */
  if (help === true) {
    /* A thread already exists under this id, so this turn is not creating one.
       `storedKind` is defined for exactly the threads that exist, and it was
       loaded a few dozen lines up for the character cap, so this costs nothing.

       **Checked again under `inTurnOrder` below**, and that is not belt and
       braces: this read is outside the lock, so a thread can be created between
       it and the write. Here for the sentence and the fast refusal; there for
       the guarantee — the division `withTurn`'s own kind check already
       describes. */
    if (storedKind !== undefined) {
      throw httpError(400, 'A "?" press starts a conversation; a later question in one is not one');
    }
    /* Absent means chat — the default `withTurn` applies to a thread it is
       creating — so the effective kind is what is checked, not the field. And
       it can be read off the body alone because the rule above has established
       that this turn creates the thread. */
    if ((wantedKind ?? "chat") !== "chat") {
      throw httpError(
        400,
        `A ${wantedKind} conversation is about the whole article, not a passage, so it cannot be a "?" press`,
      );
    }
    if (!wanted || "quote" in wanted) {
      throw httpError(
        400,
        'A "?" press is about a whole paragraph: send anchor: { blockId }, with no quote',
      );
    }
  }
  // Loaded before anything is written, so a bad slug is still an ordinary JSON
  // 404 rather than an `error` frame inside a 200 stream.
  const article = await loadArticle(slug);
  /* Checked against the real article, not just against itself. The three column
     checks in the schema let a malformed id, an empty quote and an offset past
     the end of the block through, and the foreign key only catches the first of
     those. This is where the rest is caught — and it is done after
     `loadArticle` because it needs the blocks. */
  if (wanted) checkAnchor(wanted, article.blocks);

  /* Deciding and writing the turn happen together, under the conversation's
     turn order — see `inTurnOrder`. Everything after it is one answer streaming
     and needs no lock at all. */
  const begun = await inTurnOrder(`${slug}/${threadId}`, async () => {
    if (wantsRetry || wantsEdit) {
      /* **Refuse a stale request before anything is aborted.**

         `settleThread` below stops the live answer in this conversation, and it
         used to run first — so a second tab retrying a turn that is no longer
         the last one aborted the answer the reader in the *first* tab was
         watching, stored it as stopped, and only then answered 409. That reader
         pressed nothing and was told they had stopped it, and no replacement
         came. Found by a GPT-5.6 review, 2026-08-26.

         The check is the real rule rather than a copy of it: `withRetry` and
         `withEdit` are pure, so they can be run against a snapshot and thrown
         away. Whatever they would refuse, they refuse here, for free, before
         the destructive part. The authoritative run is still the one inside
         `chatStore.retry` / `chatStore.edit` below, which re-reads under the
         store's own lock — this is a gate, not a substitute. */
      const snapshot = await chatStore.load(slug);
      if (wantsRetry) withRetry(snapshot, threadId, retry as string, "");
      else withEdit(snapshot, threadId, edit as string, (question as string).trim(), "");

      /* Both of these rewrite rows that a live answer in this thread may be
         halfway through writing, so the live one is stopped and *waited for*
         first. Not needed for an ordinary send: that appends, and appending
         beside a stream is already ordered correctly by the serialised queue in
         src/chat.ts. */
      await settleThread(slug, threadId);
    }
    /* **A thread is anchored once.** Reached only for an ordinary send, and
       only when one was offered — `withTurn` applies an anchor solely on the
       branch that builds a new thread, so without this the second question of
       an anchored conversation could carry a different passage and be accepted
       in silence. What the reader would then have is a conversation the
       database says is about passage A holding a question about passage B, with
       nothing anywhere disagreeing.

       Read under `inTurnOrder`, so the thread cannot be created between the
       look and the write.

       An identical anchor is allowed through, which is what makes a retried
       send — the same request arriving twice — harmless rather than a 409 the
       reader has to understand. */
    if (wanted) {
      const existing = (await chatStore.load(slug)).find((t) => t.id === threadId);
      if (existing && !sameAnchor(existing.anchor, wanted)) {
        throw httpError(409, "That conversation is already about a different passage");
      }
    }
    /* **A thread is one kind for life**, and this is the same shape as the
       anchor check above it: read under `inTurnOrder` so the thread cannot be
       created between the look and the write, and an *identical* kind passes so
       that a retried send is harmless rather than a 409 nobody can act on.

       Reached only on an ordinary send — a retry or an edit was refused a
       `kind` far above, before anything was read. That ordering is the point:
       both of those call `settleThread`, which stops a live answer in this
       thread, and a request rejected *after* that has aborted the answer
       another tab's reader was watching and told them they stopped it. That
       exact bug has been fixed here once already (docs/plans/260826a-chat-mode.md).

       `withTurn` refuses it again inside the store's transaction, because
       `inTurnOrder` is per-process and this one is not. Here for the status
       code and the sentence; there for the guarantee. */
    if (wantedKind) {
      const existing = (await chatStore.load(slug)).find((t) => t.id === threadId);
      if (existing && existing.kind !== wantedKind) {
        throw httpError(409, "That conversation is already a different kind");
      }
    }
    /* **And a "?" press CREATES a conversation**, read again under the lock.

       The same rule refused this request far above, before `loadArticle`, off a
       load taken outside `inTurnOrder`. That one is the sentence a reader's
       client gets and the reason nothing was loaded for a request that was
       never going to run; this one is the guarantee, and it is here for the
       reason the two checks above it give — the thread cannot be created
       between the look and the write. Same division as `kind`, whose store-side
       twin is inside `withTurn`'s transaction.

       A later question in an existing conversation is the reader typing. A flag
       saying otherwise puts a press in the database that nobody made **and**
       answers an ordinary follow-up with the teaching prompt.

       400 rather than 409, unlike its two neighbours: they describe a request
       that would have been fine against a different conversation, and this one
       is a client sending a field it has no business sending at all. */
    if (help === true) {
      const existing = (await chatStore.load(slug)).find((t) => t.id === threadId);
      if (existing) {
        throw httpError(
          400,
          'A "?" press starts a conversation; a later question in one is not one',
        );
      }
    }
    return wantsRetry
      ? await chatStore.retry(slug, threadId, retry as string)
      : wantsEdit
        ? await chatStore.edit(slug, threadId, edit as string, (question as string).trim(), {
            /* **The guard is only as good as the client's willingness to send
               it**, which is why it is optional in the contract and not
               optional here in spirit: an edit that names no tail is an
               unguarded edit, and a stale tab can then delete every turn added
               since it last looked. src/web/useChat.ts sends the id of the
               message it believes is last. A body without one still works —
               an old tab mid-session, a curl — and is simply not protected. */
            ...(typeof expectedTailId === "string" ? { expectedTailId } : {}),
          })
        : await chatStore.begin(slug, {
            threadId,
            question: (question as string).trim(),
            ...(wanted ? { anchor: wanted } : {}),
            ...(wantedKind ? { kind: wantedKind } : {}),
            /* Onto the **pending** reply row, inside the same write as the
               question — see `ChatMessage.stance`. Only meaningful on a Remember turn;
               `withTurn` writes whatever it is given and the check constraint
               refuses one on a user row. */
            ...(stance ? { stance: stance as RememberStance } : {}),
            /* Onto the **user** row, not the reply — the mirror of `stance` just
               above. `withTurn` writes it and a CHECK constraint refuses one on
               an assistant row. */
            ...(help === true ? { help: true as const } : {}),
          });
  });
  const { thread, reply, user } = begun;
  /* **Which model call this is**, as far as storage is concerned, and it is
     NOT the same thing as `attempt` below.

     `Live.attempt` is a token this process invents so a reader's stop can name
     the answer they were watching; it never leaves this process. This one comes
     out of the store and goes back into `finish`, and it is what stops a call
     some *other* process's sweep already declared dead from landing on top of
     the retry the reader is now watching. `undefined` from the filesystem
     store, which has no attempts — see `Turn` in src/store/contracts.ts. */
  const storeAttempt = begun.attempt;
  /* **The question that was stored is the question that gets asked** — one rule
     for all three kinds of turn, rather than "the request's text, except on a
     retry". A retry has no question in its request at all, and taking one from
     there would let a stale tab retry one question and store the answer under
     another: the row above saying one thing and the answer below it being to
     something else, with nothing on screen to show the two had parted. */
  const asked = user.text;
  const key = `${slug}/${thread.id}/${reply.id}`;
  const attempt = randomUUID();
  const stop = new AbortController();
  let release!: () => void;
  const done = new Promise<void>((resolve) => {
    release = resolve;
  });

  /* Everything from here is inside one try/finally, and the `streaming` key is
     added on the first line of it rather than just before it.

     The key used to be added ahead of the try, with the header flush and the
     `begin` frame outside too. A throw from either — a socket that died between
     `beginTurn` and the first write — leaked the key for the life of the
     process, and a leaked key is not inert: `sweepChat` reads it as "this
     process is still answering", so that message stayed `pending` on disk for
     ever and no sweep would ever release it. Found by a GPT-5.6 review,
     2026-08-26. */
  /* Has the reader gone?

     `res.on("close")`, **not** `req.on("close")`, and the difference is a real
     trap rather than a preference. Node documents the request's `close` as
     "the request has been completed, **or** its underlying connection was
     terminated" — and `readBody` above consumes the request stream to its end,
     so "completed" is already true before the model is ever called. Listening
     there means that on any Node version which takes the first reading, every
     frame is dropped and the reader watches a spinner while a perfectly good
     answer is written to disk behind them. The response's `close` has one
     meaning: this connection is finished. */
  let open = true;
  res.on("close", () => {
    open = false;
  });
  const alive = () => open && !res.writableEnded && !res.destroyed;
  const frame = (event: string, data: unknown) => {
    if (!alive()) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  /* Cleared in the `finally`. This route does not go through `sse(res)` — it
     writes its headers itself, inside the try, so that a socket dying between
     `beginTurn` and the first write cannot leak the `streaming` key — so it
     needs its own beat. See `heartbeat` for why an idle chat stream needs one
     more than most: a tool round is 45 seconds of legitimate silence. */
  let stopBeating = () => {};

  let text = "";
  /** What the tools did, kept so a turn that fails still records them. */
  const tools: ToolRun[] = [];
  try {
    streaming.set(key, { stop, done, attempt });
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
    stopBeating = heartbeat(res, alive);

    /* **The link is written here, with the id the server settled on.**
       This is the first moment a real thread id exists, and it is the only
       place that has one — which is the whole reason this is not done from the
       browser. A failure is logged and swallowed: the comment is stored and the
       conversation is stored, and all that is missing is the arrow between
       them, so failing the request would throw away work that plainly
       succeeded. `linkThread` is compare-and-set from absent, so a repeat of
       the same link is a no-op and a *different* one is refused. */
    if (typeof sourceCommentId === "string" && wanted && "quote" in wanted) {
      try {
        /* **The anchor goes with it**, so the store can refuse a
           `sourceCommentId` that names one of this reader's *other* comments —
           a stale id from another tab, or a made-up one. Only a selection
           anchor can carry a link: a block-only chat has no passage to match,
           and a comment always has one. */
        await commentStore.linkThread(slug, sourceCommentId, thread.id, {
          blockId: wanted.blockId,
          quote: wanted.quote,
          start: wanted.start,
        });
      } catch (err) {
        log("store").warn(
          { slug, id: sourceCommentId, threadId: thread.id, ...errorFields(err) },
          "could not link the comment to its conversation",
        );
      }
    }

    /* The ids first, before a single word of the answer. The client minted the
       thread id optimistically and beginTurn may have overruled it (a collision,
       or an id that was not one of ours), so this frame is what the client
       believes rather than its own guess. It also gives the panel the message id
       to render the incoming text into. */
    frame("begin", {
      threadId: thread.id,
      title: thread.title,
      messageId: reply.id,
      /* The *question's* id as well as the answer's, and leaving it out was a
         real bug rather than an omission.

         On an ordinary send the client has invented a name for the question —
         it puts the reader's words on screen the instant Enter is pressed,
         before this server has seen them — and only the answer's id was ever
         corrected here. Nothing renders an id, so nothing looked wrong, until
         the reader edited a question without reloading first and posted a name
         this server had never heard of: "That message is not in this
         conversation." Reported by Greg, 2026-08-26.

         Sent on all three kinds of turn even though only a send needs it. A
         retry and an edit both reuse a row this server already named, so the
         id is usually one the client has, and "usually" is the problem: the
         client may still be holding an invented name from a send earlier in
         the same session. One rule — the frame always says what both rows are
         called — is cheaper to be sure of than three. */
      questionId: user.id,
      /* Which attempt at that row this is, so a stop can name the answer it was
         pressed on rather than whatever is under the id when it arrives. See
         `Live.attempt`. */
      attempt,
    });

    for await (const event of converse({
      meta: article.meta,
      blocks: article.blocks,
      history: thread.messages.slice(0, -2), // everything before this turn
      question: asked,
      at: typeof at === "string" ? at : undefined,
      // The tools need to know which article the reader has open; the prompt
      // does not, and does not get it. src/chat-tools.ts § ToolContext.
      slug,
      /* Resolved per turn rather than once per thread, so a reader who edits
         their profile mid-conversation gets the next answer written to the new
         one. The opposite of the job path, which freezes it — and the reason
         they differ is that a turn resolves this **once** and hands the same
         string to every round of it, so there is no window in which half an
         artefact could be written to each. (That used to read "a turn is one
         call", which stopped being true the day chat grew a tool loop. The
         conclusion held; the reason had rotted. Found by a GPT Sol review,
         2026-08-26.) */
      profile: wantsProfile ? await resolveProfile(slug) : null,
      /* **From the THREAD the store just wrote, never from the request body.**
         Those two agree only when the request was right, and the request comes
         from a tab that may be several navigations out of date. A retry and an
         edit send no kind at all, so for two of the three ways into this
         function the body has nothing to offer anyway — and for the third,
         `withTurn` has already refused a kind that contradicts the thread. The
         thread is the only thing here that is authoritative about what this
         conversation is. GPT Sol's review of docs/plans/260827ah-review-mode.md,
         finding 5. */
      kind: thread.kind,
      /* **The passage, from the THREAD, on every turn** — same rule as `kind`
         just above, and this one had never been kept. `buildConverseMessages`
         has documented since 2026-08-26 that the structural anchor is sent every
         turn *because* `recentHistory` drops the oldest turns, so a passage that
         lives only in the reader's first message stops being sent while the
         panel and the database still say the thread is anchored to it. Nothing
         passed it, so on the chat path that was never true.

         `?? null` rather than a conditional spread: the option's type admits
         null, `anchorSection` returns "" for it, and `exactOptionalPropertyTypes`
         refuses an explicit `undefined`. Nothing moves above the `cache_control`
         breakpoint — the line lands in the final user message, beside the
         profile and the position. GPT Sol's review of the built code, finding 2.

         The quote stays fenced in `anchorSection`: the passage is the article's
         words, and the article is untrusted — docs/project/security.md. */
      anchor: thread.anchor ?? null,
      /* And the stance from the reply row, for the same reason one step down:
         `withTurn` wrote the request's, `withRetry` carried over the replaced
         answer's, `withEdit` took it from the answer it is replacing. Reading
         it back off the row means all three paths are asked the same question —
         "what does this pending answer say it is?" — instead of the route
         re-deriving it three ways. */
      ...(reply.stance ? { stance: reply.stance } : {}),
      /* **From the stored QUESTION row, never from the request body** — the rule
         `kind` and `stance` above already follow, applied to the one field the
         client could have got right and still must not be asked.

         All three ways in agree here without arranging it: `withTurn` wrote it
         onto the row it just created, `withRetry` hands back the very same
         stored question, and `withEdit` spreads it onto the rewritten one. So
         pressing "Try again" on an explanation is answered as an explanation,
         which is exactly what a thread-level flag could not have done — it would
         have had to be refused on a turn that creates no thread, and the reader
         would have got a different kind of answer with nothing saying so. GPT
         Sol's review of docs/plans/260905c-gutter-comment-chip-explanation-metadata-and-prompt.md,
         finding 1. */
      help: user.help === true,
      signal: stop.signal,
    })) {
      if (event.type === "delta") {
        text += event.text;
        frame("delta", { text: event.text });
        continue;
      }
      /* A tool starting, or the same tool finishing — one frame either way, and
         the client assigns by `index`. Held here as well as sent, because the
         connection may close mid-turn: the answer still finishes and is still
         stored (see point 3 in the header), and it should be stored with the
         tools it actually ran rather than with an empty list because nobody was
         watching. That copy is what makes a *failed* turn keep them too. */
      if (event.type === "tool") {
        tools[event.index] = event.run;
        frame("tool", { index: event.index, run: event.run });
        continue;
      }
      /* A stopped answer is stored `done`, with a flag. It is not a failure —
         see the `stopped` field in src/types.ts — and `...(x ? {x} : {})` rather
         than `stopped: event.stopped` so an ordinary answer does not carry a
         `false` into the file for every turn ever written. */
      const finished = {
        text: event.text,
        status: "done" as const,
        citations: event.citations,
        searches: event.searches,
        model: event.model,
        /* Omitted rather than stored empty, the same rule `stopped` follows on
           the next line: most answers use no tools, and a `"tools": []` on every
           one of them is noise in a file a person may well open. */
        ...(event.tools.length > 0 ? { tools: event.tools } : {}),
        // Same rule again: a flag only when it is true, so an ordinary answer
        // does not carry two `false`s into the file for the life of the thread.
        ...(event.truncated ? { truncated: true } : {}),
        ...(event.stopped ? { stopped: true } : {}),
      };
      await chatStore.finish(slug, thread.id, reply.id, finished, { attempt: storeAttempt });
      frame("done", finished);
    }
  } catch (err) {
    /* **Nothing in here may throw**, and that is why it is wrapped again.

       Once the headers are on the wire this function owns the response, and the
       route's outer catch cannot help: its `send()` sets `res.statusCode` and
       then throws from `setHeader` on an already-sent response, which both
       mislabels the request in the log (500, when 200 went out) and leaves an
       unhandled rejection for Vite's middleware to trip over. So a failure to
       *record* the failure is swallowed, having been logged where it happened.
       Found by a GPT-5.6 review, 2026-08-26. */
    captureFailure(err, { route: "chat", slug, threadId: thread.id });
    const message = (err as Error).message;
    try {
      // The partial answer is kept, not dropped — see the header note.
      await chatStore.finish(
        slug,
        thread.id,
        reply.id,
        {
          text,
          status: "error",
          error: message,
          // A failed turn keeps what its tools found, for the same reason it
          // keeps its half-written text: the reader watched both happen.
          ...(tools.length > 0 ? { tools } : {}),
        },
        // The same attempt as the success path. A failure is this call
        // reporting, and a call whose fence has been taken away by a sweep may
        // no longer report at all — which is the point of the fence.
        { attempt: storeAttempt },
      );
    } catch (storeErr) {
      log("store").error(
        { ...errorFields(storeErr), slug, threadId: thread.id, messageId: reply.id },
        "could not record a failed chat answer",
      );
      captureFailure(storeErr, { route: "chat", slug, phase: "record-failure" });
    }
    frame("error", { error: message, text });
  } finally {
    stopBeating();
    streaming.delete(key);
    // After the delete, so a supersede that was waiting on this cannot see the
    // key again and abort a stream that has already let go of the row.
    release();
    if (!res.writableEnded) res.end();
  }
}

/**
 * Stop an answer the reader has read enough of.
 *
 * A route rather than a socket close, and that is the whole design. Closing the
 * connection is what happens when a reader switches thread or shuts the tab,
 * and `streamChat` deliberately lets the answer finish in that case — they will
 * want it when they come back, and it has already been paid for. The two are
 * indistinguishable from this end, so the deliberate one has to say so in a
 * request of its own. See the header note on `streamChat`, point 3.
 *
 * Waits for the writer, so a reader who presses stop and immediately reloads
 * sees the partial answer rather than a spinner that a sweep clears two minutes
 * later.
 */
async function stopChat(
  slug: string,
  threadId: string,
  body: unknown,
): Promise<{ stopped: boolean }> {
  const { messageId, attempt } = (body ?? {}) as Record<string, unknown>;
  if (typeof messageId !== "string") throw httpError(400, "Expected { messageId }");
  const live = streaming.get(`${slug}/${threadId}/${messageId}`);
  /* Not an error. The answer finished a moment ago, or the other dev server is
     writing it, or this is a second tab pressing stop on something already
     stopped. `false` says "there was nothing to stop", which is all the client
     needs and is true in every one of those cases. */
  if (!live) return { stopped: false };
  /* And the same answer for a stop that names an attempt this row has moved on
     from — see `Live.attempt`. It is "there was nothing to stop" in the only
     sense the reader cares about: the words they were watching are already
     finished. Aborting what is there instead would stop an answer nobody asked
     to stop. */
  if (typeof attempt === "string" && attempt !== live.attempt) return { stopped: false };
  live.stop.abort(new Error("stopped by the reader"));
  await live.done;
  return { stopped: true };
}

/**
 * **Stop the first answer of a conversation, and throw the conversation away.**
 *
 * Greg's call, 2026-08-26: a reader who selects a sentence, sees the answer
 * start, and changes their mind wants the whole thing gone — panel, mark and
 * all, "as if you had never selected the text". Distinct from `stopChat` above,
 * which keeps what arrived and is what a reader means further into a real
 * conversation.
 *
 * ## Why this is one route and not `stop` followed by `DELETE`
 *
 * That was the first plan, and a GPT-5.6 review took it apart. `stopChat`'s
 * `await live.done` genuinely does what it says — the *named* writer has
 * finished when it returns — but it does not make the pair atomic:
 *
 *     Tab A                          Tab B
 *     POST …/stop
 *       aborts, awaits, returns
 *                                    sends a second question
 *                                    (the thread now has two turns)
 *     DELETE …/<threadId>
 *       deletes BOTH turns
 *
 * `DELETE` has no expected-tail guard, so B's question dies with A's. Four more
 * ways through, all of them from the same review:
 *
 *  - a stop pressed before the `begin` frame names a provisional id, so it
 *    stops nothing and the delete then races a live stream;
 *  - `{stopped:false}` conflates "already finished", "wrong attempt" and "the
 *    writer is in another process", and only the first is safe to act on;
 *  - two filesystem servers can interleave `A load → B delete+save → A stale
 *    save` and resurrect the thread;
 *  - a concurrent sweep is not a cancellation fence.
 *
 * So the check and the delete happen together, here, with the tail named.
 *
 * ## What it does not promise
 *
 * **Aborting the model call is best-effort across processes.** `streaming` is
 * this process's map; another server's call cannot be reached, so it runs to
 * the end and is paid for, and its `finish` then updates zero rows because the
 * thread is gone. Deletion is the part that is guaranteed, and it is the part
 * that matters.
 */
async function cancelChat(
  slug: string,
  threadId: string,
  body: unknown,
): Promise<{ cancelled: boolean }> {
  const { messageId, attempt, expectedTailId } = (body ?? {}) as Record<string, unknown>;
  if (typeof messageId !== "string") throw httpError(400, "Expected { messageId }");

  return inTurnOrder(`${slug}/${threadId}`, async () => {
    const thread = (await chatStore.load(slug)).find((t) => t.id === threadId);
    /* Already gone. Not an error: a second tab, a double-press, or a reader who
       cancelled and reloaded. The client wants to close the panel either way. */
    if (!thread) return { cancelled: true };

    /* **Exactly one turn**, which is what "the first answer" means. Anything
       else is a conversation the reader has been having, and deleting it
       because they pressed a button labelled for the other case is the outcome
       this whole route exists to prevent. */
    if (thread.messages.length !== 2) {
      throw httpError(409, "That conversation has more in it than the answer you stopped");
    }
    const tail = thread.messages[thread.messages.length - 1];
    if (tail?.id !== messageId) {
      throw httpError(409, "That is not the answer at the end of this conversation");
    }
    /* The client sends what it believes is last; a body without one is simply
       unguarded, the same deliberate looseness `edit`'s `expectedTailId` has. */
    if (typeof expectedTailId === "string" && expectedTailId !== tail.id) {
      throw httpError(409, "This conversation has moved on since you looked");
    }

    /* Abort and **wait**, before the delete rather than after it. A writer still
       running would otherwise `finish` into rows we are about to remove — on
       Postgres that updates nothing, but the filesystem store would write the
       whole thread list back from a snapshot taken before the delete, and the
       conversation would be there again on the next read. */
    const live = streaming.get(`${slug}/${threadId}/${messageId}`);
    if (live && (typeof attempt !== "string" || attempt === live.attempt)) {
      live.stop.abort(new Error("cancelled by the reader"));
      await live.done;
    }

    await chatStore.remove(slug, threadId);
    log("store").info({ slug, threadId }, "chat cancelled and discarded");
    return { cancelled: true };
  });
}

/**
 * **A finished spoken exchange, written into the thread.**
 * `POST /api/chat/:slug/:threadId/spoken`.
 *
 * Live conversation's whole write path. The audio never comes near this
 * server — the browser talks to OpenAI directly, because Vercel has no
 * long-lived sockets (docs/project/live-conversation.md) — so by the time
 * anything arrives here the exchange is over and both halves are known. That
 * is why there is no `begin`/`finish` pair and no stream: one request, one
 * transaction, two `done` rows.
 *
 * ## Everything here is a claim by the browser, and is treated as one
 *
 * A typed answer is written by this server from a model call this server made.
 * A spoken answer is written from what a browser says happened. So each field
 * is either validated or **replaced**:
 *
 * - `status` on a tool run is not read at all. It is set to `done`, because a
 *   stored `running` row is a spinner nobody will ever end — src/types.ts
 *   § `ToolRun.status` says so, and this is the one route that could put one on
 *   disk.
 * - `model` is not read either. It is `LIVE_MODEL`, so that the citation
 *   instruments in src/converse.ts can tell a spoken answer from a typed one
 *   that cited nothing. Having no citations is *normal* for a spoken answer —
 *   it points with `show_passage` instead — so without an explicit mark the
 *   `citedBlockIds` number drifts downwards for a reason that is not a
 *   regression. docs/plans/260831l-live-conversation-in-chat.md § 1d.
 * - every block id in `passages` is checked, because these become pressable
 *   references in the reader's transcript and an id nothing resolves is a
 *   reference that goes nowhere.
 *
 * ## `expectedTailId` is required, and it is the idempotency
 *
 * Not optional, unlike the same field on `/cancel`: there it is a safety net
 * over a destructive operation, here it is the *only* thing between a replayed
 * POST and a duplicated turn. A retry after a lost response presents a tail the
 * first attempt has already moved and gets a 409 rather than appending twice —
 * which is what lets the client retry a transport failure at all. `null` means
 * "I believe this conversation is empty", which is a real state: a reader may
 * press Live before typing anything. `SpokenTurn` in src/chat.ts.
 */
async function spokenChat(
  slug: string,
  threadId: string,
  body: unknown,
): Promise<{ thread: ChatThread }> {
  const { question, answer, passages, tools, interrupted, expectedTailId } = (body ??
    {}) as Record<string, unknown>;
  if (typeof question !== "string" || typeof answer !== "string") {
    throw httpError(400, "Expected { question, answer, expectedTailId }");
  }
  /* **Absent is refused; `null` is accepted.** The two mean different things —
     "I forgot to say" and "I think this conversation is empty" — and collapsing
     them would let a caller skip the guard by omission. */
  if (expectedTailId !== null && typeof expectedTailId !== "string") {
    throw httpError(400, "expectedTailId is required, and is null for an empty conversation");
  }
  /* An empty question is ordinary — the transcriber fails — and so is an empty
     answer, if the reader hung up mid-breath. Both empty is not a turn, and
     writing it puts a nameless pair of rows in somebody's transcript. The
     client's ledger drops these too; this is the half that does not trust it. */
  if (question.trim() === "" && answer.trim() === "") {
    throw httpError(400, "That exchange has nothing in it");
  }
  for (const [what, text] of [
    ["question", question],
    ["answer", answer],
  ] as const) {
    if (text.length > MAX_SPOKEN_CHARS) {
      throw httpError(413, `That spoken ${what} is longer than ${MAX_SPOKEN_CHARS} characters`);
    }
  }

  /* Loaded so the passage pointers can be checked against the real thing. It is
     one read of an artefact this request already implies — a spoken exchange is
     about this article — and it happens before the write so a bad pointer is an
     ordinary 400 rather than a turn on disk with a dead reference in it. */
  const known = new Set((await loadArticle(slug)).blocks.map((b) => b.id));

  const thread = await inTurnOrder(`${slug}/${threadId}`, () =>
    /* Under the conversation's turn order, like every other write to a thread.
       An append is safe beside a stream — src/chat.ts serialises the store —
       but a spoken append landing between a retry's check and its write would
       put back the narrow version of the abort-then-refuse bug that
       `inTurnOrder` exists to close. */
    chatStore.appendSpoken(slug, {
      threadId,
      question,
      answer,
      expectedTailId,
      ...(parseSpokenPassages(passages, known) ?? {}),
      ...(parseSpokenTools(tools) ?? {}),
      ...(interrupted === true ? { interrupted: true } : {}),
      model: LIVE_MODEL,
    }),
  ).then((t) => t.thread);

  log("store").info(
    { slug, threadId: thread.id, turns: thread.messages.length },
    "spoken turn appended",
  );
  return { thread };
}

/**
 * How long either half of one spoken exchange may be.
 *
 * Its own number rather than `MAX_QUESTION_CHARS`, and for the same reason
 * `MAX_REMEMBER_CHARS` is: 4,000 is a considered cap on a sentence somebody
 * *typed*, and speech runs three or four times longer than the same thought
 * typed. It applies to the answer as well, which is the model's own speech and
 * bounded by one realtime turn.
 *
 * A cap on a transcript is not really a product rule — nobody will hit it in a
 * conversation — it is a bound on what a browser can push into a column.
 */
const MAX_SPOKEN_CHARS = 20_000;

/** At most this many of either. A bound, not a rule anyone will meet. */
const MAX_SPOKEN_ITEMS = 32;

/**
 * The passages a spoken answer pointed at, checked.
 *
 * Returns the field or **nothing**, so the caller spreads it: the two stores
 * are compared field for field by tests/store-roundtrip.test.ts, where an
 * absent key and an explicit `undefined` are not the same thing.
 *
 * Every id goes through `isSpideryarnId`. These are rendered as pressable
 * references in the reader's own transcript, so an id from a browser that has
 * gone wrong is a reference that resolves to nothing, stored for ever, in the
 * one place the reader trusts.
 */
function parseSpokenPassages(
  x: unknown,
  known: Set<string>,
): { passages: { blockIds: string[]; why: string }[] } | undefined {
  if (x === undefined) return undefined;
  if (!Array.isArray(x)) throw httpError(400, "passages must be a list");
  if (x.length > MAX_SPOKEN_ITEMS) throw httpError(400, "too many passages in one exchange");
  const passages = x.map((raw) => {
    const { blockIds, why } = (raw ?? {}) as Record<string, unknown>;
    if (!Array.isArray(blockIds) || blockIds.length === 0 || blockIds.length > MAX_SPOKEN_ITEMS) {
      throw httpError(400, "each passage needs blockIds");
    }
    /* **Against the article, not against the shape.** `isSpideryarnId` alone
       accepts `spya-zzzzzz`, which is well-formed and points at nothing — and
       what gets stored is a pressable reference in the reader's own transcript
       that scrolls nowhere for ever. A dead link that does nothing is worse
       than a plain string: the reader presses it, the page does not move, and
       there is no way to tell that from a bug in the scrolling. The typed path
       has the same distinction and counts its misses (`unknownCitedIds` in
       src/converse.ts); here we can simply refuse, because these ids came from
       the article the browser is looking at. GPT Sol, reviewing the built code. */
    const wrong = blockIds.find(
      (id) => typeof id !== "string" || !isSpideryarnId(id) || !known.has(id),
    );
    if (wrong !== undefined) {
      throw httpError(400, "a passage pointed at something that is not in this article");
    }
    return {
      blockIds: blockIds as string[],
      why: typeof why === "string" ? shortenedSpokenLabel(why) : "",
    };
  });
  return passages.length > 0 ? { passages } : undefined;
}

/**
 * The tools a spoken answer ran, checked — and **`status` is not read**.
 *
 * The browser runs these itself (the data channel relays the call and the
 * result), so its idea of a run is a live one and may well say `running`. A
 * `running` row on disk is a spinner with nothing left to end it, which is the
 * failure src/types.ts § `ToolRun.status` names. So the status is set here
 * rather than taken: by the time this request exists the run is over.
 */
function parseSpokenTools(x: unknown): { tools: ToolRun[] } | undefined {
  if (x === undefined) return undefined;
  if (!Array.isArray(x)) throw httpError(400, "tools must be a list");
  if (x.length > MAX_SPOKEN_ITEMS) throw httpError(400, "too many tool runs in one exchange");
  const tools = x.map((raw) => {
    const { name, label, detail } = (raw ?? {}) as Record<string, unknown>;
    if (typeof name !== "string" || typeof label !== "string") {
      throw httpError(400, "each tool run needs a name and a label");
    }
    /* **A receipt for something that could have happened.** The name is stored
       and shown to the reader as a thing the companion did, and without this a
       browser could file `delete_database` against its own transcript — a claim
       the reader has no way to check and every reason to believe, since every
       other row in that list is real. The set is the tools a live session is
       actually given: `LIVE_SERVER_TOOLS` plus the one answered in the browser.
       GPT Sol, reviewing the built code. */
    if (!LIVE_SERVER_TOOLS.has(name) && name !== SHOW_PASSAGE_TOOL.name) {
      throw httpError(400, "that is not a tool a live session runs");
    }
    return {
      name,
      label: shortenedSpokenLabel(label),
      status: "done" as const,
      ...(typeof detail === "string" && detail !== "" ? { detail: shortenedSpokenLabel(detail) } : {}),
    };
  });
  return tools.length > 0 ? { tools } : undefined;
}

/**
 * **A ticket for one live conversation.** `POST /api/chat/:slug/:threadId/live`.
 *
 * Hands the browser three things and no more: an ephemeral `ek_…` secret, the
 * conversation so far as items to seed the session with, and the id of the row
 * that is currently last.
 *
 * ## Why the seed is built here
 *
 * Because `recentHistory` in src/converse.ts is the one thing that decides what
 * a model may see, and a second window in the browser would be a second set of
 * rules about interrupted answers, failed turns and how far back to go — rules
 * that have already been got wrong twice at the one end that has them. It is
 * also where the block ids come *out*: seeding a voice model with typed history
 * verbatim hands it examples of its own past speech containing `[spya-k3m9qt]`
 * while its instructions forbid saying one aloud. `liveSeedItems` in
 * src/live.ts, and Fable's finding in docs/plans/260831l-live-conversation-in-chat.md § 1d.
 *
 * ## `tailId` and the seed come from one read
 *
 * They have to: the tail is what the first spoken append will claim, and a tail
 * read separately from the history it belongs to is a claim about a
 * conversation that never existed. If somebody types a turn between this
 * request and that append, the append is refused — which is exactly right, and
 * is the barrier docs/plans/260831l-live-conversation-in-chat.md § 6 asks for.
 *
 * The instructions, the tool list and the article go to **OpenAI**, never to the
 * browser: a client handed the prompt is a client that can be talked into
 * sending a different one. src/live.ts § `mintLiveToken`.
 */
async function liveChatToken(
  slug: string,
  threadId: string,
  body: unknown,
): Promise<LiveTicket> {
  const { placement, useProfile } = (body ?? {}) as Record<string, unknown>;
  /* **Validated against the shared union, never cast.** The two ends declare
     `MicPlacement` once, in src/types.ts, and this is the gate that keeps a
     string off the wire from becoming a `Record` lookup that quietly answers
     `undefined` — which would spread into the session as a missing field and
     turn noise reduction off without a word. */
  if (placement !== undefined && !isMicPlacement(placement)) {
    throw httpError(400, `placement must be one of: ${MIC_PLACEMENTS.join(", ")}`);
  }
  if (useProfile !== undefined && typeof useProfile !== "boolean") {
    throw httpError(400, "useProfile must be true or false");
  }

  const article = await loadArticle(slug);
  const thread = (await chatStore.load(slug)).find((t) => t.id === threadId);

  const session = liveSession({
    meta: article.meta,
    blocks: article.blocks,
    profile: useProfile === false ? null : await resolveProfile(slug),
    /* The same terms dictation primes its transcriber with, in the `keywords`
       field rather than `prompt` — src/live.ts says at length why that
       distinction is the whole difference between 4/4 and 2/4 on a block id. */
    vocabulary: await vocabularyTermsFor({ kind: "article", slug }),
    ...(placement === undefined ? {} : { placement }),
  });

  const minted = await mintLiveToken(session);

  /* **The journal row goes in before the token comes out, and the order is the
     whole rule.**

     OpenAI mints the secret, we write the session, and only then does the token
     reach the browser. If the insert throws, this function throws with it and
     the reader is told the session could not start — because a usable token with
     no journal row is money that will be spent on a wire this server cannot see,
     with nothing anywhere that could later say a conversation had even happened.
     GPT Sol set the sequence out in exactly these three steps; the token is
     genuinely wasted when this fails, and that is the cheaper of the two
     outcomes.

     It also means an issued session that reports nothing shows up as a session
     that reported nothing, which is the one failure a browser-reported meter
     actually has — the reader shuts the laptop and the last turns never arrive.
     Without a row there is no gap to see, only an absence.
     docs/reusable/silent-success.md. */
  const sessionId = randomUUID();
  const issuedAt = new Date();
  await realtimeSessionStore.issue({
    id: sessionId,
    ownerId: currentOwnerId(),
    articleSlug: slug,
    threadId,
    /* **What OpenAI created, not what we asked for.** They agree only when the
       request was honoured, and `mintLiveToken` reads the created session
       precisely so that this column can be an answer rather than a hope — which
       matters here more than usual, because the price is looked up by this
       string. A row that named a model the session was not on would be priced
       against the wrong rate card for ever. */
    model: minted.model,
    transcriptionModel: LIVE_TRANSCRIBER,
    issuedAt: issuedAt.toISOString(),
    /* **The server's own deadline, stored on the row.** Not the token's expiry,
       which admits one connection and is about ten minutes, while a conversation
       may run for twenty — see `REPORT_WINDOW_MS` in src/live.ts for why using
       the wrong clock would have dropped the reports that matter most. Stored
       rather than recomputed, so a session issued under today's rule keeps it
       when the rule changes. */
    acceptsUntil: new Date(issuedAt.getTime() + REPORT_WINDOW_MS).toISOString(),
    connectedAt: null,
    closedAt: null,
    closeReason: null,
  });

  return {
    ...minted,
    sessionId,
    seed: liveSeedItems(thread?.messages ?? []),
    tailId: thread?.messages.at(-1)?.id ?? null,
  };
}

/**
 * **The data channel opened** — `POST /api/live/:sessionId/connected`.
 *
 * The smallest endpoint in this file, and it exists because *a minted token is
 * not a conversation*. A reader can press the button, think better of it, and
 * never open the channel. A denominator built on issued sessions would then
 * quietly understate what a real conversation costs by however many of those
 * there are, and nothing would look wrong.
 *
 * GPT Sol offered two ways out — name the denominator honestly, or add this
 * event — and preferred this one, because "issued" and "connected" are both
 * facts worth having rather than one fact worth relabelling.
 *
 * Best-effort by nature: it fires once, on a channel that has just become
 * usable, and nothing retries it. So `close` and the first usage report both
 * backfill `connected_at` as well, and all three keep the earliest time.
 */
async function liveConnected(sessionId: string): Promise<{ ok: true }> {
  const owner = currentOwnerId();
  /* **Looked up for this owner, and 404 if it is not theirs.** The session id
     travels through the browser, so a lookup that did not carry the owner would
     answer for any session whose id somebody had. 404 rather than 403 is this
     repo's rule for a thing you may not see — docs/project/auth.md § Whose data
     is it. */
  const session = await realtimeSessionStore.find(sessionId, owner);
  if (!session) throw httpError(404, "No such live session.");
  await realtimeSessionStore.markConnected(sessionId, owner, new Date().toISOString());
  return { ok: true };
}

/**
 * **One paid event from a live conversation** — `POST /api/live/:sessionId/usage`.
 *
 * This is the seam: an authenticated request carrying a browser's account of
 * what a turn cost becomes a row in the ledger. Everything about the request
 * that can be got wrong is got wrong in `parseRealtimeUsage` and
 * `acceptRealtimeUsage`, which are named, pure and tested without HTTP —
 * `tests/realtime-usage.test.ts`. This function does only the three things they
 * cannot: find the session **for the authenticated owner**, price nothing
 * itself, and write.
 *
 * ## What the endpoint refuses to take from the caller
 *
 * A dollar amount, a model, an owner, an article. All four come from the session
 * row this server wrote when it minted the token. A client that could name its
 * own model could name the cheap one; a client that could name its own cost
 * could name zero. docs/plans/realtime-voice-cost-tracking.md.
 *
 * ## Why a lost report is worse than a wrong one
 *
 * Nobody has an incentive to under-report their own token count and there is no
 * per-reader cap to duck under — docs/project/security-map.md is explicit that a
 * signed-in reader is not one of the untrusted parties. What will actually
 * happen is that a tab closes mid-conversation. That is why the browser posts
 * every turn as it happens rather than one total at the end (Stage 2B), and why
 * a retry of a report that was already accepted has to be harmless: the row's id
 * is derived from the event, so a repeat lands on `on conflict do nothing`.
 */
async function liveUsage(sessionId: string, body: unknown): Promise<{ ok: true }> {
  const owner = currentOwnerId();
  const session = await realtimeSessionStore.find(sessionId, owner);
  if (!session) throw httpError(404, "No such live session.");

  const receivedAt = new Date();
  const row = acceptRealtimeUsage({
    session,
    usage: parseRealtimeUsage(body),
    receivedAt,
  });
  await costStore.record(row);
  /* **A report is also evidence the channel opened**, and the `connected` event
     above is the one thing here that nothing retries. Kept earliest-wins in the
     store, so this weaker inference never overwrites the real moment. */
  await realtimeSessionStore.markConnected(sessionId, owner, receivedAt.toISOString());
  return { ok: true };
}

/**
 * **The conversation ended** — `POST /api/live/:sessionId/close`.
 *
 * Best-effort, and it has to be treated that way by everything downstream: a
 * closed laptop sends nothing, so a session with no `closed_at` is the ordinary
 * case rather than an error, and **nothing may read its absence as a session
 * still running**. The value of the field is in the sessions that do close — it
 * is what makes "issued, never connected" and "connected, ended, reported
 * nothing" different rows rather than one shrug.
 *
 * The reason is the browser's own word for it and is stored as free text with a
 * length bound: the list belongs to `useLiveConversation.ts`, and a server-side
 * union that lagged it would refuse a true report about how a conversation
 * ended. `realtimeCloseReason` in src/live.ts is the bound.
 */
async function liveClose(sessionId: string, body: unknown): Promise<{ ok: true }> {
  const owner = currentOwnerId();
  const session = await realtimeSessionStore.find(sessionId, owner);
  if (!session) throw httpError(404, "No such live session.");
  const { reason } = (body ?? {}) as Record<string, unknown>;
  await realtimeSessionStore.close(
    sessionId,
    owner,
    new Date().toISOString(),
    realtimeCloseReason(reason),
  );
  return { ok: true };
}

/**
 * **One chat tool, run for a live session.** `POST /api/chat/:slug/live-tool`.
 *
 * The one route where the *browser* names the tool. In typed chat the name
 * comes off the model's own output on this server; in a live session the model
 * is talking to the browser, so the call arrives here second-hand. That is one
 * step further out, and it is why the name is checked against
 * `LIVE_SERVER_TOOLS` rather than handed to `runTool` — which answers an
 * unknown name with a friendly sentence listing the others, which is the right
 * reply to a confused model and the wrong one to a caller that is not one.
 *
 * `show_passage` is deliberately not runnable here: it is answered in the
 * browser, in the frame it arrives in, and that is the whole reason it exists.
 *
 * **The exposure is the same as typed chat's, not larger.** `read_web_page`
 * fetches a URL this server chooses to fetch either way — a reader can already
 * ask a typed conversation to read one — so the defence is the same one, in the
 * same place. docs/project/security.md.
 */
async function liveTool(slug: string, body: unknown): Promise<ToolOutcome> {
  const { name, args } = (body ?? {}) as Record<string, unknown>;
  if (typeof name !== "string" || !LIVE_SERVER_TOOLS.has(name)) {
    throw httpError(400, "That is not a tool a live session may run");
  }
  const article = await loadArticle(slug);
  return runTool(name, (args ?? {}) as Record<string, unknown>, {
    slug,
    meta: article.meta,
    blocks: article.blocks,
  });
}

/** What the browser is given to open one live session. See `liveChatToken`. */
interface LiveTicket extends LiveToken {
  /**
   * **The id of this server's own journal row for the conversation**, and the
   * thing every later report is addressed to.
   *
   * Not the OpenAI session id, which the browser also learns and which this
   * server never sees. Ours, minted here, so the three acceptance endpoints can
   * find the row that says whose money it is, which article it was about, which
   * model was created and how long reports are accepted for — none of which the
   * browser is trusted to state. src/live.ts § `RealtimeUsage`.
   */
  sessionId: string;
  /** The thread so far, windowed and with our block ids taken out. */
  seed: { role: "user" | "assistant"; text: string }[];
  /** The row the first spoken append must claim, or `null` for an empty thread. */
  tailId: string | null;
}

/**
 * A thread with its transcript replaced by the two facts a hover needs.
 *
 * `turns` counts the reader's questions rather than all messages, because that
 * is what "three turns" means to a person looking at a tooltip.
 *
 * `lastLine` is the opening of the most recent **finished** answer. Deliberately
 * not the pending one: a half-written answer is not a summary of anything, and
 * an empty string in a tooltip reads as a bug. It is omitted rather than
 * blanked when there is nothing to show, so the client's test is `if
 * (lastLine)` rather than a length check on a string that might be whitespace.
 *
 * **Never carries the anchor quote into a log**, because nothing here logs. The
 * quote is article prose, which docs/project/logging.md forbids; it travels in
 * this response body and nowhere else.
 */
function summarise(thread: ChatThread): ThreadSummary {
  const answers = thread.messages.filter((m) => m.role === "assistant" && m.status === "done");
  const last = answers[answers.length - 1]?.text.trim().split(/\n/)[0]?.trim();
  return {
    id: thread.id,
    title: thread.title,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    ...(thread.anchor ? { anchor: thread.anchor } : {}),
    /* The reading view draws no marks for Remember — a Remember thread cannot be
       anchored — but it still needs this. `?thread=` opens the floating
       `ChatDialog` in every mode but the two conversation modes, and that
       dialog is chat's UI asking with chat's prompt; a pasted
       `?mode=hierarchy&thread=<a Remember thread>` would continue it as a chat. The
       overlay is gated on this. src/web/reader/Reader.tsx § overlay. */
    kind: thread.kind,
    turns: thread.messages.filter((m) => m.role === "user").length,
    ...(last ? { lastLine: last } : {}),
  };
}

/** Long enough for a paragraph of context, short enough that nothing runs away. */
const MAX_QUESTION_CHARS = 4000;

/**
 * How long a **Remember** turn may be — its own limit, and not the question's.
 *
 * A chat question is a sentence somebody typed; a Remember turn is a paragraph or two
 * somebody *said*, and speech runs three or four times longer than the same
 * thought typed. 4,000 characters is a considered cap on the first and an
 * accident applied to the second: a reader who talks for four minutes hits it,
 * having already paid for the transcription, and gets a 413 for a box that
 * invited them to ramble.
 *
 * This is the same mistake `MAX_QUOTE_CHARS` below had to be rescued from —
 * one limit shared by two things that are only superficially the same shape.
 * Roughly fifteen minutes of continuous speech, because the cost of a long one
 * is tokens rather than risk.
 */
const MAX_REMEMBER_CHARS = 20_000;

/**
 * How long a selection may be, in characters.
 *
 * **Its own limit, not the question's**, and that is not tidiness. A question is
 * something a reader types; an anchor quote is a passage of somebody else's
 * prose that they dragged across, and a long paragraph goes past 4,000
 * characters without trying. Sharing one limit meant selecting a long passage
 * opened a thread optimistically and then took a 413 with the panel already on
 * screen. Found by a GPT-5.6 review, 2026-08-26.
 *
 * Generous, because the cost of a big quote is tokens rather than risk, and the
 * client refuses over-long selections before it mints a thread anyway. The
 * ceiling that actually bites first is `MAX_BODY_BYTES`.
 */
const MAX_ANCHOR_CHARS = 20_000;

/**
 * The `anchor` field of a chat request, as a `ChatAnchor` or nothing.
 *
 * Shape only — whether the block exists and whether the quote is really at that
 * offset are `checkAnchor`'s job, because those need the article.
 *
 * **No part of the quote reaches a thrown message.** `httpError` messages are
 * logged as `reason`, redaction is path-based and cannot reach inside a string,
 * and the quote is article prose — which docs/project/logging.md says must
 * never be logged. The same rule `answer()` states for `deep` a few hundred
 * lines up, and the reason every message here describes the shape rather than
 * quoting the value.
 */
function parseAnchor(anchor: unknown): ChatAnchor | undefined {
  if (anchor === undefined || anchor === null) return undefined;
  if (typeof anchor !== "object") throw httpError(400, "anchor must be an object");
  const { blockId, quote, start } = anchor as Record<string, unknown>;
  if (typeof blockId !== "string" || !isSpideryarnId(blockId)) {
    throw httpError(400, "anchor.blockId must be a block id");
  }
  /* Both or neither. Half an anchor is not an error anybody sees — it is a mark
     drawn a few characters to the left of the words it belongs to, which reads
     as a styling glitch rather than as bad data. The database says the same
     thing in `chat_threads_anchor_both`; this says it before the write. */
  const hasQuote = quote !== undefined;
  const hasStart = start !== undefined;
  if (hasQuote !== hasStart) {
    throw httpError(400, "anchor needs both quote and start, or neither");
  }
  if (!hasQuote) return { blockId };
  if (typeof quote !== "string" || quote.trim() === "") {
    throw httpError(400, "anchor.quote must be a non-empty string");
  }
  if (quote.length > MAX_ANCHOR_CHARS) {
    throw httpError(413, `A selection may be at most ${MAX_ANCHOR_CHARS} characters`);
  }
  if (typeof start !== "number" || !Number.isInteger(start) || start < 0) {
    throw httpError(400, "anchor.start must be a non-negative integer");
  }
  return { blockId, quote, start };
}

/**
 * Are these the same anchor?
 *
 * A thread with no anchor is **not** the same as one with any anchor: a send
 * offering a passage for an unanchored conversation is still trying to change
 * what that conversation is about, and it is refused. `undefined` on both sides
 * cannot reach here — the caller only asks when it has one.
 */
function sameAnchor(stored: ChatAnchor | undefined, wanted: ChatAnchor): boolean {
  if (!stored) return false;
  if (stored.blockId !== wanted.blockId) return false;
  const a = "quote" in stored ? stored : null;
  const b = "quote" in wanted ? wanted : null;
  if (!a || !b) return a === b; // both block-only, or one of each
  return a.quote === b.quote && a.start === b.start;
}

/**
 * The anchor against the article it claims to be part of.
 *
 * Three things the schema cannot check, in the order they matter:
 *
 *  - **the block is one of this article's.** The foreign key would catch it too,
 *    but as a 500 out of a transaction rather than as a 400 anybody can read;
 *  - **the offset is inside the block**, rather than past the end of it;
 *  - **the quote is really the text at that offset.** Not required to match —
 *    the client measures in the *rendered* offset space and the server has the
 *    block's `text`, and the two can differ by whitespace — so a mismatch is
 *    allowed through. `resolveMark` re-finds the quote in the rendered text
 *    rather than trusting the offset, exactly as src/quote-match.ts does for a
 *    search hit, so a drifted offset costs nothing. What is refused is a quote
 *    that is not in the block **at all**, which is the case that means the
 *    client is anchoring to something else entirely.
 */
function checkAnchor(anchor: ChatAnchor, blocks: Block[]): void {
  const block = blocks.find((b) => b.id === anchor.blockId);
  if (!block) throw httpError(400, "anchor.blockId is not a block of this article");
  if (!("quote" in anchor)) return;
  if (anchor.start > block.text.length) {
    throw httpError(400, "anchor.start is past the end of that block");
  }
  /* Whitespace-folded on both sides, because the rendered text the client
     measured collapses runs of space that `block.text` may keep. Comparing them
     literally rejected perfectly good selections. */
  if (!foldSpace(block.text).includes(foldSpace(anchor.quote))) {
    throw httpError(400, "anchor.quote is not in that block");
  }
}

/* --------------------------------------------------------------- search --
   Finding a passage by what it says. See docs/project/search.md.

   Streams now, and it is worth saying what this comment used to argue and why
   that turned out to be wrong. It said a search result is a list, not prose,
   so there is nothing to watch arrive and streaming would buy the reader a
   progress bar they cannot read. That mistook "not prose" for "nothing worth
   showing as it arrives". A hit is a complete, self-contained object —
   blockId, quote, confidence, reasoning — and src/search.ts's prompt already
   asks the model to return them best-match-first. The moment a hit's closing
   brace has arrived in the model's output, src/search-hits-stream.ts's
   `hitExtractor` can hand it over, so the strongest match highlights the
   article while the model is still composing its tenth-best guess, instead of
   the reader watching a spinner for the whole pass. Nothing about the prompt
   or the ranking changed to make this true — `findPassagesStream` is still one
   call asked for one JSON object, and the eventual `done` is still the
   authoritative, strictly-parsed answer. See that file's module docstring
   § Streaming. */

/**
 * The searches this process is running right now, as `slug/runId`.
 *
 * The same job `answering` and `streaming` do above, for the same reason:
 * `pending` on disk does not mean "an answer is coming", because it is written
 * *before* the model call precisely so a crash leaves evidence. Only the
 * running process can tell a search in flight from one that died with the
 * process that was writing it.
 */
const searching = new Set<string>();

/**
 * What this process is searching *in this article*, as bare run ids.
 *
 * The same conversion `liveMessages` does, and for the same two reasons: the
 * set's key has to stay unique across articles, and the store's `keep` is a
 * set of row ids rather than of composites it would have to take apart.
 */
function liveRuns(slug: string): Set<string> {
  const prefix = `${slug}/`;
  const ids = new Set<string>();
  for (const key of searching) {
    if (key.startsWith(prefix)) ids.add(key.slice(prefix.length));
  }
  return ids;
}

/**
 * Turn abandoned `pending` searches into `error`, so they can be run again.
 *
 * As with `sweepChat`, the rule is the store's and only the two things a
 * running server knows are here: what this process is writing, and how long
 * another process's row may stay silent. The filesystem store ignores the
 * grace window — it has no other processes to be wrong about, and giving it
 * one would be an improvement smuggled in under a migration.
 */
function sweepSearches(slug: string): Promise<SearchRun[]> {
  return searchStore.sweepPending(slug, {
    keep: liveRuns(slug),
    graceMs: SEARCH_ORPHAN_GRACE_MS,
  });
}

/**
 * Run a search, streaming hits as they arrive, and store the result.
 *
 * Shaped on `answer` above — see its docstring for the reasoning behind each
 * decision, repeated here rather than reinvented:
 *
 * - **Validation happens before `beginRun`**, so a bad request is still an
 *   ordinary JSON 400 — the thrown `httpError` never reaches a half-opened
 *   stream.
 * - `beginRun` writes the `pending` row **before** a header goes out, exactly
 *   as `commentStore.create` does, so a crash mid-search leaves evidence.
 * - Frames: one `begin` (the whole run — `beginRun` may reset an existing id
 *   rather than mint one, see `withRun` in src/searches.ts, and `?runs=` has
 *   to be able to name the real one from the first frame), then any number of
 *   `hit`, then exactly one `done` — **unless the run was deleted while the
 *   model was thinking**, see below.
 * - A model failure is a `done` frame carrying a run whose status is `error`,
 *   not an HTTP error: the request *did* succeed at what it was for, which was
 *   recording the criterion. The panel shows the failure and offers to try
 *   again.
 * - **Nothing past `sse(res)` may throw.** The store write after the loop is
 *   wrapped for the same reason `answer`'s is: a store that cannot record the
 *   result is a worse thing than a failed search, and it deserves its own log
 *   line rather than an escaped exception landing on a response whose headers
 *   are long gone.
 *
 * **What's different from `answer`: the deleted-mid-search case cannot be a
 * 404 any more.** The old JSON version threw one when `finishRun` reported the
 * run gone — the reader had deleted it while the model was still thinking, and
 * `finishRun` deliberately does not resurrect a row that is no longer there
 * (see its docstring in src/searches.ts). With a stream the headers are
 * already sent, so there is no status code left to change. The client already
 * knows: deleting a run is a purely local act (the `deleted` tombstone in
 * src/web/useSearch.ts), and the row is off screen before this response is
 * even being watched. So the server's half of the contract is simply to stay
 * quiet about a run that is not there any more — no `done` frame, just the
 * stream ending — and the client's half is to treat a stream that ends
 * without `done` as *expected* for a run it has already forgotten, rather than
 * as the broken-connection failure it is for any other run.
 */
async function search(slug: string, body: unknown, res: ServerResponse): Promise<void> {
  const { id, criterion } = (body ?? {}) as Record<string, unknown>;
  if (typeof criterion !== "string" || criterion.trim() === "") {
    throw httpError(400, "Expected { criterion }");
  }
  // The whole article goes in the prompt, so a criterion is not the expensive
  // part — but an unbounded one is still a way to push the article out of the
  // context window from the outside.
  if (criterion.length > 500) {
    throw httpError(400, "A criterion must be 500 characters or fewer");
  }

  const { run, attempt } = await searchStore.begin(
    slug,
    criterion.trim(),
    typeof id === "string" ? id : undefined,
  );
  const key = `${slug}/${run.id}`;
  searching.add(key);

  const { frame } = sse(res);
  frame("begin", run);

  let patch: Partial<SearchRun>;
  try {
    const article = await loadArticle(slug);
    let hits: SearchHit[] = [];
    let model = "";
    for await (const event of findPassagesStream({
      meta: article.meta,
      blocks: article.blocks,
      criterion: run.criterion,
    })) {
      if (event.type === "hit") {
        frame("hit", { hit: event.hit });
        continue;
      }
      hits = event.result.hits;
      model = event.result.model;
    }
    patch = { status: "done", hits, model };
  } catch (err) {
    captureFailure(err, { route: "search", slug, id: run.id });
    patch = { status: "error", error: (err as Error).message };
  } finally {
    searching.delete(key);
  }

  try {
    /* The attempt goes back with the answer, and the Postgres store refuses a
       `finish` without one rather than falling back to identity. A run keeps
       its id across a retry — that is what makes it the same question — so
       identity alone cannot say which model call is reporting, and a call a
       sweep already buried would otherwise land on top of the retry the reader
       is watching. `undefined` on the filesystem, which has no attempts. */
    const stored = await searchStore.finish(slug, run.id, patch, attempt);
    /* `undefined` now means one of two things and both are silence. The reader
       deleted this run while the model was thinking — see the docstring above,
       the client has already forgotten the row — or this attempt is no longer
       the live one, in which case there is a newer answer on its way and
       saying anything about this one would only overwrite it on screen. */
    if (stored) frame("done", stored);
  } catch (storeErr) {
    log("store").error(
      { ...errorFields(storeErr), slug, id: run.id },
      `could not record a search result for ${slug}`,
    );
    captureFailure(storeErr, { route: "search", slug, phase: "record-result" });
  } finally {
    res.end();
  }
}


/* ---------------------------------------------- referee criteria (stage 3) --
   A peer reviewer's own criteria, run over the paper.
   docs/plans/260831an-referee-mode-for-peer-reviewers.md § 1.

   **Search's four routes, and deliberately so.** Sol's finding 5 warned that
   Criteria growing "separate routes, stores and rendering machinery" is where
   the duplication becomes fatal, and the answer taken here is not to avoid the
   separation — the data model genuinely differs, finding 6 — but to make every
   piece of it the same shape as the one it is modelled on, so a reader of one
   is a reader of both. The store is `SearchStore` method for method, the stream
   frames are `begin` / `result` / `done` against search's `begin` / `hit` /
   `done`, the sweep is the same sweep, and the ownership checks are the same
   checks because they are literally the same `assertOwner` this dispatcher runs
   for every `/api/` route. */

/**
 * The criteria this process is running right now, as `slug/id`.
 *
 * The same job `searching` does above, for the same reason: `pending` in the
 * store does not mean "an answer is coming", because it is written *before* the
 * model call precisely so a crash leaves evidence.
 */
const refereeing = new Set<string>();

/** What this process is running *in this article*, as bare ids — `liveRuns`. */
function liveCriteria(slug: string): Set<string> {
  const prefix = `${slug}/`;
  const ids = new Set<string>();
  for (const key of refereeing) {
    if (key.startsWith(prefix)) ids.add(key.slice(prefix.length));
  }
  return ids;
}

/**
 * How long an abandoned `pending` criterion may stay silent before another
 * process may bury it.
 *
 * **Measured against the longest clock a criterion can have**, which is
 * `LITERATURE_TIMEOUT_MS` rather than the 60s the other two kinds get — a
 * `literature` run goes to the web, and a grace window sized for the short pair
 * would have another process burying a run that is still waiting on its fourth
 * search. That is the failure `SEARCH_ORPHAN_GRACE_MS` exists to prevent,
 * arriving through the one kind that has a different deadline.
 */
export const CRITERION_ORPHAN_GRACE_MS = 150_000;

if (CRITERION_ORPHAN_GRACE_MS <= LITERATURE_TIMEOUT_MS) {
  throw new Error(
    `CRITERION_ORPHAN_GRACE_MS (${CRITERION_ORPHAN_GRACE_MS}ms) must be longer than ` +
      `LITERATURE_TIMEOUT_MS (${LITERATURE_TIMEOUT_MS}ms), or a sweep buries criteria that ` +
      "are still running.",
  );
}

/** Turn abandoned `pending` criteria into `error`, so they can be run again. */
function sweepCriteria(slug: string): Promise<SavedCriterion[]> {
  return refereeCriteriaStore.sweepPending(slug, {
    keep: liveCriteria(slug),
    graceMs: CRITERION_ORPHAN_GRACE_MS,
  });
}

/**
 * The criterion a POST is asking for, or a 400 saying which half is missing.
 *
 * **Everything is checked before `begin` writes anything**, which is the rule
 * `search` above states and the reason a bad request is still an ordinary JSON
 * 400 rather than a thrown `httpError` landing on a half-opened stream.
 *
 * The kind is read from the body and **narrowed by `isRefereeCriterionKind`**
 * rather than cast, so the union in src/referee-criteria.ts is the only list of
 * kinds and a fourth one cannot arrive through a request. `criterionProblem`
 * then answers the question the *database* also answers
 * (`referee_criteria_diverging_shape`): a two-ended criterion needs a word for
 * each end, or its valence is signed against nothing and the panel cannot print
 * the direction in words — which docs/project/colour-scales.md requires, because
 * colour may never be the only carrier.
 */
function readCriterionRequest(body: unknown): {
  id: string | undefined;
  criterion: string;
  config: RefereeCriterionConfig;
} {
  /* Checked before it is destructured — `readBody` will happily return a bare
     JSON `null`, and destructuring that throws a `TypeError` the generic
     handler turns into a 500. GPT Sol's review, 2026-08-27. */
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw httpError(400, "Expected a JSON object");
  }
  const { id, criterion, kind, poles, scale } = body as Record<string, unknown>;

  if (typeof criterion !== "string" || criterion.trim() === "") {
    throw httpError(400, "Expected { criterion }");
  }
  // The whole paper goes in the prompt, so a criterion is not the expensive
  // part — but an unbounded one is still a way to push the paper out of the
  // context window from the outside. Search's number, for search's reason.
  if (criterion.length > 500) {
    throw httpError(400, "A criterion must be 500 characters or fewer");
  }
  if (!isRefereeCriterionKind(kind)) {
    throw httpError(400, "Expected { kind } to be single, diverging or literature");
  }

  let config: RefereeCriterionConfig;
  if (kind === "diverging") {
    const { against, favour } = (poles ?? {}) as Record<string, unknown>;
    if (typeof against !== "string" || typeof favour !== "string") {
      throw httpError(400, "Expected { poles: { against, favour } } on a diverging criterion");
    }
    // A pole is printed in the panel and sent to the model; the same bound as
    // the criterion for the same reason, and long before either is interesting.
    if (against.length > 200 || favour.length > 200) {
      throw httpError(400, "A pole must be 200 characters or fewer");
    }
    config = {
      kind,
      poles: { against: against.trim(), favour: favour.trim() },
      /* An absent scale is the default rather than a 400: `rg` is what the
         referee gets if they never touch it, and a *wrong* one is refused
         rather than silently corrected, because a name this narrow either
         matches a block in styles/colourscales.css or draws nothing at all. */
      scale: scale === undefined ? DEFAULT_DIVERGING_SCALE : requireScale(scale),
    };
  } else {
    config = { kind };
  }

  const problem = criterionProblem({ criterion: criterion.trim(), config });
  if (problem) throw httpError(400, problem);

  return {
    id: typeof id === "string" ? id : undefined,
    criterion: criterion.trim(),
    config,
  };
}

/** A diverging ramp we actually have, or a 400. See `DivergingScale`. */
function requireScale(value: unknown): DivergingScale {
  if (!isDivergingScale(value)) {
    throw httpError(400, "Expected { scale } to be rg or br");
  }
  return value;
}

/**
 * Run one criterion, streaming passages as they arrive, and store the result.
 *
 * **`search` above, with three differences and no fourth.** Read its docstring
 * for every decision repeated here — validation before `begin`, the `pending`
 * row written before a header goes out, a model failure being a `done` frame
 * rather than an HTTP error, nothing past `sse(res)` being allowed to throw,
 * and the deleted-mid-run case ending the stream quietly because the headers
 * are long gone.
 *
 * The three differences:
 *
 * - The middle frame is `result` rather than `hit`, and carries a
 *   `RefereeResult` — which is three shapes, discriminated by the criterion's
 *   own kind.
 * - A `literature` criterion may sit silent for a long time while the provider
 *   searches the web. Nothing here has to do anything about that (the clocks
 *   are `runCriterionStream`'s and the sweep's grace window is sized for it),
 *   but it is the reason the first `result` frame can be a minute late.
 * - The `dropped` counts come back on the outcome and are **not** sent to the
 *   client. They are a log line and an alarm; a panel that showed "4 results
 *   were unusable" would be reporting the model's manners rather than anything
 *   a referee can act on. src/referee-criteria-run.ts logs them.
 *
 *   **With one exception, and it is an exception because the panel was lying
 *   without it.** An answer in which *every* row was thrown away is raised as a
 *   failure by `runCriterionStream` (`ANSWER_UNUSABLE`), so it arrives here as
 *   an ordinary error and is stored as one. Without that, a `diverging` answer
 *   that anchored a passage and forgot its valence was stored `done` with no
 *   results, and the panel printed "the model did not find a passage for this"
 *   — which is the sentence for a model that found nothing, and false about a
 *   model that found something and could not score it. GPT Sol's finding 4. A
 *   *partial* loss is still a success and still only a log line: one usable row
 *   means the criterion ran.
 */
async function runRefereeCriterion(
  slug: string,
  body: unknown,
  res: ServerResponse,
): Promise<void> {
  const { id, criterion, config } = readCriterionRequest(body);

  const { row, attempt } = await refereeCriteriaStore.begin(slug, criterion, config, id);
  const key = `${slug}/${row.id}`;
  refereeing.add(key);

  const { frame } = sse(res);
  frame("begin", row);

  let patch: Partial<SavedCriterion>;
  try {
    const article = await loadArticle(slug);
    let results: RefereeResult[] = [];
    let model = "";
    for await (const event of runCriterionStream({
      meta: article.meta,
      blocks: article.blocks,
      criterion: row.criterion,
      config: row.config,
    })) {
      if (event.type === "result") {
        frame("result", { result: event.result });
        continue;
      }
      results = event.outcome.results;
      model = event.outcome.model;
    }
    patch = { status: "done", results, model };
  } catch (err) {
    captureFailure(err, { route: "referee-criteria", slug, id: row.id });
    patch = { status: "error", error: (err as Error).message };
  } finally {
    refereeing.delete(key);
  }

  try {
    /* The attempt goes back with the answer, and the Postgres store refuses a
       `finish` without one rather than falling back to identity. A criterion
       keeps its id across a retry — that is what makes it the same question —
       so identity alone cannot say which model call is reporting. */
    const stored = await refereeCriteriaStore.finish(slug, row.id, patch, attempt);
    /* `undefined` means one of two things and both are silence: the referee
       deleted this criterion while the model was thinking, or this attempt is
       no longer the live one and a newer answer is on its way. */
    if (stored) frame("done", stored);
  } catch (storeErr) {
    log("store").error(
      { ...errorFields(storeErr), slug, id: row.id },
      `could not record a referee criterion for ${slug}`,
    );
    captureFailure(storeErr, { route: "referee-criteria", slug, phase: "record-result" });
  } finally {
    res.end();
  }
}

/* ------------------------------------------------ referee claims (stage 4) --
   What the paper claims about itself, and where it takes each claim up.
   docs/plans/260831an-referee-mode-for-peer-reviewers.md § 2.

   **Criteria's two routes rather than its four**, and the difference is the data
   model rather than a corner cut: there is one claims run per article, so there
   is no row to name, nothing to recolour and nothing to delete one of. A second
   run replaces the first, which is what POST already means.

   The ownership check is the same `assertOwner` this dispatcher runs for every
   `/api/` route, and the spend is attributed the same way Criteria's is. */

/**
 * The articles this process is pulling claims for right now, as slugs.
 *
 * The same job `refereeing` and `searching` do above, for the same reason:
 * `pending` in the store does not mean "an answer is coming", because it is
 * written *before* the model call precisely so a crash leaves evidence. A slug
 * rather than a `slug/id` because there is only ever one run per article.
 */
const pullingClaims = new Set<string>();

/**
 * The run a request should ask for, and a 400 saying why not.
 *
 * **A claims POST carries no body at all**, and that is the design rather than
 * an omission — the same call `runMirror` below makes and for the same reason.
 * Everything this run is about is already ours: the article is in the store and
 * the question is fixed. A body that named anything would be a way for a stale
 * tab, or a tampered client, to steer a paid call.
 *
 * So the only thing to refuse is a paper with no blocks in it. That check is
 * here, above `sse(res)`, because after a header has gone out there is nowhere
 * to put a 400 — and a model asked to find claims in an empty article does not
 * fail, it invents.
 */
function claimsProblem(blocks: Block[]): string | null {
  return blocks.length === 0
    ? "This article has no text to read yet. Let ingestion finish and try again."
    : null;
}

/**
 * Pull the paper's claims, streaming each one as it arrives, and store the run.
 *
 * **`runRefereeCriterion` above, with three differences and no fourth.** Read
 * its docstring, and `search`'s behind it, for every decision repeated here —
 * validation before `begin`, the `pending` row written before a header goes out,
 * a model failure being a `done` frame rather than an HTTP error, and nothing
 * past `sse(res)` being allowed to throw.
 *
 * The three differences:
 *
 * - **The middle frame is `claim`**, and it carries a whole `Claim` with its
 *   passages already anchored and re-quoted against the article.
 * - **A streamed claim is not in document order and the final one is.**
 *   `validateClaims` sorts by position, and a preview cannot — the claims after
 *   it have not arrived. So the panel sorts what it is holding on every frame
 *   (src/web/ClaimsPanel.tsx), which is what makes rule 1 true on screen at
 *   every instant rather than only at the end.
 * - **There is no id and no attempt.** One run per article, so `finish` writes
 *   over whatever `begin` wrote and identity is the slug. The cost of that is
 *   real and is written down in src/store/pg-referee-claims.ts: two tabs
 *   running this at once will have the slower answer win, where a criterion's
 *   `attempt` would have refused the stale one.
 *
 * The `dropped` counts come back on the outcome and are **not** sent to the
 * client, exactly as Criteria's are not — with the same exception, for the same
 * reason. An answer in which every claim was thrown away is raised as a failure
 * by `runClaimsStream` (`CLAIMS_UNUSABLE`) and stored as one, because otherwise
 * the panel would print "the model did not find" about an answer that found
 * things and could not place them. The per-claim half of that lives on the row
 * as `Claim.discarded` and *is* sent, because the sentence under an empty claim
 * depends on it.
 */
async function runRefereeClaims(slug: string, res: ServerResponse): Promise<void> {
  /* Read before anything is written, so a slug that is not an article is a clean
     404 and an empty one is a clean 400 — both before a header exists. */
  const article = await loadArticle(slug);
  const problem = claimsProblem(article.blocks);
  if (problem) throw httpError(400, problem);

  const row = await refereeClaimsStore.begin(slug);
  pullingClaims.add(slug);

  const { frame } = sse(res);
  frame("begin", row);

  let patch: Pick<ClaimsRun, "status"> & Partial<ClaimsRun>;
  try {
    let claims: Claim[] = [];
    let model = "";
    /* The one `dropped` count that **is** stored, and the exception is narrow on
       purpose. The others describe answers we threw away, which is our business
       and the log's. This one describes claims the paper made that the referee
       will never see, cut from the end of the document because the cap is
       positional — so without it the list looks complete and position has
       quietly become the ranking this sub-mode is built to have none of.
       GPT Sol's finding 5, 2026-09-01; tests/referee-claims-omitted.test.ts. */
    let claimsOmitted = 0;
    for await (const event of runClaimsStream({ meta: article.meta, blocks: article.blocks })) {
      if (event.type === "claim") {
        frame("claim", { claim: event.claim });
        continue;
      }
      claims = event.outcome.claims;
      model = event.outcome.model;
      claimsOmitted = event.outcome.dropped.truncated;
    }
    patch = { status: "done", claims, model, claimsOmitted };
  } catch (err) {
    captureFailure(err, { route: "referee-claims", slug });
    patch = { status: "error", error: (err as Error).message, claims: [] };
  } finally {
    pullingClaims.delete(slug);
  }

  try {
    const stored = await refereeClaimsStore.finish(slug, patch);
    /* `null` means the run is not there any more — the article's data went away
       underneath the call. Silence rather than a resurrection. */
    if (stored) frame("done", stored);
  } catch (storeErr) {
    log("store").error(
      { ...errorFields(storeErr), slug },
      `could not record a claims run for ${slug}`,
    );
    captureFailure(storeErr, { route: "referee-claims", phase: "record-result", slug });
  } finally {
    res.end();
  }
}

/* ----------------------------------------------- referee mirror (stage 5b) --
   The model reads the referee's own comments and remarks on them. It is never
   given the article, so "it says nothing about the paper" is true of the input
   rather than merely asked of the prompt.
   docs/plans/260831an-referee-mode-for-peer-reviewers.md § 3, and
   src/referee-mirror.ts, which is the whole of the thinking. */

/**
 * Read the referee's own comments back to them, a run at a time.
 *
 * `POST /api/referee/mirror/:slug`, **no body**, SSE out.
 *
 * ## Why there is nothing to send and nothing to store
 *
 * The request carries no fields at all, and that is the design rather than an
 * omission. Everything this run is about is already ours: the comments are in
 * the comment store, the criteria are in the criteria store, and the passages
 * come off the article. A body that named any of them would let a stale tab —
 * or a tampered client — ask the model to remark on a comment the referee never
 * made, which is the same rule `markOneAnswer` above states about the quiz's
 * reference answers.
 *
 * And nothing is written. There is no `pending` row, no attempt and no result:
 * a remark is a prompt to look at your own sentence again, not an artefact, and
 * a reload asking for one again is a referee asking again. `markOneAnswer` made
 * the same call for the same reason.
 *
 * ## The frames, and what a `delta` deliberately does not carry
 *
 * Zero or more `delta`, then **exactly one terminal frame** — `done` on
 * success, `error` on anything else. A body that ends with neither is a failure
 * and the client says so (src/web/useMirror.ts), because a stream can end by
 * simply stopping and that looks exactly like finishing.
 *
 * **A `delta` carries a character count and not the characters.** What
 * `mirrorStream` yields is the raw JSON object as it arrives — unparsed and
 * unvalidated, which is to say a `misunderstanding` whose quoted passage has
 * not yet been checked against the block it claims to come from. Every promise
 * Mirror makes about a remark is made by `validateRemarks` *after* the stream
 * closes, so there is nothing here a panel could honestly show. The count is
 * enough for the one thing streaming buys a run with no incremental extractor
 * behind it: the referee can tell the model is answering from the moment it
 * starts, rather than watching a spinner for eight seconds and hoping.
 *
 * ## An empty answer is the ordinary answer
 *
 * Most comments should produce no remark, and `mirrorStream` returns a `done`
 * with an empty list without paying for a call at all when nothing was worth
 * sending. Nothing here may treat either as a failure — see `MirrorResult`.
 */
async function runMirror(slug: string, res: ServerResponse): Promise<void> {
  /* All three reads before a header goes out, so a slug that is not an article
     is a clean 404 rather than an `error` frame on a stream whose status the
     client has already had to accept as 200. The rule `runRefereeCriterion`
     above and `markOneAnswer` before it both keep. */
  const article = await loadArticle(slug);
  /* The store's own list, **not** `sweepOrphaned`: that repairs rows and this
     is a read. A comment whose block has gone is counted by `mirrorInput` as an
     orphan and withheld from the model, which is the honest handling of it
     here — the check is the comment against its passage, and there is no
     passage. */
  const comments = await commentStore.load(slug);
  /* The criteria as words, because that is all a coverage remark can be matched
     against. The id travels too, so a placement the referee made against a
     criterion can be named in the panel. */
  const criteria = (await refereeCriteriaStore.load(slug)).map((c) => ({
    id: c.id,
    text: c.criterion,
  }));

  const { frame } = sse(res);
  let chars = 0;
  try {
    for await (const event of mirrorStream({ blocks: article.blocks, comments, criteria, slug })) {
      if (event.type === "delta") {
        chars += event.text.length;
        frame("delta", { chars });
        continue;
      }
      const { type: _type, ...result } = event;
      frame("done", result);
    }
  } catch (err) {
    /* **Reported here or nowhere.** Once `sse(res)` has sent the headers this
       function owns the response and the outer catch never sees the error —
       the same reasoning as `answer`, `markOneAnswer` and `streamChat`. */
    captureFailure(err, { route: "referee-mirror", slug });
    /* No partial text travels with it, unlike the quiz's. Half of a JSON
       object is not half of an answer: nothing in it has been checked, and a
       remark whose pointers have not been verified is exactly the
       confident-looking claim about a sentence nobody wrote that this whole
       module is arranged against. */
    frame("error", { error: (err as Error).message });
  } finally {
    res.end();
  }
}

/* ------------------------------------------------ reading the path apart --
   TWO functions, and picking the wrong one is a path traversal.

   `part` for a capture that is only ever an *identifier* — a comment id, a job
   id. Those are looked up in a list or a map; nothing joins them onto a path.

   `slugPart` for every capture that becomes a **directory name**. That is
   `:slug` on /api/article, /api/metadata, /api/tweets, /api/glossary,
   /api/ideas and /api/comments.

   The next person to add a route will copy whichever line they happen to read
   first, so the rule is written here rather than left to be inferred: **if the
   value reaches the filesystem, it goes through `slugPart`.** */

/**
 * One capture group of a route match, URL-decoded.
 *
 * No group in the patterns below is optional, so the `?? ""` never fires — it
 * is there because a regex match types every group as possibly absent, and an
 * empty value would 404 rather than reach a lookup as "undefined".
 *
 * **Not for anything that becomes a path.** See `slugPart`.
 */
function part(m: RegExpExecArray, group: number): string {
  return decodeURIComponent(m[group] ?? "");
}

/**
 * The same, validated as a slug — **the fix for a real path traversal**.
 *
 * The route patterns allow `%` and `.`, and `part` percent-decodes. So
 * `/api/article/..%2F..%2F…` arrived at `loadArticle` as `../../…`, and
 * `path.join(ROOT, "data", slug)` normalises those segments straight out of the
 * repo. Demonstrated on 2026-08-25 by planting a `blocks.json` under `/tmp` and
 * reading it back through the endpoint: HTTP 200, with the planted text in the
 * body.
 *
 * **The thing that made it survive review is how a shallow attempt failed.**
 * `../../etc` finds no `blocks.json`, and `candidateDirs` used to fall through
 * to `example/` and serve the fixture — which looks exactly like a refusal. You
 * had to traverse all the way to a directory you control before anything
 * differed, and a test that stopped short reported the endpoint safe. Textbook
 * docs/reusable/silent-success.md, and it is why this is written up in
 * docs/project/security.md rather than filed as a bug fix.
 *
 * That fallback is gone as of stage 1a: `candidateDirs` offered
 * `example/` for the fixture's own slug and for nothing else, so a slug with no
 * artefacts now answers 404 whether it is a typo or a traversal. The history
 * stays here because it is the reason this route validates the slug rather than
 * trusting the filesystem to refuse.
 *
 * The knowledge was already in this file. `parseJobRequest` validates its slug
 * and says why: *"it is joined onto `data/` and `output/`, so an unchecked one
 * is a path traversal."* It just never reached the read routes.
 *
 * 400 rather than 404: the request is malformed, and saying "not found" would
 * send whoever sent it looking for a missing article.
 */
function slugPart(m: RegExpExecArray, group: number): string {
  const value = part(m, group);
  if (!isSlug(value)) throw httpError(400, `Not a slug: ${JSON.stringify(value)}`);
  return value;
}

/**
 * The most passages one search will return.
 *
 * A cap, and the response says when it bit. A list that is silently cut reads
 * as "that is everything", which is the failure mode this repo keeps writing
 * up (docs/reusable/silent-success.md).
 */
const MAX_LIBRARY_HITS = 30;

/**
 * `GET /api/library/search?q=…&limit=…` — every article at once.
 *
 * The query is read from the URL rather than a body because this is a read, and
 * a read that cannot be linked to or retried is a read that has given something
 * up for nothing.
 *
 * **Nothing here logs `q`.** It is what the reader typed, which is as much their
 * own text as a comment is — and `redact` in src/log.ts matches key names, not
 * values, so the only thing keeping it out of the log is not putting it in. The
 * `finally` in `handleApi` logs `path`, which is already stripped of its query
 * string for exactly this reason. See docs/project/logging.md.
 */
async function searchTheLibrary(params: URLSearchParams): Promise<LibrarySearchResponse> {
  const query = params.get("q") ?? "";

  const asked = Number(params.get("limit") ?? MAX_LIBRARY_HITS);
  /* Clamped rather than refused. A limit is a hint from a client we wrote, and
     a 400 here would be a broken search box rather than a corrected one — but
     an unbounded one is a client asking the server to read every paragraph it
     owns. `Number.isFinite` catches `?limit=abc`, which is `NaN`, which passes
     every comparison you would write instead. */
  const limit = Number.isFinite(asked) ? Math.min(Math.max(Math.trunc(asked), 1), MAX_LIBRARY_HITS) : MAX_LIBRARY_HITS;

  const { hits, capped } = await librarySearch.searchLibrary(query, limit);
  return {
    // Echoed so a client can drop a response that arrived after it moved on.
    // Debounced typing produces out-of-order responses as a matter of course.
    query,
    hits,
    articles: new Set(hits.map((h) => h.slug)).size,
    capped,
  };
}

/**
 * `PATCH /api/library/:slug` — archive it, put it back, rename it, or say why
 * you're reading it.
 *
 * One route for all three because they are one act from the reader's side:
 * they edited the shelf record. Sending none of the accepted fields is
 * refused rather than treated as a no-op — a PATCH with nothing in it is a
 * client bug, and answering 200 would hide it.
 *
 * `title: null` and `purpose: null` are both meaningful and NOT the same as
 * omitting the key: `title: null` clears the reader's override and restores
 * whatever the extractor last found; `purpose: null` clears "why you're
 * reading this one" (docs/plans/260826t-reader-profile.md). So this tests `in`, not
 * truthiness.
 *
 * **Everything is validated before anything is written, and the write is one
 * call.** An earlier version validated and wrote each field in turn, so
 * `{ title: "Changed", archived: "no" }` renamed the article and then answered
 * 400 — a request that reports failure and changes your data, which is the
 * worst available combination. Caught by a cross-family review, 2026-08-26.
 * `ShelfStore.patch` exists so that every field lands in one serialised file
 * edit or one `UPDATE`, rather than as separate writes a reader can land
 * between.
 */
async function patchShelf(
  slug: string,
  body: unknown,
): Promise<{ entry: LibraryEntry; purpose: string | null }> {
  /* A JSON body that is not an object at all — `"hello"`, `42`, `null` — must
     be a 400 rather than a 500. `in` throws on a primitive, so this cannot be
     folded into the checks below. */
  const patch = objectBody(body);
  const hasArchived = "archived" in patch;
  const hasTitle = "title" in patch;
  const hasPurpose = "purpose" in patch;
  if (!hasArchived && !hasTitle && !hasPurpose) {
    throw httpError(400, "Nothing to change: expected archived, title, purpose, or some of them");
  }

  const change: { archived?: boolean; title?: string | null; purpose?: string | null } = {};

  if (hasTitle) {
    const title = patch.title;
    if (title !== null && typeof title !== "string") {
      throw httpError(400, "title must be a string or null");
    }
    change.title = title;
  }
  if (hasPurpose) {
    const purpose = patch.purpose;
    if (purpose !== null && typeof purpose !== "string") {
      throw httpError(400, "purpose must be a string or null");
    }
    change.purpose = purpose;
  }
  if (hasArchived) {
    const archived = patch.archived;
    // Not truthiness: `"false"` is the shape a hand-written client produces,
    // and treating it as true would archive an article somebody was un-archiving.
    if (typeof archived !== "boolean") throw httpError(400, "archived must be true or false");
    change.archived = archived;
  }

  const entry = await shelfStore.patch(slug, change);
  /* **`purpose` is answered beside the entry, not on it.** `LibraryEntry` is the
     shelf card, and it already refuses to carry the superseded title for the
     reason that a string nothing renders should not be on the wire for every
     card on the homepage. The reader's note about why they are reading one
     article is that argument one field further on: only the metadata page shows
     it, and putting it on the card would send it with all thirty.

     But the caller does need it back, and needs it as the *store* holds it
     rather than as they sent it — the value is trimmed and its line endings
     settled on the way in, and a box showing one string while every prompt
     carries another is the failure this whole feature is arranged around. So
     one extra read, on a write, on this route only. */
  const { purpose } = await shelfStore.read(slug);
  return { entry, purpose: purpose ?? null };
}

/**
 * Turn a POST body into a job request, or explain what was wrong with it.
 *
 * Two shapes, and they are **mutually exclusive**. `{ url }` means "add this
 * article", and the slug is derived rather than accepted — the client shows the
 * same derivation (src/ingest.ts) so the two agree by construction rather than
 * by trust. `{ slug, steps }` means "run these stages on the article I already
 * have", which is how a re-run after a prompt change and a refresh from source
 * are both expressed. Sending both is refused; see the note below for what that
 * combination used to let you do.
 *
 * The slug is validated even in the second shape, and especially there: it is
 * joined onto `data/` and `output/`, so an unchecked one is a path traversal.
 */
/**
 * A request naming an upload names **nothing else**, and this throws if it does.
 *
 * `{ url, uploadId }` and `{ slug, uploadId }` are both requests whose author
 * believed something false about what they were asking for, and the second is
 * the shape that would have been dangerous: an upload's bytes written into an
 * article the caller named. There is no honest reason to send two origins, so
 * there is deliberately no precedence rule — and therefore none to get wrong
 * later.
 *
 * Asserting the id's shape here too, so that the two checks a caller has to
 * pass are in one place rather than one here and one three lines down.
 */
function checkUploadOrigin(
  uploadId: unknown,
  others: { url: unknown; slug: unknown; steps: unknown; force: unknown },
): asserts uploadId is string {
  if (others.url !== undefined || others.slug !== undefined) {
    throw httpError(400, "Send a url, a slug, or an uploadId — not two of them");
  }
  /* **And no step controls either**, which is not tidiness. Claiming happens
     before `enqueue` validates anything, so `{ uploadId, steps: [] }` takes the
     one-and-only claim and *then* gets a 400 for having no steps — leaving an
     attempt stuck `claimed` with no job and no way to reach it. `steps:
     ["arc"]` is worse: it claims, skips acquisition entirely, and runs a model
     stage over an article that does not exist. An upload is always the default
     ingest, which is what the documented `{ uploadId }` shape already said.
     GPT Sol, 2026-08-27. */
  for (const [name, value] of [
    ["steps", others.steps],
    ["force", others.force],
  ] as const) {
    if (value !== undefined) {
      throw httpError(400, `An upload runs the default steps — ${name} is not accepted with one`);
    }
  }
  if (!isUploadId(uploadId)) throw httpError(400, "That is not an upload id");
}

/**
 * The body of `PUT /api/article/:slug/visibility`, or a 400.
 *
 * Two shapes, and nothing else is accepted:
 *
 *     { "visibility": "public", "rightsConfirmed": true }
 *     { "visibility": "private" }
 *
 * **Extra keys are refused**, which is not fussiness. This endpoint decides
 * whether a third party's full text is served from our origin, and the failure
 * mode it has to be closed against is a client sending a field this server has
 * never heard of and believing it took — the shape
 * docs/reusable/silent-success.md keeps writing up, and the one a 200 is
 * especially good at hiding (an API that ignores unknown request keys answers
 * 200 to a request it did not honour).
 *
 * **`rightsConfirmed` is not accepted on an unpublish**, and that is a real
 * rule rather than symmetry. Nobody is asked to confirm anything to take a
 * document *down*, so accepting it would write a `true` into
 * `article_visibility_changes` for an act about which nobody confirmed
 * anything — and that column is precisely the one a rights complaint would ask
 * about. docs/plans/260827ai-public-read-only-access.md § Rights and takedown.
 *
 * **`=== true`, not truthiness.** `rightsConfirmed: "yes"` and
 * `rightsConfirmed: 1` are shapes a hand-written client produces, and reading
 * either as a confirmation would record a confirmation nobody gave.
 */
export function parseVisibilityRequest(body: unknown): {
  visibility: Visibility;
  rightsConfirmed: boolean;
} {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw httpError(400, "Expected an object with a visibility");
  }
  const { visibility, rightsConfirmed, ...rest } = body as Record<string, unknown>;
  const extra = Object.keys(rest);
  if (extra.length) {
    /* The key names are ours only in the sense that the client chose them, so
       they are NOT interpolated: every `httpError` message in this file is
       written to a log, and redaction matches key paths rather than text. */
    throw httpError(400, "That request had fields this endpoint does not accept");
  }
  if (visibility !== "private" && visibility !== "public") {
    throw httpError(400, 'visibility must be "private" or "public"');
  }
  if (visibility === "private") {
    if (rightsConfirmed !== undefined) {
      throw httpError(400, "rightsConfirmed is only for sharing, not for unsharing");
    }
    return { visibility, rightsConfirmed: false };
  }
  if (rightsConfirmed !== true) {
    throw httpError(400, "Sharing needs rightsConfirmed: true");
  }
  return { visibility, rightsConfirmed: true };
}

export function parseJobRequest(body: unknown): {
  slug: string;
  url?: string;
  steps?: StepName[];
  force?: StepName[];
  /**
   * Whether this run should use the reader's profile. Default true.
   *
   * A boolean rather than the profile itself, because **the caller must not get
   * to say who the reader is.** The text is resolved server-side from the
   * store, by `resolveProfile` below; all a client may do is decline it. Any
   * other arrangement would make "who is reading" a request parameter, which is
   * a way to spend tokens on a string of your choosing and a way to put
   * arbitrary text into a prompt that writes an artefact.
   */
  useProfile?: boolean;
  /**
   * An upload to make an article from, instead of a URL.
   *
   * **Only the id.** The filename, the size and the claimed hash all live on
   * the record we wrote when we minted the grant, and the object key is derived
   * from the id by `stagingKey` — so there is nothing here for a caller to
   * point at somebody else's bytes with. That is the rule the plan calls
   * load-bearing: *never accept a client-supplied object path*.
   */
  uploadId?: string;
} {
  const { url, slug, steps, force, useProfile, uploadId } = (body ?? {}) as Record<
    string,
    unknown
  >;

  const stepList = (value: unknown, field: string): StepName[] | undefined => {
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || !value.every(isStepName)) {
      throw httpError(400, `${field} must be an array of step names`);
    }
    return value;
  };
  const parsedSteps = stepList(steps, "steps");
  const parsedForce = stepList(force, "force");
  /* Absent means yes. Not truthiness on the raw value: `useProfile: "false"` is
     the shape a hand-written client produces, and reading it as true would
     write a profiled artefact for somebody who asked for a plain one — the same
     trap `archived` names two hundred lines up. */
  if (useProfile !== undefined && typeof useProfile !== "boolean") {
    throw httpError(400, "useProfile must be true or false");
  }
  const parsedUseProfile = useProfile;

  /* The three optional fields, spelled once. They were written out at each of
     the three `return`s, which is three chances for one of them to be quietly
     dropped from a branch — and `exactOptionalPropertyTypes` means the spread
     has to be conditional rather than `steps: parsedSteps`, so each one is four
     lines rather than one.

     **A `guidance` field used to be a fourth, and is now ignored rather than
     refused.** The summary steer it fed is gone
     (docs/plans/260830o-steer-becomes-the-profile.md), and so is the stage it steered
     (docs/plans/260831s-gist-only-summaries.md); an old tab still sending one should
     get its job run rather than a 400 about a box it can still see. Nothing
     reads it. */
  const rest = {
    ...(parsedSteps ? { steps: parsedSteps } : {}),
    ...(parsedForce ? { force: parsedForce } : {}),
    ...(parsedUseProfile !== undefined ? { useProfile: parsedUseProfile } : {}),
  };

  /* Before the URL branch. `checkUploadOrigin` refuses every combination rather
     than picking a winner — see its own note. */
  if (uploadId !== undefined) {
    checkUploadOrigin(uploadId, { url, slug, steps, force });
    return {
      /* A placeholder the caller must replace. The real slug comes from the
         upload record's filename and is allocated inside `enqueue`, which is
         the only place with no gap between deciding and inserting. */
      slug: "",
      uploadId,
      ...rest,
    };
  }

  if (typeof url === "string" && url.trim() !== "") {
    // **The slug is derived, never accepted.** It used to fall back to a
    // caller-supplied one, which quietly made this the most dangerous shape in
    // the API: `{ url: "https://a.example/x", slug: "an-article-i-already-have",
    // force: ["fetch"] }` pointed a full refresh at somebody else's article and
    // overwrote it, from a request that looked like an ordinary add. The slug
    // was path-safe, so nothing complained. Refuse the combination outright —
    // there is no honest reason to send both.
    if (slug !== undefined) {
      throw httpError(400, "Send a url or a slug, not both — the slug comes from the url");
    }
    /* Normalised before anything else looks at it, so the URL that is fetched,
       the URL stored in meta.json and the URL `freeSlug` compares against the
       shelf are one string rather than three spellings of one. See
       `normaliseUrl` in src/ingest.ts. */
    const source = normaliseUrl(url);
    const derived = slugFromUrl(source);
    if (!isSlug(derived)) {
      // **Not the URL.** This message is logged — `logRequest` writes an
      // `httpError`'s message as `reason`, because an error that named its own
      // status is one this file chose to raise. So it is published, not just
      // said, and a source URL is untrusted input: it can carry basic-auth
      // credentials or a `?token=`. Interpolating it here would have undone the
      // query-string strip in `handleApi` below — `path` cleaned, and then the
      // whole raw URL back in through the side door. Nothing is lost by leaving
      // it out, because the caller is the one who sent it.
      throw httpError(400, "Could not make a slug from that url");
    }
    return {
      slug: derived,
      url: source,
      ...rest,
    };
  }

  if (!isSlug(slug)) {
    throw httpError(400, "Expected { url } or { slug }");
  }
  return {
    slug,
    ...rest,
  };
}

/* ------------------------------------------------------------- uploads --
   docs/plans/260826u-pdf-upload-and-storage.md. Three small handlers, and between them
   they move no file bytes at all — which is the entire design. Everything this
   server handles is a few hundred bytes of JSON, so the 4.5 MB Vercel body
   limit never applies to anything on the critical path and `MAX_BODY_BYTES`
   above stays exactly as it is.
   ------------------------------------------------------------------------- */

/** What the browser claims about the file it is about to send. All three are checked. */
function parseUploadRequest(body: unknown): { filename: string; bytes: number; sha256: string } {
  const { filename, bytes, sha256 } = (body ?? {}) as Record<string, unknown>;
  if (typeof filename !== "string" || filename.trim() === "") {
    throw httpError(400, "An upload needs a filename");
  }
  /* A whole number of bytes, and a positive one. `Number.isSafeInteger` rather
     than `typeof === "number"` because `1e21`, `NaN` and `1.5` all pass that
     and none of them is a file size — and the cap comparison below would wave
     `NaN` straight through, since every comparison with it is false. */
  if (!Number.isSafeInteger(bytes) || (bytes as number) <= 0) {
    throw httpError(400, "An upload needs its size in bytes");
  }
  if (typeof sha256 !== "string" || !/^[0-9a-f]{64}$/.test(sha256)) {
    throw httpError(400, "An upload needs a lower-case hex SHA-256 of its contents");
  }
  return { filename, bytes: bytes as number, sha256 };
}

/**
 * `POST /api/uploads` — a place to put a file, and permission to put it there.
 *
 * The checks here are **the cheap ones, and deliberately the same ones the file
 * picker already ran** (`uploadProblem`, src/uploads.ts, imported by both). A
 * browser refusing a file the server would have taken is a confusing bug; the
 * other way round is a reader watching 50 MB upload and then being told no.
 *
 * What it cannot check is what is actually in the file, because the file has
 * not been sent yet. That is the acquisition step's job, over the bytes, and
 * nothing here should ever be mistaken for it.
 */
async function mintAnUpload(body: unknown): Promise<{
  uploadId: string;
  url: string;
  expiresAt: string;
  slug: string;
}> {
  const grants = uploadGrants();
  /* 503 rather than 500: the request was fine and the server is not broken, it
     simply has not got the thing this needs. The sentence says which. */
  if (!grants) throw httpError(503, UPLOAD_UNAVAILABLE.message);
  /* **The other half of "not switched on here", and it is a harder one to
     admit.** Storage is configured and grants would mint perfectly; what will
     not work is the *next* request finding the record this one writes, because
     a serverless function's filesystem is neither durable nor shared. Refused
     here rather than discovered as a 404 three minutes into an 11 MB upload.
     See `recordsSurviveTheRequest`. */
  if (!recordsSurviveTheRequest()) throw httpError(503, UPLOAD_UNAVAILABLE.message);

  /* Resolved **after** the two guards above, not passed in by the dispatcher.
     `currentOwnerId()` throws on a production host with no owner configured, and
     as an argument it was evaluated before this function ran at all — so an
     installation that cannot take uploads answered 500 about an owner rather
     than 503 about uploads. Caught by the test that pins the 503. */
  const owner = currentOwnerId();
  const claim = parseUploadRequest(body);
  /* **`type: ""`, not `"application/pdf"`.** The browser's MIME guess does not
     cross the wire and we must not supply one on its behalf: writing the answer
     we want into the input makes `looksLikePdf` return true for `notes.txt`,
     because it accepts *either* the type or the name and the type was ours. The
     empty string is what `uploadProblem` documents as "no guess, and that is
     not a refusal", so the name is what decides here — which is all the server
     has to go on before the bytes arrive. Caught by the test below it. */
  const wrong = uploadProblem({ name: claim.filename, type: "", size: claim.bytes });
  if (wrong) throw httpError(413, wrong);

  /* **Asks, and takes nothing.** An account at its ceiling is told at the door
     rather than after transferring 11 MB — the same reason `uploadProblem` runs
     up here. The gate that actually decides is `POST /api/jobs`, which is
     serialised per owner; this one is allowed to be a moment out of date. */
  await refuseUploadWithoutQuota(owner);

  const minted = await mintUpload({ ...claim, owner }, (key) => grants.sign(key), stagingKey);
  return {
    uploadId: minted.record.id,
    url: minted.url,
    expiresAt: minted.expiresAt,
    /* The slug this *will* get, if nothing else has taken it — a preview, for
       the same reason the add box previews one for a URL. `enqueue` decides for
       real, and may add a number; the job card shows what it decided. */
    slug: slugFromFilename(minted.record.filename) || "document",
  };
}

/**
 * An upload record as a client may see it. Our hash is included; the claimed one
 * is not.
 *
 * `arrived` is **not** on the record — it is asked of Storage by the caller and
 * passed in, because the record has no idea. It is what a page waiting on
 * another tab's transfer polls: reload `/add/upload/<id>` mid-upload and the
 * page that comes back holds no `File` and no XHR, so watching for the object is
 * the only way it can know when the ingest may be queued. Without it that page
 * would have to poll by re-POSTing `/api/jobs`, which is a mutation on a loop.
 */
function publicUpload(record: UploadRecord, arrived: boolean): Record<string, unknown> {
  return {
    uploadId: record.id,
    arrived,
    filename: record.filename,
    status: record.status,
    ...(record.sha256 ? { sha256: record.sha256 } : {}),
    ...(record.bytes !== undefined ? { bytes: record.bytes } : {}),
    ...(record.reason ? { reason: record.reason } : {}),
    ...(record.slug ? { slug: record.slug } : {}),
  };
}

/**
 * **Have the bytes actually arrived?** The readiness gate.
 *
 * Asked of Storage, before anything is claimed, enqueued or reserved. Until
 * 2026-09-03 nobody had to ask: `/add/upload/<id>` did not exist until the last
 * byte had landed, because the shelf navigated only after the transfer resolved.
 * The reader now gets that address at byte **zero** so they can walk away from
 * the upload (docs/plans/260903j-background-pdf-upload-so-add-does-not-wait.md),
 * and three ordinary gestures then queue a job over a file that is not there:
 * reload the page, open the address in a second tab, or press Stop and reload.
 * `acquireUpload` answers each of those with `refuse("missing")`, which is
 * **terminal** — so the reader's own reload destroyed their upload.
 *
 * ## Why the object rather than a `ready` column
 *
 * A column would need a writer, and the only candidate is the browser saying
 * *I have finished* — which is a claim by the party we are checking up on, and a
 * second source of truth that can disagree with the bucket. The object is the
 * fact itself, and it cannot drift from itself.
 *
 * **And a `head` is a true test of a *completed* upload, not a proxy for one.**
 * Measured against the local Supabase stack on 2026-09-03: a PUT aborted at
 * 320 KB of 5 MB leaves **no object at all**, and re-PUTting the same grant then
 * succeeds. There is no half-written object for this to mistake for a whole one,
 * because the write is not resumable. The table is in the plan.
 *
 * `head` answers `null` for absent and **throws for everything else** — a
 * Storage 503 read as "absent" would turn an outage into "your file never
 * arrived", which is the lie a reader acts on by uploading 11 MB again
 * (`RawSourceStore.head`, src/store/blobs.ts). So a bad day here is a 500, not a
 * refusal.
 */
async function uploadHasArrived(uploadId: string): Promise<boolean> {
  return (await blobStore().head(stagingKey(uploadId))) !== null;
}

/**
 * The job or article this upload already became, **without spending a slot**.
 *
 * Split out of `queueAnUpload` on 2026-09-03 for one reason, and it is a
 * question of ordering rather than of tidiness: `withIngestSlot` wraps that
 * function, and `admitIngest` **throws 402 before the callback runs**
 * (src/billing/admission.ts). So a reader with one slot left who reloads
 * `/add/upload/<id>` — or whose second tab posts alongside the first — could be
 * refused for having no allowance, when the correct answer was the job their
 * first request already made. The refusal was about a slot nobody needed.
 * GPT Sol, 2026-09-03, reviewing the plan for the background upload.
 *
 * `null` means *nothing yet*, which is the only case that goes on to admission.
 *
 * It reads the record's status rather than trying the claim, because trying the
 * claim is what takes it. Two genuinely fresh requests both see `pending` here
 * and both go on; `claimUpload` still decides between them, and the loser
 * recovers inside `queueAnUpload` exactly as it always did. This removes the
 * **common** repeat from the admission path, not the race.
 */
async function resolveExistingUpload(uploadId: string): Promise<UploadOutcome | null> {
  const owner = currentOwnerId();
  const record = await readUpload(uploadId, owner);
  /* **Here rather than in `queueAnUpload`**, so that an id belonging to nobody
     is a 404 before a slot is reserved for it, too. */
  if (!record) throw httpError(404, "No such upload");
  if (record.status === "pending") return null;
  /* **Stopped by the reader, or its grant swept.** `cancelUpload` puts a record
     here, so this is the answer to *I pressed Stop and then reloaded the
     address*. It has to come before the job lookup: an `expired` upload has no
     job and no slug, and without this it fell through to *"already being turned
     into an article"*, which is the opposite of what happened. */
  if (record.status === "expired") throw httpError(410, UPLOAD_MISSING.message);

  const already = await jobForUpload(uploadId);
  if (already) return { kind: "job", job: already };
  /* Retention has taken the job and the record still names the article — the
     case `queueAnUpload` documents at length below. Re-read there rather than
     reusing `record`, because `noteSlug` lands after `enqueue` returns. */
  const fresh = await readUpload(uploadId, owner);
  if (fresh?.slug) return { kind: "article", slug: fresh.slug };
  /* Claimed, no job, no slug: `enqueue` threw between the claim and `noteSlug`.
     Unrecoverable, and pre-existing — see the plan's last stage. */
  throw httpError(409, "That upload is already being turned into an article.");
}

/**
 * `POST /api/jobs { uploadId }` — take ownership of an upload and queue it.
 *
 * **Called only for an upload that is `pending` and whose bytes are there** —
 * `resolveExistingUpload` and `uploadHasArrived` run in front of it, outside the
 * quota slot. What is left here is the fresh case and the race.
 *
 * The order is the whole of it: **claim, then enqueue.** Claiming is a
 * create-only file, so two tabs racing produce one winner and one `taken`; if
 * enqueueing then throws, the upload is stuck `claimed` and the reader chooses
 * the file again, which is cheap and correct. Enqueue-then-claim would be the
 * other way round — two jobs, two articles, two transcriptions paid for.
 *
 * A repeat of the *same* request is not a race, though, and must not read like
 * one. A double-clicked button, or a reload of `/add/upload/<id>`, arrives
 * after the claim has been taken by the first one — so `taken` looks for the
 * article that claim produced and hands back its job. Only a claim with nothing
 * to show for it is an error.
 */
async function queueAnUpload(uploadId: string, slot: IngestSlot): Promise<UploadOutcome> {
  const owner = currentOwnerId();
  /* **`arrived`, because the route has just looked.** `uploadHasArrived` ran a
     `head` on the staging key immediately above this call, so the question the
     grant's expiry stands in for — *did the bytes ever come?* — has been
     answered from the authoritative place. Suppressing the expiry refusal is
     what stops a reader who upgrades after a late quota 402, or whose PUT
     started inside the two hours and finished outside them, being told their
     file expired while we are holding it. `UploadStore.claim` has the rest. */
  const claim = await claimUpload(uploadId, { owner, arrived: true });
  if (!claim.ok) {
    /* **`unknown` is a 404, and it used to be a 409.** The `readUpload` that
       answered it moved out to `resolveExistingUpload`, and without this line
       a vanished record fell through the `taken` branch to "already being
       turned into an article" — a sentence about a record that is not there.
       Not reachable through the route, which resolves first; reachable by
       anything that calls this directly, which is what makes it worth stating. */
    if (claim.why === "unknown") throw httpError(404, "No such upload");
    if (claim.why === "expired") throw httpError(410, UPLOAD_MISSING.message);
    /* `taken`. If the first claim got as far as a job, that job is the answer —
       this is the same request arriving twice, not a conflict. **Reached only
       by the genuine race now** — two fresh requests that both saw `pending`
       before either claimed — because `resolveExistingUpload` answers the
       common repeat before a slot is ever reserved. */
    const already = await jobForUpload(uploadId);
    if (already) return { kind: "job", job: already };
    /**
     * **And when the job has gone, the upload record still knows.**
     *
     * Finished jobs are trimmed to fifty per reader (`KEEP_FINISHED`,
     * src/jobs.ts), and modes are jobs now — a glossary, a set of ideas and a
     * quiz are three more rows on one article — so fifty is a fortnight of
     * ordinary use rather than a year of it. After that the upload is still
     * `claimed`, the article is still on the shelf, and this answered *"That
     * upload is already being turned into an article"* about an article the
     * reader had finished reading. GPT Sol, reviewing the built stage 1,
     * finding 5.
     *
     * **Answered from the record rather than by keeping the job alive**, and
     * that is the choice worth writing down. Sparing an upload's job from
     * retention only covers the ingests that never completed: a *successful*
     * import's job is trimmed like any other success, and that is the case a
     * reader actually comes back to. What is durable here is the **article**,
     * and the upload record has named it since the moment `enqueue` returned —
     * upload records are never trimmed by count, so the record outlives the job
     * by design. (This used to add "swept on their grant", which was simply
     * false: `sweepable` in src/source.ts has no production caller and nothing
     * deletes an upload record or its staging object. Nothing here depends on
     * the sweep; the claim was wrong rather than load-bearing.)
     *
     * Re-read rather than reusing `record` above: `noteSlug` lands after
     * `enqueue` returns, so a second request arriving in that window would
     * otherwise read a record from before the slug was written.
     */
    const fresh = await readUpload(uploadId, owner);
    if (fresh?.slug) return { kind: "article", slug: fresh.slug };
    /* A claim with nothing at all to show for it: `enqueue` threw between the
       claim and `noteSlug`. The reader chooses the file again, which is cheap
       and correct. */
    throw httpError(409, "That upload is already being turned into an article.");
  }

  const candidate = slugFromFilename(claim.record.filename) || "document";
  const job = await enqueue({
    slug: candidate,
    upload: { id: uploadId, filename: claim.record.filename },
    /* The quota slot, spread onto the request so it rides the job's own INSERT.
       Empty when nothing was reserved — src/billing/admission.ts. Every earlier
       exit from this function leaves without a job, and none of them has to do
       anything about the slot: the caller releases on every path, and the
       ledger's own `not exists` is what decides whether that frees anything. */
    ...slot,
  });
  /* **Immediately**, so that `GET /api/uploads/:id` can say which article this
     file became rather than only which one it might.

     It used to be written by the acquisition step, on success — so a reload of
     `/add/upload/<id>` while the job was still queued behind another one found
     a claimed upload with no slug, could not find its job, and answered 409.
     Every reload, for ever, if acquisition never began. GPT Sol, 2026-08-27.
     The recovery no longer goes through this field — `jobForUpload` matches the
     upload id — but the record still had a hole in it, and the reader's own
     `/add/upload/<id>` page reads the slug from here. */
  await noteSlug(uploadId, job.slug);
  return { kind: "job", job };
}

/**
 * What `POST /api/jobs { uploadId }` resolves to.
 *
 * Two answers rather than one, because after retention there is a true thing to
 * say that is not a job: *this file is already that article*. The alternative
 * was to invent a job record to say it with, which is a lie about what the
 * store holds, or to keep answering 409, which is a lie about what happened.
 *
 * `article` rather than `slug` on the wire, so the two bodies cannot be
 * confused: a `publicJob` carries a `slug` of its own.
 */
type UploadOutcome = { kind: "job"; job: Job } | { kind: "article"; slug: string };

/**
 * The job this upload became, whatever state it is in. For the repeat-claim
 * case above.
 *
 * **It matches the upload id, which is the thing it actually means.** It asked
 * `j.slug === record.slug` until 2026-09-02, over **every** status, and that
 * was two guesses at once. An article holds a *line* of jobs now, so a reload
 * of `/add/upload/<id>` could be handed whichever mode job on that article
 * happened to sort first — a glossary run, presented to the reader as their
 * import. And it depended on `noteSlug` having landed, where the upload id is
 * on the job record from the moment `enqueue` returns.
 *
 * **Every status, deliberately.** The reader reloading `/add/upload/<id>` after
 * their ingest has finished — or failed — must be shown *that* job, not a 409,
 * and narrowing this to the active statuses would take that away again a minute
 * after each import ends.
 *
 * It is not the *whole* of the recovery, though it was described that way until
 * 2026-09-02: finished jobs are trimmed to fifty per reader, so this eventually
 * finds nothing however wide its statuses are. `queueAnUpload` above falls back
 * to the upload record for that.
 *
 * Newest first, because `listJobs` is (src/jobs.ts) and a retry of an upload
 * ingest is the more recent of the two rows.
 */
async function jobForUpload(uploadId: string): Promise<Job | null> {
  const all = await listJobs();
  return all.find((j) => j.upload?.id === uploadId) ?? null;
}

/**
 * An artefact, and whether the reader has changed since it was written.
 *
 * **In the route rather than in the store adapters**, and that placement is not
 * tidiness. Answering it needs the reader's current profile, which lives behind
 * `readerStore` in src/store/index.ts — and that module imports the filesystem
 * artefact reader, so a store adapter reaching back for it would be an import
 * cycle. The routes are already the layer that knows about both.
 *
 * It also keeps the adapters answering only questions about the article, which
 * is what they are for: `stale` and `outdated` are properties of the artefact
 * against the piece, and this one is a property of the artefact against the
 * person.
 *
 * ## It takes a thunk, and that is the whole design
 *
 * `resolveProfile` is two queries of its own and has nothing to do with the
 * artefact read. They used to run one after the other — the route awaited the
 * artefact, then called this, which then went to the database again — so a
 * reader waiting on a panel waited for both in series.
 *
 * A **thunk** rather than the value, and rather than a promise. A promise
 * parameter would make the overlap a caller convention: every route could go on
 * writing `const found = await loadGlossary(at)` and hand over an
 * already-settled promise, and a test of this function would still pass. GPT
 * Sol's fifth finding on docs/plans/260828c-library-read-latency.md. Taking the thunk
 * moves the responsibility in here, where it can be proved.
 *
 * ## Why not `Promise.all`, and why not `allSettled` either
 *
 * Three shapes were tried, and the two obvious ones are both wrong:
 *
 * - **`Promise.all`** rejects with whichever failed *first*, so a reader asking
 *   for an article that does not exist could be told about a profile failure
 *   instead of getting a 404. The error would name the wrong thing.
 * - **`Promise.allSettled`** picks the right error, but it waits for *both*
 *   before looking at either. A profile read that hangs would then hold up a
 *   404 that the serial version answered at once, and what the reader would see
 *   is a client or proxy timeout — a worse failure than the one it fixed. GPT
 *   Sol's first finding on the built code, 2026-08-28.
 *
 * So: start both, await the artefact, and await the profile only after the
 * artefact is in hand. A rejecting artefact throws at the first `await`, as it
 * always did, and the profile's own rejection still surfaces when the artefact
 * was fine — because a profile that could not be read is not the same as a
 * profile that has not changed, and reporting `profileChanged: false` for it
 * would be a silent wrong answer.
 *
 * The bare `.catch` is load-bearing rather than decorative. Without it, the
 * artefact-fails-and-profile-fails-too case throws before anything has ever
 * looked at the profile promise, and Node reports an unhandled rejection for a
 * failure we deliberately chose not to report.
 *
 * Starting `resolveProfile` for a slug that turns out not to exist is harmless:
 * its shelf read already catches, and the global half still counts.
 */
async function withProfileChanged<R extends { profileChanged: boolean }>(
  slug: string,
  load: () => Promise<Omit<R, "profileChanged">>,
  stampOf: (found: Omit<R, "profileChanged">) => { profileHash?: string | null },
  /**
   * Quotes may append after the reader deletes their profile while deliberately
   * keeping the first pass's profile stamp. For that artefact alone, deletion
   * must keep the "older profile" badge up; the shared rule for artefacts that
   * replace still treats deletion as no reason to rewrite them.
   */
  clearedCountsAsChanged = false,
): Promise<R> {
  /* Both started before either is awaited — that is the point of the thunk. */
  const artefact = load();
  const profile = resolveProfile(slug);
  /* Handled here so that throwing below cannot leave this one unhandled; the
     `await` further down is what actually reports it. */
  void profile.catch(() => {});

  const found = await artefact;
  const now = await profile;
  const recorded = stampOf(found).profileHash;
  const nowHash = now ? hashProfile(now) : null;
  return {
    ...found,
    profileChanged:
      profileIsStale(recorded, nowHash) ||
      (clearedCountsAsChanged && recorded != null && nowHash === null),
  } as R;
}

/**
 * A job as the client may see it — **without the reader's profile**.
 *
 * The frozen profile has to live on the job: that is what makes it survive a
 * restart and what stops a batched run split across two profiles
 * (`Job.profile`, src/types.ts). But the job record is also what
 * `GET /api/jobs` returns on **every poll**, every eight seconds, for the life
 * of the panel — and it is the reader's own description of themselves. There is
 * nothing on the client that renders it and no question it answers there.
 *
 * So it is stripped on the way out. Not a leak in the sense of crossing a trust
 * boundary — it is the reader's own text going back to the reader's own browser
 * — but `docs/project/logging.md`'s rule about the reader's prose is the same
 * instinct, and a field nothing renders should not be on the wire at all.
 * GPT Sol's review of the built code, 2026-08-26.
 *
 */
function publicJob(job: Job): Omit<Job, "profile" | "ownerId"> {
  /* `ownerId` goes too. The client never needs it — it can only ever be looking
     at its own jobs now — and an `auth.users` uuid on the wire is one more
     thing that has to not end up in a log, a bug report or a screenshot. */
  const { profile: _hidden, ownerId: _whose, ...rest } = job;
  return rest;
}

/**
 * Which model writes what — a read of the table in src/models.ts, nothing more.
 *
 * A route rather than an import, and that is the whole reason it exists. The
 * profile page wants to show this and **nothing under src/web/ may import a
 * server module** (tests/client-imports.test.ts): src/models.ts reads
 * `process.env`, so bundling it would ship configuration names to the browser
 * and put one more file on the allowlist's slippery slope. One tiny GET is
 * cheaper than that argument.
 *
 * Names, never keys. `TASK_TIER` and `STAGE_EFFORT` hold model ids and effort
 * levels, which are facts about how this server is configured and not secrets.
 * What is still deliberately absent: no environment **variable names**, no keys
 * and no provider ordering. `source` says an override happened; it does not say
 * which switch to flick.
 *
 * **Four fields where there used to be one, since 2026-08-27.** This returned
 * the raw wire id as `model`, and the page printed it — so seven rows said
 * `claude-sonnet-5` and three said `anthropic/claude-sonnet-5`, which is one
 * model wearing two names on a page whose whole job is to say which model
 * writes what. `model` is now the human name (`displayName`), `id` is the wire
 * id it was sent as, `provider` says which wire, and `source` says whether the
 * environment overrode the code. The client shows the name and puts the rest in
 * a title attribute; nothing is hidden, but nothing that is an addressing
 * detail gets to look like a difference in models.
 *
 * **And the paragraph above used to end by boasting that this route reads
 * nothing from `process.env` at all.** It was true and it was the bug: the
 * three request-path calls each read a `SPIDERYARN_*_MODEL` override, so with
 * one set this page named a model the server was not using while telling the
 * reader it showed "what the server is configured with". `resolveModel` and
 * `effortFor` are what it consults now, which are the same functions the calls
 * themselves consult. Found by a GPT-5.6-sol review, 2026-08-27.
 *
 * **The request-path list is no longer duplicated here.** It used to be
 * `task === "explain" || task === "chat" || task === "search"` on the next
 * line, a second copy of something src/models.ts already knows — and the copy
 * that decides what this page *claims*, which is the worst one to let drift.
 * `wireFor` and `modelFor` own it now (`providerFor` until 2026-08-27, when
 * the provider stopped being a thing that varies — src/models.ts).
 */
function modelsInUse(): { tasks: ModelReport[] } {
  const tasks = (Object.keys(TASK_TIER) as (keyof typeof TASK_TIER)[]).map((task) => {
    /* `effortFor`, not `STAGE_EFFORT`, for the same reason `resolveModel` reads
       the environment: `SPIDERYARN_PIPELINE_EFFORT` moves all four stages at
       once and is exactly what somebody running a comparison has set. Reading
       the raw table would have printed `high` beside a stage running at
       `medium`. */
    const effort = task in STAGE_EFFORT ? effortFor(task as ArticleStage) : undefined;
    const { id, provider, source } = resolveModel(task);
    return {
      task,
      model: displayName(id),
      id,
      provider,
      source,
      ...(effort ? { effort } : {}),
    };
  });
  /* **The two rows that are not `Task`s.** The PDF transcriber and the
     embedding model are on neither tier — deliberately, src/models.ts says why
     — so they are in no table this loop can read, and the page listed ten
     Claude rows while both of the app's calls to a model from somebody else
     went unmentioned. A page titled "what's running" that omits them is not
     wrong about any row; it is wrong about the set. They are also the rows that
     make the names on screen legibly different *models* rather than different
     spellings of one. */
  const others = NON_TASK_MODELS.map((m) => ({
    task: m.job,
    model: displayName(m.id),
    id: m.id,
    provider: m.provider,
    source: "default" as const,
  }));
  return { tasks: [...tasks, ...others] };
}

/** One row of `GET /api/models` — see `modelsInUse`. */
type ModelReport = {
  task: string;
  /** What to show a person: one name per model, no provider prefix. */
  model: string;
  /** The exact string sent on the wire. */
  id: string;
  provider: Provider;
  /** `"override"` when an environment variable, rather than the code, put that id there. */
  source: "default" | "override";
  effort?: string;
};

/**
 * Who is reading this article, as one string, resolved from the store.
 *
 * The two halves live apart — the global one on the reader, the per-article one
 * on the shelf — and this is the only place in the request path that joins
 * them. `renderProfile` returns `null` when both are empty, which is what every
 * caller downstream tests for.
 *
 * **Resolved here rather than inside the step that uses it**, and for a job the
 * result is then frozen onto the job. See `Job.profile` in src/types.ts: a
 * step can be several batched calls at once, and a reader who edits their box
 * mid-run would otherwise get one artefact written from two profiles.
 *
 * Never reads the client's word for it. See `useProfile` above.
 */
async function resolveProfile(slug: string): Promise<string | null> {
  return renderProfile(await resolveProfileParts(slug));
}

/**
 * The same two halves, **before** they are joined — for the one caller that
 * needs to show them to the person who wrote them.
 *
 * `GET /api/reader?slug=` answers the profile panel, which prints each box
 * separately with its own way in to edit it (docs/plans/260830c-profile-panel.md). It
 * cannot use `resolveProfile` above, because the joined string is a prompt
 * fragment: it carries "About the reader:" / "Why they are reading this piece:"
 * prefixes that are ours rather than the reader's, and there is no honest way
 * back from it to the two boxes.
 *
 * **Split out rather than reshaping `resolveProfile`**, whose six callers all
 * want the joined string and none of which should have to reach through a
 * `.rendered`. What matters is that the *gathering* stays in one place, because
 * the rule below lives in it and a route that read the two stores for itself
 * would be a second gathering with one clause missing.
 *
 * **`purposeFailed` is the difference between the two callers**, and it is the
 * whole reason this returns an object rather than a tuple. Swallowing a shelf
 * failure is right for a *prompt*: the global half still counts and a job must
 * not die over a purpose nobody may have written. It is wrong for a *panel*
 * that exists to tell the reader what their profile says — there, a shelf read
 * that fell over and a box that was never filled in are the same `null`, and
 * the reader is told "you haven't said why you're reading this one" about the
 * sentence they wrote last week. `resolveProfile` ignores this flag; the route
 * passes it on. GPT Sol's review of the built code, 2026-08-30.
 */
interface ProfileParts {
  /** "About you", as stored. */
  profile: string | null;
  /** "Why you're reading this one", as stored — `null` if never written. */
  purpose: string | null;
  /** …or `null` because the shelf could not be read. Never the same thing. */
  purposeFailed: boolean;
}

async function resolveProfileParts(slug: string): Promise<ProfileParts> {
  /* **The shelf read is allowed to fail, and the global half still counts.**
     Under `postgres` an article with no row throws not-found here, and under
     `files` a slug that is not an article is simply empty. Neither is a reason
     to answer a question about the *reader* with an error — and a caller that
     got one would fail a whole job over a purpose nobody had written.
     Found by GPT Sol's review of the built code, 2026-08-26. */
  let purposeFailed = false;
  const [profile, shelf] = await Promise.all([
    readerStore.readProfile(),
    shelfStore.read(slug).catch((): ShelfState => {
      purposeFailed = true;
      return { opens: 0 };
    }),
  ]);
  return { profile, purpose: shelf.purpose ?? null, purposeFailed };
}

/**
 * What `PATCH /api/reader` answers with — everything about the reader that this
 * route can change, whichever of it the request actually changed.
 *
 * Not in src/types.ts, and not shared with the client: `useProfile` and the
 * settings hook each read the one field they are about, and a shared interface
 * would invite a component to take a dependency on the *other* one.
 */
interface ReaderState {
  /** "About you", as stored — normalised, `null` for never-written. */
  profile: string | null;
  /** When experimental features were switched on, ISO 8601, or `null` for off. */
  experimentalSince: string | null;
}

/**
 * The reader's global profile — "about you", the half that is true on every
 * article.
 *
 * Its own route rather than a field on the shelf, because it is not about an
 * article: `PATCH /api/library/:slug` needs a slug and this has none. The
 * per-article half lives there, as `purpose`, and the two are joined into one
 * prompt string by `renderProfile` in src/profile.ts — which is the only place
 * that knows there were two.
 *
 * `profile: null` clears it. A body naming **neither** field is a 400 rather
 * than a no-op: a request that changes nothing is a request that meant
 * something else, and answering 200 to it would report a save that did not
 * happen.
 *
 * **The reply carries both fields whichever one you sent**, and that is the
 * rule this route grew on 2026-08-31 rather than an accident of it. A shape
 * that varies with the request is the one a client reads as "the other field is
 * unset" — the same argument the `purpose` field on the GET above makes at
 * length. The cost is one store read for the field you did not change.
 *
 * **One field per request, though — both at once is a 400.** The two writes are
 * two store operations and there is no transaction across them, so a body
 * carrying both could save the profile, fail on the switch, and answer with an
 * error after half of it had committed. No client sends both (the two hooks own
 * one field each), so refusing costs nothing today and removes a half-committed
 * state that would be found the hard way. The day one needs to, the fix is a
 * store operation that patches both — a single queued merge on the filesystem,
 * a single upsert in Postgres — not a second sequential write here. GPT Sol's
 * review of the built code, 2026-08-31.
 *
 * `experimental` is a **boolean on the wire and a date in the store**: the
 * client says on or off, and what comes back is when it was switched on.
 * docs/project/experimental-features.md.
 *
 * The **cap is enforced in the store, not here**. That is deliberate: this is
 * stored, so the rule has to hold for every writer rather than for this one
 * route. (The summary steer was the counter-example — validated at the boundary
 * because it went straight into a prompt and never landed anywhere — and it is
 * gone: docs/plans/260830o-steer-becomes-the-profile.md.) `pgReaderStore.writeProfile`
 * (src/store/pg-reader.ts) throws with `status: 400`, which
 * `httpErrorFrom` below turns into the same answer this would have given.
 */
async function patchReader(body: unknown): Promise<ReaderState> {
  const patch = objectBody(body);
  const wantsProfile = "profile" in patch;
  const wantsExperimental = "experimental" in patch;
  if (!wantsProfile && !wantsExperimental) {
    throw httpError(400, "Nothing to change: expected profile or experimental");
  }
  // See the header: two writes, no transaction across them.
  if (wantsProfile && wantsExperimental) {
    throw httpError(400, "Change one at a time: profile or experimental, not both");
  }
  const profile = patch.profile;
  if (wantsProfile && profile !== null && typeof profile !== "string") {
    throw httpError(400, "profile must be a string or null");
  }
  const experimental = patch.experimental;
  /* Strictly a boolean. Not truthiness: `"false"` and `0` are exactly the
     values a client sends by mistake, and truthiness answers both of them
     confidently and one of them backwards. */
  if (wantsExperimental && typeof experimental !== "boolean") {
    throw httpError(400, "experimental must be true or false");
  }
  /* Exactly one of these is a write and the other is a read, which is what the
     both-at-once refusal above buys: there is no order here that can leave the
     row half-changed. */
  return {
    profile: wantsProfile
      ? await readerStore.writeProfile(profile as string | null)
      : await readerStore.readProfile(),
    experimentalSince: wantsExperimental
      ? await readerStore.writeExperimental(experimental as boolean)
      : await readerStore.readExperimental(),
  };
}

/**
 * **A dictation, turned into text.** `POST /api/transcribe`.
 *
 * The reader has already stopped talking and is watching a spinner sit on top
 * of their own text box, so everything here is about being quick and about
 * failing in a way they can act on. src/transcribe.ts does the model call and
 * assembles the vocabulary; this is the boundary.
 *
 * Three checks, and each of them refuses rather than repairs:
 *
 *  - **The body has its own, larger cap.** Read with `MAX_AUDIO_BODY_BYTES`,
 *    which is the only place in this file that is not `MAX_BODY_BYTES` — see
 *    the note on the constant for why that is a parameter and not a raise.
 *  - **`format` is checked against a closed set**, because it is handed
 *    straight into OpenRouter's request and an unchecked one is a field the
 *    caller controls in somebody else's call.
 *  - **`context` is parsed rather than trusted**, and an article slug goes
 *    through the same `isSlug` every other route uses.
 *
 * **The client's disconnect aborts the model call.** A reader who navigates
 * away mid-transcription is a reader who will never see the answer, and
 * finishing the call for them is spending money on nobody.
 *
 * `res.on("close")`, **not** `req.on("close")` — the same trap `sse` documents
 * two hundred lines up, and the first draft of this function walked straight
 * into it (GPT Sol's plan review, item 7). Node's request `close` means "the
 * request has been completed, **or** the connection was terminated", and
 * `readBody` above consumes the request stream to its end — so "completed" is
 * already true before the model is called, and on any Node that takes the first
 * reading, every transcription would abort itself immediately.
 */
async function transcribeDictation(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<{ text: string; ms: number }> {
  const body = await readBody(req, MAX_AUDIO_BODY_BYTES);
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw httpError(400, "Expected a JSON object");
  }
  const sent = body as Record<string, unknown>;
  /* **An exact shape, refused rather than ignored.** A body with a key we do
     not know is a client and a server that disagree about this request, and the
     cheap failure is now rather than whenever somebody notices the field they
     added has never done anything. GPT Sol's code review, item 9. */
  for (const key of Object.keys(sent)) {
    if (key !== "audio" && key !== "format" && key !== "context") {
      /* **Fixed prose, and the key is not in it.** A JSON key is a string the
         caller wrote, `httpError`'s message is what `logRequest` writes as
         `reason`, and the two together are an authenticated caller streaming
         whatever they like into our logs a request at a time, without ever
         reaching a rate limit. Pre-existing here from c5c7e37 and found by GPT
         Sol's review of the feedback route, which had copied it. The rule it
         breaks is docs/plans/260826p-error-boundary.md's: no arbitrary string
         crosses a log boundary. */
      throw httpError(400, "That request has a field this endpoint does not take");
    }
  }

  const audio = sent.audio;
  if (typeof audio !== "string" || audio === "") throw httpError(400, "audio must be base64");
  /* **Checked here rather than left for the provider to reject.** An audio
     field that is not base64 at all is a bug in a caller, and finding that out
     from a 400 that arrived via OpenRouter — after a megabyte went over the
     wire and somebody's key was used — is finding it out in the wrong place.
     Anchored and length-checked, so a string with a newline or a stray quote in
     it fails here. */
  /* Canonical base64, and the padding rule is the part worth spelling out:
     `AB==` is the right length and the right alphabet and is still not valid,
     because two padding characters only follow a group of two. A decoder that
     accepts it produces bytes nobody encoded. */
  if (!/^[A-Za-z0-9+/]*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{4})$/.test(audio)) {
    throw httpError(400, "audio is not valid base64");
  }
  if (audio.length > MAX_AUDIO_BASE64) {
    /* The number is in the message because the fix depends on it, and the fix
       is "record less" — which a reader can only act on if they know what the
       limit is. docs/project/copy.md. */
    /* **The same sentence the browser would have shown**, and the arithmetic
       that turns base64 into "MB of audio" now lives once, beside the constant,
       rather than here and again in `dictation-upload.ts`. The two used to be
       different sentences under one code — `tests/dictation-codes.test.ts`. */
    throw httpError(413, tooLongMessage());
  }
  if (!isAudioFormat(sent.format)) throw httpError(400, "format is not one we can transcribe");
  const where = parseWhere(sent.context);
  if (!where) throw httpError(400, "context must say where the dictation is going");

  const gone = new AbortController();
  const drop = () => gone.abort();
  res.on("close", drop);
  try {
    const result = await transcribe(audio, sent.format, where, gone.signal);
    return { text: result.text, ms: result.ms };
  } finally {
    res.off("close", drop);
  }
}

/* ------------------------------------------------------------- feedback -- */

/**
 * The fields a feedback body may contain. **Exactly these, and refused
 * otherwise.**
 *
 * An exact shape rather than an ignored surplus, for the reason
 * `transcribeDictation` gives above: a body with a key we do not know is a
 * client and a server that disagree about this request, and the cheap failure is
 * now. Here it is doing a second job as well — `reporterEmail`,
 * `requestVercelId` and `environment` are things the *server* decides, so a
 * caller sending one is refused rather than quietly overruled, and there is no
 * field at all in which to write a content type or a filename for the
 * screenshot.
 */
/**
 * The three fields the dialog sent before 2026-09-02, named once so that the
 * allowlist and the shape check cannot disagree about what "the old shape" is.
 */
const LEGACY_ANSWER_FIELDS = ["steps", "expected", "actual"] as const;

const FEEDBACK_FIELDS = [
  "id",
  "body",
  "kind",
  /* **The old three-box vocabulary, still accepted on purpose.** A reader whose
     tab was loaded before the deploy posts these, and this is the one endpoint
     where a client and a server disagreeing is likely to be the very thing the
     reader is trying to report — so they are folded into `body` rather than
     refused. GPT Sol's review of the plan, 2026-09-02. They come out when the
     old bundles are certainly gone. */
  ...LEGACY_ANSWER_FIELDS,
  "consented",
  "url",
  "slug",
  "buildCommit",
  "diagnostics",
  "screenshot",
] as const;

/**
 * Canonical base64, padding rule included — the same expression
 * `transcribeDictation` uses, and it is written out here rather than shared for
 * the reason its own comment gives: `AB==` is the right length and the right
 * alphabet and is still not valid, because two padding characters only follow a
 * group of two. A decoder that accepts it produces bytes nobody encoded.
 */
const BASE64 = /^[A-Za-z0-9+/]*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{4})$/;

/** `abc1234`, `unknown`, or whatever `SPIDERYARN_BUILD_COMMIT` was set to. */
const BUILD_COMMIT = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * `lhr1::abcde-1234567890-0123456789ab`, and its multi-region forms.
 *
 * The same expression src/feedback-payload.ts holds the *diagnostics* Vercel ids
 * to. Two copies, because that file may not import this one — and both are
 * exercised, so a change to one that is not made to the other shows up as a
 * report whose ids stop arriving rather than as nothing at all.
 */
const VERCEL_ID = /^[A-Za-z0-9]{1,12}(:[A-Za-z0-9]{1,12}){0,3}::[A-Za-z0-9-]{1,64}$/;

/**
 * What the reader wrote, trimmed — or `null` for an empty box.
 *
 * **No part of the answer reaches a thrown message**, and that is the rule this
 * whole function exists to keep rather than a nicety: an `httpError` message is
 * written to the log as `reason`, redaction in src/log.ts matches key paths and
 * can never reach a string, and this is the one route whose body is a person's
 * own prose. The cap is in the message because the fix depends on it; the text
 * never is. docs/project/copy.md, and the same rule as `tidyBody` above.
 */
function feedbackAnswer(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw httpError(400, `${field} must be a string or null [fb-type]`);
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_FEEDBACK_ANSWER_CHARS) {
    throw httpError(
      400,
      `An answer can be at most ${MAX_FEEDBACK_ANSWER_CHARS} characters. ` +
        `Trimming it to the part that matters usually helps. [fb-long]`,
    );
  }
  return trimmed;
}

/**
 * **What the reader wrote**, from either shape of request body.
 *
 * The current dialog sends one `body`. A dialog loaded before 2026-09-02 sends
 * `steps`, `expected` and `actual`, and those are glued here under the same
 * headings the migration used, so a report from a stale tab is stored as the
 * same text it would have been stored as the day before.
 *
 * Accepting both is deliberate and is GPT Sol's finding: `FEEDBACK_FIELDS`
 * refuses an unknown key outright, so without this a reader with an open tab is
 * told *"a report has a field this endpoint does not take"* at the exact moment
 * they are trying to tell us something is broken. Refusing a body that carries
 * **both** shapes is the other half — that is not an old client, it is a caller
 * making something up, and there would be no right answer about which to keep.
 */
function feedbackBody(sent: Record<string, unknown>): string {
  /* **Which shape this is, decided on the keys and before any value is looked
     at.** The first version asked whether each field held text, so
     `{body: null, steps: "…"}` — both vocabularies, one of them empty — was
     read as a well-formed old client rather than as the muddle it is. A shape
     is a set of keys. GPT Sol's code review, 2026-09-02. */
  const hasBody = Object.hasOwn(sent, "body");
  const hasLegacy = LEGACY_ANSWER_FIELDS.some((key) => Object.hasOwn(sent, key));
  if (hasBody && hasLegacy) {
    throw httpError(400, "A report mixes two request shapes [fb-shape]");
  }

  const written = feedbackAnswer(sent.body, "body");
  const steps = feedbackAnswer(sent.steps, "steps");
  const expected = feedbackAnswer(sent.expected, "expected");
  const actual = feedbackAnswer(sent.actual, "actual");
  const legacy = [
    steps === null ? null : `Steps to reproduce:\n${steps}`,
    expected === null ? null : `What you expected to see:\n${expected}`,
    actual === null ? null : `What you saw instead:\n${actual}`,
  ].filter((part): part is string => part !== null);
  const body = written ?? (legacy.length > 0 ? legacy.join("\n\n") : null);
  /* The database says the same thing — `body` is `not null` — and this is the
     half that gets to explain itself. A `kind` on its own is not a report: it is
     the row a mis-wired toggle would file. */
  if (body === null) {
    throw httpError(400, "A report needs something written in it. [fb-empty]");
  }
  return body;
}

/**
 * *A problem*, *a suggestion*, or **nothing**, which is a third answer rather
 * than a missing one.
 *
 * Greg asked for the toggle to start unset — *"don't default to Problem. Default
 * to null/unknown"* — so an absent field is valid and an unrecognised one is
 * not. A value outside the vocabulary is a client and a server that disagree,
 * and the cheap failure is now; the CHECK in src/db/schema.ts is the same
 * refusal for every other writer.
 */
function feedbackKind(value: unknown): FeedbackKind | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !(FEEDBACK_KINDS as readonly string[]).includes(value)) {
    /* The list is ours and the value is not the reader's prose — but it is still
       a string off the wire, so it does not go in the message. `[fb-kind]`. */
    throw httpError(400, "kind is not one of ours [fb-kind]");
  }
  return value as FeedbackKind;
}

/**
 * Which deployment this is, **asked of the server rather than of the browser**.
 *
 * The same pair `initMonitoring` builds Sentry's `environment` from, mapped onto
 * the closed union so that a report from a preview build cannot be read as one
 * from production. A client-supplied value would be a claim, and the whole point
 * of the column is that it is not.
 */
function feedbackEnvironment(): FeedbackEnvironment {
  const name = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development";
  return (FEEDBACK_ENVIRONMENTS as readonly string[]).includes(name)
    ? (name as FeedbackEnvironment)
    : "development";
}

/**
 * The header this request arrived under, which is the only place it can come
 * from.
 *
 * `x-vercel-id` is the request id Vercel logs a function invocation under. A
 * browser can read it off a **response** and cannot put it into a request, so a
 * value in the body would be a fiction indistinguishable from the real thing in
 * a report six weeks later. The ids of the requests that went *wrong* ride in
 * the diagnostics blob, behind the tick-box; this one is about the submit.
 */
function requestVercelId(req: IncomingMessage): string | null {
  const raw = req.headers["x-vercel-id"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  /* **Shape-checked, not merely truncated.** It becomes a Sentry tag and a
     column, and the old version relied on Vercel overwriting whatever a caller
     sent — which is true on Vercel and is not an invariant this code
     establishes. Anywhere else (a proxy, a laptop, a preview behind something
     else) the header is whatever arrived, and 200 characters of it would be 200
     characters of anything. So: the shape Vercel actually writes, or nothing.
     GPT Sol's code review, 2026-08-31. */
  return VERCEL_ID.test(trimmed) ? trimmed : null;
}

/**
 * **Where the reader was**, as three checked fields — and the first of them is
 * the whole address.
 *
 * It was `route_kind`, a closed vocabulary, and never an address, until Greg
 * reversed that on 2026-09-02: *"I think it's fine (and even advantageous) to
 * store the url with the Feedback - if that means we can get rid of the
 * route_kind and simplify things"*. What the vocabulary cost was a migration per
 * page and a 500 whenever its four hand-mirrored copies drifted.
 *
 * **The reason it was closed has not gone away**, which is why `isWebUrl` and
 * the length cap below are not ceremony: this app's URLs carry `?q=` and
 * `?find=`, which are reader-typed search text, and `/add/<a whole third-party
 * URL>`, which may carry a token. The reader is told the whole address goes —
 * docs/project/privacy.md § What a bug report carries, and the hover card on
 * the button itself (src/web/FeedbackButton.tsx) — which is what makes storing
 * it a decision rather than a leak. Note that this comment went on claiming the
 * opposite for a day after the code stopped doing it, and it was a cross-family
 * review that noticed rather than anybody reading the function under it.
 * docs/plans/260831aj-feedback-button-and-bug-reports-to-sentry.md § Always —
 * where they were, and docs/project/feedback.md.
 */
function feedbackWhere(sent: Record<string, unknown>): {
  url: string | null;
  slug: string | null;
  buildCommit: string | null;
} {
  const { url, slug, buildCommit } = sent;
  /* **Two questions, and `isWebUrl` answers only one of them.** It answers
     *is this an `http(s)` address* — the same allowlist that decides whether
     model output may become an `href` (src/urls.ts), reused here because the
     admin inbox renders this value and a `javascript:` string in an `href` is
     the whole of that bug. The length cap is the second question and it is
     ours: the CHECK in src/db/schema.ts is the same 2048, and a value that
     passed here and failed there would be a 500 on a valid report.

     What this deliberately does **not** ask is whether the address is one of
     ours. A reader can only pollute their own report by lying about where they
     were, and an origin check is a list that goes stale on every preview
     deployment. src/types.ts § MAX_FEEDBACK_URL_CHARS. */
  /* **Absent is allowed; wrong is not.** A bundle loaded before 2026-09-02
     sends `routeKind` and no `url`, and refusing it would lose a report at the
     one endpoint where the mismatch may be the bug being reported — the same
     call `LEGACY_ANSWER_FIELDS` makes above. A value that is *present* and not
     a web address is still a 400, because that can only be a client we wrote
     getting it wrong. */
  const absent = url === undefined || url === null;
  if (!absent && (typeof url !== "string" || !isWebUrl(url) || url.length > MAX_FEEDBACK_URL_CHARS)) {
    throw httpError(400, "url is not a web address we can store [fb-url]");
  }
  if (slug !== undefined && slug !== null && !isSlug(slug)) {
    throw httpError(400, "slug is not a slug [fb-slug]");
  }
  if (
    buildCommit !== undefined &&
    buildCommit !== null &&
    (typeof buildCommit !== "string" || !BUILD_COMMIT.test(buildCommit))
  ) {
    throw httpError(400, "buildCommit is not a build stamp [fb-build]");
  }
  return {
    url: absent ? null : (url as string),
    slug: typeof slug === "string" ? slug : null,
    buildCommit: typeof buildCommit === "string" ? buildCommit : null,
  };
}

/**
 * A pasted screenshot, decoded and **written again by us**.
 *
 * Four refusals, in the order that costs least: the encoding, then the encoded
 * size, then the decoded size, then whether it is a picture we can take apart
 * and rebuild. The last is the one worth stating, and it is stronger than it
 * used to be.
 *
 * The first version sniffed eight bytes of PNG signature or three of JPEG and
 * forwarded the rest. GPT Sol's code review, 2026-08-31: `PNG_SIGNATURE ||
 * articleProse` passes that, and a real PNG can carry text chunks, EXIF, or
 * anything at all appended after `IEND`. So the bytes are now taken apart and a
 * new file is written from the raster — src/feedback-image.ts, which is also
 * where the reason JPEG is refused is argued.
 *
 * **No part of the caller's bytes reaches the message.** The messages below are
 * three constants and one number.
 */
function feedbackScreenshot(value: unknown): FeedbackScreenshot | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw httpError(400, "screenshot must be base64 or null [fb-type]");
  if (!value) return null;
  if (!BASE64.test(value)) throw httpError(400, "screenshot is not valid base64 [fb-shot]");
  const bytes = Buffer.from(value, "base64");
  const result = reencodeScreenshot(bytes, MAX_FEEDBACK_SCREENSHOT_BYTES);
  if (result.ok) return result.screenshot;
  if (result.reason === "too-big") {
    throw httpError(
      413,
      `That screenshot is too big. The limit is about ${
        Math.round((MAX_FEEDBACK_SCREENSHOT_BYTES / 1024 / 1024) * 10) / 10
      } MB, and at most ${MAX_SCREENSHOT_EDGE} pixels on a side. [fb-shot-big]`,
    );
  }
  /* Both remaining refusals say the same sentence. "Not a PNG" and "a PNG that
     does not decode" are the same thing to act on — take the screenshot again —
     and telling the two apart would be telling a caller how far into our parser
     their bytes got. */
  throw httpError(400, "A screenshot has to be a PNG. [fb-shot]");
}

/**
 * **A bug report, built field by field from a body nothing is spread from.**
 *
 * `POST /api/feedback`, and the rule at this seam is the one `safeEvent` follows
 * one file over: *build the payload, do not clean it*. Every field below is
 * named, checked and assigned; there is no path by which a key this function has
 * not heard of reaches a column, a JSONB blob or Sentry.
 *
 * Three of the fields are **not** read off the body at all — the reporter's
 * email comes from the gate's `VerifiedUser`, the environment from this process,
 * and the Vercel id from this request's own headers. See each of them.
 */
function parseFeedback(
  /* `raw` rather than `body`, which is now a *field* of the report — the request
     body and the reader's words are two different things and were briefly one
     name. */
  raw: unknown,
  req: IncomingMessage,
  user: VerifiedUser,
): { report: NewFeedback; screenshot: FeedbackScreenshot | null } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw httpError(400, "Expected a JSON object [fb-type]");
  }
  const sent = raw as Record<string, unknown>;
  for (const key of Object.keys(sent)) {
    if (!(FEEDBACK_FIELDS as readonly string[]).includes(key)) {
      /* **Fixed prose. Not the key, not forty characters of it.**
         The first version put the key in, on the argument that a key is a name a
         client wrote in its own source rather than something the reader typed.
         That is true of *our* client and of nothing else: `httpError`'s message
         is written to the log as `reason`, so an authenticated caller could post
         `{"<forty characters of anything>": 1}` in a loop and write prose into
         our logs, without touching the rate limiter, which counts reports and
         not refusals. GPT Sol's code review, 2026-08-31, and it breaks this
         plan's own rule that no request text reaches an `httpError` message. */
      throw httpError(400, "A report has a field this endpoint does not take [fb-field]");
    }
  }

  const id = sent.id;
  if (typeof id !== "string" || !isSpideryarnId(id)) {
    throw httpError(400, "id must be a report id [fb-id]");
  }
  /* Strictly a boolean, not truthiness: `"false"` and `0` are exactly what a
     client sends by mistake, and truthiness answers both confidently and one of
     them backwards. The same call `patchReader` makes about `experimental`. */
  if (typeof sent.consented !== "boolean") {
    throw httpError(400, "consented must be true or false [fb-type]");
  }
  const consented = sent.consented;
  const where = feedbackWhere(sent);

  const body = feedbackBody(sent);
  const kind = feedbackKind(sent.kind);

  if (
    sent.diagnostics !== undefined &&
    sent.diagnostics !== null &&
    (typeof sent.diagnostics !== "object" || Array.isArray(sent.diagnostics))
  ) {
    throw httpError(400, "diagnostics must be an object or null [fb-type]");
  }
  /* **Rebuilt from a named allowlist**, and the client's version is not trusted
     — src/feedback-payload.ts drops every field it has not heard of and cuts
     every path at its query string. */
  const built = consented ? parseFeedbackDiagnostics(sent.diagnostics) : null;
  if (!consented && sent.diagnostics !== undefined && sent.diagnostics !== null) {
    /* Refused rather than dropped. The database refuses it too
       (`feedback_diagnostics_consented`), and a client that collected
       diagnostics without the tick-box is a bug worth hearing about at once. */
    throw httpError(400, "diagnostics need the reader's consent [fb-consent]");
  }

  const screenshot = feedbackScreenshot(sent.screenshot);

  return {
    report: {
      id,
      /* **The gate's, never the browser's.** `serveAuthenticatedApi` holds a
         `VerifiedUser` — the one type only `requireUser` can make — and this is
         a snapshot of the address it verified, taken at submit time. */
      reporterEmail: user.email,
      body,
      kind,
      consented,
      ...where,
      environment: feedbackEnvironment(),
      requestVercelId: requestVercelId(req),
      diagnostics: built === null ? null : { version: FEEDBACK_DIAGNOSTICS_VERSION, payload: built },
      screenshot: screenshot === null ? null : screenshot.bytes,
    },
    screenshot,
  };
}

/**
 * File a report. **Two destinations, and only the first one is ours.**
 *
 * The row is written first and is authoritative — its success is what the reader
 * is told about — and only a **newly created** row is mirrored, because feedback
 * events are not deduped by Sentry and a retry would otherwise file the same bug
 * twice. `mirrorFeedback` cannot throw and cannot fail this request.
 *
 * The three answers map to three statuses:
 *
 * - `created` → **201**, and the report goes to Sentry.
 * - `duplicate` → **200**. A retry that finds its own earlier report has
 *   succeeded; answering an error would make a client retry a submit that
 *   already worked.
 * - `limited` → **429** with a `Retry-After`, and a sentence saying when.
 */
async function fileFeedback(
  req: IncomingMessage,
  res: ServerResponse,
  user: VerifiedUser,
): Promise<void> {
  const { report, screenshot } = parseFeedback(
    await readBody(req, MAX_FEEDBACK_BODY_BYTES),
    req,
    user,
  );
  const answer = await feedbackStore.submit(report);

  if (answer.kind === "limited") {
    const seconds = Math.max(1, Math.ceil(answer.retryAfterMs / 1000));
    res.setHeader("Retry-After", String(seconds));
    /* A number a reader can act on, in minutes when it is minutes — the rule
       docs/project/copy.md states about "please try again later". */
    const wait =
      seconds < 90 ? `${seconds} seconds` : `about ${Math.ceil(seconds / 60)} minutes`;
    send(res, 429, {
      error: `That is a lot of reports in one hour. Please try again in ${wait}. [fb-often]`,
      retryAfterMs: answer.retryAfterMs,
    });
    return;
  }

  /* Lengths and ids, never text. The reader's words are in the row and, if they
     consented, in Sentry; they are not in this log line, which they did not
     agree to. docs/project/logging.md, and the same rule pg-feedback.ts keeps. */
  log("http").info(
    {
      id: report.id,
      kind: answer.kind,
      /* The reader's own answer, next to the store's. Two different `kind`s in
         one line would be a log nobody can read, so this one says whose it is. */
      reportKind: report.kind,
      chars: report.body.length,
      consented: report.consented,
      url: report.url,
      slug: report.slug,
      screenshotBytes: screenshot === null ? null : screenshot.bytes.length,
      diagnosticsVersion: report.diagnostics?.version ?? null,
    },
    "feedback report accepted",
  );

  /**
   * **Started before the answer goes out, awaited after it.**
   *
   * `mirrorFeedback` waits for Sentry to acknowledge the event before it writes
   * `mirrored_at` — that is the whole point of the two columns, and it costs a
   * network round trip. Doing it before `send` would put that round trip in
   * front of a reader who has already finished writing; doing it after means the
   * response is complete and all that is being held open is a warm function.
   *
   * It cannot throw (rule 2 of src/monitoring.ts) so there is nothing to catch,
   * and `res.end` has already happened, so there is nothing left it could break.
   */
  const mirror =
    answer.kind === "created" ? mirrorFeedback({ report: answer.report, user, screenshot }) : null;
  send(res, answer.kind === "created" ? 201 : 200, {
    id: answer.report.id,
    createdAt: answer.report.createdAt,
    status: answer.kind,
  });
  if (mirror) await mirror;
}


/**
 * One line per request, on the way out, at a level the status decides.
 *
 * **The level is the status, and that is the whole rule.** A 4xx is the
 * client's fault — a bad slug, a typo'd endpoint — and an alarm on it trains
 * you to ignore alarms. A 5xx is ours.
 *
 * The path goes in the **message as well as** the object. Vercel's log search
 * matches the raw line reliably; its indexing of structured fields is not
 * something to rely on (their own docs disagree with each other about it), so
 * the one field you always search by is duplicated where grep can see it.
 *
 * Nothing from the request body is here, deliberately. A comment POST carries
 * `quote` — a passage the reader selected out of the article — and the log is a
 * reading history already (src/log.ts, on why `url` is not redacted) without
 * putting the reading itself in it.
 */
/**
 * Did this failure *name its own status* — i.e. did this file choose it?
 *
 * The rule `logRequest` has always used to decide whether a stack is worth
 * keeping in the log line, given a name because it now has a second reader.
 *
 * **It is deliberately not the rule for what reaches Sentry**, and the first
 * version of this change got that wrong. The two questions are different: *is a
 * stack useful here?* and *should somebody be told about this?* An error that
 * named its own `status: 500` — `src/owner.ts` raises one for a broken
 * authentication-order invariant — is a genuine fault wearing the mark of a
 * chosen failure, and reusing this predicate made it invisible. In the other
 * direction `ChatConflict` and a missing file both name no status at all, and
 * both are answered 409 and 404 by design. GPT Sol's review, 2026-08-27.
 */
function chosenByUs(err: unknown): boolean {
  return typeof (err as { status?: number }).status === "number";
}

function logRequest(
  method: string,
  path: string,
  status: number,
  started: number,
  err?: unknown,
): void {
  /* **A stack only where a stack tells you something.**
   *
   * `httpError(400, …)` is a *decision this file made* — a bad slug, both a url
   * and a slug, a body that is not JSON. Its stack is the four frames between
   * here and the `throw` two hundred lines up, which nobody has ever needed,
   * and in dev they are frames of Vite's bundled temp copy of this file, which
   * is worse than nothing. An error with no `status` of its own is the case
   * this logging exists for: something threw that we did not plan for, and the
   * stack is the only record of where.
   *
   * So the test is not the status code but whether the error *named* one. A
   * `throw new Error(…)` that happens to be mapped to 400 still keeps its
   * stack, because nobody chose that 400 on purpose.
   *
   * **The invariant this rests on, stated because it is easy to break from far
   * away:** every `httpError` message in this file is written to a log, so it
   * must contain nothing but words we chose. Not the URL, not the body, not the
   * offending value. One of them interpolated the source URL and put
   * credentials and a query string into `reason` at warn — cleanly defeating
   * the query strip in `handleApi`, forty lines from the code that did it.
   * `tests/jobs.test.ts` pins that one. See docs/project/logging.md. */
  const expected = err !== undefined && chosenByUs(err);
  const fields = {
    method,
    path,
    status,
    ms: since(started),
    ...(err === undefined
      ? {}
      : expected
        ? { reason: (err as Error).message }
        : errorFields(err)),
  };
  const line = log("http");
  const msg = `${method} ${path} ${status}`;
  /* **What this request spent on models**, from the collector `handleApi`
     opened. Read here rather than returned, because this line is written in
     `serveApi`'s own `finally` — inside the scope, before it closes. An ordinary
     request that called no model gets no extra fields at all. */
  Object.assign(fields, spendFields(currentSpend() ?? emptySpend()));
  if (status >= 500) line.error(fields, msg);
  else if (status >= 400) line.warn(fields, msg);
  else line.info(fields, msg);
}

/** Returns false if the request was not ours, so the caller can fall through. */
export function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  /**
   * How to check a token. Injected only by tests; see the gate below and
   * src/auth.ts. Left alone it is the real thing.
   */
  verify?: Verifier,
): Promise<boolean> {
  /* **One owner box per request, opened here and nowhere else.**
   *
     A wrapper rather than a `run()` around the body below, because the body is
     five hundred lines and re-indenting all of it in a tree several agents are
     editing is a merge conflict with no upside. `serveApi` is the old
     `handleApi` unchanged.

     Everything the request does happens inside this callback, including the
     awaits — that is the property AsyncLocalStorage gives us and a module-level
     variable does not. src/owner.ts § Why an AsyncLocalStorage. */
  /* **And a spend collector, in the same place and for the same reason.**

     The pipeline's unit of accounting is a step, opened by `runStep` in
     src/jobs.ts. A reader's request is not a step, and until this line the five
     reader-facing model calls — explain, chat, search, dictation, and the
     embeddings a search runs — recorded their cost into no collector at all, so
     `unscopedCalls()` counted them and nothing added them up. Those are
     precisely the calls Greg's *"spend limit per user"* is about.

     It has to wrap the whole of `serveApi`, not the point where a stream is
     created: `explain`, `chat` and `search` all drive their generator to
     completion inside this frame (the three `for await`s below), so the scope
     covers the whole answer. **If a route ever returns before its stream
     finishes, this stops being true** — the report would be a snapshot and the
     rest of the calls would land as `aiLateFinishes`, which is exactly why that
     field exists rather than the late records being dropped. Raised by a GPT Sol
     review.

     The result is discarded because `serveApi` reports its own cost, on the line
     it already writes — see `logRequest`, which reads `currentSpend()` from
     inside the scope. */
  return runInRequest(
    async () =>
      (
        await collectSpend(() => serveApi(req, res, verify), {
          /* **No owner here, and that is not an omission.** The gate that fills
             the owner box runs *inside* `serveApi`, which is inside this
             collector — so at this instant nobody knows who is asking. The sink
             resolves it at record time, by which point the gate has long since
             run. src/ai-spend.ts § `ownerFor`.

             No article either: a route knows which one, and says so with
             `withSpendAttribution`. */
          attribution: { scopeKind: "request" },
          sink: (row) => costStore.record(row),
        })
      ).result,
  );
}

async function serveApi(
  req: IncomingMessage,
  res: ServerResponse,
  verify?: Verifier,
): Promise<boolean> {
  const url = req.url ?? "";
  // Before the clock starts, and before anything can log: a request that is not
  // ours must produce **no line at all**. In dev this function sees every
  // stylesheet, module and source map Vite serves, and a line each would bury
  // the ones about the API.
  if (!url.startsWith("/api/")) return false;

  const started = Date.now();
  const method = req.method ?? "";
  /* **The path without the query string, and every route below matches on it.**

     It arrived for logging alone: `req.url` carries the query string, and
     `logRequest` writes its argument into the message as well as the object,
     where redaction — which matches key paths and never text — can never reach
     it. Stripping it stops a `?token=…`, sent deliberately or by mistake, from
     being written down twice. Raised by GPT/Codex in review.

     Routing was left on the raw URL at the time, on the reasoning that no route
     read a query string — which stopped being true the next morning. The library
     family was moved here in the same commit that gave it `?q=` and
     `?archived=1`, so it never broke; the generalisation just stopped at the
     edge of that commit. The next route to take a parameter got no such move,
     and every pattern here is `$`-anchored with a slug class that excludes `?`,
     so it did not mis-route — it stopped matching anything.
     `GET /api/chat/<slug>?summary=1` 404'd on every article an owner opened, for
     five days, with its handler sitting a line below unreached.
     docs/postmortems/260901a-the-route-the-query-string-hid.md. */
  const path = url.split("?")[0] ?? url;
  /* **The other half of the same split, parsed once.** Four route families read
     a query string, and before this each parsed the URL again for itself — one
     of them out of `req.url` directly, which is the escape hatch that made the
     `path`/`rawUrl` distinction above a convention rather than a rule. Handing
     the parsed parameters down means no handler below has a reason to hold a
     URL string at all. GPT Sol's finding 1, 2026-09-01. */
  const query = new URLSearchParams(url.slice(path.length).replace(/^\?/, ""));


  /* Every response leaves by one of the ~14 `send` calls below, the catch, or
     the 404 at the end — so the log line lives in a single `finally` rather
     than at each of them. A branch added later cannot forget it, and there is
     no set of call sites to keep in step. It reads `res.statusCode`, which
     `send` has just set, so the exit points do not have to report anything. */
  let failure: unknown;
  try {
    /**
     * **The public namespace, dispatched before the gate and inside this `try`.**
     *
     * Before `requireUser`, obviously — the whole point is a reader with no
     * session. Inside the `try` for the reason the gate itself is: a throw from
     * above it escapes to the outer handler, which answers a blank 500 on Vercel,
     * and the `finally` never runs, so the refusal is never logged.
     *
     * **`no-store` before the dispatch, not on the successful answers.** GPT Sol's
     * answer 9, 2026-08-28: a cached public 404 outlives the switch being turned
     * on, and a cached error outlives it being fixed. Setting the header here means
     * every response out of the closed room carries it — the 200s, the 404s, the
     * 405s and the 500s — including the ones thrown from inside it and answered by
     * the `catch` below.
     *
     * Caching comes back only with an invalidation tied atomically to the
     * visibility change, and with a deployed test that warms the edge, turns the
     * document private, and proves the next anonymous request cannot get the body.
     * A manual global purge is not a privacy control.
     * docs/plans/260827ai-public-read-only-access.md.
     */
    if (isPublicNamespace(path)) {
      res.setHeader("Cache-Control", "no-store");
      /* No `req`. See src/public/routes.ts — the public dispatcher is not handed
         the request object, so "the public routes ignore `Authorization`" is not a
         rule anybody has to keep. */
      await servePublicApi({ res, path, method });
      return true;
    }

    /**
     * **The Stripe webhook — the second thing on this server that runs before
     * the gate, and the only one that is handed the request.**
     *
     * Stripe has no session and never will, so this cannot sit behind
     * `requireUser`. An **exact** path rather than a namespace, unlike the
     * public branch above: nothing else under `/api/webhooks/` should become
     * reachable because somebody added a second provider without re-reading
     * src/billing/webhook.ts.
     *
     * Inside the `try` for the reason the comment below gives at length, and
     * before anything else touches `req`, because the signature is over the
     * bytes as they arrived — something that had already consumed the stream
     * would leave nothing to verify.
     */
    if (path === WEBHOOK_PATH) {
      await serveStripeWebhook(req, res, method);
      return true;
    }

    /* **The gate, and it is inside the `try` — that is the whole of this
       comment's content.** An earlier plan put it just after the `/api/` prefix
       check, eighty-five lines above, on the theory that this `try` would turn
       its thrown `httpError` into the right status. It would not: a throw up
       there escapes to the outer handler, which answers 500 with the message in
       dev and a blank 500 on Vercel — and the `finally` below never runs, so
       **the refusal is never logged at all**. It still fails closed, which is
       the one mercy, but every word we have written about 401s and 403s would
       have been false. GPT Sol found it; confirmed by reading the line numbers.

       Before any body is read and before any route matches, so a malformed
       request from a stranger is a 401 rather than a 400. We owe an
       unauthenticated caller no diagnosis of their JSON.

       `verify` is a seam rather than a hard call because six test files drive
       this function with hand-built requests and none of them can mint a real
       ES256 token. The default is the real verifier, so forgetting to inject
       cannot make a production build permissive. src/auth.ts. */
    const user = await requireUser(req, verify);
    /* **And from here on it is a different function.** Everything the
       authenticated API does moved into `serveAuthenticatedApi` on 2026-08-28,
       unchanged, so that its one parameter can be a `VerifiedUser` — a type only
       `requireUser` can produce (src/auth.ts). Before the split, "an
       authenticated route reached without authentication" was prevented by this
       line being above the route table and by nothing else. GPT Sol's answer 2. */
    await serveAuthenticatedApi(user, { req, res, rawUrl: url, path, query });
    return true;
  } catch (err) {
    // Anything that knows its own status says so. What is left is either a
    // missing artefact or a genuine fault, and telling those apart matters: a
    // blanket 404 made a corrupt comments.json and a bad request both read as
    // "no such article", which is the wrong thing to go and investigate.
    const status =
      (err as { status?: number }).status ??
      /* A retry or an edit the stored conversation will not accept — a stale
         tab, a second window, a Back button. 409 rather than 500, because
         nothing here is broken and the client's job is to reload and look
         again. See `ChatConflict` in src/chat.ts. */
      (err instanceof ChatConflict ? 409 : null) ??
      /* Somebody else's comment already has that id, or that comment already
         started a different conversation. 409 for the same reason as above:
         nothing is broken, the client asked for something the stored state will
         not allow, and reloading is the answer. `CommentIdTaken` in
         src/comments.ts.

         **Both of these classes now carry their own `status`**, so the first
         line of this chain answers them and these two branches never run. They
         are kept as the belt to that brace, and the numbers live on the classes
         so the two cannot disagree. Why the classes and not a sixth name in
         `mayPassThrough`: the note on `CommentIdTaken`, and
         docs/postmortems/260901d-a-409-and-a-404-arrived-as-500.md — behind
         Postgres, which is what production runs, the `instanceof` below could
         not match, because `guardDbStore` had already replaced the error. */
      (err instanceof CommentIdTaken ? 409 : null) ??
      /* Two different failures under one class, and they must not share a code:
         `missing` is a comment that is not there (404), `free` is a bookmark
         being pushed down the retired explanation path (409). Guessing one for
         both would make a deleted comment read as "you cannot answer that". */
      (err instanceof NotAnExplanation ? (err.why === "missing" ? 404 : 409) : null) ??
      ((err as NodeJS.ErrnoException).code === "ENOENT" ? 404 : 500);
    // Handed to `logRequest`, which decides how much of it to write down — the
    // message for a failure this file chose, the whole stack for one it did
    // not. That is the point of the exercise: an unexpected throw used to be
    // mapped to a status, handed to the client and forgotten, so a production
    // 500 left nothing behind to read.
    failure = err;
    /* **The rule is the status we answered with, not who chose it.** If this
       request logged at `error` level it goes to Sentry, and `logRequest` uses
       exactly the same threshold two lines down — so the two can never drift
       into disagreeing about what a fault is.

       What that buys, case by case: a `TypeError` mapped to 500 is reported; so
       is `src/owner.ts`'s deliberate `status: 500` invariant failure, and so is
       an authored 502 from a provider. A 404 for a slug with no article, a 400
       for a bad body, and `ChatConflict`'s 409 are answers rather than faults
       and are not reported. An error tracker full of mistyped URLs is an error
       tracker nobody reads.

       src/monitoring.ts decides what may be *said* about the error. This line
       only decides whether to say anything. */
    if (status >= 500) captureFailure(err, { method, path, status });
    /* **The message and nothing else, and it must stay that way.** A
       `structuredDetail(err)` used to be spread in beside it, carrying the
       blocking `Job` out of a `JobConflict`; the per-article queue removed the
       refusal, so it went with it
       (docs/plans/260902e-a-per-article-job-queue-that-appends-and-modes-that-start-themselves.md § 1g).

       Whatever brings a structured field back, it must match **one declared
       class and read one declared field** — never copy an error's own
       enumerable properties. This handler answers every throw in the API,
       including a Drizzle failure whose `Error.message` carries bound
       parameters (src/store/db-errors.ts) and a provider's own words
       (docs/project/copy.md rule 4), and a generic spread would put every one
       of those on the wire. */
    send(res, status, { error: (err as Error).message });
    return true;
  } finally {
    logRequest(method, path, res.statusCode, started, failure);
  }
}

/**
 * The request, as the dispatchers below take it.
 *
 * **Three fields, three jobs, and the split is the whole point.** `path` is what
 * every route matches on. `query` is what the four route families that take
 * parameters read — the shelf's `?archived=1`, search's `?q=`, the reader's
 * `?slug=`, chat's `?summary=1`. `rawUrl` is for the 404 message, which is worth
 * printing in full. All three are computed once in `serveApi`.
 *
 * Matching a route against a URL with a query string on it cannot match
 * anything, because every pattern below is `$`-anchored — that is the bug in
 * docs/postmortems/260901a-the-route-the-query-string-hid.md, and it ran for
 * five days. The field is called `rawUrl` rather than `url` so that `.exec(url)`
 * does not compile.
 *
 * **That rename is a speed bump, not a wall**, and it is worth being honest
 * about which: `req` is right here, so `.exec(req.url ?? "")` compiles fine, and
 * so does aliasing `rawUrl`. GPT Sol made the point and it stands. What actually
 * shrinks the class is `query`: before it, a handler that wanted a parameter had
 * to get hold of a URL and parse it, and the chat handler did exactly that, out
 * of `req.url`, one line under the matcher that could not reach it. Now nothing
 * below has a reason to hold a URL string at all.
 *
 * **The public dispatcher takes a different, smaller envelope** and in
 * particular does not take `req` — see `PublicRequest` in src/public/routes.ts.
 * GPT Sol sketched one shared shape for both; the public half needs no body and
 * no header, and not handing it the request is a stronger statement of that than
 * a sentence saying it ignores them.
 */
interface ApiRequest {
  req: IncomingMessage;
  res: ServerResponse;
  rawUrl: string;
  path: string;
  /** The query string, parsed once in `serveApi`. Empty for most requests. */
  query: URLSearchParams;
}

/* -------------------------------------------------------- the route table */

/**
 * **The five verbs the authenticated dispatcher answers.**
 *
 * A closed union rather than `string`, so a sixth verb is a compile error here
 * rather than a row nothing asks about: `METHOD_UNIVERSE` in
 * tests/authenticated-api-route-contract.test.ts is the universe every refusal
 * and collision question is asked over, and a verb outside it is skipped by all
 * of them (GPT Sol, review § P2-METHOD-UNIVERSE). HEAD and OPTIONS are
 * deliberately absent: this dispatcher has no handling for either, and that
 * stays a matter for the terminal 404 rather than a pair to answer.
 */
type AuthRouteMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * **Everything a table handler is given, and all of it.**
 *
 * The entries below are built once, at module scope, so a handler cannot close
 * over anything about the request — it is handed the request instead (GPT Sol,
 * review § P2-STATIC-CONTRACT). `user` is here rather than only `request`
 * because one handler outside billing already needs it (`fileFeedback`), and
 * because the alternative — reading the owner back out of the async store — is
 * a second way to answer a question this parameter already answers.
 */
interface AuthRouteContext {
  user: VerifiedUser;
  request: ApiRequest;
}

/** An entry matched by string equality — the shape of `/api/jobs` and billing. */
interface ExactAuthRoute {
  kind: "exact";
  method: AuthRouteMethod;
  path: string;
  handler: (context: AuthRouteContext) => Promise<void>;
}

/**
 * An entry matched by a regex.
 *
 * **Not "an entry whose path has captures", which is what this said.** Nothing
 * in the type requires a capture group: `/^\/api\/x$/` is a legal `pattern` and
 * its handler is handed a one-element `RegExpExecArray` (GPT Sol, stage 3a
 * review § P3-CAPTURE-CONTRACT). Every pattern row here does capture, and the
 * paragraph below is about what happens to those captures — but that is a fact
 * about the rows, not a guarantee the compiler makes. Encoding it would need a
 * matcher abstraction rather than a `RegExp`, which is not worth building yet.
 *
 * The handler is handed the **raw `RegExpExecArray`**, not a decoded tuple, and
 * that is the point of the discriminated union: dispatch does no decoding. Which
 * happens first — reading the body or decoding the slug — differs per route and
 * is observable from outside as two different status codes for the same two
 * malformed inputs (§ [DECODE] in
 * docs/plans/260907b-split-the-authenticated-api-dispatch-by-domain.md, and two
 * cases in tests/authenticated-api-route-contract.test.ts pin both). A dispatcher
 * that decoded captures for its handlers would have to pick one order for all of
 * them. `part` and `slugPart` go on doing the decoding and the validation they
 * already do, at the point in the handler where they were already called.
 */
interface PatternAuthRoute {
  kind: "pattern";
  method: AuthRouteMethod;
  pattern: RegExp;
  handler: (context: AuthRouteContext, captures: RegExpExecArray) => Promise<void>;
}

/**
 * One row of the table: exact or pattern, and never both.
 *
 * Discriminated so a handler cannot be handed captures the match cannot produce
 * — an exact route's handler has no `captures` parameter to be given, and a
 * pattern route's handler cannot be attached to a `path`.
 */
type AuthRoute = ExactAuthRoute | PatternAuthRoute;

/**
 * **The matchers two rows each share**, named once so there is one place that
 * decides what they match.
 *
 * The chain still declares bindings read by two guards apiece, and each of those
 * is a single `const`. (It was fourteen when the table was built; every slice
 * takes some of them, so the number is not written down here — a count that
 * decays once per commit is a comment that will be wrong more often than right.)
 * A table row has no such binding, so the same shape has to be a
 * module-scope constant that both rows name. Spelling a regex out twice would
 * compile, run identically today, and let the copies drift apart tomorrow —
 * tests/authenticated-api-route-contract.test.ts § `names each matcher once` is
 * what refuses that, and it counts declaration *sites*, so each of these is one
 * matcher and not two.
 *
 * A matcher used by exactly one row is written into that row instead: there is
 * nothing to keep in step, and a constant named from one place is a name to
 * chase rather than a fact recorded once. That is why referee's scan and mirror
 * patterns are not here — one row apiece — while its criteria and claims
 * patterns are.
 */
const JOBS_PATH = "/api/jobs";
const UPLOAD_PATTERN = /^\/api\/uploads\/([\w-]+)$/;
const JOB_PATTERN = /^\/api\/jobs\/([\w.%-]+)$/;
/* Referee mode's criteria: the collection, and one row. `criteria` sits inside
   the path rather than as `/api/referee/:slug` because the mode has four
   sub-modes and three of them will want routes of their own —
   `/api/referee/claims/:slug` and `/api/referee/mirror/:slug` both arrived under
   it without a rename — and a namespace decided now is cheaper than a rename
   later. Claims is **one pattern, not two**: there is one claims run per
   article, so there is no row to name; GET reads it, POST replaces it. */
const CRITERIA_PATTERN = /^\/api\/referee\/criteria\/([\w.%-]+)$/;
const ONE_CRITERION_PATTERN = /^\/api\/referee\/criteria\/([\w.%-]+)\/([\w.%-]+)$/;
const REFEREE_CLAIMS_PATTERN = /^\/api\/referee\/claims\/([\w.%-]+)$/;
/* Search: the runs of one article, and one run of one article. Two rows apiece,
   so both are named here rather than spelled into the rows twice. */
const SEARCHES_PATTERN = /^\/api\/search\/([\w.%-]+)$/;
const ONE_RUN_PATTERN = /^\/api\/search\/([\w.%-]+)\/([\w.%-]+)$/;
/* Chat: an article's conversations, and one conversation. Two rows apiece — GET
   and POST on the list, PATCH and DELETE on the thread — so both are named here.
   The other eight chat and live-session matchers are used by one row each and
   are written into those rows, per the rule above.

   **`ONE_THREAD_PATTERN` also matches `/api/chat/<slug>/live-tool`**, because
   `live-tool` is spelled with the same characters a thread id may use. Nothing
   is ambiguous: the live-tool row is POST and these two are PATCH and DELETE, so
   no path is accepted twice for one method —
   tests/authenticated-api-route-contract.test.ts § *allows
   /api/chat/:slug/live-tool three times, because the methods differ* is what
   holds that, and it held it while these were guards too. */
const CHAT_PATTERN = /^\/api\/chat\/([\w.%-]+)$/;
const ONE_THREAD_PATTERN = /^\/api\/chat\/([\w.%-]+)\/([\w.%-]+)$/;
/* Comments: an article's comments, and one comment. Two rows apiece — GET and
   POST on the list, PATCH and DELETE on the comment — so both are named here;
   `answer` and `mark` are one row each and are written into those rows. */
const COMMENTS_PATTERN = /^\/api\/comments\/([\w.%-]+)$/;
const ONE_COMMENT_PATTERN = /^\/api\/comments\/([\w.%-]+)\/([\w.%-]+)$/;

/**
 * **The ordered table `serveAuthenticatedApi`'s `if` chain is being moved into,
 * one domain at a time.**
 *
 * docs/plans/260907b-split-the-authenticated-api-dispatch-by-domain.md § *The
 * shape, and the fork that had to be settled*. Three opinions disagreed; this is
 * the settled one — a static ordered table of closures, gates outside it,
 * handlers owning their own response and returning nothing. The alternative was
 * fourteen `async function tryXRoutes(): Promise<boolean>` dispatchers, and the
 * argument against it is one centralised handled/miss protocol instead of
 * fourteen boolean ones.
 *
 * ## Why it is consulted *after* the chain rather than instead of it
 *
 * Because the move is incremental and must reorder nothing. What is here is the
 * **bottom of the chain, taken upward**: billing was its last four guards, jobs
 * and uploads the nine immediately above those, referee the eight above them,
 * search the four above *those*, chat and the live sessions the twelve above
 * those again, and comments the six above chat — and asking the table after
 * every remaining guard and before the terminal 404 puts each of them in exactly
 * the position it already had. The
 * count is deliberately not written here: it changes once per slice, and a
 * number in a comment that decays on a schedule is a comment that is wrong more
 * often than right. `EXPECTED_AUTH_ROUTES` in
 * tests/authenticated-api-route-contract.test.ts is where the inventory lives.
 *
 * **So the rows are in chain order, and prepending is how a domain arrives.**
 * The next slice up goes above the comments rows, not below them — the table's
 * order *is* the chain's order, continued. Taking the slice contiguously is also what
 * preserves the one interleave here for free: `/api/uploads` and
 * `/api/uploads/:id` sit *between* `GET /api/jobs` and `POST /api/jobs`, which is
 * why these rows are not grouped by domain name and must not be tidied into it.
 *
 * A domain lifted out of the *middle* of the chain could not be added here
 * without also proving the reorder is safe — which the contract test's § *no two
 * guards accept the same method and path* is what would say. Its disjointness is
 * a corpus check over a hand audit, not a proof, so the safe move is to go on
 * taking the bottom slice (GPT Sol, stage 3a review § P2-STAGE3B-ORDER). And
 * there must stay exactly **one** dispatch of this table: a second call earlier
 * in the chain would let billing answer from the wrong position.
 *
 * ## What the entries may not do
 *
 * **Nothing, at construction.** Building this array evaluates string literals,
 * regex literals and function expressions and calls nothing — so importing
 * src/routes.ts still contacts no provider, opens no pool and reads no store.
 * tests/owner-isolation.test.ts does not cover that (GPT Sol, review §
 * P2-ISOLATION-SCOPE), so the contract test asserts it directly against this
 * literal.
 *
 * **No `g` or `y` flag**, refused by `assertDispatchableRoutes` below.
 */
const AUTH_ROUTES: readonly AuthRoute[] = [
  {
    kind: "pattern",
    method: "GET",
    pattern: COMMENTS_PATTERN,
    handler: async ({ request: { res } }, captures) => {
      const slug = slugPart(captures, 1);
      send(res, 200, { comments: await sweepOrphaned(slug) });
    },
  },

  {
    kind: "pattern",
    method: "POST",
    pattern: COMMENTS_PATTERN,
    handler: async ({ request: { req, res } }, captures) => {
      /* **Making a comment is free and answers with JSON.** Until 2026-08-28
         this path was `answer`, which spends a model call and streams; the two
         meanings now have two routes, because a colliding id means opposite
         things to them — a retry to one, somebody else's comment to the other.
         docs/plans/260828a-comments-and-bookmarks.md § the store contract. */
      send(res, 201, { comment: await createFree(slugPart(captures, 1), await readBody(req)) });
    },
  },

  /* Answering is its own sub-path rather than a field on the POST, because it
     is the one thing a comment can do that spends money and streams. **There is
     deliberately no route for linking a comment to its conversation**: the only
     place that knows the real thread id is the chat stream itself, so the link
     is written there. See docs/plans/260828a-comments-and-bookmarks.md. */
  {
    kind: "pattern",
    method: "POST",
    pattern: /^\/api\/comments\/([\w.%-]+)\/([\w.%-]+)\/answer$/,
    handler: async ({ request: { req, res } }, captures) => {
      /* The one endpoint here that does not answer with JSON — it writes its
         own headers and ends the response. It is still reached through `send`
         for its *failures*: validation throws before a header is written, so a
         bad request is an ordinary 400. */
      const [slug, id] = [slugPart(captures, 1), part(captures, 2)];
      const answerBody = await readBody(req);
      await withSpendAttribution({ articleSlug: slug }, () =>
        answer(slug, id, answerBody, res),
      );
    },
  },

  /* **The referee's own placement, changed** — its own sub-path rather than two
     more fields on the `PATCH` below, and the reason is what that route's own
     bug turned out to be. A patch route carrying more than one thing has to
     decide what an absent key means, and "leave it alone" is one missing branch
     away from "clear it": a placement would then be destroyed by a request that
     never mentioned it, with a 200 in the answer and nothing in the log.
     docs/reusable/silent-success.md, and
     docs/plans/260901i-the-referee-places-the-passage-themselves.md § *Why a
     separate path*. A named path cannot express the ambiguity. */
  {
    kind: "pattern",
    method: "PATCH",
    pattern: /^\/api\/comments\/([\w.%-]+)\/([\w.%-]+)\/mark$/,
    handler: async ({ request: { req, res } }, captures) => {
      /* **Both fields, always, and a half body is a 400.** `tidyMark` reads an
         absent key as "no placement", which is right on the create path and
         would be a silent wipe here — a request naming only `criterionId` would
         clear the number the referee chose and answer 200. The pair is one
         value, so the route asks for the pair; `{ criterionId: null, valence:
         null }` is how a placement is cleared, deliberately and in writing.

         This rule is the route's own and is not a second copy of what a
         placement is: `tidyMark` still owns every rule about the values, and it
         is the same `tidyMark` the create path uses. */
      const [slug, id] = [slugPart(captures, 1), part(captures, 2)];
      const raw = fields(await readBody(req));
      if (!("criterionId" in raw) || !("valence" in raw)) {
        throw httpError(
          400,
          "A placement carries both criterionId and valence, each a value or null [cmt-mark-pair]",
        );
      }
      const mark = await tidyMark(slug, raw);
      send(res, 200, { comment: await commentStore.patchMark(slug, id, mark) });
    },
  },

  {
    kind: "pattern",
    method: "PATCH",
    pattern: ONE_COMMENT_PATTERN,
    handler: async ({ request: { req, res } }, captures) => {
      const [slug, id] = [slugPart(captures, 1), part(captures, 2)];
      const raw = fields(await readBody(req));
      /* **A patch that never mentions the body must not delete it.**
         `tidyBody(undefined)` is `null` and `patchBody` writes `body` whatever
         it is handed, so `PATCH {}` — or a `PATCH` carrying any other field —
         answered 200 and destroyed the reader's words, with nothing erroring
         and nothing in the log. It was latent only because `useComments.edit`
         is the sole caller and always sends `{ body }`, and it would have
         stopped being latent the moment this route grew a second field. Found
         by reading, 2026-09-01.

         `"body" in raw` is the whole fix, and the distinction it draws is
         real: `{ body: null }` is a reader clearing their words back to a bare
         bookmark and stays a 200, while no `body` key at all is a request that
         does not say what it wants — absent could mean *clear it* or *leave
         it*, and the route must not guess. docs/reusable/silent-success.md.

         **Unknown keys are ignored rather than refused**, deliberately: with
         the body required, the worst a field this route does not act on can do
         is nothing, and a no-op is visible where a wipe was not. Refusing every
         unrecognised key is a stricter rule than any other route here keeps,
         and `POST /api/comments/:slug` cannot keep it at all — it reads several
         fields off one body. */
      if (!("body" in raw)) {
        throw httpError(400, "A body patch has to say what the body is, or null [cmt-body-missing]");
      }
      // `tidyBody` is the one place that decides what a body may be, so the
      // route no longer keeps a second, slightly different copy of that rule.
      send(res, 200, { comment: await commentStore.patchBody(slug, id, tidyBody(raw.body)) });
    },
  },

  {
    kind: "pattern",
    method: "DELETE",
    pattern: ONE_COMMENT_PATTERN,
    handler: async ({ request: { res } }, captures) => {
      // The slug becomes a directory; the id is only ever matched against a list.
      const [slug, id] = [slugPart(captures, 1), part(captures, 2)];
      send(res, 200, { comments: await commentStore.remove(slug, id) });
    },
  },

  {
    kind: "pattern",
    method: "GET",
    pattern: CHAT_PATTERN,
    handler: async ({ request: { res, query } }, captures) => {
      const slug = slugPart(captures, 1);
      const threads = await sweepChat(slug);
      /* **`?summary=1` is the reading view's version of this list**, and it is a
         parameter rather than a route because it is the same question with the
         transcripts left off — same sweep, same order, same ids.

         The reading view needs one thing from chat: which conversations are
         anchored to which passage, so it can draw a mark and say something on
         hover. Handing it the transcripts as well is not merely wasteful. Chat
         state changes on every streamed token, so holding threads above
         `TableView` would re-render — and re-`annotateHtml` — every paragraph
         of the article, hundreds of times, while an answer arrives. Found by a
         GPT-5.6 review, 2026-08-26; docs/plans/260826ab-chat-as-gateway.md § summaries. */
      if (query.get("summary") === "1") {
        send(res, 200, { threads: threads.map(summarise) });
        return;
      }
      send(res, 200, { threads });
    },
  },

  {
    kind: "pattern",
    method: "POST",
    pattern: CHAT_PATTERN,
    handler: async ({ request: { req, res } }, captures) => {
      /* The one branch that does not call `send`. It writes its own headers and
         ends the response itself, so there is nothing for `send` to do — but
         `res.statusCode` is still set, which is all the logging in `finally`
         reads. A stream that fails *before* the headers go out throws, and the
         catch below answers it as ordinary JSON; after that, the failure is an
         `error` frame inside a 200, because the status line is long gone. */
      /* **The article goes on every row this request writes.** Without it,
         "what has this piece cost me" would cover the ingest and none of the
         questions asked about it afterwards — which is the half a reader
         actually generates. src/ai-spend.ts § `withSpendAttribution`. */
      const chatBody = await readBody(req);
      await withSpendAttribution({ articleSlug: slugPart(captures, 1) }, () =>
        streamChat(slugPart(captures, 1), chatBody, res),
      );
    },
  },

  {
    kind: "pattern",
    method: "POST",
    pattern: /^\/api\/chat\/([\w.%-]+)\/([\w.%-]+)\/cancel$/,
    handler: async ({ request: { req, res } }, captures) => {
      const [slug, id] = [slugPart(captures, 1), part(captures, 2)];
      send(res, 200, await cancelChat(slug, id, await readBody(req)));
    },
  },

  {
    kind: "pattern",
    method: "POST",
    pattern: /^\/api\/chat\/([\w.%-]+)\/live-tool$/,
    handler: async ({ request: { req, res } }, captures) => {
      /* Attributed like every other paid call this article causes. A tool run
         may embed or search, and "what has this piece cost me" should not stop
         at the questions that were typed. */
      const slug = slugPart(captures, 1);
      const toolBody = await readBody(req);
      send(
        res,
        200,
        await withSpendAttribution({ articleSlug: slug }, () => liveTool(slug, toolBody)),
      );
    },
  },

  /* **Live conversation's ticket.** It is under the conversation rather than
     under the article because it seeds the session with the thread. Its pair is
     `POST /api/chat/:slug/:threadId/spoken`, the write that lands a finished
     exchange back in that thread; the `/api/live/:sessionId/…` routes are the
     session's accounting, a different subject with its own comment.

     **The two halves of that pair are not adjacent here, and were not adjacent
     in the chain either** — the accounting routes have always sat between them,
     because this table is in the order the chain dispatched and that is the
     order the chain had. Rearranging it into subject order would be the one edit
     a slice of this migration may not make. (An earlier draft of this comment
     said they *had* been adjacent and that the move separated them. Both halves
     were wrong; GPT Sol, 260908a stage 2/3 review § F11.) */
  {
    kind: "pattern",
    method: "POST",
    pattern: /^\/api\/chat\/([\w.%-]+)\/([\w.%-]+)\/live$/,
    handler: async ({ request: { req, res } }, captures) => {
      const [slug, id] = [slugPart(captures, 1), part(captures, 2)];
      send(res, 200, await liveChatToken(slug, id, await readBody(req)));
    },
  },

  /* **Live conversation's three accounting endpoints, and they are NOT under
     `/api/chat/`.**

     `POST /api/chat/:slug/:threadId/live` and `…/spoken` are: a ticket needs the
     thread to seed from, and a spoken exchange is appended to it. These three
     are about the *session* — what it
     spent, when its channel opened, when it ended — and a session outlives the
     thread it started in, may be reported against after the reader has moved on,
     and is addressed by a uuid this server minted rather than by a slug and a
     thread id. Routing them under a conversation would have made every report
     carry two identifiers that nothing checks against each other, which is two
     more ways for a report to be about the wrong thing.

     `[\w-]+` rather than the slug class the rest of this file uses: these ids
     are uuids from `randomUUID`, so a dot or a percent-escape in one is not a
     spelling to accept, it is a request to look at. */
  {
    kind: "pattern",
    method: "POST",
    pattern: /^\/api\/live\/([\w-]+)\/connected$/,
    handler: async ({ request: { res } }, captures) => {
      send(res, 200, await liveConnected(part(captures, 1)));
    },
  },

  {
    kind: "pattern",
    method: "POST",
    pattern: /^\/api\/live\/([\w-]+)\/usage$/,
    handler: async ({ request: { req, res } }, captures) => {
      /* **Not wrapped in `withSpendAttribution`, and that is deliberate.** That
         helper puts an article on rows the *collector* writes — the calls made
         inside this request. This request makes no model call at all: it reports
         one that happened on a wire this server never touched, and the row is
         built and written directly. The article comes off the session row, which
         is a more durable answer than the ambient scope anyway. */
      send(res, 200, await liveUsage(part(captures, 1), await readBody(req)));
    },
  },

  {
    kind: "pattern",
    method: "POST",
    pattern: /^\/api\/live\/([\w-]+)\/close$/,
    handler: async ({ request: { req, res } }, captures) => {
      send(res, 200, await liveClose(part(captures, 1), await readBody(req)));
    },
  },

  {
    kind: "pattern",
    method: "POST",
    pattern: /^\/api\/chat\/([\w.%-]+)\/([\w.%-]+)\/spoken$/,
    handler: async ({ request: { req, res } }, captures) => {
      /* **The spend attribution the streaming route has, for the half of a live
         session this server can see.** It buys nothing today: the realtime rows
         are written by `/api/live/:sessionId/usage` above, which takes its
         article off the session row rather than off the ambient scope. Kept
         because this request makes model calls of its own the moment anything
         here does, and because it is the only request in a live conversation
         that knows which article it belongs to. */
      const [slug, id] = [slugPart(captures, 1), part(captures, 2)];
      const spokenBody = await readBody(req);
      send(
        res,
        200,
        await withSpendAttribution({ articleSlug: slug }, () => spokenChat(slug, id, spokenBody)),
      );
    },
  },

  {
    kind: "pattern",
    method: "POST",
    pattern: /^\/api\/chat\/([\w.%-]+)\/([\w.%-]+)\/stop$/,
    handler: async ({ request: { req, res } }, captures) => {
      // The slug becomes a directory; the ids are only ever matched in a Map.
      const [slug, id] = [slugPart(captures, 1), part(captures, 2)];
      send(res, 200, await stopChat(slug, id, await readBody(req)));
    },
  },

  {
    kind: "pattern",
    method: "PATCH",
    pattern: ONE_THREAD_PATTERN,
    handler: async ({ request: { req, res } }, captures) => {
      // Slug becomes a directory; the thread id is only ever matched in a list.
      const [slug, id] = [slugPart(captures, 1), part(captures, 2)];
      const { title } = objectBody(await readBody(req));
      if (typeof title !== "string") throw httpError(400, "Expected { title }");
      send(res, 200, { threads: await chatStore.rename(slug, id, title) });
    },
  },

  {
    kind: "pattern",
    method: "DELETE",
    pattern: ONE_THREAD_PATTERN,
    handler: async ({ request: { res } }, captures) => {
      const [slug, id] = [slugPart(captures, 1), part(captures, 2)];
      /* Under the conversation's turn order, like the writes in `streamChat`.
         A retry or an edit checks that it will be accepted, then aborts the live
         answer, then writes — and a delete landing between the check and the
         write puts the abort-then-refuse bug back in a narrower window. There is
         no reason a delete needs to interleave with a turn, so it does not. */
      send(res, 200, {
        threads: await inTurnOrder(`${slug}/${id}`, () => chatStore.remove(slug, id)),
      });
    },
  },

  /* **Search — the runs list, and one run.** The chain's last four guards
     before this table was consulted, moved here on 2026-09-07 in the order they
     had, and therefore still answering from the position they answered from.
     docs/plans/260907b-split-the-authenticated-api-dispatch-by-domain.md.

     **`POST /api/search/:slug` streams and holds a lock** — `search()` marks the
     run `searching` and writes SSE — so, like referee's three, this handler
     returns its promise for `dispatchAuthRoute` to await. A closure that
     launched the call and resolved would end the request mid-stream with the run
     still locked. The lock and the stream both live inside `search()`, which
     this move does not touch. */
  {
    kind: "pattern",
    method: "GET",
    pattern: SEARCHES_PATTERN,
    handler: async ({ request: { res } }, captures) => {
      const slug = slugPart(captures, 1);
      send(res, 200, { runs: await sweepSearches(slug) });
    },
  },

  {
    kind: "pattern",
    method: "POST",
    pattern: SEARCHES_PATTERN,
    handler: async ({ request: { req, res } }, captures) => {
      /* The third endpoint in this file that does not answer with JSON — see
         `answer`, which writes its own headers and ends the response. It is
         still reached through `send` for its *failures*: validation throws
         before a header is written, so a bad request is an ordinary 400. */
      const searchBody = await readBody(req);
      await withSpendAttribution({ articleSlug: slugPart(captures, 1) }, () =>
        search(slugPart(captures, 1), searchBody, res),
      );
    },
  },

  {
    kind: "pattern",
    method: "PATCH",
    pattern: ONE_RUN_PATTERN,
    handler: async ({ request: { req, res } }, captures) => {
      // Slug becomes a directory; the run id is only ever matched against a list.
      const [slug, id] = [slugPart(captures, 1), part(captures, 2)];
      /* Checked before it is destructured — see `objectBody`, which is where
         the reasoning and the other four callers now live. The sentence this
         comment used to carry, that "the same hole is latent in the other
         PATCH routes here", stayed true for as long as it was the only thing
         enforcing itself. */
      const { colour } = objectBody(await readBody(req));
      /* `null` is a real value here — it is how the reader says "put this row
         back on whatever colour it would have had". So the check cannot be a
         truthiness one, and it cannot be `!colour` either: slot **0** is a
         colour, and every `if (!colour)` in this route would have refused the
         first hue in the palette while accepting the other seven. */
      if (colour !== null && !isStorableColour(colour)) {
        throw httpError(400, "Expected { colour } to be null or a small whole number");
      }
      send(res, 200, { runs: await searchStore.recolour(slug, id, colour) });
    },
  },

  {
    kind: "pattern",
    method: "DELETE",
    pattern: ONE_RUN_PATTERN,
    handler: async ({ request: { res } }, captures) => {
      // The slug becomes a directory; the id is only ever matched against a list.
      const [slug, id] = [slugPart(captures, 1), part(captures, 2)];
      send(res, 200, { runs: await searchStore.remove(slug, id) });
    },
  },

  /* **Referee — criteria, claims, scan, mirror.** The chain's last eight guards
     before this table was consulted, moved here on 2026-09-07 in the order they
     had, and therefore still answering from the position they answered from.
     docs/plans/260907e-referee-joins-the-route-table-and-the-stream-lifetime-test-that-has-to-come-first.md.

     **Three of these stream**, which is what made this slice different from the
     thirteen before it: criteria POST and claims POST each open SSE *and hold a
     live-run lock*, and mirror POST opens SSE. Each handler therefore has to
     return its promise — `dispatchAuthRoute` awaits it, and a closure that
     launched the call and resolved would end the request mid-stream with the
     lock still held. tests/referee-stream-lifetime.test.ts holds all three open
     and asks; it was written against these guards *before* they moved, so it
     says the same thing about both arrangements. */
  {
    kind: "pattern",
    method: "GET",
    pattern: CRITERIA_PATTERN,
    handler: async ({ request: { res } }, captures) => {
      const slug = slugPart(captures, 1);
      /* Both halves in one response, and read close together, for the reason
         `SearchStore.sourceHash` gives (src/store/contracts.ts): the paper can
         be re-extracted between them, and a list read before a hash read would
         be compared against an article none of its criteria ever saw. */
      send(res, 200, {
        criteria: await sweepCriteria(slug),
        sourceHash: await refereeCriteriaStore.sourceHash(slug),
      });
    },
  },

  {
    kind: "pattern",
    method: "POST",
    pattern: CRITERIA_PATTERN,
    handler: async ({ request: { req, res } }, captures) => {
      /* The fourth endpoint in this file that does not answer with JSON — see
         `answer` and `search`. It is still reached through `send` for its
         *failures*: `readCriterionRequest` throws before a header is written,
         so a bad request is an ordinary 400. */
      const criteriaBody = await readBody(req);
      await withSpendAttribution({ articleSlug: slugPart(captures, 1) }, () =>
        runRefereeCriterion(slugPart(captures, 1), criteriaBody, res),
      );
    },
  },

  {
    kind: "pattern",
    method: "PATCH",
    pattern: ONE_CRITERION_PATTERN,
    handler: async ({ request: { req, res } }, captures) => {
      // Slug becomes a directory; the id is only ever matched against a list.
      const [slug, id] = [slugPart(captures, 1), part(captures, 2)];
      const { colour } = objectBody(await readBody(req));
      /* **`{ colour }` and nothing else**, exactly as the search PATCH beside
         it. A criterion's text, kind and poles are not editable through this
         route — changing the question is what POST does, because a changed
         question needs a fresh model call and this route makes none.

         `null` is a real value: it is how the referee says "put this row back
         on whatever colour it would have had". So the check cannot be a
         truthiness one, and it cannot be `!colour` either — slot **0** is a
         colour. */
      if (colour !== null && !isStorableColour(colour)) {
        throw httpError(400, "Expected { colour } to be null or a small whole number");
      }
      send(res, 200, { criteria: await refereeCriteriaStore.recolour(slug, id, colour) });
    },
  },

  {
    kind: "pattern",
    method: "DELETE",
    pattern: ONE_CRITERION_PATTERN,
    handler: async ({ request: { res } }, captures) => {
      const [slug, id] = [slugPart(captures, 1), part(captures, 2)];
      send(res, 200, { criteria: await refereeCriteriaStore.remove(slug, id) });
    },
  },

  {
    kind: "pattern",
    method: "GET",
    pattern: REFEREE_CLAIMS_PATTERN,
    handler: async ({ request: { res } }, captures) => {
      const slug = slugPart(captures, 1);
      /* Both halves in one response, and read close together, for the reason
         `SearchStore.sourceHash` gives (src/store/contracts.ts): the paper can
         be re-extracted between them, and a run read before a hash read would
         be compared against an article it was never answered about.

         The sweep is a *read* that repairs: a `pending` run this process is not
         running is one an earlier process died in the middle of, and leaving it
         would be a spinner nothing can ever clear. */
      send(res, 200, {
        run: await refereeClaimsStore.sweep(slug, pullingClaims.has(slug)),
        sourceHash: await refereeClaimsStore.sourceHash(slug),
      });
    },
  },

  {
    kind: "pattern",
    method: "POST",
    pattern: REFEREE_CLAIMS_PATTERN,
    handler: async ({ request: { res } }, captures) => {
      /* The sixth endpoint in this file that does not answer with JSON. It still
         reaches `send` for its failures: `loadArticle` throws its 404 and
         `claimsProblem` its 400 before a header is written, which is why both
         are the first two lines of `runRefereeClaims`.

         **No body is read at all** — see that function's docstring. A POST with
         a body is not refused, it is ignored, which is the same call
         `POST /api/referee/mirror/:slug` makes.

         `withSpendAttribution`, because the call inside it pays: the rows have
         to carry the article or the cost report cannot say which paper a
         referee's session was about. src/ai-spend.ts. */
      await withSpendAttribution({ articleSlug: slugPart(captures, 1) }, () =>
        runRefereeClaims(slugPart(captures, 1), res),
      );
    },
  },

  /* The source scan, and the one route under `/api/referee/` that is not a
     sub-mode: it belongs to the **mode**, because a hidden instruction is a fact
     about the document that bears on Criteria, Claims, Mirror and Candidates
     alike. GET only, and nothing to POST: the answer is a pure function of bytes
     already stored, so asking for it is reading. One row, so the pattern is
     written here rather than named above. */
  {
    kind: "pattern",
    method: "GET",
    pattern: /^\/api\/referee\/scan\/([\w.%-]+)$/,
    handler: async ({ request: { res } }, captures) => {
      const slug = slugPart(captures, 1);
      /* **Ask whose article this is before reading a byte of it**, exactly as
         `sendSource` does and for the same reason: this route reads the
         reader's original manuscript off disk or out of the bucket, and the
         Postgres reader's own `ownedSlug` filter is the second refusal rather
         than the only one. tests/owner-isolation.test.ts pins that ordering
         there; tests/referee-scan-route.test.ts pins it here. The answer is
         discarded — it is asked as a question. */
      await shelfStore.read(slug);
      /* **No `withSpendAttribution`**, and its absence is the point rather than
         an omission: this is the one thing in Referee mode that calls no model.
         It is deterministic, free, and it reports without deciding anything —
         see src/injection-scan.ts § *It reports. It does not decide.*

         It can take several seconds on a large paper, which is why the panel
         fetches it beside the band rather than in front of it: the band opens
         at once and this lands when it lands (src/web/useSourceScan.ts). */
      const { scan } = await scanArticleSource(slug);
      /* **`scan: null` is "this article kept no source document"**, and it is
         sent rather than turned into a 404 because the two mean different
         things to a referee: a 404 says *no such paper*, and this says *there
         is nothing here to check, so a clean report would be a lie*. A dangling
         reference is neither — `loadSource` throws a 500 for that, above. */
      send(res, 200, { scan });
    },
  },

  /* Mirror, the second sub-mode to get a route, and the namespace above is why
     it needed no rename to arrive. POST only: a run is a model call the referee
     asks for and nothing is stored, so there is nothing to GET, nothing to PATCH
     and nothing to DELETE. One row, so the pattern is written here. */
  {
    kind: "pattern",
    method: "POST",
    pattern: /^\/api\/referee\/mirror\/([\w.%-]+)$/,
    handler: async ({ request: { res } }, captures) => {
      /* The fifth endpoint in this file that does not answer with JSON. It
         still reaches `send` for its failures: `loadArticle` throws its 404
         before a header is written, and `runMirror` reads everything it needs
         above `sse(res)` for exactly that reason.

         `withSpendAttribution`, because the call inside it pays — the rows have
         to carry the article or the cost report cannot say which paper a
         referee's session was about. src/ai-spend.ts. */
      await withSpendAttribution({ articleSlug: slugPart(captures, 1) }, () =>
        runMirror(slugPart(captures, 1), res),
      );
    },
  },

  {
    kind: "exact",
    method: "GET",
    path: JOBS_PATH,
    handler: async ({ request: { res } }) => {
      send(res, 200, { jobs: (await listJobs()).map(publicJob) });
    },
  },

  {
    kind: "exact",
    method: "POST",
    path: "/api/uploads",
    handler: async ({ request: { req, res } }) => {
      // 201: a record now exists that did not before, and the body says where
      // to put the bytes. Nothing has been queued and nothing has been read.
      send(res, 201, await mintAnUpload(await readBody(req)));
    },
  },

  /* `GET /api/uploads/:id` — for a browser that lost its tab, and for the
     picker to confirm what landed. Read-only in the strict sense: an expired
     grant is *reported* as expired without the record being rewritten, so a
     poll cannot be a mutation. See `asOf`. */
  /* `DELETE /api/uploads/:id` — **the reader pressed Stop.**
     `pending → expired`, so a reload of `/add/upload/<id>` is answered rather
     than polled at for the two hours of the grant, and so that *"nothing was
     added"* is a claim the server backs rather than one the browser asserts
     about itself. `cancelUpload` for the race against a queue request that
     got there first: it loses, quietly, and the ingest goes on.

     200 either way, with `cancelled` saying which. A Stop that arrived too
     late is not an error the reader did anything wrong to cause, and the page
     is about to show them the running job it lost to. */
  {
    kind: "pattern",
    method: "DELETE",
    pattern: UPLOAD_PATTERN,
    handler: async ({ request: { res } }, captures) => {
      const id = part(captures, 1);
      const stopped = await cancelUpload(id, currentOwnerId());
      send(res, 200, { uploadId: id, cancelled: stopped });
    },
  },

  {
    kind: "pattern",
    method: "GET",
    pattern: UPLOAD_PATTERN,
    handler: async ({ request: { res } }, captures) => {
      const id = part(captures, 1);
      const found = await readUpload(id, currentOwnerId());
      if (!found) throw httpError(404, "No such upload");
      /* **After the ownership check, never before.** A `head` on a staging key
         derived from an id is a yes-or-no about somebody else's file, and this
         route already answers 404 for an upload that is not the reader's. */
      send(res, 200, publicUpload(asOf(found), await uploadHasArrived(id)));
    },
  },

  {
    kind: "exact",
    method: "POST",
    path: JOBS_PATH,
    handler: async ({ request: { req, res } }) => {
      // 202, not 200: the work has been accepted and has not been done. The
      // body is the receipt to poll, which is the only thing there is to say
      // about a job that has not started.
      const request = parseJobRequest(await readBody(req));
      const uploadId = request.uploadId;
      if (uploadId !== undefined) {
        /* No other field survives `checkUploadOrigin`, so there is nothing to
           forward: an upload is always the default ingest.

           **Three steps, and the order is the point.** Each of the first two is
           outside the quota slot, because neither of them is a new ingest:

           1. `resolveExistingUpload` — the answer for a reload, a second tab or
              a double-click is the job that already exists, and asking for it
              inside `withIngestSlot` meant a reader with nothing left was told
              402 about a slot nobody needed (GPT Sol, 2026-09-03).
           2. `uploadHasArrived` — the readiness gate. The reader reaches this
              address at byte zero now, so "the file is not there yet" is an
              ordinary state and must cost nothing: no claim, no job, no slot.
              Queueing anyway is what `acquireUpload` refuses **terminally**.
           3. and only then a **new ingest, which takes a quota slot** — with no
              slug to name the reservation with, because the article's name comes
              from the upload record's filename inside `queueAnUpload`. */
        const existing = await resolveExistingUpload(uploadId);
        if (existing?.kind === "article") {
          send(res, 200, { article: existing.slug });
          return;
        }
        if (existing) {
          send(res, 202, publicJob(existing.job));
          return;
        }
        if (!(await uploadHasArrived(uploadId))) {
          throw httpError(409, UPLOAD_STILL_ARRIVING.message);
        }
        const outcome = await withIngestSlot({ ownerId: currentOwnerId() }, (slot) =>
          queueAnUpload(uploadId, slot),
        );
        /* **200, not 202**: nothing has been accepted, because there is nothing
           left to do. The file became this article a while ago and its job
           record has since been trimmed — `queueAnUpload` for why the record
           rather than the job is what answers. */
        if (outcome.kind === "article") {
          send(res, 200, { article: outcome.slug });
          return;
        }
        send(res, 202, publicJob(outcome.job));
        return;
      }
      /* **Not for the `{ url }` shape**, and that is a correctness fix rather
         than an economy. The slug this resolves against is the one *derived*
         from the URL, and `enqueue` may not use it: `freeSlug` renames on a
         collision. So resolving here would read the purpose of *another
         article* and stamp a new one's artefacts with it — and under `postgres`
         it would simply throw, because the article does not exist yet.

         Nothing is lost. A new ingest runs `DEFAULT_INGEST_STEPS`, which stops
         at `arc`, and no step in it takes a profile. The reader asks for a
         glossary or a set of ideas later, by slug, and that request resolves
         correctly. GPT Sol's review of the built code, 2026-08-26.

         `=== false`, so absent means yes: a client that has never heard of this
         field gets the profiled run, which is the default the panel offers. */
      const profile =
        request.url !== undefined || request.useProfile === false
          ? null
          : await resolveProfile(request.slug);
      const { useProfile: _asked, ...work } = request;
      const queue = (slot: IngestSlot) =>
        enqueue({ ...work, ...(profile ? { profile } : {}), ...slot });
      /**
       * **A URL is a new ingest and spends a slot; a bare slug is a re-run and
       * is free.** The two shapes arrive at the same endpoint and are told apart
       * only here — by the time `enqueue` has them, a re-run's job carries a URL
       * too, read off the article it names.
       *
       * That is the whole of docs/project/billing.md § *The quota*: a slot is
       * one successful **new** ingest, and asking for a glossary, a set of ideas
       * or a quiz on an article already on the shelf costs nothing.
       */
      const job =
        request.url === undefined
          ? await queue({})
          : await withIngestSlot({ ownerId: currentOwnerId(), slug: request.slug }, queue);
      send(res, 202, publicJob(job));
    },
  },

  {
    kind: "pattern",
    method: "GET",
    pattern: JOB_PATTERN,
    handler: async ({ request: { res } }, captures) => {
      const found = await getJob(part(captures, 1));
      if (!found) throw httpError(404, "No such job");
      send(res, 200, publicJob(found));
    },
  },

  {
    kind: "pattern",
    method: "DELETE",
    pattern: JOB_PATTERN,
    handler: async ({ request: { res } }, captures) => {
      if (!(await forgetJob(part(captures, 1)))) throw httpError(404, "No such job");
      send(res, 200, { forgotten: part(captures, 1) });
    },
  },

  {
    kind: "pattern",
    method: "POST",
    pattern: /^\/api\/jobs\/([\w.%-]+)\/(cancel|retry)$/,
    handler: async ({ request: { res } }, captures) => {
      const [id, action] = [part(captures, 1), part(captures, 2)];
      /* **Retry is the second front door to a new ingest**, and it never passes
         through the handler above: a check bolted on there alone would leave a
         failed ingest retryable free for ever. `withRetrySlot` reserves only
         when the attempt being repeated spent a slot — src/billing/admission.ts. */
      const result =
        action === "cancel"
          ? await cancelJob(id)
          : await withRetrySlot({ jobId: id, ownerId: currentOwnerId() }, (slot) =>
              retryJob(id, slot),
            );
      if (!result) throw httpError(404, "No such job");
      send(res, action === "cancel" ? 200 : 202, publicJob(result));
    },
  },

  /**
   * Run one step of this job, here, now, and answer when it is finished.
   *
   * Its own branch rather than a third name in `jobAction` above, because it
   * is the one job action that does not answer with a bare `Job`: the caller
   * is a loop, and a loop needs to be told whether to come back — see
   * `Advanced` in src/jobs.ts and docs/plans/260826q-job-queue-rethink.md.
   *
   * **A long request on purpose.** One step can be a minute of model calls,
   * and that is the design: the browser holds the request open so the work
   * happens inside an invocation somebody is waiting on, rather than in a
   * floating promise a serverless runtime is free to freeze. `vercel.json`
   * caps a function at **800** seconds (`functions."api/**".maxDuration`),
   * which is the real ceiling on a request. It is not the ceiling on a *step*:
   * the claimant aborts itself at `LEASE_MS - DEADLINE_MARGIN_MS` = 740 s so
   * that an expired lease means *the process is gone*, and a step that
   * overruns that hands the job back rather than ending it
   * (src/jobs.ts § `LEASE_MS`, src/store/jobs.ts § `pauseForDeadline`). This
   * line said 300 seconds, which no version of `vercel.json` in this repo has
   * ever said.
   *
   * **200, not 409, when somebody else has it.** A second tab asking to
   * advance a job that is already advancing is a correct thing for a correct
   * client to do — it cannot know without asking — so it is an answer, not an
   * error. `readJson` in src/web/lib/api.ts throws on any non-2xx, so a 409
   * would turn the ordinary case into a message on the reader's screen.
   */
  {
    kind: "pattern",
    method: "POST",
    pattern: /^\/api\/jobs\/([\w.%-]+)\/advance$/,
    handler: async ({ request: { res } }, captures) => {
      const advanced = await advanceJob(part(captures, 1));
      if (!advanced) throw httpError(404, "No such job");
      send(res, 200, advanced);
    },
  },

  /**
   * **The four billing routes.** No slug and no id in any path: each is about
   * the reader who is signed in, and the only one that takes an identifier at
   * all takes a Checkout Session id in its *body*, where it is proved to be
   * theirs before anything is done with it (src/billing/checkout.ts).
   *
   * They are exact paths, like the shelf's, so `/api/billing/anything` is a 404
   * rather than a quiet match — and none of them is a namespace, for the same
   * reason `/api/webhooks/stripe` is not: a namespace is somewhere a later
   * endpoint gets added without anybody re-reading the ordering rules that make
   * checkout safe.
   *
   * **Three POSTs and one GET, and the split is not about which of them writes.**
   * `checkout` and `portal` each *create a Stripe object* — a Checkout Session
   * is a real, chargeable thing — and `confirm` retrieves one and then **writes
   * a subscription into `billing_accounts`**. A GET is something a browser
   * prefetches, a crawler follows and a cache may keep, and none of those three
   * should be. `usage` reads four of our own tables, writes nothing and never
   * touches the network, so asking for it twice costs nothing and means nothing:
   * that is a GET.
   * docs/project/billing.md.
   *
   * **Start a subscription — or, if they already have one, manage it.**
   *
   * The whole handler is one call, and that is deliberate: the order of
   * operations inside `startCheckout` is what stops a paying customer arriving
   * at a webhook that cannot find them, and it is written out once in
   * src/billing/checkout.ts rather than spread across a route.
   *
   * The reply carries `kind` as well as `url`, so a client *can* tell which
   * door it is being sent through — the two look identical to
   * `location.assign`. **Ours does not use it**, and that was a decision
   * rather than an omission: it navigates immediately, and a sentence rendered
   * for the half-second before a navigation is a sentence nobody reads. The
   * page says which door it is before the press instead of after it: since
   * 2026-09-04 `summary.purchase` (src/billing-plan.ts) carries the same
   * distinction, so a subscriber's button reads *Switch plan* and the sentence
   * under the cards names the Portal. The field stays because the two outcomes
   * really are different and a caller that wanted to wait could say so. This
   * comment claimed the client explained it; it did not. GPT Sol, 2026-09-03.
   *
   * **200, not 302.** A redirect would be answered by `fetch` before the page
   * could say anything, and the client is an SPA that navigates itself.
   */
  {
    kind: "exact",
    method: "POST",
    path: "/api/billing/checkout",
    handler: async ({ request: { req, res } }) => {
      const asked = parseCheckoutRequest(await readBody(req));
      send(res, 200, await startCheckout(currentOwnerId(), asked));
    },
  },

  /**
   * The hosted place to see invoices, change a card, or cancel — none of which
   * this app implements, on purpose (docs/project/billing.md § *We never touch
   * a card*). No body at all: the only thing it could carry is a customer id,
   * and that comes from the reader's own row.
   */
  {
    kind: "exact",
    method: "POST",
    path: "/api/billing/portal",
    handler: async ({ request: { res } }) => {
      send(res, 200, await openPortal(currentOwnerId()));
    },
  },

  /**
   * The return path from a completed Checkout.
   *
   * It takes **only** a session id, and `confirmCheckout` proves the session
   * is this reader's before it syncs anything — a callback that synced
   * whatever id it was handed would let one reader make this server work on
   * another's subscription, and would answer the question *did that person
   * subscribe?*.
   *
   * It is a convenience rather than the mechanism: the webhook is what makes a
   * subscription real, and this exists so the reader landing back on
   * `/profile` a second after paying sees their new plan.
   */
  {
    kind: "exact",
    method: "POST",
    path: "/api/billing/confirm",
    handler: async ({ request: { req, res } }) => {
      const body = fields(await readBody(req));
      const sessionId = body.sessionId;
      if (typeof sessionId !== "string" || sessionId === "") {
        throw httpError(400, "Expected { sessionId } from the Checkout return URL");
      }
      send(res, 200, await confirmCheckout(currentOwnerId(), sessionId));
    },
  },

  /**
   * **What plan this reader is on, and what they have used.** The one billing
   * route that is a read.
   *
   * It never reaches Stripe — see src/billing/summary.ts. A stored period that
   * has run out comes back as *we cannot say*, rather than as a guess or as
   * the 503 admission answers, because nothing is being decided here.
   */
  {
    kind: "exact",
    method: "GET",
    path: "/api/billing/usage",
    handler: async ({ request: { res } }) => {
      send(res, 200, await readBillingSummary(currentOwnerId()));
    },
  },
];

/**
 * **Refuse a `g` or `y` pattern at registration**, once, at import.
 *
 * A table entry's `RegExp` is constructed once and shared by every request that
 * reaches it — which is the whole point of a static table, and the one way it
 * differs from the 51 literals in the chain above, each of which is built fresh
 * per request. `lastIndex` on a `/g` or `/y` regex survives a call, so a shared
 * one would make whether a route matches depend on the *previous* request. All
 * 51 have no flags today, so nothing is being fixed here; this is the check that
 * stops the property being lost silently when the next domain moves.
 * § [REGEX] in docs/plans/260907b-split-the-authenticated-api-dispatch-by-domain.md.
 *
 * A throw at import rather than a per-request check: a bad registration is a
 * programmer error, and boot is when it should be found.
 */
function assertDispatchableRoutes(routes: readonly AuthRoute[]): void {
  for (const route of routes) {
    if (route.kind !== "pattern") continue;
    if (/[gy]/.test(route.pattern.flags)) {
      throw new Error(
        `AUTH_ROUTES: ${route.method} ${route.pattern} uses a \`g\` or \`y\` flag, so whether it matches would depend on the request before it`,
      );
    }
  }
}
assertDispatchableRoutes(AUTH_ROUTES);

/**
 * **First match wins, the handler is awaited, and then this returns whether it
 * answered.**
 *
 * `true` means an entry took the request and has already replied on `res`; the
 * caller must return rather than fall through to its 404. The boolean is the
 * *table's* handled/miss protocol and there is exactly one of it — handlers
 * themselves return nothing, so there is no per-handler "did you take it?" value
 * to get wrong (the shape argued for in the plan's § *The shape*).
 *
 * **The `await` is not decoration.** The catch and the finally live in
 * `serveApi`, which awaits `serveAuthenticatedApi`; a handler that returned a
 * floating promise would have its errors land nowhere and its spend counted
 * nowhere — the collector at § `withSpendAttribution` depends on the request
 * still being open. Streaming handlers must stay awaited to completion. Billing
 * opens no stream, which is part of why it is the first domain moved, but the
 * next one does. § [LIFETIME].
 *
 * **No decoding, no normalisation, no trailing-slash tolerance, no `Allow`.**
 * The method is compared, the path is compared, and nothing else happens here.
 */
async function dispatchAuthRoute(
  routes: readonly AuthRoute[],
  context: AuthRouteContext,
): Promise<boolean> {
  const { req, path } = context.request;
  for (const route of routes) {
    if (route.method !== req.method) continue;
    if (route.kind === "exact") {
      if (route.path !== path) continue;
      await route.handler(context);
      return true;
    }
    const captures = route.pattern.exec(path);
    if (captures === null) continue;
    await route.handler(context, captures);
    return true;
  }
  return false;
}

/**
 * **Everything behind the gate.** Reached only with a `VerifiedUser`, which only
 * `requireUser` can make.
 *
 * This function is the old body of `serveApi`, moved here on 2026-08-28 so that
 * the diff of *that* change read as a pure move — the route declarations and the
 * `if` chain went across as the same text in the same order. It has been edited
 * many times since, so do not read that as a description of the present. It was
 * deliberately **not** redesigned into a route table on the way: that is a real
 * improvement and it is a different change, and doing both at once would have
 * made neither reviewable.
 *
 * ## What the split buys, which a boolean parameter would not
 *
 * `docs/plans/260827ai-public-read-only-access.md` asked for a check that the authenticated
 * dispatcher cannot be reached without a user, and noted there is no route table to
 * enumerate — only an `if` chain. This is the structural version of that check:
 * the public dispatcher runs *before* `requireUser` and therefore cannot produce
 * the one type this function accepts.
 *
 * A required `AuthedUser` parameter would have prevented omission and nothing
 * else, because any `{ id, email }` satisfies it. GPT Sol, 2026-08-28:
 *
 * > A required parameter prevents omission but accepts any `{ id, email }` object.
 * > That does not encode “came from `requireUser`”.
 *
 * ## Why it returns nothing
 *
 * Every branch below answers, and the last one 404s. There is no “I did not handle
 * it” value, so there is nothing for a caller to fall through on — the same
 * property `servePublicApi` has, for the same reason.
 *
 * ## Why it is exported
 *
 * For one test, and the export **is** the thing under test: the boundary is only
 * worth having if calling it wrongly fails, so tests/public-dispatch.test.ts
 * calls it with `undefined as never` and asserts it throws before any handler,
 * any store call or any spy runs. A boundary nobody has watched refuse is not
 * evidence — docs/reusable/silent-success.md. Nothing in `src/` imports it.
 */
export async function serveAuthenticatedApi(
  user: VerifiedUser,
  request: ApiRequest,
): Promise<void> {
  /* **The type again, at runtime.** `as never`, plain JavaScript and a stale
     build all get past the compiler; none of them gets past this. It is the
     first statement in the function on purpose, so it runs before any handler,
     any store call and any spy a test has installed. src/auth.ts. */
  assertVerifiedUser(user);
    /* **The identity is not just checked, it is carried.** Until 2026-08-27 the
       return value of this call was dropped on the floor: the gate proved a
       person existed and then every store read went on using the process-wide
       `SPIDERYARN_OWNER_ID`, so every account that got past it shared one shelf,
       one profile, one set of chats and one wallet. GPT Sol's review of the
       built code led with it; Greg chose the real fix over an email allowlist.
       src/owner.ts explains why this is an AsyncLocalStorage and not forty
       extra parameters. */
  setRequestOwner(user.id);
  /* And the same identity to the error tracker, so an issue says who hit it
     rather than only what broke. Here rather than anywhere else because this is
     the one line that holds a `VerifiedUser` — the gate's own output — so there
     is no question of where the address came from. src/monitoring.ts explains
     why it lands on the isolation scope and not the global one. */
  setMonitoringUser(user);

  const { req, res, rawUrl, path, query } = request;

  /* An EXACT match, which is what this line has always been for: a stray
     `/api/library/anything` must 404 rather than quietly serve the whole shelf.
     The shelf takes `?archived=1`, which is why it was the first route moved
     off the raw URL. */
  /* **The admin namespace, and it is two comparisons rather than one.**
     `startsWith("/api/admin/")` alone would leave a future endpoint at exactly
     `/api/admin` — no trailing slash — outside the gate, which would make the
     claim that nothing under here can be added ungated quietly false. The bare
     path is in the namespace too. GPT Sol, 2026-08-27.

     `serveApi` has already refused anything not beginning `/api/`, and `path`
     has no query string in it, so there is no other spelling to get past.

     `/api/administer` is deliberately **not** in here — the prefix ends at a
     slash — and neither is `/api/adminx`. The namespace is a path segment. */
  const adminNamespace = path === "/api/admin" || path.startsWith("/api/admin/");
  /* The only route in it today. Exact on `path` like the shelf's, so a stray
     `/api/admin/users/anything` is a 404 rather than a quiet match — and behind
     the namespace check either way. docs/project/admin.md. */
  const adminUsers = path === "/api/admin/users";
  /* The second admin route, and the only one that returns a reader's own
     sentences. Exact on `path` for the same reason as the one above.
     docs/plans/260902l-admin-feedback-page.md. */
  const adminFeedback = path === "/api/admin/feedback";
  /* **One report, and it takes two segments** — `feedback`'s primary key is
     `(owner_id, id)` because the id is minted by a browser, so an address with
     only the id in it can name two different people's reports. GPT Sol,
     2026-09-02; src/store/pg-admin-feedback.ts has the whole argument.

     The patterns are id *shapes*; `isUuid` and `isSpideryarnId` are the *rules*,
     applied in the handler before the store sees either value — the division
     every other id route here uses, and the reason a pattern that merely looks
     strict is not treated as validation. */
  const adminFeedbackOne = /^\/api\/admin\/feedback\/([\w-]+)\/([\w-]+)$/.exec(path);
  const adminFeedbackShot = /^\/api\/admin\/feedback\/([\w-]+)\/([\w-]+)\/screenshot$/.exec(
    path,
  );
  const library = path === "/api/library";
  /* Before the `:slug` pattern below, and it has to be: `search` is a valid
     slug shape, so the two patterns overlap and the specific one must win.
     Putting them the other way round would make `/api/library/search` a
     perfectly plausible request to rename an article called "search". */
  const librarySearchRoute = path === "/api/library/search";
  const shelfEntry = /^\/api\/library\/([\w.%-]+)$/.exec(path);
  const shelfOpen = /^\/api\/library\/([\w.%-]+)\/open$/.exec(path);
  /* No slug, and that is the whole shape of it: this one is about the reader
     rather than about an article. */
  const readerRoute = path === "/api/reader";
  // Static as far as a request is concerned — a read of two constants. No slug
  // and no store behind it.
  const modelsRoute = path === "/api/models";
  /* **The only route that carries audio**, and the only one whose body is
     measured in megabytes rather than kilobytes. No slug in the path even
     though most dictations are about an article: what the article decides here
     is the *vocabulary*, which is a property of the request rather than of the
     resource, and a `/api/transcribe/:slug` would have made a slug mandatory
     for the profile boxes, which have none. src/transcribe.ts. */
  const transcribeRoute = path === "/api/transcribe";
  /* **The other route with a body measured in hundreds of kilobytes**, and the
     only one whose body is a person writing to us. No slug in the path even
     when the report is about an article: what the reader was looking at is a
     *field of the report* — one of several, and nullable, because a report can
     come from the shelf or the profile page. src/feedback.ts and
     docs/plans/260831aj-feedback-button-and-bug-reports-to-sentry.md. */
  const feedbackRoute = path === "/api/feedback";
  /**
   * **What the page on the other end of one of this article's hyperlinks says
   * about itself** — fetched by us, once, and cached for everybody.
   * src/link-previews.ts, docs/project/links.md.
   *
   * **In this table and not under `/api/public/`**, which is dispatched before
   * the gate and sets no owner: an unauthenticated fetch endpoint is an open
   * proxy and an open wallet.
   *
   * **Both the slug and the URL are in the query, and the slug's place is the
   * one deviation from this file's habit.** Everything else that is about an
   * article carries the slug in the path. Here the pair is the *question* — is
   * this URL in that article, and does this reader own it — rather than a
   * resource with a sub-resource: there is no `/api/link-preview/<slug>` worth
   * asking for on its own, and the answer is not about the article at all. The
   * URL cannot go in a path in any case (it carries its own `/` and `?`), so a
   * split address would put half the question in each half of the URL. The plan
   * fixed this shape: docs/plans/260905f-external-link-panel-add-to-spideryarn-and-server-side-preview.md.
   *
   * The URL is a **query parameter that is never logged** — `path` above is
   * already stripped of the query for exactly this reason, and a hovered URL is
   * a fact about what somebody was reading. docs/project/logging.md.
   */
  const linkPreviewRoute = path === "/api/link-preview";
  /**
   * **How that page stands to the piece the reader is holding** — the other half
   * of the same card, and the half we wrote. src/link-summary.ts.
   *
   * **A `GET` that spends money**, which the file's own rule about counters
   * argues against. It is deliberate and it is the sibling above's shape: the
   * question is *(slug, url, block)* and nothing else, the client's cache is
   * keyed on exactly that, and an SSE stream is a `GET` everywhere else in this
   * app's client. Nothing prefetches an `/api/` address, and the spending is
   * behind three things a prefetch could not satisfy anyway — article ownership, link
   * membership, and a cache that answers almost every call.
   */
  const linkSummaryRoute = path === "/api/link-summary";
  const article = /^\/api\/article\/([\w.%-]+)$/.exec(path);
  /**
   * **The sharing switch, and it is a sub-resource rather than a field.**
   *
   * Not a new key on `PATCH /api/library/:slug`: that route edits *shelf state*
   * — the relationship between a reader and a document — and visibility is a
   * property of *the work*. Stage 3 of docs/plans/260827ai-public-read-only-access.md
   * splits `articles` from `shelf_entries` along exactly that line, so putting
   * them together now would mean moving the API twice. GPT Sol's reasoning.
   *
   * **`PUT`, not `PATCH`.** Visibility is a singleton sub-resource whose
   * *complete* state is being replaced, so `PUT` makes the idempotency obvious —
   * and idempotent it is: asking for the state the article is already in returns
   * the current representation and changes nothing.
   *
   * No ordering hazard against `article` above it — that pattern ends at the slug, so it
   * cannot match a path with `/visibility` on the end — but it is declared after
   * it so the two read in the order a person would look for them.
   */
  const visibility = /^\/api\/article\/([\w.%-]+)\/visibility$/.exec(path);
  // Its own endpoint rather than a field on the article payload: that one is
  // ~150KB and is fetched on every page, and stat-ing every file for it would
  // charge every reader for a page almost nobody opens.
  const metadata = /^\/api\/metadata\/([\w.%-]+)$/.exec(path);
  /* Its own endpoint too, and for a sharper reason than the metadata one: a
     thread does not exist for most articles, and putting it on the article
     payload would mean every reader of every article downloads a `null` for a
     page almost none of them open. GET only — *writing* a thread is a job, not
     a request, because it is a model call that takes half a minute
     (docs/plans/260825g-tweet-thread-page.md#generation-on-demand-through-the-queue-we-already-have).
     POST /api/jobs { slug, steps: ["tweets"] } is how you ask for one. */
  const tweets = /^\/api\/tweets\/([\w.%-]+)$/.exec(path);
  /* Same shape and same reasoning as the thread's — most articles have no
     glossary, so putting one on the article payload would make every reader of
     every article download a `null`.

     GET *and* DELETE, which the thread does not have. Asking for the step again
     appends terms rather than replacing them (src/glossary.ts), so "start over"
     needs a way to say so — see `deleteGlossary` in src/store/pg-glossary.ts for why that is
     two acts rather than one flag. There is still no POST: *finding* terms is a
     model call that takes tens of seconds, which is a job, not a request.
     POST /api/jobs { slug, steps: ["glossary"] } is how you ask. */
  const glossary = /^\/api\/glossary\/([\w.%-]+)$/.exec(path);
  /* The one POST the glossary has, and the exception that proves the rule above:
     *finding* terms is a job because it is one call over a whole article, but
     checking **one** term is a single question with a reader sitting in front of
     it — the same shape as a comment, and it reuses the same call. It can take
     the better part of a minute if the model searches, so the client's fetch
     needs a patient deadline; `explain` has its own. */
  const lookup = /^\/api\/glossary\/([\w.%-]+)\/([\w.%-]+)\/lookup$/.exec(path);
  /* **The glossary's second POST, and it writes nothing.** A reader types a term
     into the box and this finds it in the prose and explains the passage —
     `lookup` above with the entry replaced by a phrase, so it is the same
     `explain` call at the same cost with the same patient deadline.

     The term is in the **body**, never the path. It is the reader's own words,
     which docs/project/logging.md keeps out of an address, and it can carry
     spaces and punctuation `[\w.%-]` would not take.

     It cannot collide with `lookup`: that one is three segments after the slug's
     and this is one, so no term id can reach it and no article can be named
     `find`. src/term-lookup.ts § `makeAskAboutTerm`. */
  const askTerm = /^\/api\/glossary\/([\w.%-]+)\/ask$/.exec(path);
  /* Read only, and no DELETE beside it: `ideas` replaces rather than appends,
     so re-running the step already *is* "start again". The glossary has a delete
     precisely because running it again would add to the list it is trying to
     throw away — though since 2026-09-05 nothing in the client calls it, and
     this route's shape is the one the glossary's button was measured against
     when it went (docs/project/glossary.md § Finding more). Asking for these is
     POST /api/jobs { slug, steps: ["ideas"] }. */
  const ideas = /^\/api\/ideas\/([\w.%-]+)$/.exec(path);
  /* Read only, and no DELETE, for exactly the reason `ideas` above has none:
     the step replaces rather than appends, so re-running it already *is* "find
     them again". POST /api/jobs { slug, steps: ["quotes"] }. */
  const quotes = /^\/api\/quotes\/([\w.%-]+)$/.exec(path);
  /* The timeline — docs/project/timeline.md. GET only, and no DELETE, for the
     reason `ideas` above has none: the step replaces rather than appends, so
     rebuilding it is
     POST /api/jobs { slug, steps: ["timeline"] }. */
  const timeline = /^\/api\/timeline\/([\w.%-]+)$/.exec(path);
  /* The quiz. GET only for the artefact, for the reason `ideas` and `timeline`
     have no DELETE: the step replaces rather than appends, so rewriting the
     questions is POST /api/jobs { slug, steps: ["quiz"] }.

     `mark` below is the exception, and it is the same exception the glossary's
     `lookup` is: *writing* the questions is one call over a whole article and so
     is a job, but marking ONE answer is a single question with a reader sitting
     in front of it. It stores nothing — see `markOneAnswer`. */
  const quiz = /^\/api\/quiz\/([\w.%-]+)$/.exec(path);
  const quizMark = /^\/api\/quiz\/([\w.%-]+)\/mark$/.exec(path);
  /* What the rest of the web says about this piece —
     docs/plans/260905f-debate-mode-what-the-web-says-about-this-piece.md. GET
     only, and no DELETE, for the reason `ideas`, `quotes` and `timeline` have
     none: the step replaces rather than appends, so asking the web again is
     POST /api/jobs { slug, steps: ["debate"] }. That is also the only way to
     start one — this route never spends. */
  const debate = /^\/api\/debate\/([\w.%-]+)$/.exec(path);
  /* The Sketch diagram — docs/project/diagram.md § Sketch. GET only, like the
     four reads around it: drawing one is
     POST /api/jobs { slug, steps: ["sketch"] }, which is also how "draw it
     again" is spelled, because the step replaces rather than appends. */
  const sketch = /^\/api\/sketch\/([\w.%-]+)$/.exec(path);
  /* Illustrated — docs/project/diagram.md § Illustrated. GET only, like Sketch
     above and for the same reason: painting one is
     POST /api/jobs { slug, steps: ["illustrated"] }.

     **Two routes, and the second is the only one in this file that serves bytes
     an artefact points at.** The hash is spelled out as 64 hex characters here
     rather than as a loose capture — not because `sendPlate` trusts it (it does
     not; see that function) but because a pattern that accepts anything invites
     the next reader to think the capture is a key.

     **Both extensions since 2026-09-04**, when the illustrator changed to one
     that ignores `output_format` and returns PNG. The extension is captured and
     `sendPlate` requires it to be the one the stored record names, so a `.jpeg`
     URL can never serve a PNG: an artefact holds plates of both kinds side by
     side, and the URL is a promise about the bytes exactly as the storage key
     is (src/illustrated-image.ts). */
  const illustrated = /^\/api\/illustrated\/([\w.%-]+)$/.exec(path);
  const illustratedPlate = /^\/api\/illustrated\/([\w.%-]+)\/([0-9a-f]{64})\.(jpeg|png)$/.exec(path);
  /* The arc on its own. It also travels inside `/api/article/:slug`, and this is
     not a second way to do the same thing — since 2026-08-29 the arc is not built
     by every ingest, so a reader can arrive without one, ask for one, and need to
     collect it when the job lands. Refetching the whole article for that re-reads
     every block and the whole tree; see docs/plans/260827am-glossary-read-latency.md for
     what that costs on Postgres. */
  const arc = /^\/api\/arc\/([\w.%-]+)$/.exec(path);
  /* Its own endpoint, and unlike every artefact route above it this one is not
     a read: it embeds the article's blocks the first time it is asked, then
     serves the answer out of memory (src/similar.ts). It is here rather than on
     the article payload because only one of the six diagram pictures wants it,
     and only when the reader presses that toggle — charging every reader of
     every article for a model call almost none of them will look at is exactly
     what the `tweets` note above refuses to do. */
  const similar = /^\/api\/similar\/([\w.%-]+)$/.exec(path);
  /* The other half of the same purchase, and a second endpoint rather than a
     second field on the first: `similar` answers "which passages are about the
     same thing", this one answers "where does every passage sit relative to the
     others" (src/projection.ts). Different pictures want different ones, they
     are asked for at different moments, and the vectors underneath are bought
     once and shared (src/article-vectors.ts) — so a reader who presses Force
     and then Drift pays for one article, not two. */
  const projection = /^\/api\/projection\/([\w.%-]+)$/.exec(path);
  const source = /^\/api\/source\/([\w.%-]+)$/.exec(path);
  /* **One of the article's own pictures, out of our bucket** —
     `sendArticleAsset`, and `assetPath` in src/asset-delivery.ts is the same
     line without the regex, which is what the client builds its `src` from.

     The hash is spelled out as 64 hex characters and the extension as the three
     formats we host, for `illustratedPlate`'s reason above: not because the
     route trusts either (it does not — both are only ever *compared* with what
     the manifest says), but because a pattern that accepts anything invites the
     next reader to think the capture is a key. `AssetExt` in src/assets.ts is
     the list; a fourth format there is a change here too. */
  const asset = /^\/api\/asset\/([\w.%-]+)\/([0-9a-f]{64})\.(png|jpeg|gif)$/.exec(path);
  /* **Everything Spideryarn holds for one article, as a zip.** Its own
     namespace rather than `/api/article/:slug/export`, because it is not a
     representation of the article payload — it is a snapshot across ten tables
     and two artefact columns, and the article route's response type is a thing
     the client parses as JSON. `sendExport` has the rest.
     docs/plans/260901h-export-article-data.md. */
  const exportBundle = /^\/api\/export\/([\w.%-]+)$/.exec(path);
  /* The comments, chat, live-session, search, referee, jobs, uploads and billing
     matchers used to be declared here and handled at the very end of the chain.
     They are the rows of `AUTH_ROUTES` above, in that same order, and the table
     is consulted after every guard below and before the terminal 404 — the
     position they already had, so the move reorders nothing. `exportBundle` is
     now the last matcher this chain declares, but declaration order is not
     dispatch order: the last *guard* is `projection`, so the sketch-to-projection
     block is the next slice up. */

    /* **The second gate, and it guards a prefix rather than a route.**
       Everything under `/api/admin/` is refused to everybody but the one
       address in src/admin.ts. Written here, above the route table, rather than
       inside the one admin handler — so an admin route added later is behind
       this check whether or not whoever adds it remembers, which is the only
       version of this that stays true.

       Matched on `path`, not on `url`, for the same reason the shelf's route is:
       `url` carries the query string, and a check that reads it is a check that
       a `?` can be hidden behind. `path` is `url` up to the first `?`, and
       `serveApi` has already refused anything not starting with `/api/`, so
       there is no second spelling of this prefix to get past.

       **403, not 404.** The usual rule here is that a thing you may not see
       does not exist (docs/project/auth.md § Whose data is it), and it is the
       right rule for another reader's article — a 404 refuses to confirm it is
       there. It buys nothing at all here: the admin page's code is a public
       asset served to anybody who requests it, so its existence is not a secret
       and pretending otherwise would only make a real refusal unreadable in a
       log. (Since 2026-09-05 it is not in every reader's *initial* download —
       src/web/LazyPage.tsx — which changed the startup cost and nothing about
       who may have it.) */
    if (adminNamespace && !isAdmin(user.id)) {
      /* One case is worth a line, and only one: the administrator's own address
         on an id we do not know. Fixed prose, nothing interpolated — see
         src/admin.ts, and logging.md on why a message is the one place
         redaction cannot reach. */
      const notable = describeAdminMiss(user.id, user.email);
      if (notable) log("auth").warn({ route: "admin" }, notable);
      throw httpError(403, "That page is for the site's administrator. [admin-only]");
    }

    if (adminUsers && req.method === "GET") {
      /* **Said on the response as well as meant by the client.** The offline
         cache in src/web/lib/api.ts keeps to an allowlist that this route is
         not on, so nothing of ours would store it — but a page listing other
         people's accounts should not depend on our own cache's good manners for
         that, and an intermediary has no way to know the policy unless the
         response states it. GPT Sol, 2026-08-27. */
      res.setHeader("Cache-Control", "private, no-store");
      send(res, 200, { users: await adminStore.listUsersAcrossOwners() });
      return;
    }

    if (adminFeedback && req.method === "GET") {
      /* `private, no-store`, and here it is not belt and braces the way it is on
         the users list. That one carries counts; this one carries what other
         people wrote to us in confidence, and a cache — ours, a proxy's, a
         browser's back-forward store — is a second copy of it that nobody
         decided to make. */
      res.setHeader("Cache-Control", "private, no-store");
      /* Absent means the default. A `?limit=` that is not a number is the
         default too rather than a 400: the store clamps into
         [1, ADMIN_FEEDBACK_MAX] whatever arrives, so there is no value here
         that can do harm, and a refusal would be ceremony on a page only one
         person can open. */
      const asked = Number(query.get("limit"));
      /* **A malformed cursor is a 400, and that one is not ceremony.** Silently
         starting from the top instead would hand back page 1 while the reader
         pressed *Load older* — a page that looks like it worked and quietly
         skipped everything in between, which is the shape docs/reusable/silent-success.md
         is about. */
      const cursor = decodeFeedbackCursor(query.get("before"));
      if (cursor === "malformed") throw httpError(400, "That is not a valid page cursor.");
      send(
        res,
        200,
        await adminStore.listFeedbackAcrossOwners(
          Number.isFinite(asked) && asked > 0 ? asked : ADMIN_FEEDBACK_DEFAULT_LIMIT,
          cursor,
        ),
      );
      return;
    }

    if (adminFeedbackOne && req.method === "GET") {
      const [, owner = "", id = ""] = adminFeedbackOne;
      if (!isUuid(owner)) throw httpError(400, "ownerId must be a uuid");
      if (!isSpideryarnId(id)) throw httpError(400, "id must be a report id");
      res.setHeader("Cache-Control", "private, no-store");
      const report = await adminStore.readFeedbackAcrossOwners(owner, id);
      if (!report) throw httpError(404, "There is no such report.");
      send(res, 200, { report });
      return;
    }

    if (adminFeedbackShot && req.method === "GET") {
      const [, owner = "", id = ""] = adminFeedbackShot;
      /* The shapes in the pattern are not the rules. These are, and they run
         before the store does — src/ids.ts, and docs/project/block-ids.md on
         why a regex that looks strict enough is how range checks go quietly
         wrong. Both halves, because both are half of the key. */
      if (!isUuid(owner)) throw httpError(400, "ownerId must be a uuid");
      if (!isSpideryarnId(id)) throw httpError(400, "id must be a report id");
      const bytes = await adminStore.readFeedbackScreenshotAcrossOwners(owner, id);
      /* No such report and a report with no screenshot are one answer, and the
         store says so — see its docstring. Distinguishing them here would tell
         the caller a thing it may do nothing with. */
      if (!bytes) throw httpError(404, "That report has no screenshot.");

      res.statusCode = 200;
      /* **A literal, and it is correct by construction rather than by trust.**
         src/feedback-image.ts does not *check* an uploaded screenshot, it
         rebuilds one: the stored bytes are a PNG signature and a chunk stream
         this app wrote, with every ancillary chunk — text, EXIF, colour
         profiles — dropped. So there is no stored content type to get wrong,
         and nothing to sniff. */
      res.setHeader("Content-Type", CONTENT_TYPE.png);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "private, no-store");
      /* The bytes being written, not a stored count — the same rule the PDF
         route follows, and the one that stays true when the two disagree. */
      res.setHeader("Content-Length", String(bytes.byteLength));
      res.end(Buffer.from(bytes));
      return;
    }

    if (library && req.method === "GET") {
      /* `=== "1"`, not truthiness. `?archived=0` is a thing somebody will write
         meaning "no", and a loose check would hand them the archive. */
      const archived = query.get("archived") === "1";
      /* Annotated rather than inferred: `LibraryResponse` is the envelope the
         client filters and reads, and naming it here is what makes a
         disagreement about it a compile error instead of a silent no-op.
         docs/postmortems/260903e-offline-shelf-filter-never-ran.md. */
      const shelf: LibraryResponse = { articles: await listArticles({ archived }) };
      send(res, 200, shelf);
      return;
    }
    if (librarySearchRoute && req.method === "GET") {
      send(res, 200, await searchTheLibrary(query));
      return;
    }
    /* PATCH rather than PUT: both fields are optional and the client sends
       whichever the reader changed. A PUT would mean "here is the whole shelf
       record", and a client that forgot one field would silently clear it. */
    if (shelfEntry && req.method === "PATCH") {
      send(res, 200, await patchShelf(slugPart(shelfEntry, 1), await readBody(req)));
      return;
    }
    /**
     * **Destroy the article, for good.** The other ending, beside the `archived`
     * flag the PATCH above sets.
     *
     * **No body.** There is nothing to say: the slug is the whole request, and a
     * body would only invite a confirmation token that the server would have to
     * either check (a second authorisation, disagreeing with the first) or
     * ignore (a field that reads as a safeguard and is not one). The two-step
     * confirm is the client's, and it is a property of the button rather than of
     * the protocol.
     *
     * **And no ownership check here.** Authorisation is the `where` clause
     * inside the one statement `destroy` runs, so this route asks nobody whose
     * article it is — a second check would be a second opinion that can disagree
     * with the first, and the one that matters is the one in the `DELETE`.
     * docs/project/auth.md § *whose data is it*.
     */
    if (shelfEntry && req.method === "DELETE") {
      send(res, 200, await shelfStore.destroy(slugPart(shelfEntry, 1)));
      return;
    }
    if (modelsRoute && req.method === "GET") {
      send(res, 200, modelsInUse());
      return;
    }
    if (transcribeRoute && req.method === "POST") {
      send(res, 200, await transcribeDictation(req, res));
      return;
    }
    /* `fileFeedback` answers for itself rather than returning a body, because
       three of its four outcomes are different statuses and one of them sets a
       header. `send` inside one function beats a status threaded back out. */
    if (feedbackRoute && req.method === "POST") {
      await fileFeedback(req, res, user);
      return;
    }
    if (readerRoute && req.method === "GET") {
      /* **`?slug=` answers a different question, and the panels need that one.**
         Without it this says only whether the *global* box is written, and a
         reader who has filled in "why you're reading this one" and nothing else
         has a profile as far as every prompt is concerned — `renderProfile`
         joins the two — while every control that offered to turn it off has
         disappeared. They could not opt out of something they could not see.

         So `profile` is the global text, which is what /profile edits, and
         `hasProfile` is the real answer to "is anything being taken into
         account here", resolved the same way the prompts resolve it. One
         request, right in every state, including the ones with no artefact to
         hang a flag on. GPT Sol's review, 2026-08-26. */
      /* **`purpose` is here for the profile panel**, which prints each box on
         its own with its own way in to edit it (docs/plans/260830c-profile-panel.md).
         It is the reader's own words being shown back to the reader, which is a
         different act from the `useProfile: boolean` a generate request sends —
         that one is still a boolean, because a client that could supply profile
         *text* is a way to put an arbitrary string into a prompt.

         **Always present, `null` without a slug** — never absent. A field that
         appears on some responses and not others is the one that gets dropped
         at a boundary and then read as "this reader has no purpose" rather than
         "nobody asked": three states wearing two. `profile` is already spelled
         that way and this matches it.

         `resolveProfileParts` rather than `resolveProfile`, and that also costs
         one store read fewer than this used to: the old pair read the global
         profile directly *and* again inside `resolveProfile`. */
      const at = query.get("slug");
      const parts: ProfileParts =
        at && isSlug(at)
          ? await resolveProfileParts(at)
          : { profile: await readerStore.readProfile(), purpose: null, purposeFailed: false };
      /* **On every answer, with or without a slug**, because the switch is a
         property of the reader and this is the reader's route. It costs one
         extra row read on a route the article pages already fetch for
         `hasProfile`, which is the trade that keeps the client from needing a
         second endpoint — and a second endpoint is how two answers to "is it
         on" come to disagree. docs/project/experimental-features.md. */
      const experimentalSince = await readerStore.readExperimental();
      /* Asked of the *rendered* pair rather than of `parts.profile`, which is
         what makes a reader who has written only "why you're reading this one"
         count — the case this whole `?slug=` exists for. */
      /* **Normalised on the way out, so the two answers cannot disagree.**
         `hasProfile` is asked of `renderProfile`, which trims and settles line
         endings — so a legacy whitespace-only value stored before that rule
         existed makes `hasProfile` false while the raw string is still truthy,
         and the panel draws a box containing three spaces instead of saying
         nothing is written. One normalisation, used for both. GPT Sol,
         2026-08-30. */
      send(res, 200, {
        profile: normaliseProfileText(parts.profile),
        purpose: normaliseProfileText(parts.purpose),
        purposeFailed: parts.purposeFailed,
        hasProfile: renderProfile(parts) !== null,
        /* **The date, not a boolean beside it.** The client derives "on" from
           this being non-null. Sending both would be two spellings of one fact,
           free to disagree — and the one that disagreed would be the one a
           feature gate read. */
        experimentalSince,
      });
      return;
    }
    /* PATCH rather than PUT, for the same reason the shelf's is: the body names
       what changed. Here that is one field, so the two spellings would mean the
       same thing today — and PUT would start meaning "here is the whole reader
       record" the moment a second field arrives, which is exactly when a client
       that had not been updated would silently clear it. */
    if (readerRoute && req.method === "PATCH") {
      send(res, 200, await patchReader(await readBody(req)));
      return;
    }
    /* POST, not GET, because it writes — and it is its own route rather than a
       side effect inside `GET /api/article/:slug` for the same reason. A GET
       that counts is a GET that a prefetch, a retry or a health check inflates
       without anybody deciding to. */
    if (shelfOpen && req.method === "POST") {
      await shelfStore.recordOpen(slugPart(shelfOpen, 1));
      // 204: there is nothing worth reading back, and a body would invite
      // somebody to render a counter that is one behind.
      res.statusCode = 204;
      res.end();
      return;
    }
    if (article && req.method === "GET") {
      send(res, 200, await loadArticle(slugPart(article, 1)));
      return;
    }
    if (linkPreviewRoute && req.method === "GET") {
      /* **A bad slug is a 400**, which is the one thing this route says out
         loud about the request itself: it is malformed rather than a
         destination we could not reach, and answering it like a Cloudflare
         challenge would hide a client bug for ever.

         **An article that is not this reader's is a 404**, thrown by
         `loadArticle` through the owner filter, exactly as every other
         per-article route here answers — a slug that does not exist and one
         that belongs to somebody else are the same miss, which is the property
         that stops this confirming what other people own.

         Everything *after* those two is a 200 carrying one of the four
         `LinkPreviewResponse` members, because the card's rule is that a
         failure leaves it exactly as it was. `refused` and `unavailable` look
         identical to the reader and differ only to the client's cache —
         src/link-previews.ts § `linkPreview` says why that distinction exists
         and why it gives a caller nothing. */
      const at = query.get("slug") ?? "";
      if (!isSlug(at)) throw httpError(400, "Not a slug");
      send(res, 200, await linkPreview(at, query.get("url")));
      return;
    }
    if (linkSummaryRoute && req.method === "GET") {
      const at = query.get("slug") ?? "";
      if (!isSlug(at)) throw httpError(400, "Not a slug");
      /* `query.get` is `null` for a parameter that was never sent, which is
         exactly what "the client did not say which mention" means here — a
         client from before this existed, and a chat link, which sits in no
         block at all. */
      await streamLinkSummary(at, query.get("url"), query.get("block"), res);
      return;
    }
    if (visibility && req.method === "PUT") {
      const asked = parseVisibilityRequest(await readBody(req));
      send(
        res,
        200,
        await visibilityStore.set(slugPart(visibility, 1), asked.visibility, asked.rightsConfirmed),
      );
      return;
    }
    if (source && req.method === "GET") {
      await sendSource(res, slugPart(source, 1));
      return;
    }
    /* `slugPart` on the slug for the reason the `source` route above gives —
       the pattern allows `%` and `.` — and `part` is not used on the hash or the
       extension, which the pattern has already narrowed and which are in any
       case only ever compared, never joined onto anything. The same shape
       `illustratedPlate` uses below. */
    if (asset && req.method === "GET") {
      await sendArticleAsset(res, slugPart(asset, 1), part(asset, 2), part(asset, 3));
      return;
    }
    /* `slugPart`, not `part` — the pattern above allows `%` and `.` and `part`
       percent-decodes, so `..%2F..%2F…` would arrive at the store as a path.
       Nothing here joins a slug onto a filesystem path, but the rule is that
       the check goes on the capture rather than on what the capture happens to
       reach today. See the note above `slugPart`. */
    if (exportBundle && req.method === "GET") {
      await sendExport(res, slugPart(exportBundle, 1));
      return;
    }
    if (metadata && req.method === "GET") {
      send(res, 200, await articleMetadata(slugPart(metadata, 1)));
      return;
    }
    if (tweets && req.method === "GET") {
      {
        const at = slugPart(tweets, 1);
        send(res, 200, await withProfileChanged<ThreadResponse>(at, () => loadTweets(at), (found) => found.thread));
      }
      return;
    }
    if (glossary && req.method === "GET") {
      {
        const at = slugPart(glossary, 1);
        send(res, 200, await withProfileChanged<GlossaryResponse>(at, () => loadGlossary(at), (found) => found.glossary));
      }
      return;
    }
    if (glossary && req.method === "DELETE") {
      send(res, 200, await deleteGlossary(slugPart(glossary, 1)));
      return;
    }
    if (lookup && req.method === "POST") {
      const at = slugPart(lookup, 1);
      await withSpendAttribution({ articleSlug: at }, () =>
        streamTermLookup(at, slugPart(lookup, 2), res),
      );
      return;
    }
    if (askTerm && req.method === "POST") {
      const at = slugPart(askTerm, 1);
      /* **Only `term` is read off the body, and it is the only thing there is
         to read.** No block id, no offset, no definition, no owner — the
         passage is found from the article, server-side, which is what stops
         this being a way to ask a paid model about text of the caller's
         choosing. `askAboutTerm` validates and normalises it; the route does
         not pre-judge it, so there is one bound in one place.

         **No rate limit, and there is none to reuse.** The sibling `lookup`
         POST has none either, and feedback's hourly cap is the only limiter in
         this file (`fileFeedback`). So an owner with one article of their own
         can drive paid `explain` calls as fast as they can post: ownership says
         *which* article, not *how many* requests, and `withSpendAttribution`
         records the spend rather than authorising it. **This request never
         enters the job queue**, so the queue's concurrency of three is not a
         limit on it either — a first draft of this comment claimed it was, and
         GPT Sol was right that it is false. Stated rather than fixed here
         because it is the shape of every paid request in this file and a scheme
         invented on the day for one endpoint would be the wrong place to put
         one. docs/project/glossary.md § Looking a term up, and the note in
         docs/user-feedback/ for Greg.

         Re-traced 2026-09-10 for the move to streaming, and still true: the
         route has no limiter, and `withSpendAttribution` records rather than
         gates. It wraps the whole stream, so the one model call inside it is
         attributed to this article however it ends. `streamAskedTerm` above. */
      const askBody = (await readBody(req)) as { term?: unknown } | null;
      await withSpendAttribution({ articleSlug: at }, () => streamAskedTerm(at, askBody?.term, res));
      return;
    }
    if (ideas && req.method === "GET") {
      {
        const at = slugPart(ideas, 1);
        send(res, 200, await withProfileChanged<IdeasResponse>(at, () => loadIdeas(at), (found) => found.ideas));
      }
      return;
    }
    if (quotes && req.method === "GET") {
      {
        const at = slugPart(quotes, 1);
        send(
          res,
          200,
          await withProfileChanged<QuotesResponse>(
            at,
            () => loadQuotes(at),
            (found) => found.quotes,
            /* Unlike the other profiled artefacts, Find more appends. If the
               profile was deleted, the next pass is unprofiled but the list
               keeps its first-pass hash; calling that mixed list "written for
               you" would be false. */
            true,
          ),
        );
      }
      return;
    }
    if (timeline && req.method === "GET") {
      /* **No `withProfileChanged`**, unlike its five neighbours, and that is
         the decision rather than an omission: this artefact was never written
         for a profile, so there is no third staleness fact to add.
         `TimelineResponse` in src/types.ts has two fields where the others have
         three. docs/plans/260831i-timeline-mode.md § Freshness. */
      send(res, 200, await loadTimeline(slugPart(timeline, 1)));
      return;
    }
    if (quiz && req.method === "GET") {
      /* **No `withProfileChanged`**, for `timeline`'s reason rather than by
         omission: this artefact was never written for a profile, so there is no
         third staleness fact to add and offering one would be a banner about a
         thing that cannot have happened. `QuizResponse` in src/types.ts has two
         fields where `IdeasResponse` has three.
         docs/plans/260831al-review-quiz-sub-mode.md § No profile in v1. */
      send(res, 200, await loadQuiz(slugPart(quiz, 1)));
      return;
    }
    if (debate && req.method === "GET") {
      /* **No `withProfileChanged`**, for `timeline`'s and `quiz`'s reason: who
         is reading does not change what the web said, so there is no third
         staleness fact and offering one would be a banner about a thing that
         cannot have happened. `DebateResponse` in src/types.ts has two fields.

         **And nothing here about how old the search is.** `searchedAt` travels
         on the artefact and the panel prints it; it is provenance rather than
         staleness, and a year-old shared link must not have its artefact
         declared invalid by the clock. */
      send(res, 200, await loadDebate(slugPart(debate, 1)));
      return;
    }
    if (quizMark && req.method === "POST") {
      /* One of the handful of endpoints here that does not answer with JSON —
         it writes its own headers and ends the response. It is still reached
         through `send` for its *failures*: every validation and both 409s throw
         before a header is written, so a stale batch is an ordinary 409 rather
         than an error frame the client would have to parse. */
      const at = slugPart(quizMark, 1);
      const markBody = await readBody(req);
      /* **The article goes on every row this request writes**, or "what has
         this piece cost me" would cover writing the questions and none of the
         answering. src/ai-spend.ts § `withSpendAttribution`. */
      await withSpendAttribution({ articleSlug: at }, () => markOneAnswer(at, markBody, res));
      return;
    }
    if (sketch && req.method === "GET") {
      {
        const at = slugPart(sketch, 1);
        /* `found.sketch` is `unknown` on the wire and a `Sketch` in both stores,
           and the cast is only about reaching `profileHash` for the comparison
           below — the client parses the scene itself on arrival. See
           SketchResponse in src/types.ts for why the field is not typed here. */
        send(
          res,
          200,
          await withProfileChanged<SketchResponse>(
            at,
            () => loadSketch(at),
            (found) => found.sketch as { profileHash?: string | null },
          ),
        );
      }
      return;
    }
    if (illustrated && req.method === "GET") {
      {
        const at = slugPart(illustrated, 1);
        /* Shaped exactly like `sketch` above, including the cast, which is only
           about reaching `profileHash` — the client parses the plates itself on
           arrival (IllustratedResponse in src/types.ts).

           **`profileChanged` is about the profile the SKETCH was drawn for**,
           because that is what this artefact inherits (src/illustrated.ts). The
           comparison is the same one either way; what differs is where the hash
           came from, and it came from the Sketch. */
        send(
          res,
          200,
          await withProfileChanged<IllustratedResponse>(
            at,
            () => loadIllustrated(at),
            (found) => found.illustrated as { profileHash?: string | null },
          ),
        );
      }
      return;
    }
    if (illustratedPlate && req.method === "GET") {
      /* `slugPart` on the slug for the reason the `source` route gives — the
         pattern allows `%` and `.` — and `part` is not used at all on the hash,
         which is already narrowed to hex by the pattern and is in any case only
         ever compared, never joined onto anything. */
      await sendPlate(
        res,
        slugPart(illustratedPlate, 1),
        part(illustratedPlate, 2),
        part(illustratedPlate, 3),
      );
      return;
    }
    /* Read only, like the ideas above and for the same reason: running the step
       again replaces the artefact, so "start over" already has a spelling. Asking
       for one is POST /api/jobs { slug, steps: ["arc"] }.

       **No `withProfileChanged`**, unlike the two above. The arc's prompt does not
       take the reader profile (src/arc.ts § `generateArc` sends no profile), so
       there is no "you are not who you were" answer to give and offering one would
       be a banner about a thing that cannot have happened. */
    if (arc && req.method === "GET") {
      send(res, 200, await loadArc(slugPart(arc, 1)));
      return;
    }
    /**
     * **POST, not GET, and the method is the load-bearing part.**
     *
     * Every other artefact route in this file is a GET because it *reads*
     * something a pipeline step already wrote. This one is different: the first
     * call embeds the article, which spends money at an external provider. A
     * GET that does that is wrong in a way that is easy to miss — GET is
     * supposed to be safe, so a link prefetcher, a proxy retry, a crawler or a
     * double-tap on Back can all pay for it again, none of them having asked
     * anybody. GPT Sol's finding, 2026-08-27.
     *
     * `useIdeas` makes the same split more visibly: it GETs the ideas and POSTs
     * a *job* to write them. This is the same shape with the write inline,
     * because embedding an article takes a second or two rather than the half a
     * minute that makes something a job.
     */
    if (similar && req.method === "POST") {
      {
        const at = slugPart(similar, 1);
        /* This route pays for embeddings, so its rows carry the article like
           chat's and explain's do. GPT Sol found both this and `projection`
           writing owner-attributed rows with a null slug — which the report then
           excludes from "by article" entirely, so an article's real cost would
           have been understated by exactly the two features that embed it. */
        return withSpendAttribution({ articleSlug: at }, async () => {
          /* The whole article, because this needs the prose **and the tree** —
             the tree so that two passages of one section cannot take a place in
             the answer from two passages of different ones (src/similar.ts §
             `sectionOfRow`). It is the same read every other artefact route
             makes and the store caches nothing, so on a warm similarity cache
             this load is the entire cost of the request. */
          const loaded = await loadArticle(at);
          try {
            send(res, 200, await similarBlocks(at, loaded.blocks, loaded.tree));
          } catch (err) {
            /* **This used to catch everything and blame the provider**, which
               is the bug a GPT Sol review had already found and fixed in
               `projection` twenty lines below — and this, its sibling, was left
               with it. A ranking bug in src/similar.ts was reported to the
               reader, and logged, as an outage at somebody else's company.
               ⟨Sol⟩, 2026-08-28. */
            throw embeddingHttpError(err, at);
          }
          return;
        });
      }
    }
    /**
     * **POST for the same reason `similar` is a POST**: the first call for an
     * article spends money, and a GET is something a browser, a proxy or a
     * prefetcher may repeat without asking anybody.
     *
     * The arithmetic afterwards is ours rather than the provider's — principal
     * components and k-means over vectors already in hand — so a failure here
     * is either the embedding call or a bug, and only the first of those is
     * worth a sentence about reaching a model.
     */
    if (projection && req.method === "POST") {
      {
        const at = slugPart(projection, 1);
        /* Same reason as `similar` above: this route pays for embeddings, so its
           rows carry the article. */
        return withSpendAttribution({ articleSlug: at }, async () => {
          const loaded = await loadArticle(at);
          try {
            send(res, 200, await projectArticle(at, loaded.blocks));
          } catch (err) {
            throw embeddingHttpError(err, at);
          }
          return;
        });
      }
    }

    /**
     * **The table, asked after every guard above and before the 404 below.**
     *
     * Comments, chat, the live sessions, search, referee, jobs, uploads and
     * billing live in `AUTH_ROUTES` (above `serveAuthenticatedApi`) rather than
     * in this chain.
     * They were the chain's last guards, in that order, immediately above the
     * terminal 404, so consulting the table exactly here leaves each of them
     * where it already was and reorders nothing — the property that makes each
     * increment a rearrangement rather than a behaviour change.
     *
     * **That property is why the queue is consumed bottom-up.** A domain from
     * the middle of the chain would answer from here instead of from where it
     * sits, which is a reordering — safe today, since no two guards accept the
     * same method and path, but safe by an argument rather than by construction.
     *
     * **This is the only place the table is dispatched, and it has to be.** A
     * second call earlier in the chain would give the *whole* table its turn
     * there, so billing would answer from a position it has never had.
     *
     * `true` means an entry answered on `res`, so this returns instead of
     * falling into the 404. The handler is awaited inside `dispatchAuthRoute`;
     * see there for why that is load-bearing rather than tidy.
     */
    if (await dispatchAuthRoute(AUTH_ROUTES, { user, request })) {
      return;
    }

    /**
     * Anything else under `/api/` is a 404 **from us**, not a fall-through.
     *
     * Returning false here handed the request back to Vite, whose SPA fallback
     * answered it with `index.html` and a cheerful 200. So a typo'd endpoint,
     * or a client built against a route that has since been renamed, came back
     * as `Unexpected token '<'` from `r.json()` — a parse error, pointing at
     * the client, for a server route that simply is not there. Textbook
     * docs/reusable/silent-success.md: the request succeeded, loudly, at
     * nothing. That is also why the line it logs is a `warn`: a request for a
     * route nobody has usually means a client built against an older one.
     *
     * Only `/api/`, and only after every pattern above has had its turn. A path
     * that is not ours at all still falls through, which is what makes this
     * function mountable as middleware.
     */
    send(res, 404, { error: `No API route for ${req.method} ${rawUrl}` });
    return;
}
