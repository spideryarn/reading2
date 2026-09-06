/**
 * The ingest pipeline, as data.
 *
 * Seven steps, each one a name, a label a reader can watch tick over, the
 * artefact it produces, and the function that produces it. Everything that
 * knows the *order* of the pipeline knows it from this file — and the last two,
 * `tweets` and `glossary`, are in the order without being in the default, which
 * is why there are two lists below rather than one.
 *
 * Written as a list rather than as a function that calls four other functions
 * for one reason: Greg asked for jobs beyond "add this URL" — re-run one stage
 * after a prompt change, refresh an article from source, and *"potentially
 * it'll be used in other ways too"* (2026-08-25). All of those are the same
 * machinery given a different sub-list of these steps, so a job is a list of
 * step names and nothing here needs a special case for any of them.
 *
 * See docs/project/ingest-queue.md. The queue that runs these is src/jobs.ts;
 * the stage implementations belong to other agents and are reached through
 * their exported functions, never by reimplementing what they do.
 */
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { readArticle, tryReadArticle } from "./article-input.js";
import {
  generateArc,
  inputFingerprint as arcFingerprint,
  PROMPT_VERSION as ARC_PROMPT_VERSION,
} from "./arc.js";
import {
  BLOCKS_INPUT_HTML,
  blocksArtefact,
  type BlocksRun,
  NoBlocksProduced,
  previousBlocksFrom,
  runBlocks,
  splitIntoBlocks,
} from "./blocks.js";
import type { Assets, PdfFigureEntry } from "./assets.js";
import {
  ASSETS_VERSION,
  assetsInputHash,
  collectAssets,
  pdfFigureMarkersIn,
} from "./collect-assets.js";
import { collectPdfFigures, type PdfFiguresRun } from "./collect-pdf-figures.js";
import { ReadabilityRefused, runExtract } from "./extract.js";
import {
  fetchDocument,
  type RawManifest,
  RawDocumentUnavailable,
  readRawBytes,
  writeRaw,
} from "./fetch.js";
import {
  generateGlossary,
  previousGlossaryFrom,
  PROMPT_VERSION as GLOSSARY_PROMPT_VERSION,
} from "./glossary.js";
import {
  generateIdeas,
  inputFingerprint as ideasFingerprint,
  previousIdeasFrom,
  PROMPT_VERSION as IDEAS_PROMPT_VERSION,
} from "./ideas.js";
import {
  generateQuotes,
  inputFingerprint as quotesFingerprint,
  previousQuotesFrom,
  PROMPT_VERSION as QUOTES_PROMPT_VERSION,
} from "./quotes.js";
import {
  generateTimeline,
  inputFingerprint as timelineFingerprint,
  previousTimelineFrom,
  PROMPT_VERSION as TIMELINE_PROMPT_VERSION,
} from "./timeline.js";
import {
  generateQuiz,
  inputFingerprint as quizFingerprint,
  PROMPT_VERSION as QUIZ_PROMPT_VERSION,
} from "./quiz.js";
import {
  generateDebate,
  inputFingerprint as debateFingerprint,
  PROMPT_VERSION as DEBATE_PROMPT_VERSION,
} from "./debate.js";
import { stageFailure } from "./job-failure.js";
import {
  generateIllustrated,
  inputFingerprint as illustratedFingerprint,
  PROMPT_VERSION as ILLUSTRATED_PROMPT_VERSION,
} from "./illustrated.js";
import { storePlateImage } from "./illustrated-image.js";
import { isStale as sketchIsStale } from "./sketch.js";
import { type IllustratedPlate, plateDrawn, plateFailed } from "./illustrated-plate.js";
import type { Sketch } from "./sketch-scene.js";
import {
  generateSketch,
  inputFingerprint as sketchFingerprint,
  PROMPT_VERSION as SKETCH_PROMPT_VERSION,
} from "./sketch.js";
import { openRouterFrontMatterReader } from "./pdf-frontmatter.js";
import { runPdfExtract } from "./pdf-read.js";
import { MAX_PAGES } from "./uploads.js";
import { countPdfPages, pdfIsUnreadable, refuseTooManyPages, TooManyPages } from "./pdf.js";
import type { CheckpointStore } from "./store/checkpoints.js";
import { log } from "./log.js";
import {
  ARTICLE_RENDERER,
  type ArticleStage,
  CAPABLE_MODEL,
  modelFor,
  STAGE_EFFORT,
} from "./models.js";
import { STEP_ORDER } from "./step-order.js";
import { articleFingerprint } from "./source-hash.js";
import { hashProfile, profileIsStale } from "./profile.js";
import {
  ARTICLE_HAD_NO_TEXT,
  ILLUSTRATE_NO_SKETCH,
  ILLUSTRATE_SKETCH_PROFILE,
  ILLUSTRATE_SKETCH_STALE,
  PAGE_HAS_NO_ARTICLE,
  pdfTooManyPages,
  type ReaderFacingFailure,
  SOURCE_DOCUMENT_DAMAGED,
  SOURCE_DOCUMENT_GONE,
} from "./messages.js";
import { type RejectReason, looksLikePdf, MAX_UPLOAD_BYTES, rejectionFailure, stagingKey } from "./source.js";
import { readUpload, rejectUpload, settleUpload } from "./upload-records.js";
import { blobStore, CONTENT_TYPE, storeRawSource } from "./store/blobs.js";
import {
  type ArtifactKind,
  type ArtifactParts,
  type ArtifactReads,
  sameStamp,
  type StepStamp,
} from "./store/artifacts.js";
import { generateHierarchy } from "./hierarchy.js";
import { generateTweets, PROMPT_VERSION as TWEETS_PROMPT_VERSION } from "./tweets.js";
import type { Block, JobUpload, StepName } from "./types.js";
import { getDb } from "./db/client.js";
import { articleRevisions, articles } from "./db/schema.js";
import { ownedSlug } from "./store/owned-slug.js";

/**
 * One line per step, saying what the step cost.
 *
 * **Why the logging lives here rather than in the stages.** Every model stage
 * already counts its own tokens and times its own call, and then hands those
 * numbers back in its run object — which the `run()` closures below receive and
 * currently reduce to a sentence for a progress bar. The stage command lines
 * printed them and the queue threw them away. So "what did this article's tree cost?" had no
 * answer once the web UI became the normal way to ingest, which is open question
 * Q7 in docs/project/open-questions.md.
 *
 * The numbers are all in scope *here*, at the seam the queue already owns, so
 * this file can answer that question without a single edit inside somebody
 * else's stage — see architecture.md#stage-ownership. The two exceptions are two
 * lines each: `hierarchy` and `arc` keep `CAPABLE_MODEL` private, so they now return it.
 *
 * A module-level logger is fine and rule 4 in src/log.ts does not forbid it: it
 * carries the component name and nothing else. What must never be module-level
 * is a logger bound to *one job or request*, because several run concurrently in
 * one process and the lines would be attributed to the wrong article. Every
 * per-article field below is passed at the call site instead.
 */
const plog = log("pipeline");

export type { StepName };

/**
 * **The order, and the two types read off it, live in
 * [step-order.ts](./step-order.ts)** — `STEP_ORDER` re-exported here so that
 * every importer that has always said `from "./pipeline.js"` still can, and so
 * that there is one ordering in the repository rather than two.
 *
 * They moved out on 2026-09-04 because `src/web/useStepJob.ts` needs
 * `StepBefore` and may not import this file: it is a server module, and
 * `tests/client-imports.test.ts` holds the client to leaves. The leaf's header
 * has the reasoning, including why the `import type` that was there first is
 * not the exemption it looks like.
 *
 * Only this one name is re-exported. `StepBefore`'s one importer is the client,
 * which names the leaf directly, and `StepsMissingFromOrder` exists to be
 * checked beside the array it guards, by nothing importing it at all — a
 * re-export of either would be a second address for a name with no callers at
 * this one.
 */
export { STEP_ORDER };

/**
 * What "add this URL" runs: every step that makes the article readable.
 *
 * Not `tweets` and not `glossary`. Each costs model calls over the whole
 * article and each is a thing you go to — a page, and a mode — so each is
 * generated when somebody asks for it, `{ steps: ["tweets"] }` or
 * `{ steps: ["glossary"] }`, and never as a side effect of adding an article.
 * Greg was asked about both and said no to both, directly (2026-08-25), and
 * every paid step added since has followed the rule they established.
 *
 * **And not `arc`, since 2026-08-29**, which is a different argument from the
 * three above and worth keeping separate. Those are things a reader *goes to*.
 * The arc is part of the reading view itself — it is the L0 column — and it comes
 * out for latency: it was the last model call between pasting a URL and being
 * able to read. `src/web/useArc.ts` now asks for one when an owner opens an
 * article that has none.
 *
 * **Be clear about the size of that win, because it is smaller than it sounds.**
 * Measured over the one ingest in `data/_ai-calls.jsonl` that logged both: `hierarchy`
 * 228s, `arc` 10s. This takes about 4% off the wait. Greg was shown that number
 * and chose to make the change anyway (2026-08-29). What makes it worth having
 * is not the 4%: it is that `arc` now behaves like every other asked-for stage,
 * and that it gained a real freshness check on the way (see its `stamp`), which
 * fixed a live silent-staleness bug.
 *
 * **The cost, recorded because nothing on screen will show it:** an article whose
 * owner has not opened it since this landed shows a *visitor* no arc, and a
 * visitor cannot ask for one — starting a job is a POST. `TableView` falls back
 * to the root gist, which looks fine. Greg was offered a second, non-blocking arc
 * job after ingest, which would have closed this, and chose the smaller change.
 * tests/visitor-gaps.test.ts pins it, so it stays a decision rather than becoming
 * a bug report. docs/plans/260829f-defer-arc-and-rename-hierarchy.md § 2.2.
 */
export const DEFAULT_INGEST_STEPS: StepName[] = [
  "fetch",
  "extract",
  "blocks",
  "hierarchy",
  /* In the default, unlike the four steps after `arc`: it costs no model call,
     and an article whose images are still hot-linked to the publisher announces
     the reader's IP to that publisher on every single read. That is the privacy
     leak this step exists to close, so closing it cannot be something somebody
     has to ask for. docs/plans/260829b-hosting-the-articles-images.md. */
  "assets",
];

/**
 * Will any of `later` read the cached article that `step` is about to write?
 *
 * Two stages share a cached article when they render it the same way **and**
 * send the same `output_config.effort`, because effort is part of the cache key
 * — measured, and the reason glossary is not in the same group as arc and
 * tweets despite sending identical bytes. See src/models.ts § `STAGE_EFFORT`,
 * which is the grouping: this reads that table rather than keeping a second
 * list beside it that could quietly disagree.
 *
 * Anything not in the table is not an article-reading stage and shares nothing.
 */
export function sharesArticleCache(step: StepName, later: readonly StepName[]): boolean {
  const effort = STAGE_EFFORT[step as ArticleStage];
  if (effort === undefined) return false;
  const renderer = ARTICLE_RENDERER[step as ArticleStage];
  /* **Both tables, not just the effort one.** Effort is part of the cache key
     and that is the surprising half, which is why it got written down first —
     but the *bytes* are the obvious half, and they stopped being uniform when
     `ideas` arrived and had to send block ids. Grouping on effort alone would
     mark the article on an `arc` run because `ideas` is queued behind it at the
     same effort, pay the 1.25x write premium, and never collect a read: the two
     prompts do not agree on a single byte after the head.
     src/models.ts § ARTICLE_RENDERER. */
  return later.some(
    (s) =>
      STAGE_EFFORT[s as ArticleStage] === effort &&
      ARTICLE_RENDERER[s as ArticleStage] === renderer,
  );
}

/**
 * **Should the step at `index` mark the article with a cache breakpoint?**
 *
 * This is `sharesArticleCache` applied to a whole job, and it exists as its own
 * named function because the shape of its argument is the thing that went wrong
 * and stayed wrong for eight days. `src/jobs.ts` used to build the list inline as
 * `job.steps.slice(i + 1)` — *later* steps only — which marks the stage that
 * **writes** the entry and never the one that **reads** it. The reader is the last
 * member of its group by construction, so it sent no `cache_control`, and a
 * request that carries no breakpoint performs no lookup however warm the entry is.
 * Every batched pair paid the 1.25x write premium and collected nothing.
 * docs/postmortems/260903c-the-conditional-article-cache-breakpoint-marks-the-writer-but-never-the-reader.md.
 *
 * **So: every *other* step of this job, in both directions, and position-blind.**
 * Caching is a two-party protocol and both parties have to carry the marker.
 *
 * **Why there is no "…and the earlier one actually ran" test**, which the
 * postmortem originally recommended and Fable talked us out of. The filter would
 * be `status === "done"`, and `done` does not mean *a warm entry exists*: a job
 * that stalls and resumes an hour later has `done` earlier steps whose entries
 * expired long ago, so the marker is exactly as speculative with the test as
 * without it. What the test would really buy is one avoided write premium in the
 * narrow case "earlier group member was `skipped`, none later" — about 1.3¢ on a
 * 17,000-word article — and it would cost a load-bearing dependency on `runStep`
 * mutating `job.steps` in place as it walks, which a reorder of the `StepContext`
 * construction would silently break.
 *
 * What it costs when it guesses wrong is bounded and small: the write premium on
 * one cold prefix, about 1.3¢ on a 17,000-word article. **Per group, not per
 * job** — an all-mode job where only one member of each of the three groups
 * actually runs wastes three of them, about 3.9¢ here, scaling with length. GPT
 * Sol, who also pointed out that `skipped` no more proves the absence of a warm
 * entry than `done` proves the presence of one.
 *
 * **The asymmetry is what decides it, and it is worth writing down** because it
 * points the other way from the instinct that built the original optimisation.
 * A marker sent onto a *cold* prefix costs 0.25x that prefix; a marker withheld
 * from a *warm* one costs 0.9x. Wrongly marking is 3.6x cheaper than wrongly
 * withholding, so where this predicate has to guess, it should guess *yes*.
 *
 * That same asymmetry is an argument for marking unconditionally — the way every
 * stage did before `24335207` — and we are deliberately not taking it, because
 * the break-even is a rate nobody has measured. **Two rates, and they are not
 * the same number:** per *call*, always-marking wins above a warm-hit rate of
 * 0.25/(0.25 + 0.9) ≈ 21.7%; per *pair*, where a first press always pays 0.25x
 * and only a second press inside the TTL collects 0.9x, it wins above a
 * conversion rate of 0.25/0.9 ≈ 27.8%. Measure whichever you are actually going
 * to observe, and say which. Deciding it by argument is precisely the class of
 * mistake the postmortem is about.
 */
export function cacheArticleForStep(steps: readonly StepName[], index: number): boolean {
  const step = steps[index];
  /* Both guards are defensive rather than reachable, and saying so is the point:
     `orderSteps` (src/jobs.ts) puts every job's names through a `Set` before one
     exists, so a job cannot hold a step twice and an index always lands. A
     forced re-run is a flag on the one entry, not a second copy of it.

     Filtering by position anyway, because it is the shape that stays correct if
     that ever changes: a name filter would drop the other copy of a repeated
     step along with this one, turning a genuine pair into a lone step that marks
     nothing. GPT Sol talked the first version of this comment out of claiming the
     repeat was a real job shape. */
  if (step === undefined) return false;
  return sharesArticleCache(
    step,
    steps.filter((_, i) => i !== index),
  );
}

/**
 * Steps the positional force-cascade must not sweep in — `cascadeForce`, in
 * src/jobs.ts. Forcing an earlier step does **not** force one of these; they
 * have to be named.
 *
 * **This is where the pipeline stops being one straight line, and it is worth
 * being exact about why.** `cascadeForce` encodes "invalidating a step
 * invalidates everything after it", which is sound for a chain where each step
 * eats what the one before it wrote. `tweets` does not sit in that chain: it
 * reads `blocks.json` and `tree.json`, the same inputs the arc reads, and
 * nothing reads what it writes. Forcing `arc` in a job that also holds `tweets`
 * would therefore spend a second model call to regenerate a thread whose inputs
 * did not move.
 *
 * The reason it is *safe* to take it out of the cascade is the other half of
 * this change, and the two must be read together: `tweets` has a freshness
 * check of its own that compares the thread's `sourceHash` against what the
 * store holds.
 * So when the article really has changed it re-runs **without** being forced,
 * and `force` goes back to meaning only what it says — "run this even though it
 * looks current".
 *
 * `arc` stays in the cascade for exactly the inverse reason: it cannot tell
 * whether it is current, so its position is the only signal there is. Give it a
 * freshness check of its own and it belongs here too.
 *
 * `glossary` is here for both halves of the same argument: it reads the blocks
 * and the tree, nothing reads what it writes, and its `stamp` below compares the
 * stored `sourceHash` against what the store holds. **And one thing more that
 * `tweets` does not have to worry about** — forcing this step *appends* a batch
 * of terms rather than replacing the list (src/glossary.ts § `generateGlossary`),
 * so being swept into the cascade would not merely waste a model call, it would
 * lengthen the reader's glossary as a side effect of re-fetching the article.
 *
 */
export const FORCE_ONLY_WHEN_NAMED: ReadonlySet<StepName> = new Set<StepName>([
  /* **`arc` joined on 2026-08-29, the day it got a `stamp`.** The paragraph above
     names the exact condition — "give it a freshness check of its own and it
     belongs here too" — and it now has one, over the blocks, the tree and the
     metadata its prompt carries. Its position is no longer the only signal it
     has, so being swept in by the cascade would only spend a model call
     rewriting an arc whose inputs had not moved. */
  "arc",
  "tweets",
  "glossary",
  /* It reads `blocks.json` and `tree.json` and nothing reads what it writes, so
     the positional cascade would buy a model call for nothing. Like `ideas` and
     unlike the glossary, forcing it cannot silently lengthen anything — it
     replaces rather than appends. */
  "quotes",
  /* Same two reasons as the three above: it reads `blocks.json` and
     `tree.json`, nothing reads what it writes, so the positional cascade would
     buy a model call for nothing. Unlike the glossary, forcing it does not
     silently lengthen anything — `ideas` replaces rather than appends — but the
     first reason stands on its own. */
  "ideas",
  /* The same two reasons again: it reads `blocks.json` and `tree.json` (and the
     metadata, for the publication date), nothing reads what it writes, so the
     positional cascade would buy a model call for nothing. Its `stamp` below
     compares a stored `sourceHash` against what the store holds, so when the
     article really has moved it re-runs without being forced. And like `ideas`
     and unlike the glossary, forcing it replaces rather than appends. */
  "timeline",
  /* The same two reasons a fourth time: it reads `blocks.json` and `tree.json`,
     nothing else in the pipeline reads what it writes, so the positional
     cascade would buy a model call for nothing. And forcing it replaces rather
     than appends — with one consequence worth naming, because it is the whole
     of why the mark route has a 409 in it: a forced run mints a NEW `batchId`,
     so every question a reader is part-way through answering stops being
     markable. That is correct — the reference answers have been rewritten —
     and it is why an unnamed force must never reach this step.
     docs/plans/260831al-review-quiz-sub-mode.md § Marking. */
  "quiz",
  /* The same two reasons, and a third that is about the clock rather than the
     money. `sketch` is the slowest call here — 194s measured on the
     constitution — and every step self-aborts at 400s inside an 800s
     invocation that must also fit a `hierarchy` measured at 320s. A positional
     cascade that swept this in beside `hierarchy` would not merely waste a call, it
     would run the invocation out of time, and the way that fails is a platform
     kill that takes the whole job rather than a recorded failure. */
  "sketch",
  /* All three of `sketch`'s reasons and it is dearer than any of them: $0.27 to
     $0.40 an article measured, of which 86–89% is the brief call, plus one
     image call per plate. A positional cascade that swept this in would spend
     that on somebody who pressed a button one band along. */
  "illustrated",
  /* All of `illustrated`'s reasons, and it is the only step here whose inputs
     are not in this repository at all: it reads `blocks.json`, `tree.json` and
     the metadata, but what it *returns* comes off the open web, so re-fetching
     the article is no reason whatever to buy the search again. Up to ~$0.27 a
     run, typically $0.13–0.20 (Stage 0b), and its `stamp` below compares a
     stored `sourceHash` against what the store holds, so when the article
     really has moved it re-runs without being forced. And it replaces rather
     than appends. */
  "debate",
]);

export interface StepContext {
  slug: string;
  /** The source URL. Absent only when re-running a late stage on an article that has one on disk. */
  url?: string;
  /**
   * The file the reader uploaded, when that is where this article came from.
   *
   * Beside `url` rather than replacing it, and **only the acquisition step ever
   * reads it**. Stage 2 onwards work off `raw.json`, which both origins write
   * and neither signs — that is the seam docs/project/content-extraction.md
   * calls the entire design, and putting the origin into every context without
   * putting it into every step is what keeps it true.
   */
  upload?: JobUpload;
  /*
   * **`dir` and `htmlFile` stood here until 2026-09-05, and nothing goes back
   * in their place.** They were `data/<slug>` and `output/<slug>.html`, computed
   * by `contextPaths` on every step of every job and read by nothing but the
   * `outputs` closures that have gone with them. A step is told what it may
   * read and where its product goes by the `ArtifactStore` it is handed; a path
   * on the context is a second answer to that question, and the one the
   * filesystem store used to give.
   * docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md § G.
   */
  /** Say something short about how this step is going. Shown live; not persisted. */
  report(detail: string): void;
  signal: AbortSignal;
  /**
   * **When this claimant stops** — `Date.now()`'s clock, and `undefined` where
   * nobody imposed one (a command line, a test).
   *
   * The signal above says *"stop now"*; this says *when* that will be, which is
   * a different and occasionally more useful thing: a step that fans out over
   * several paid calls can decline to **start** one it cannot finish, and hand
   * back with what it has bought already banked, rather than being aborted in
   * the middle of a call nobody will ever read. The hierarchy step's deepening
   * wave is the only reader today (src/hierarchy-deepen.ts § `runExpansionWave`).
   *
   * It is `LEASE_MS - DEADLINE_MARGIN_MS` after the claim, which is the same
   * instant `src/jobs.ts` sets its own timer for — one number, passed, rather
   * than two computed in two places.
   */
  deadlineAt?: number;
  /**
   * Who is reading, already rendered — `renderProfile` in src/profile.ts.
   *
   * Resolved once by whoever queued the job and carried here, never read from
   * storage by a step. Read the note on `Job.profile` in src/types.ts for why
   * that matters: a step that resolved it itself would let a profile edited
   * mid-run split one artefact across two profiles.
   *
   * **Not part of any step's `isDone`.** Staleness against a profile is a
   * separate question with its own answer — `profileIsStale` in src/profile.ts
   * — which the reader's panel asks and the pipeline does not. (A `guidance`
   * steer sat beside this and was left out for a different reason again: it was
   * a reason to *force* a rewrite rather than evidence of staleness. It is gone
   * — docs/plans/260830o-steer-becomes-the-profile.md.)
   */
  profile?: string;
  /**
   * Whether this step should pay to cache the article it is about to send.
   *
   * True when **any other step of this same job** renders the same article the
   * same way and asks the model to think about it at the same effort — which is
   * what `cacheArticleForStep` decides. A cache write costs 1.25x, so marking a
   * prefix nobody reads is a straight loss, and on the ordinary ingest path
   * (which now carries no article stage at all) nobody would.
   *
   * **"Any other", not "a later one".** It said later until 2026-09-03, and that
   * marked the step that writes the entry and never the one that reads it — a
   * request with no `cache_control` performs no lookup, so every batched pair
   * paid the premium and collected nothing. `cacheArticleForStep` has the story.
   *
   * Steps that do not read the whole article ignore this.
   */
  cacheArticle: boolean;
}

/**
 * What a step hands back when it is done: the line to show, and — once the step
 * has been converted — the artefacts it made.
 *
 * **`run` used to return a `string`, and the string is still here as `detail`.**
 * The rest is the seam this whole migration turns on:
 *
 * > A stage stops writing. It returns a product. A short commit afterwards
 * > writes the product, checks it, and finishes the step.
 *
 * On the filesystem that buys nothing — there is no transaction to hold — and
 * that is exactly why the shape lands first, with nothing converted, so the
 * boundary exists before anything depends on it (docs/plans/260827aa-delete-the-importer.md
 * § D1a). Under Postgres it is the difference between a step's artefacts, its
 * postcondition and its completion committing together or one at a time.
 *
 * **`parts` is optional and `UNCONVERTED_STEPS` is what makes that safe.** A
 * stage that still writes its own files during `run` returns `{ detail }` alone,
 * and the session refuses that for any step not on the list — because under a
 * transactional session the same stage would write nothing, pass its
 * postcondition against the artefacts the draft carried forward, and report
 * success. See `checkProduct` in src/store/session.ts.
 *
 * `stamp` is what the store records about this run, passed straight to `write`.
 * It is separate from `parts` because on the filesystem the stamp is a field
 * *inside* the artefact and the argument is checked against it rather than
 * stored (src/store/artifacts.ts § `write`).
 */
export interface StepProduct {
  /** One line about what happened, kept on the finished step and shown to the reader. */
  detail: string;
  /** The artefacts this run made, for the commit to write. Absent until the step is converted. */
  parts?: ArtifactParts;
  /** What the store should record about this run. */
  stamp?: StepStamp;
}

/**
 * The steps that still write their own artefacts inside `run`, and so are
 * allowed to return a product with no `parts` in it.
 *
 * **Empty since 2026-08-31, and it is kept rather than deleted.**
 *
 * Every one of the thirteen steps now returns its artefacts and writes no file of
 * its own (docs/plans/260831b-finish-the-database-move.md § Stage 2). The exemption has
 * no members, which means `LegacyUnconvertedStep` is `never` and `run` must
 * return a `ConvertedProduct` for every step in the pipeline — so the mechanism
 * has stopped being a list of exceptions and become a compile-time rule with no
 * way round it.
 *
 * **Deleting it would be the wrong tidy-up.** It is what makes conversion the
 * default rather than something a new stage has to opt into: a stage added
 * tomorrow that writes its own file is refused at commit, by name, and the only
 * way to make that legal is for somebody to add the name here deliberately.
 * That direction was inverted for a few hours on 2026-08-29 — a test held this
 * against `STEP_ORDER`, so a new step was *forced* onto the exemption to make
 * the suite green, which is fail-open. An empty list is the strongest the rule
 * has ever been; an absent one is no rule at all.
 *
 * GPT Sol's rule, and it is the whole design: the unsafe answer must never be
 * the one you get by doing nothing. A name is added here only by somebody who
 * has looked at the stage and knows it still writes its own files.
 *
 * **The two sessions now agree, where they used to differ.** The filesystem
 * session consults this list and a transactional one deliberately passes an
 * empty set instead — because a stage writing outside the transaction is the
 * failure the transaction exists to prevent
 * (docs/plans/260827aa-delete-the-importer.md § D1b). With the list empty those are the
 * same question, and that is the point of the migration rather than a reason to
 * merge them: the day somebody adds a name back, they diverge again on purpose.
 */
export const LEGACY_UNCONVERTED_STEPS = [] as const satisfies readonly StepName[];

/** A step still on the exemption above — see `LEGACY_UNCONVERTED_STEPS`. */
export type LegacyUnconvertedStep = (typeof LEGACY_UNCONVERTED_STEPS)[number];

/**
 * The same list as a set, for `checkProduct` — one source, so the runtime rule
 * and the type rule cannot disagree.
 */
export const UNCONVERTED_STEPS: ReadonlySet<StepName> = new Set<StepName>(
  LEGACY_UNCONVERTED_STEPS,
);

/**
 * What a **converted** step returns: the same product, with `parts` required.
 *
 * This is finding 3 of the D1a review made static. The runtime guard in
 * `checkProduct` refuses an absent `parts` for any step off the legacy list, and
 * this is the same refusal at compile time, so a new stage cannot reach the
 * runtime guard by accident.
 */
export interface ConvertedProduct extends StepProduct {
  parts: ArtifactParts;
}

export interface PipelineStep<N extends StepName = StepName> {
  name: N;
  /** Present tense, naming the actual thing — "Fetching the page", never "Loading". */
  label: string;
  /**
   * **What** this step produces — the kinds of thing it makes
   * (src/store/artifacts.ts), with the `ArtifactStore` deciding where they go.
   *
   * A step counts as done when **all** of them are readable, which is the only
   * safe reading for the two steps that make more than one: `extract` makes the
   * HTML and the metadata, `hierarchy` the tree, the labels and its copy of the
   * blocks. Checking only the first would let a crash between the two writes
   * leave a step that reports itself finished with half its output, and the
   * stage after it would consume the missing half.
   *
   * **For most steps this is still an existence check, not a correctness
   * check** — unless the step supplies `isDone` below. See the honest account of
   * the gap in
   * docs/project/ingest-queue.md#idempotent-is-the-goal-this-is-a-step-towards-it.
   *
   * **An `outputs(ctx): string[]` stood beside it until 2026-09-05**, saying the
   * same list as repository paths, and the pair existed so the swap to kinds
   * could be checked against the old declaration before anything depended on it
   * (docs/plans/260826e-postgres-storage-implementation.md § The order). The
   * paths went with the filesystem store; `produces` is the whole declaration
   * now, and `assertProduced` reads it through the store.
   */
  produces: readonly ArtifactKind[];
  /**
   * Optional: what stamp would this step write if it ran right now?
   *
   * The **currency** half of "is this step done", and the replacement for the
   * three near-identical `…IsCurrent` functions. The store reads the recorded
   * stamp (`stampFor`); this says what it ought to be; `sameStamp` compares
   * them once, in one place, instead of the same three lines living in
   * src/tweets.ts and src/glossary.ts.
   *
   * `null` means *we cannot tell* — the blocks it would be hashed against are
   * not readable — and that answers not-current. The safe way to be wrong here
   * is a model call; the other way round is a stale artefact served for ever.
   *
   * Adding one to `hierarchy` or `arc` is now four lines rather than a whole
   * function, which is the point. Neither has one yet, and the interface says
   * so out loud rather than letting bare existence look like freshness.
   */
  stamp?(ctx: StepContext, store: ArtifactReads): Promise<StepStamp | null>;
  /**
   * Optional: is this step's artefact not merely present but **current**?
   *
   * Existence is the default because it is all most steps can afford to check.
   * It is also not what "cached" means, and the difference is a
   * [silent success](docs/reusable/silent-success.md) waiting to happen: a
   * `tweets.json` describing last week's text is *present*, so the step skips,
   * reports "already done", and the reader gets a thread about an article that
   * has since changed — with a green tick over it.
   *
   * A step that can answer the real question answers it here. `tweets` does,
   * by comparing the `sourceHash` it stored against the blocks on disk, plus
   * its prompt version and model id — which is exactly what
   * architecture.md#storage has always specified for a cached artefact and what
   * nothing had implemented.
   *
   * Kept optional, and kept out of `produces`, on purpose: this is the only
   * place in the interface that can read an artefact's *contents*, so a step
   * that gets it wrong burns a model call every run. Adding one is a deliberate
   * act. `assertProduced` reads `produces` instead, because "did you write it"
   * stays a separate question from "was it worth writing".
   *
   * **`stamp` above is what replaces this, and one step is still here** —
   * `tweets`.
   *
   * The reason used to be that it kept `PROMPT_VERSION` module-private, so a
   * `stamp` for it would have written the version out a second time in this
   * file: two copies of one string, free to drift, and the drift showing up as
   * an artefact that never regenerates. **That reason has gone** — it exports
   * it now (`tweets/2`), as `glossary` did when it made the move.
   * What is left is one `stamp` line here and one deletion in the stage.
   *
   * Worth doing before the artefacts left the filesystem rather than after:
   * both of these `isDone` implementations used to read a directory off `ctx`,
   * and under Postgres there is no directory to read.
   * docs/plans/260827j-transactional-stage-runner.md § D.
   */
  isDone?(ctx: StepContext, store: ArtifactReads): Promise<boolean>;
  /**
   * Do the work, and hand back what was done — see `StepProduct`.
   *
   * **It returned the one-line summary as a bare `string` until 2026-08-29.**
   * Now that line is `product.detail` and the product has room for the
   * artefacts as well, so that a converted stage can stop writing and let the
   * commit after it do the writing inside one transaction. Nothing is converted
   * yet: all nine still write their own files and return `{ detail }` alone.
   *
   * **The store is `ArtifactReads`, not the whole store, and it has no default.**
   * Read-only because this half runs *outside* the commit and a write from here
   * would land outside the transaction that is supposed to hold the step
   * together. No default for the reason `stepIsDone` gives at length: a default
   * lets a Postgres caller that forgot it compile cleanly and get a confident
   * answer about the filesystem. Only `blocks` reads it today, because stage 3
   * is the only stage whose *previous output* is an input it cannot do without
   * (docs/project/block-ids.md); the two stages with the same shape, `glossary`
   * and `ideas`, are the next piece of work and this is the seam they take.
   *
   * **`checkpoints` is the third argument and not a field of `ctx`**, and the
   * reason is the same as `store`'s: `ctx` also reaches `stamp` and `isDone`,
   * neither of which may buy anything, and a capability that only the
   * run phase has should only be reachable from the run phase. Two of the
   * thirteen steps use it — `extract`, for a PDF's per-chunk transcriptions, and
   * `hierarchy`, for the nav-label batches — and both hand it straight down to
   * the stage rather than reading it here.
   *
   * **Required, with no default.** A stage handed nothing checkpoints nothing,
   * which is a run that costs money and reports success — so a caller with no
   * article to key on passes `nullCheckpointStore()` and says so out loud.
   * src/store/checkpoints.ts.
   */
  run(
    ctx: StepContext,
    store: ArtifactReads,
    checkpoints: CheckpointStore,
  ): Promise<N extends LegacyUnconvertedStep ? StepProduct : ConvertedProduct>;
}

/**
 * One block, as a string that can be compared across storage shapes.
 *
 * **Keys sorted and every field included, id and all.** Sorted because the two
 * sides are built by different code — `splitIntoBlocks` writes an object
 * literal, the Postgres adapter assembles one from columns — so key *order* is
 * not a fact about the block. Every field, rather than a chosen tuple, because
 * a field added to `Block` later is then covered without anybody remembering,
 * and the way this check fails when a field is forgotten is silence.
 *
 * **Nothing is normalised away, and an earlier version of this stripped the
 * ids.** That version could not see a block id that had moved, nor an internal
 * link repointed from one heading to another — both of which are exactly what
 * `blocks` exists to get right (docs/project/block-ids.md). GPT Sol reproduced
 * both against the real guard, 2026-08-31.
 */
function canonicalBlock(block: Block): string {
  const fields = block as unknown as Record<string, unknown>;
  return JSON.stringify(Object.keys(fields).sort().map((key) => [key, fields[key]]));
}

/**
 * Is stage 3's output still what stage 3 would produce from the HTML stage 2 is
 * holding **now**?
 *
 * Three questions, in increasing order of cost.
 *
 * 1. **Every id in the blocks artefact is in the stamped HTML.** All of them,
 *    not a sample. A cheap early rejection: it settles the commonest failure
 *    (stage 2 re-ran and wiped the ids) before anything is parsed, and it is
 *    the only question that can be asked without a full parse.
 * 2. **Stage 3, run again against the extracted HTML, writes the same
 *    document.** `splitIntoBlocks(extracted, storedBlocks).html` byte for byte
 *    against `stampedHtml`. This is the one question about the document as a
 *    document: a changed `<title>`, or anything else outside a block, moves it
 *    while every block stays identical.
 * 3. **And the same blocks, exactly** — ids, link targets, note fields and all.
 *
 * ## Why the baseline is passed, which took three goes to get right
 *
 * `splitIntoBlocks(extracted, file.blocks)`. Handing the stored blocks in is
 * what makes an **exact** comparison possible: unchanged content comes back
 * carrying the ids it already had (`carryOverIds`), so anything that differs
 * differs because the article did. Two earlier versions of this function got
 * that wrong in opposite directions — one omitted the baseline believing it
 * would manufacture agreement, the other passed it but then stripped the ids
 * out of the comparison, which threw away the very thing the baseline buys.
 * Omitting it is also the shape tests/blocks-baseline.test.ts refuses in `src/`,
 * because one argument to that function means "mint everything".
 *
 * ## Why question 1 is not enough on its own
 *
 * This began as `htmlCarriesItsIds`, which asked it alone. On disk that was
 * enough **by accident**: `extract.extractedHtml` and `blocks.stampedHtml` both
 * resolved to the same `output/<slug>.html` in the filesystem store's path map
 * (deleted 2026-09-05), so a
 * re-extraction overwrites the very file question 1 reads and the missing ids
 * give it away. In Postgres they are two columns (`extracted_html`,
 * `stamped_html`), question 1 compares stage 3's own output against stage 3's
 * own blocks, and it **returns true always** — a vacuous guard over the one
 * contract this codebase is built on, arriving at the moment the reads start
 * succeeding. docs/plans/260831b-finish-the-database-move.md § stage 1.
 *
 * ## Why not something cheaper than re-running the split
 *
 * Two cheaper things were tried and both were unsound, in ways worth keeping
 * because they looked well-measured at the time.
 *
 * - **Comparing the two documents' parsed text.** It under-fires:
 *   `<p>Alpha</p><p>Beta</p>` re-extracted as `<p>AlphaBeta</p>` has identical
 *   text and genuinely different blocks, as do a heading demoted to a
 *   paragraph, a repointed `href`, and whitespace inside a `<pre>`. And it
 *   over-fires in a way that cannot cure: stage 3 sanitises what it is handed
 *   and `FORBID_TAGS` (src/sanitize-policy.ts) removes `style` outright, so a
 *   healthy stamped HTML legitimately says less than its extraction — and under
 *   Postgres `extracted_html` stays unsanitised for ever, so the step would
 *   re-run and never report itself done.
 * - **Comparing the blocks with the ids normalised out.** Blind to a moved id
 *   and to a repointed internal link, which is most of what this guard is for.
 *
 * **The lesson, and it is the general one.** The first of those was measured
 * against one real article and found sound. One healthy pair says nothing about
 * the unhealthy ones, and nothing at all about the pairs that ought to be
 * healthy and are not — docs/reusable/silent-success.md.
 *
 * There is no cheap *exact* pre-check available from what is stored today. The
 * one that would work is persisted binding — digests of stage 2's input, the
 * stamped output and the blocks, written transactionally with the step run —
 * and that is storage work for a later stage. **Its absence is a reason to do
 * that work before the flip, not a reason to keep a cheaper heuristic now.**
 *
 * ## What it costs
 *
 * A full jsdom parse, a DOMPurify pass and a document walk — `splitIntoBlocks`
 * less the writing. Measured over the twenty articles in `output/` that have a
 * blocks artefact beside them: 7 ms for the smallest, 469 ms at 669 blocks, and
 * **934 ms for the 676 KB `consciousness`**, which is the worst case in the
 * corpus. It runs once per `stepIsDone` for this one step: once per job that
 * contains `blocks`, and once per metadata-page load (src/api.ts). Accepted as
 * temporary, against the persisted binding above.
 *
 * It is **not** short-circuited on the filesystem, where the two reads return
 * the same string. Two reasons: a guard that knows which store it is in is a
 * guard with an untested half, and the equality would not be safe anyway —
 * `runBlocks` writes the HTML before the blocks (src/blocks.ts), so an
 * interruption between the two leaves a stamped document and a blocks artefact
 * from different generations, wearing the same ids. GPT Sol, 2026-08-31.
 *
 * ## What it rests on, stated so it can be checked again
 *
 * Question 2 compares bytes, so it needs `splitIntoBlocks` to be **exactly**
 * idempotent: on the filesystem the candidates are derived from stage 3's own
 * output, because there is only one document. Measured across the twenty
 * articles in `output/` with a blocks artefact — exact HTML and exact blocks —
 * and independently by GPT Sol across 313 targeted and combinatorial cases
 * (canonical footnotes, nested lists, anchor retargeting, sanitiser removal,
 * embeds, templates, malformed nesting, SVG, orphan text, duplicate ids). No
 * non-idempotent class found. Evidence, not proof; and if it ever stops being
 * true, every filesystem article reports this step not-done at once rather than
 * quietly, which is the right way round for it to break.
 *
 * **The one case that is not idempotent is not reachable here**: `debugPage`
 * (src/extract.ts) writes `<!doctype html>` and jsdom serialises `<!DOCTYPE
 * html>`, so stage 2's string is not its own serialisation. It does not matter,
 * because both sides of question 2 are serialisations — `stampedHtml` is always
 * `dom.serialize()` output and so is the candidate. `output/revistes-ub-30977`
 * is the one article in the corpus still holding the lower-case form, and its
 * blocks artefact is from a different run anyway: question 1 rejects it, 0 ids
 * of 43.
 *
 * ## What it still does not prove
 *
 * That these blocks carry the ids a reader's comments name. Question 3 says
 * stage 3 would produce this artefact again, not that the ids in it were
 * carried rather than minted — `assertIdsCarried` (src/blocks.ts) is what holds
 * that, at write time, and it refuses rather than warns.
 *
 * **No ids at all is not "all of them are there".** `every` over an empty array
 * is true, so a `blocks.json` listing nothing passed this vacuously and the step
 * reported itself done having retained zero ids — an article the stages after it
 * then read as having no blocks in it. Reachable on a first ingest, where the
 * runtime guard in src/blocks.ts has no baseline to refuse against: a paywall or
 * an error page extracts to no prose, `{"blocks":[]}` satisfies the store's
 * shape check (`SHAPE` in src/store/artifacts.ts takes any array), and every
 * path exists and parses. GPT Sol, 2026-08-28.
 *
 * **Kept even though `assertSomethingWasProduced` (src/blocks.ts) now refuses to
 * write an empty artefact at all.** Belt and braces, and both halves have work:
 * the write-time guard stops new empties being created, and this one still has
 * to answer for the `blocks.json` files already on disk, which nothing will
 * rewrite. Deleting either leaves a real state unguarded.
 *
 * The cost of being wrong is small in the direction it can be wrong — stage 3
 * makes no model call, and re-running it carries the ids over rather than
 * minting new ones.
 */
async function blocksMatchTheirHtml(ctx: StepContext, store: ArtifactReads): Promise<boolean> {
  const file = await store.read(ctx.slug, "blocks", "blocks");
  const stamped = await store.read(ctx.slug, "blocks", "stampedHtml");
  /* Stage 2's output, named through `BLOCKS_INPUT_HTML` rather than spelled
     again, so this can never end up asking about a different document than the
     one stage 3 consumes. A missing one answers **not current** rather than
     "nothing to compare against": a `blocks` artefact whose input has gone is
     precisely the state this exists to refuse to call finished. */
  const extracted = await store.read(ctx.slug, "extract", BLOCKS_INPUT_HTML);
  if (!file?.blocks?.length || !stamped || !extracted) return false;

  const ids = new Set<string>();
  for (const [, id] of stamped.matchAll(/\sid="(spya-[a-z0-9]{6})"/g)) ids.add(id!);
  if (!file.blocks.every((block) => ids.has(block.id))) return false;

  const run = splitIntoBlocks(extracted, file.blocks);
  if (run.html !== stamped) return false;
  if (run.blocks.length !== file.blocks.length) return false;
  return run.blocks.every((c, i) => canonicalBlock(c) === canonicalBlock(file.blocks[i]!));
}

/*
 * `countBlocksIn` and `previousBlockCount` were here until 2026-08-28, and what
 * replaced them is worth a line where they stood.
 *
 * They counted blocks in the two `blocks.json` files on disk, so that the warn
 * in the `blocks` step could tell a first ingest (mint everything, correctly)
 * from a re-run that lost every id. Both halves were about to stop working at
 * once: with the artefacts in Postgres there are no files, the count is 0, and
 * `previousBlocks > 0` — the clause that keeps a first ingest quiet — keeps
 * *every* ingest quiet. The warning would have gone silent at the exact moment
 * it became true, which is docs/reusable/silent-success.md in one line.
 *
 * The replacement is not a better count. It is `previousBlocksFrom` and
 * `assertIdsCarried` in src/blocks.ts: the baseline comes from the store, and
 * losing it throws instead of warning. See
 * docs/plans/260827aa-delete-the-importer.md § Three stages carry identity in a file.
 */

/**
 * Has this step already produced everything it produces, and is what it
 * produced still current?
 *
 * Two questions, asked in that order, and the order matters: the artefacts must
 * be there whatever else is true, so presence runs first and a freshness check
 * only ever narrows the answer. It can never declare a missing artefact fine.
 *
 * **Presence is the store's answer now, and the store parses.** This used to be
 * `access()` over `outputs(ctx)` — pure existence — and that is how a
 * half-written file reported its step finished. A `writeFile` killed midway
 * leaves a file that exists and will not parse; the step skipped, and the stage
 * after it consumed half a JSON document (docs/reusable/silent-success.md).
 * Five steps were exposed and three were not, purely because the three had an
 * `isDone` that happened to parse on its way to asking a different question.
 * tests/pipeline-artifact-store.test.ts is that bug, one case per step.
 *
 * All of them, never any of them — `extract` writes the HTML *and* `meta.json`,
 * and a crash between the two must not report a finished step.
 *
 * **A run that started and never finished is not done, whatever it wrote.**
 * This is asked first and it is not the same question as presence. Per-file
 * atomic renames are not atomicity across a step: `extract` writes two
 * artefacts and `hierarchy` writes three, so a rerun that replaces one of them with a
 * perfectly valid new one and then dies leaves every path present and parsing,
 * describing two generations at once. No amount of looking at the files can
 * tell, which is why the store records the *attempt* as well as the output —
 * `beginStep` / `finishStep`, and `revision_step_runs.status` once this is
 * Postgres. Found by review, 2026-08-26.
 *
 * **The `store` argument is required, and used to have a default.** A default
 * meant a Postgres caller that forgot it compiled cleanly and got a confident
 * answer about the filesystem — the silent-success shape this seam exists to
 * remove, sitting inside the seam. There is no correct value to fall back to,
 * so there is no fallback: src/jobs.ts passes the pipeline's store, and
 * src/api.ts passes its own because the metadata page falls back to the
 * `example/` fixture.
 */
export async function stepIsDone(
  step: PipelineStep,
  ctx: StepContext,
  store: ArtifactReads,
): Promise<boolean> {
  if (await store.interrupted(ctx.slug, step.name)) return false;
  if (!(await store.has(ctx.slug, step.name, step.produces))) return false;
  if (step.stamp) {
    const expected = await step.stamp(ctx, store);
    if (!expected) return false;
    return sameStamp(await store.stampFor(ctx.slug, step.name), expected);
  }
  return step.isDone ? await step.isDone(ctx, store) : true;
}

/*
 * **`inputHashFor` used to live here** — the blocks hash a stamped stage would
 * be written against today, `hashBlocks` over stage 4's `blocks.json` — and it
 * is gone as of 2026-09-06 because its last caller stopped wanting it.
 *
 * That caller was `assets`, and the reason it stopped is worth keeping: a
 * blocks hash covers `id`, `text`, `role` and `treatment` and **not**
 * `block.html` (src/source-hash.ts), so it could not see a PDF figure marker
 * arrive. The step now stamps `assetsInputHash` (src/collect-assets.ts), which
 * hashes what it actually consumes. Everything else stamped through this
 * function had already moved to `articleInputHash` below on 2026-08-31, for a
 * version of the same complaint.
 */

/**
 * The fingerprint an **article-reading** stage would be written against today:
 * the blocks, the tree and the metadata head.
 *
 * The three inputs every prompt in this half of the pipeline actually consumes —
 * `articleFingerprint` in src/source-hash.ts says which fields and why. Used by
 * `tweets` and `glossary`; `arc`, `ideas` and `sketch` call their own
 * stage's `inputFingerprint`, which is the same function under a name that
 * belongs to the stage.
 *
 * **Until 2026-08-31 those stamped `inputHashFor` above**, so the
 * sections could be re-cut or the extracted title changed and all three went on
 * reporting themselves current. Nothing showed, because the pipeline's artefact
 * reads answer `null` today and the step re-runs regardless — the fault arrives
 * with the reads that make it work. docs/plans/260831b-finish-the-database-move.md
 * § stage 1; docs/reusable/silent-success.md.
 *
 * `null` is *"we cannot tell"* for the blocks and the tree alike. **The metadata
 * is not one of those cases**: every one of these stages tolerates a missing
 * `meta.json` on purpose, so "no meta" is a legitimate input and the fingerprint
 * hashes it as one.
 */
async function articleInputHash(ctx: StepContext, store: ArtifactReads): Promise<string | null> {
  const file = await store.read(ctx.slug, "hierarchy", "blocks");
  const tree = await store.read(ctx.slug, "hierarchy", "tree");
  if (!file?.blocks || !tree) return null;
  const meta = await store.read(ctx.slug, "extract", "meta");
  return articleFingerprint(file.blocks, tree, meta ?? null);
}

/**
 * Did the step that just returned actually write what it says it writes?
 *
 * `produces` is otherwise only a hint about skipping, and a hint is exactly the
 * kind of thing that drifts from the `run()` beside it without anything
 * failing. Checking it as a postcondition turns the list into a claim the step
 * has to keep — a stage that returns happily having written nothing is caught
 * here rather than three stages later, where the symptom is a missing file and
 * no clue about which step should have made it.
 *
 * **Through the store, and the store's rules, since 2026-08-26.** This used to
 * `access()` each path in `outputs`, so a malformed artefact or one over the
 * size ceiling this store can read back passed, and the job was marked done.
 * Asking the store closes that: if the postcondition passes, every artefact the
 * step declares is at least readable.
 *
 * **It still cannot tell that *this run* wrote them.** A forced stage that
 * returns having quietly left one old output untouched passes here, because an
 * old readable artefact reads exactly like a new one — and this does not run
 * `stamp` or `isDone` either, so for `blocks` it does not ask whether the HTML
 * carries the ids. An earlier version of this comment claimed the untouched-old
 * case was caught; a review found it was not. Closing it properly means one
 * validation used both after a run and at the skip decision, which is
 * docs/plans/260826e-postgres-storage-implementation.md § Step 11 half B, stage 5.
 */
export async function assertProduced(
  step: PipelineStep,
  ctx: StepContext,
  store: ArtifactReads,
): Promise<void> {
  const missing: ArtifactKind[] = [];
  for (const kind of step.produces) {
    if ((await store.read(ctx.slug, step.name, kind)) === null) missing.push(kind);
  }
  if (missing.length > 0) {
    throw new Error(`${step.name} finished without writing ${missing.join(" or ")}`);
  }
}

/**
 * Is there an article under this slug at all?
 *
 * **Separate from `urlForSlug` because an uploaded article has no URL**, so
 * asking for one and reading `undefined` as "nothing here" would hand the next
 * upload of a file with the same name the same directory — and every step would
 * find its artefact, skip, and report a row of successes over somebody else's
 * document. The same silent success `freeSlug` was written against, arriving
 * through the one door that function does not watch.
 *
 * ## Why it asks Postgres, since 2026-08-30
 *
 * It used to read `data/<slug>/meta.json` and nothing else. On Vercel that
 * directory is empty on every fresh invocation — `/tmp` is per-instance and
 * was scoped to one job by src/store/data-root.ts (deleted 2026-09-05) — so
 * this answered **"no article exists" for every slug in the library**, and so
 * did `urlForSlug`. What that
 * costs, traced from `freeSlug` (src/jobs.ts) through `onShelfOrInFlight`:
 *
 * 1. `freeSlug` believes the slug is unclaimed and hands it out.
 * 2. The pipeline runs, and is paid for.
 * 3. The job settles, and `publishRevisionIn` (src/store/pg-revisions.ts)
 *    resolves the slug through `ownedSlug`, so it lands on the article that was
 *    **already there**.
 * 4. Different owner ⇒ nothing is found and the publication refuses, at the
 *    end, after the money.
 * 5. **Same owner ⇒ that article's current revision is moved to the document
 *    just fetched**, and every write reports success.
 *
 * Case 5 is silent data loss, and it is what asking the live store fixes. Steps
 * 3–5 were `importArticle` (src/store/import.ts) until that file was deleted on
 * 2026-09-01, and it was worse: it deleted and reinserted the article's reader
 * state as well — comments, chat threads, saved searches, glossary lookups. The
 * importer has gone; the collision it made expensive has not.
 *
 * ## Owner-scoped, deliberately, and what that leaves open
 *
 * The Postgres branch asks for **the current owner's** articles, not for
 * anybody's, via `ownedSlug` (src/store/owned-slug.ts). `slugIsTaken`
 * (src/store/slug-is-taken.ts) is the sanctioned *global* boolean and is not
 * what these want, because of what happens next door: `urlForSlug` returns a
 * URL, so a global version of it would hand the caller **another owner's source
 * URL** while resolving a collision. GPT Sol: *"Do not expose another owner's
 * URL while resolving the collision."*
 *
 * So this closes the **destructive** case — same owner, reader state
 * overwritten — and knowingly leaves the **wasteful** one open: two owners
 * racing for one free slug, where the second pays for a whole pipeline before
 * publication refuses it (case 4 above). Fixing that needs a return shape that
 * can say *"taken, but not yours"* without disclosing what it is, and it
 * belongs in `freeSlug` rather than here. It is a known gap, not an oversight.
 *
 * **Broader than `meta.json` was**, and in the safe direction: this is true as
 * soon as the article row exists, which is before the first revision is
 * published. A slug with a row under it is spoken for, and saying otherwise is
 * the failure this function exists to prevent.
 *
 * **There was a filesystem branch here until 2026-09-05**, reading `meta.json`
 * out of the filesystem store's `data/<slug>`. It is gone with the flag, and
 * with it the one way this function and `contextPaths` could disagree about
 * where `data/` is: they were called one line apart in `slugIsSpokenFor`
 * (src/jobs.ts), and with a data-root override set, one read `meta.json` out of
 * one tree and the other `raw.json` out of another with no way to notice.
 * `contextPaths` itself went the same day — see where it stood, below.
 */
export async function articleExists(slug: string): Promise<boolean> {
  return (await ownedArticle(slug)) !== undefined;
}

/**
 * The current owner's article row for this slug, with its published revision's
 * URL if it has one — one query, so the two functions above cannot disagree.
 *
 * `undefined` means no such article *for this owner*. The URL is `null` for an
 * upload (which has no address) and for an article whose first extraction has
 * not been published yet, and those two are the same answer to the only
 * question `urlForSlug` is asked: there is no address to compare against.
 *
 * **A left join, so an article with no published revision still counts as
 * existing.** An inner join would have made `articleExists` false for a slug
 * whose ingest crashed after the row was created, which is precisely the state
 * where handing the slug out again does damage.
 */
async function ownedArticle(slug: string): Promise<{ url: string | null } | undefined> {
  const rows = await getDb()
    .select({ url: articleRevisions.finalUrl })
    .from(articles)
    .leftJoin(articleRevisions, eq(articleRevisions.id, articles.currentRevisionId))
    .where(ownedSlug(slug))
    .limit(1);
  return rows[0];
}

/**
 * A label for a step, given how this job is getting its document.
 *
 * Only the acquisition step has two of them, and the reason it needs two is
 * that "Fetching the page" is a false statement about an upload — there is
 * nothing to fetch and no page. A reader watching a row that says it is
 * fetching, when the file came off their own disk, learns something untrue
 * about where their document went.
 */
export function stepLabel(name: StepName, upload: boolean): string {
  return name === "fetch" && upload ? "Checking the file" : STEPS[name].label;
}

/**
 * The source URL for a slug. Undefined if there isn't one yet.
 *
 * **The question `freeSlug` actually asks**, through `onShelfOrInFlight`
 * (src/jobs.ts): given a slug somebody wants, what address is already under it,
 * so that `urlKey` can decide whether the two are one article. Answering
 * `undefined` when there *is* an article is what makes the pipeline overwrite
 * it — see `articleExists` above for the whole chain, for why the Postgres
 * branch is owner-scoped, and for the cross-owner case this deliberately does
 * not fix.
 *
 * This is the **published** revision's `final_url`, which is the same column
 * every other reader treats as `Meta.url` (src/store/pg.ts § `metaFrom`). A run
 * still in flight has no published revision and so no answer here; `activeFor`
 * is what covers that, and `onShelfOrInFlight` already asks it second.
 *
 * The `meta.json` branch beside it went with the flag on 2026-09-05.
 */
export async function urlForSlug(slug: string): Promise<string | undefined> {
  return (await ownedArticle(slug))?.url ?? undefined;
}

/*
 * **`contextPaths(slug)` stood here until 2026-09-05.** It returned
 * `data/<slug>` and `output/<slug>.html`, `src/jobs.ts` called it on every step
 * of every job to fill `StepContext.dir` and `htmlFile`, and by the end nothing
 * read the answer: the last consumers were the `outputs` closures, which went
 * with it. Proved before deleting rather than after, by making it return
 * `/nonexistent` and watching ten pipeline, job and session suites — 86 tests —
 * stay green.
 *
 * Nothing replaces it. Where an article's artefacts live is the
 * `ArtifactStore`'s business and no step's, which is the seam
 * docs/project/architecture.md § Stage ownership describes.
 */

/**
 * The URL a step needs, or a clear error rather than a fetch of `undefined`.
 *
 * `ours`, because a retry cannot find a URL that is not there. `retryJob`
 * (src/jobs.ts) copies `old.url` when there is one and `enqueue` otherwise
 * reads `meta.json` — the two places this already looked — so the second
 * attempt asks the same two questions and gets the same two answers.
 *
 * `ours` rather than `blocked`: nothing refused anything, this installation
 * simply has an article with no address recorded for it.
 */
function requireUrl(ctx: StepContext): string {
  if (!ctx.url) {
    throw stageFailure("ours", {
      generic: `No source URL for "${ctx.slug}". Its meta.json has none, and none was given.`,
    });
  }
  return ctx.url;
}

/**
 * **The page cap, enforced in stage 1** — one policy, called from the two places
 * the queue's acquisition step has PDF bytes for the first time.
 *
 * *The queue's*, and the qualifier is load-bearing ⟨Sol, 2026-09-04⟩. It used to
 * be that the stage CLIs did not come through here at all. Half of that is now
 * false and half is still true: `npm run ingest` — which replaced `npm run fetch`
 * on 2026-09-05 and which drives this very queue — is counted like any other
 * ingest, while `npm run eval:pdf-read` still keeps the original before
 * `runPdfExtract` counts anything. That exemption is deliberate: it is the PDF
 * extraction-quality tool, somebody at a keyboard spending their own attention,
 * and it cannot reach a reader's job. So "no PDF reaches storage uncounted" is
 * still a statement about the queue and not about the repo — with one fewer
 * exception than it had.
 *
 * Greg asked for the refusal to arrive in seconds rather than after a job card
 * has been running (docs/plans/260903k-pdf-page-cap-refused-with-no-reason-given.md
 * § Stage 4). It used to happen in stage 2, inside `pass0`.
 *
 * **Why two call sites rather than one shared seam after acquisition.** By the
 * time `acquireUpload` returns it has stored the canonical bytes and settled the
 * upload `verified` — and `verified` is terminal (src/source.ts § `NEXT`), so a
 * refusal on the far side of that line cannot mark the record `rejected` and the
 * reason is lost. That is the race `acquireUpload`'s own `refuse` comment
 * describes. And a fetched `.pdf` address never goes through `acquireUpload` at
 * all, so the upload half alone enforces nothing for half the origins. What is
 * duplicated is one call; the policy is here.
 *
 * **Not `pass0`.** That walks every page calling `getTextContent` — stage 2's
 * work, and 3.7–6.9 s of it on a real 144-page paper. `countPdfPages` reads the
 * page tree and walks away in tens of milliseconds, and shares its comparison
 * with `pass0`'s own guard so the two limits cannot drift
 * (src/pdf.ts § `refuseTooManyPages`).
 *
 * **A file pdf.js says it cannot read is not refused here — and only that.** The
 * cap is a cost gate, not a validity one: a malformed or password-protected PDF
 * fails in `pass0`, in the step whose sentence is about extracting, and forcing
 * it into the step whose sentence is about fetching would tell the reader
 * something untrue about where their document went. `pdfIsUnreadable`
 * (src/pdf.ts) is the whole of that judgement, and its comment carries the one
 * file shape it deliberately does not cover.
 *
 * **Everything else rethrows**, and the first draft of this did not. ⟨Sol,
 * 2026-09-04⟩ A bare `catch {}` around the counter also swallows a failed
 * dynamic import, a worker that would not start, a pdf.js regression and a
 * programmer error — and every one of those would leave the cap silently not
 * gating while the document went to storage. A gate that quietly stops gating
 * is docs/reusable/silent-success.md in its purest form, and the narrow catch is
 * the difference between "this file is not readable" and "the counter is
 * broken".
 *
 * `mark` is how the upload half records the refusal on its own row before the
 * throw unwinds the step. The fetched half has no record to mark.
 *
 * **The whole context rather than the slug**, since 2026-09-04, and the reason
 * is `ctx.signal`: this opens a stranger's file in our own process, and the
 * claimant's self-abort at 740 s is the only bound on how long that may take.
 * The first version took a slug and passed no signal, so the deadline could not
 * reach pdf.js at all ⟨GPT Sol⟩ — see `countPdfPages`.
 */
async function refuseAnOverlongPdf(
  ctx: StepContext,
  bytes: Uint8Array,
  mark?: () => Promise<boolean>,
): Promise<void> {
  const slug = ctx.slug;
  let pages: number;
  try {
    pages = await countPdfPages(bytes, ctx.signal);
  } catch (err) {
    if (!pdfIsUnreadable(err)) throw err;
    /* `warn`, not `debug`: production runs at `info`, so a debug line here would
       be exactly the reassuring comment that reports nothing. The class name and
       nothing else — no message, because that is a stranger's file talking
       (docs/project/logging.md). */
    plog.warn(
      { slug, step: "fetch", why: (err as Error).name },
      `page count: ${slug} would not open`,
    );
    return;
  }
  try {
    refuseTooManyPages(pages, MAX_PAGES);
    return;
  } catch (err) {
    if (!(err instanceof TooManyPages)) throw err;
    /* **Awaited before the throw**, for the reason `acquireUpload`'s `refuse`
       gives at length: a fire-and-forget mark races the unwind, and the state
       machine never reaches the terminal state that stops a pointless re-run.

       **And its answer is read.** `rejectUpload` returns `false` rather than
       throwing when the row will not move, and the one way that happens here is
       a record already `verified` — a first count that failed transiently,
       followed by one that did not. The job still fails with the right sentence;
       what is left behind is a `verified` upload for a document we refuse to
       read, and it is worth being able to find that rather than inferring it.
       ⟨Sol, 2026-09-04⟩ */
    if (mark && !(await mark())) {
      plog.warn(
        { slug, step: "fetch", pages: err.pages },
        `page count: ${slug} is over the cap but its upload record would not move`,
      );
    }
    /* `{ authored }`: `pages` is `doc.numPages` off pdf.js's page tree and the
       limit is our own constant. Two numbers, and the rest is fixed prose. The
       reader's sentence is `pdfTooManyPages`; this one is for the log, and says
       where to go if you are here to tune the cap. */
    throw stageFailure(pdfTooManyPages(err.pages, err.limit), {
      authored:
        `This PDF has ${err.pages} pages and the limit is ${err.limit}. That is a cost cap, ` +
        `not a technical one — see docs/plans/260826c-pdf-ingestion.md.`,
    });
  }
}

/**
 * **Stage 1 for a file the reader gave us** — the verification the plan calls
 * `verify-source`, living inside the acquisition step rather than beside it.
 *
 * That placement is the whole point and it was a review finding:
 *
 * > My "write `raw.json` + `raw.pdf` from the blob store" floats outside the
 * > step list, which means it bypasses `beginStep`, `finishStep`, cancellation,
 * > retry and `assertProduced` — the exact machinery built to make interrupted
 * > work visible.
 * >
 * > — docs/plans/260826u-pdf-upload-and-storage.md, on GPT Sol's review
 *
 * So it is `fetch`'s other half. Same step name, same contract, same one output
 * (`raw.json`), and from stage 2 onwards nothing can tell which half ran.
 *
 * ## The order of the checks, and why the bytes move exactly once
 *
 *  1. **`head`** — cheap, and refuses an over-cap object before anything moves.
 *  2. **one `get`**, bounded by the same cap.
 *  3. **`%PDF-`** over the bytes we hold. The bucket's MIME allowlist checked
 *     the type the *uploader claimed*; this checks the actual one, and they are
 *     different questions asked of different parties.
 *  4. **our SHA-256 against the browser's**, over that same copy. A mismatch is
 *     a refusal rather than a warning: the thing we are about to spend model
 *     money reading is not the thing the reader chose.
 *
 * Downloading once and doing 3 and 4 over that one copy is not an
 * optimisation — reading the object twice is the sequence content addressing
 * does not cover, because the grant is still live and the second read may not
 * be the bytes the first one verified.
 *
 * ## What it deliberately does not do
 *
 * **It does not delete the staging object.** Measured against the running
 * stack: deleting an object *re-arms* any grant still live over its key, so a
 * tidy-up inside the two-hour TTL races the browser it is cleaning up after and
 * can end with us having checksummed one document and extracted another.
 * Staging litter is swept later, after `SWEEP_GRACE_MS` — see src/source.ts.
 */
async function acquireUpload(
  ctx: StepContext,
  upload: JobUpload,
): Promise<{ manifest: RawManifest; detail: string }> {
  const record = await readUpload(upload.id);
  if (!record) {
    /* `ours`: the bytes may well be sitting in Storage perfectly intact, and
       there is nothing the reader can do about our having lost the note saying
       they are theirs. */
    throw stageFailure("ours", { generic: `No record of upload ${upload.id}.` });
  }

  /* **Awaited, not fired and forgotten.** The first version was `void
     rejectUpload(...)` followed immediately by a throw, which reads fine and
     races: the throw unwinds the step, the job fails with the right sentence,
     and the record is still `claimed` — so the *reason* an upload was refused
     is lost exactly when somebody comes looking for it, and the state machine
     never reaches the terminal state that stops a pointless re-run. Caught by
     the three refusal tests below, all of which asserted the record and not
     only the message. `Promise<never>`, so every call site has to `await` it
     and the compiler says so. */
  const refuse = async (reason: RejectReason): Promise<never> => {
    await rejectUpload(upload.id, reason);
    const failure = rejectionFailure(reason);
    /* The whole `ReaderFacingFailure`, not its two halves passed separately:
       `rejectionFailure` already wrote the reader a sentence per reason, and
       that sentence is what src/jobs.ts persists. src/job-failure.ts. */
    throw stageFailure(failure);
  };

  const store = blobStore();
  const key = stagingKey(upload.id);
  const info = await store.head(key);
  if (!info) await refuse("missing");
  if ((info as { bytes: number }).bytes > MAX_UPLOAD_BYTES) await refuse("too-big");

  ctx.report(upload.filename);
  const bytes = await store.get(key, { maxBytes: MAX_UPLOAD_BYTES, signal: ctx.signal });
  /* Absent between the `head` and the `get` — a sweep, or somebody with the
     service key. Rare, and it is still "that file never finished arriving" as
     far as the reader is concerned. */
  if (!bytes) await refuse("missing");

  const got = bytes as Uint8Array;
  if (!looksLikePdf(got)) await refuse("not-a-pdf");
  const sha256 = createHash("sha256").update(got).digest("hex");
  if (sha256 !== record.claimedSha256) await refuse("checksum-mismatch");

  /* **After the hash, before the promotion**, and the position is the whole of
     it: three lines further down the record is `verified` and nothing can move
     it again. Not through `refuse` above, because that throws the *static*
     sentence for the reason and the reader wants the page count — the record
     takes the reason, the job takes the number. See `refuseAnOverlongPdf`. */
  await refuseAnOverlongPdf(ctx, got, () => rejectUpload(upload.id, "too-many-pages"));

  /* Promoted to a name that is a statement about its contents, and create-only.
     `already-there` is the dedup hit — two readers with the same paper — and it
     is a success rather than a collision.

     **Through `storeRawSource`, not `putIfAbsent` directly**, and the comment
     here used to end "the bytes at that key are these bytes, by construction,
     because the key is their hash". That is the reasoning `storeRawSource`
     exists to refute: something can be at a canonical name without anybody
     having deleted anything — a crashed write, a bad backfill, anybody with the
     service key — and believing the hit would mark this upload `verified`
     while the canonical object stays corrupt. Uploads were the one path still
     doing it the old way after the helper landed, which is the shape a shared
     helper is supposed to prevent. GPT Sol, 2026-08-27. */
  const { sha256: storedSha256, outcome: promotion } = await storeRawSource(got, "pdf");

  const manifest: RawManifest = {
    kind: "pdf",
    file: "raw.pdf",
    /* **No URL, and none invented.** `RawManifest` used to require two, which
       is exactly the assumption docs/plans/260826u-pdf-upload-and-storage.md § 5 warned
       would take the time. A `file://` or an `upload://…` here would have read
       as an address to everything downstream — `GET /api/source/:slug`,
       import/export, the metadata page — and none of them would have said
       anything. */
    origin: "upload",
    uploadId: upload.id,
    filename: upload.filename,
    contentType: CONTENT_TYPE.pdf,
    encoding: null,
    bytes: got.byteLength,
    sha256,
    /* **The two stored fields, which this path was writing to the bucket and
       then leaving out of the manifest.** `storeRawSource` above returns the
       digest it stored under and it was being discarded, so every uploaded
       document reached the Postgres artefact store naming no object and was
       refused outright (`NoStoredDocument`). Uploads were the one acquisition
       path still doing this after `writeRaw` was fixed — the same shape as the
       `putIfAbsent` bug two comments up, which is what a shared helper is meant
       to prevent. GPT Sol, 2026-08-28.

       For a PDF this equals `sha256` above, because the stored bytes *are* the
       fetched bytes. It is taken from the helper's return anyway rather than
       assumed, since that is the value the object is actually under. */
    storedSha256,
    storedBytes: got.byteLength,
    fetchedAt: new Date().toISOString(),
  };

  /* Only from `claimed`. A second run of this step — Retry, or `advanceJob`
     walking the list again over a job whose `raw.json` was written and whose
     later stage failed — finds the upload already `verified`, and re-verifying
     is not a transition. The work above is idempotent and cheap enough to
     repeat; the state machine is the thing that must not be asked to go
     backwards. */
  if (record.status === "claimed") {
    await settleUpload(upload.id, "verified", {
      sha256,
      bytes: got.byteLength,
      slug: ctx.slug,
    });
  }

  const kb = Math.round(got.byteLength / 1024);
  /* Not the filename: it is the reader's own string and can hold anything,
     including the title of something they would not want in a log. The size and
     whether the bytes were already ours are what a person running this server
     actually wants — `deduped` going from false to always-false is how you find
     out the canonical keys have stopped being content hashes. */
  plog.debug(
    { slug: ctx.slug, step: "fetch", origin: "upload", kb, deduped: promotion === "already-there" },
    `upload ${ctx.slug}: ${kb} KB verified`,
  );
  /* **The manifest goes back rather than to `ctx.dir`, exactly as the fetched
     half's does.** The two origins have to end in the same artefact or the seam
     stage 2 onwards depends on is not a seam
     (docs/project/content-extraction.md). This path wrote `raw.pdf` and
     `raw.json` itself until 2026-08-31, which meant the upload branch was still
     the filesystem's while the fetch branch had stopped being — the one shape
     `writeRaw` was refactored to prevent. The bytes are already in the
     content-addressed bucket, under `storedSha256`, put there by
     `storeRawSource` above. */
  return { manifest, detail: `${kb} KB` };
}

/**
 * **The three reasons painting the argument refuses**, as a closed union.
 *
 * It was `refuse(why: string)` until 2026-09-03 — one helper that took a
 * sentence and appended *"Draw the Sketch first…"* — and that shape was wrong
 * twice over. Its three callers mean three different things, so they want three
 * sentences and three codes rather than one; and a free-string factory would
 * let arbitrary text be minted into a **coded** `ReaderFacingFailure`, which is
 * precisely the provenance `authored` in src/monitoring-scrub.ts is told to
 * trust. ⟨Sol, 2026-09-03⟩
 *
 * The map is total over the union, so a fourth reason cannot be added without
 * coming here and writing its sentence — the discipline `RETRYABLE` and
 * `STEP_GAVE_UP` in src/messages.ts already keep.
 *
 * **No `detail`, on purpose.** `stageFailure` then makes `Error.message` the
 * reader's own coded sentence, which is a stronger claim than `{ authored }`
 * rather than a weaker one: the string is a registered message out of
 * src/messages.ts, so Sentry forwards it and the log line says which of the
 * three fired. There is nothing further a diagnostic could add — the slug is
 * already a Sentry tag and a log field.
 */
type IllustrateRefusal = "no-sketch" | "stale-sketch" | "wrong-profile";

const ILLUSTRATE_REFUSAL: Record<IllustrateRefusal, ReaderFacingFailure> = {
  "no-sketch": ILLUSTRATE_NO_SKETCH,
  "stale-sketch": ILLUSTRATE_SKETCH_STALE,
  "wrong-profile": ILLUSTRATE_SKETCH_PROFILE,
};

/**
 * A function declaration rather than a `const`, so that TypeScript narrows
 * after a call to it: `if (!usableSketch(sketch)) refuseToIllustrate(…)` leaves
 * `sketch` usable below, where the arrow it replaced needed a
 * `throw new Error("unreachable")` underneath it to say the same thing.
 */
function refuseToIllustrate(reason: IllustrateRefusal): never {
  throw stageFailure(ILLUSTRATE_REFUSAL[reason]);
}

/**
 * **The PDF half of the `assets` step** — or `undefined`, which means this
 * article never had a PDF to look in.
 *
 * Three cheap refusals before a byte of the document is read, in this order
 * because each is cheaper than the next: an article whose stage-1 manifest says
 * it was not a PDF, a PDF whose blocks carry no figure marker, and only then
 * the object itself. Three of the seven eval PDFs contain no raster image
 * anywhere and every web article contains no PDF, so the ordinary case has to
 * cost nothing — and the cheapest way to make that true is to never reach
 * `getDocument`.
 *
 * **`undefined` is not an empty run**, and the difference reaches the reader:
 * an absent `pdfFigures` means *there was nothing here to look at*, and a
 * present one with failed entries means *we looked and could not*. Collapsing
 * them is how a feature that has not shipped yet gets reported as one that
 * failed. src/assets.ts § `Assets`.
 *
 * **The bytes come through `readRawBytes`**, which is what stage 2 already uses
 * and which verifies the object against the hash the manifest names — so this
 * cannot read a *different* document than the one whose sha256 every marker's
 * ref folds in. A raw document that has gone missing is recorded against the
 * figures and does not fail the step, because the article's web images are the
 * other half of it and are unaffected.
 */
async function recoverPdfFigures(
  ctx: StepContext,
  store: ArtifactReads,
  blocks: Block[],
): Promise<PdfFiguresRun | undefined> {
  const manifest = await store.read(ctx.slug, "fetch", "raw");
  if (manifest?.kind !== "pdf") return undefined;
  const markers = pdfFigureMarkersIn(blocks);
  if (markers.length === 0) return undefined;

  let pdf: Uint8Array;
  try {
    pdf = await readRawBytes(manifest, { slug: ctx.slug });
  } catch {
    /* The bytes are not where the manifest says, or are not the ones it
       promises. That is a fact about the document rather than about any figure,
       so every marker gets the reason that means *nothing is known about this
       at all* — and the step carries on and stores the web images, of which a
       PDF has none, so the manifest is empty either way and the article is
       still readable. */
    const at = new Date().toISOString();
    const entries: PdfFigureEntry[] = markers.map((marker) => ({
      ref: marker.ref,
      page: marker.page,
      status: "failed",
      reason: "out-of-time",
      at,
    }));
    return {
      entries,
      stored: 0,
      failed: entries.length,
      deduped: 0,
      bytes: 0,
      storageErrors: [],
      elapsedMs: 0,
    };
  }
  return collectPdfFigures({ markers, pdf, signal: ctx.signal });
}

/**
 * The pipeline.
 *
 * Stage numbers here are the ones in architecture.md § Pipeline. The one that
 * looks missing is sanitising, which is not a step of its own: it happens
 * *inside* `blocks`, at the top of `splitIntoBlocks`, so that the stored
 * blocks.json is already safe and no later consumer has to remember. See
 * src/sanitize.ts.
 */
/**
 * **`{ [K in StepName]: PipelineStep<K> }`, not `Record<StepName, PipelineStep>`.**
 * Each entry is bound to its own name, which is what lets `run`'s return type
 * depend on whether that name is still on `LEGACY_UNCONVERTED_STEPS`.
 */
export const STEPS: { [K in StepName]: PipelineStep<K> } = {
  /* Stage 1. Its own step, and its own artefact, so that a failed or wrong
     extraction can be retried without asking the publisher again — and without
     the answer being different because they changed the page in between.

     The work is src/fetch.ts, which is stage 1's own module and does a great
     deal more than a `fetch().then(r => r.text())`: byte caps that count the
     decompressed size, the page's declared encoding rather than an assumed
     UTF-8, PDFs told apart by their bytes, and typed failures with a sentence a
     reader can act on. Those messages are what a failed step shows, which is
     most of why this step is three lines. */
  fetch: {
    name: "fetch",
    label: "Fetching the page",
    /**
     * **The manifest, not the bytes.** `raw.json` is the one file that exists
     * after both kinds of fetch, so it is the one that can mean "this step is
     * done". Listing `raw.html` would make an article that turned out to be a
     * PDF look permanently unfetched, and it would re-fetch on every retry.
     */
    produces: ["raw"],
    async run(ctx) {
      /* **The one branch in the whole pipeline that knows where an article came
         from.** An upload has nothing to fetch — the bytes are already ours —
         so this half verifies them and writes the same manifest the other half
         does. See `acquireUpload`, and the label this step shows, which is not
         "Fetching the page" when there is nothing to fetch. */
      if (ctx.upload) {
        const { manifest, detail } = await acquireUpload(ctx, ctx.upload);
        return { parts: { raw: manifest }, detail };
      }
      const url = requireUrl(ctx);
      const host = new URL(url).hostname;
      ctx.report(host);
      const doc = await fetchDocument(url, { signal: ctx.signal });
      /* **Before `writeRaw`**, so a document we will not read does not end up
         in the content-addressed bucket under its own hash. The branch is on
         what stage 1 decided the bytes *are*, never on the address — a `.pdf`
         URL that served a Cloudflare challenge is HTML (docs/project/fetching.md).
         No upload record here, so nothing to mark. */
      if (doc.kind === "pdf") await refuseAnOverlongPdf(ctx, doc.bytes);
      /* **No directory.** `writeRaw` puts the bytes in the content-addressed
         `sources` bucket and hands back the manifest that names them; where the
         manifest itself goes is this caller's business, and for the queue that
         is the store. `writeRawFiles` in the same module still writes the two
         files, and since `npm run fetch` was replaced by `npm run ingest` on
         2026-09-05 its only remaining caller is a test — it dies in stage G.
         docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md. */
      const manifest = await writeRaw(doc);
      const kb = Math.round(manifest.bytes / 1024);
      /* The **hostname**, not the URL. A log of full article URLs is a reading
         history, and nothing writes one down: the enqueue line in src/jobs.ts
         deliberately logs the slug and not the url, and says so. (This comment
         used to claim the URL "is already written once when the job is
         enqueued", which was never true — it read as a reason to relax here,
         which is the opposite of what the neighbouring file decided. Found by a
         GPT/Codex review, 2026-08-26.) The host and the size are what you want
         when a page comes back suspiciously small, or when one publisher keeps
         failing. See log.ts's note on `url` not being redacted, and why. */
      plog.debug({ slug: ctx.slug, step: "fetch", host, kb }, `fetch ${ctx.slug}: ${kb} KB`);
      return { parts: { raw: manifest }, detail: `${kb} KB` };
    },
  },

  /* Stage 2. Reads what stage 1 wrote rather than re-fetching, which is the
     whole point of splitting the two.

     **Two extractors, one artefact.** A web page goes through Readability; a
     PDF goes through a model that reads its pages. Both write `article.html`
     and `meta.json`, and stage 3 onwards cannot tell which produced them —
     which is the entire design. See docs/plans/260826c-pdf-ingestion.md.

     The branch is on **what stage 1 says it fetched**, never on the URL: a
     `.pdf` address that served a Cloudflare challenge is HTML, an
     `application/octet-stream` that starts `%PDF-` is a PDF, and stage 1
     already looked at the bytes (docs/project/fetching.md). */
  extract: {
    name: "extract",
    label: "Extracting the article",
    produces: ["extractedHtml", "meta"],
    async run(ctx, store, checkpoints) {
      /* **The manifest through the store, and the bytes by content address.**
         Stage 1 no longer leaves anything in `ctx.dir`: it puts the document in
         the `sources` bucket and returns the manifest that names it. So this
         reads the manifest from wherever stage 1's product was committed, and
         `readRawBytes` fetches the object `storedSha256` points at — through
         `blobStore()`, the same selection `writeRaw` wrote through, because
         anything else is a split brain by construction. */
      const manifest = await store.read(ctx.slug, "fetch", "raw");
      if (manifest === null) {
        throw stageFailure("ours", {
          generic: `No fetched document for "${ctx.slug}" — run the fetch step first.`,
        });
      }
      let bytes: Uint8Array;
      try {
        bytes = await readRawBytes(manifest, { slug: ctx.slug });
      } catch (err) {
        /* **Not one message for all three reasons, and the difference is
           whether the reader can do anything.** Retry never re-runs a step that
           finished, and `fetch` finished, so no reason here is served by the
           button — but that is a fact about the *button*, and the sentence has
           to be about the reader.

           `no-object` and `missing` mean the bytes are not where the manifest
           says. Adding the article again really does fix that: the fetch runs
           afresh and stores them. `SOURCE_DOCUMENT_GONE`, `blocked`.

           `corrupt` — from either constructor — means the bytes *are* there and
           are not the ones the name promises, and **adding the article again
           does not fix it**. The object is content-addressed, so a re-fetch of
           the same document lands on the same name, finds something already
           there, and leaves the bad object alone; both throw sites say so in as
           many words (src/fetch.ts). Telling the reader to try the thing that
           cannot work is the expensive mistake docs/project/copy.md § rule 2
           names, so this is `SOURCE_DOCUMENT_DAMAGED`, `bug`, and the object
           needs clearing here. GPT Sol, reviewing the built stage 1, finding 4.

           **The kind was all the reader got until 2026-09-03**, so they were
           told a step had refused and never what had happened. The diagnostic
           keeps the object key, the hashes and the credential reading either
           way, which is what somebody looking at the store needs and nothing a
           reader can use.

           `{ authored }` around an `err.message`, which src/job-failure.ts
           warns against in general and which is safe here because the class is
           narrowed by `instanceof` and every one of its four constructors is in
           src/fetch.ts: fixed prose around a slug, a content-addressed key,
           byte counts, a local digest, and `credentialsSeen()`, which reports
           only whether two environment variables are *set*. Nothing on that
           list arrived over a wire. `RawDocumentUnavailable`'s own header
           carries the constraint that keeps it true. */
        if (err instanceof RawDocumentUnavailable) {
          throw stageFailure(
            err.reason === "corrupt" ? SOURCE_DOCUMENT_DAMAGED : SOURCE_DOCUMENT_GONE,
            { authored: err.message },
          );
        }
        throw err;
      }

      /* **Only the HTML half needs a URL**, and it needs it as a base for
         relative links rather than as a thing to fetch. A PDF does not: it
         carries no relative hrefs, and an uploaded one has no address at all.
         Asking for one up here — which this did — is what made `requireUrl` the
         first thing an upload hit, three stages after the last thing that could
         have supplied one. */
      if (manifest.kind !== "pdf") {
        const url = requireUrl(ctx);
        /* `TextDecoder`, and no encoding branch: `writeRaw` stores the
           *decoded* string for an HTML page, so these bytes are already UTF-8
           whatever the publisher served. The manifest records the original
           encoding so that stays visible. */
        const html = new TextDecoder().decode(bytes);
        try {
          const result = await runExtract({ html, url, slug: ctx.slug });
          return {
            parts: { extractedHtml: result.extractedHtml, meta: result.meta },
            detail: result.meta.title,
          };
        } catch (err) {
          /* **Only this one, and by type since 2026-09-03.** Everything else
             `runExtract` can throw — a full disk, a directory that vanished —
             is ordinary bad luck, and hiding a Retry that would have worked is
             the costlier way to be wrong.

             It was a regex over `err.message` until the day this comment was
             written, which is the shape `blocks` below had already moved off:
             a prose match rots when somebody rewords the sentence, and being
             prefix-only it could not prove that a message it matched was ours
             all the way to the end. `ReadabilityRefused` (src/extract.ts) says
             the same thing in the type system and says it exactly.

             **The diagnostic is fixed here and is deliberately not
             `{ authored }`.** The claim is *I wrote every character of this
             string*, and the string worth logging is the error's own, which
             stage 2 owns and this seam does not — so what travels to Sentry is
             the reader's coded sentence, and the log keeps the library's name.
             ⟨Sol, 2026-09-03⟩ */
          if (err instanceof ReadabilityRefused) {
            throw stageFailure(
              PAGE_HAS_NO_ARTICLE,
              "Readability found no article in the fetched page.",
            );
          }
          throw err;
        }
      }

      const result = await runPdfExtract({
        frontMatter: openRouterFrontMatterReader(),
        bytes,
        ...(ctx.url ? { url: ctx.url } : {}),
        /* The last rung of the title ladder is the filename, and for an upload
           that is the reader's own — which is very often the best name anybody
           has for a scan. For a fetched PDF it stays the URL's last segment,
           which is what it always was. */
        ...(manifest.filename ? { filename: manifest.filename } : {}),
        /* **The chunk checkpoints, which is what makes a 250-page PDF
           finishable at all** — and the ceiling is 250 rather than 100 since
           2026-09-04 precisely because they work now (src/pdf-read.ts §
           `MAX_PAGES`).

           It was `ctx.dir` until 2026-09-01 — job-scoped `/tmp` on Vercel — and
           a retry is a new job id on a different machine, so every attempt
           started from zero and a long document could fail for ever without
           ever accumulating enough finished chunks to get under the deadline.
           This store is keyed on the article, which survives both.

           **That last sentence was a wish until 2026-09-03**, because a retry
           minted a fresh article as well as a fresh job, so the article was not
           a thing that survived either. `slugForRetry` (src/jobs.ts) is what
           makes it true; the whole story is
           docs/postmortems/260904a-a-retry-minted-a-fresh-name-so-the-checkpoints-could-never-be-found.md.
           docs/plans/260901d-simpler-finish-sol.md § 4. */
        checkpoints,
        slug: ctx.slug,
        signal: ctx.signal,
        /* Aggregated here rather than reported per chunk from inside the stage:
           several chunks finish at once and callbacks racing each other would
           make the progress line jump backwards. src/jobs.ts § describe. */
        onProgress: (done, total, pages) =>
          ctx.report(`${done}/${total} chunks, page${pages.length > 1 ? "s" : ""} ${pages.join("–")}`),
      });
      plog.info(
        {
          slug: ctx.slug,
          step: "extract",
          kind: "pdf",
          pages: result.pages,
          chunks: result.chunks,
          records: result.records,
          strippedChars: result.stripped,
          retries: result.retries.length,
          isScan: result.isScan,
          recall: result.recall,
          inputTokens: result.usage.input,
          outputTokens: result.usage.output,
          /* **The front-matter pass's own tokens, beside the transcription's
             rather than added to them.** Two models on two jobs, and this line
             names one of them in `model`; a sum across both would be a number
             whose unit nobody can state (src/models.ts § `Wire`). The money is
             recorded centrally under `pdf-frontmatter` either way — this is so
             the *step's* line stops implying the transcription was the whole
             bill. GPT Sol, 2026-09-05. */
          frontMatterInputTokens: result.frontMatterUsage.input,
          frontMatterOutputTokens: result.frontMatterUsage.output,
          model: result.meta.method,
        },
        `extract ${ctx.slug}: ${result.pages} pages of PDF in ${result.chunks} chunks`,
      );
      return {
        parts: { extractedHtml: result.extractedHtml, meta: result.meta },
        detail: result.meta.title,
      };
    },
  },

  /* Stage 3 — and the sanitiser, inside it. */
  blocks: {
    name: "blocks",
    label: "Splitting into blocks",
    /**
     * The JSON **and the HTML**, and `output/<slug>.blocks.json` rather than
     * `data/<slug>/blocks.json`.
     *
     * Two separate points, both easy to get wrong.
     *
     * The HTML, because stage 3 writes the ids back into it — that is what
     * makes `#spya-k3m9qt` an anchor with no JavaScript. Listing only the JSON
     * would let a blocks-only job find its JSON, skip, and leave the HTML
     * without the ids the JSON says are in it.
     *
     * And the JSON beside the HTML, because there are two copies of it and only
     * that one is this step's: stage 4 copies it into the data directory as it
     * writes the tree, so the pair there is guaranteed to be what the tree was
     * built from. Checking the data copy here would mean a finished `blocks`
     * step reporting itself unfinished until `hierarchy` had run too — so a retry
     * would redo stage 3 every time, and `{ steps: ["blocks"] }` could never
     * skip itself.
     */
    produces: ["blocks", "stampedHtml"],
    /* Presence is not enough here, and this is the only step where that is
       true for a reason other than cost — see `blocksMatchTheirHtml`. */
    isDone: (ctx, store) => blocksMatchTheirHtml(ctx, store),
    async run(ctx, store) {
      /*
       * **The store, not a path, and read before the stage runs.**
       *
       * Stage 3 keeps a paragraph's id across a re-extraction by matching this
       * run's blocks against the previous run's — that is the whole reason
       * random ids are survivable (docs/project/block-ids.md). Until 2026-08-28
       * it got the previous run by reading `output/<slug>.blocks.json` inside a
       * `try/catch` whose `catch` said "first run for this article", so the day
       * the artefacts leave the filesystem every article silently becomes a
       * first ingest and every anchor in the database stops naming anything.
       *
       * `previousBlocksFrom` asks the store instead, and refuses rather than
       * minting when a baseline that should be there is not. On the filesystem
       * it reads the same file as before; in Postgres it reads the block rows
       * `beginDraftIn` copied into this draft from the published revision.
       *
       * **Which HTML this consumes is `BLOCKS_INPUT_HTML` in src/blocks.ts —
       * stage 2's, `extractedHtml`, never stage 3's own `stampedHtml`**, and
       * that only becomes a real choice when the input stops being a path: on
       * disk `extractedHtml` and `stampedHtml` are the same file. Landing D
       * has to honour it; the reasoning is on the constant.
       */
      const previous = await previousBlocksFrom(store, ctx.slug);
      /* **Stage 2's document, named through the constant rather than spelled
         here**, and this is the read `blocksMatchTheirHtml` above makes its
         judgement against — the two have to be the same document or the guard
         is comparing this run's output with a different run's input. On the
         filesystem `extractedHtml` and `stampedHtml` resolve to one file, so
         this reads what stage 3 itself last wrote; in Postgres they are two
         columns and this is stage 2's. That difference is the whole reason the
         constant exists (src/blocks.ts § `BLOCKS_INPUT_HTML`). */
      const extracted = await store.read(ctx.slug, "extract", BLOCKS_INPUT_HTML);
      if (extracted === null) {
        /* `ours`, not `blocked`: nobody refused us anything, we simply cannot
           find the document stage 2 was supposed to leave.

           **The reader never sees this sentence**, and the last clause of this
           comment said they did — written 2026-08-31, before the seam split
           gave a step two audiences (src/job-failure.ts § Two strings, not
           one). "Run the extract step first" is addressed to whoever is running
           steps by hand, so `{ generic }`: the reader gets `stepGaveUp`'s
           `ours` copy. What that copy withholds is the Retry button, which sits
           oddly beside the claim this comment used to make — that re-running
           `extract` would fix it. If that claim is right the *kind* is wrong,
           and that is a question about the button rather than about the
           sentence, so it is left as it stands rather than changed in passing. */
        throw stageFailure("ours", {
          generic: `No extracted HTML for "${ctx.slug}" — run the extract step first.`,
        });
      }

      let run: BlocksRun;
      try {
        run = runBlocks({ slug: ctx.slug, extractedHtml: extracted, previous });
      } catch (err) {
        /* **Only this one, and by type rather than by sentence.** Stage 3 read
           the HTML an earlier step wrote and Retry never re-runs a step that
           finished, so the second attempt hands it the identical prose-free
           document and it stops in the identical place — which is what the
           error's own last sentence tells the reader, while an unclassified
           failure was offering them a Retry underneath it. Everything else
           `runBlocks` can throw — a full disk, a directory that vanished — is
           ordinary bad luck, and hiding a Retry that would have worked is the
           costlier way to be wrong (the same argument as `extract` above).

           `IdsNotCarried` is deliberately not here: it is thrown against a
           baseline, so it is the *article* that changed under us, and whether a
           retry can come out differently depends on why. It has never been
           classified and this is not the change that decides it.

           **"which is what the error's own last sentence tells the reader" was
           not true**, and was written in good faith on the day the two
           audiences were split apart. `NoBlocksProduced`'s message goes to the
           log; what a reader saw was `stepGaveUp`'s generic `blocked` copy.
           `ARTICLE_HAD_NO_TEXT` is now what they get, and it keeps the one
           useful thing that message had to say — the usual causes, and that it
           is the fetch rather than this step that needs looking at.

           `{ authored }`: `NoBlocksProduced` (src/blocks.ts) is fixed prose
           around `slug`, which docs/project/logging.md permits by name and
           `captureFailure` already sends to Sentry as a tag. Its header carries
           the constraint that keeps that true. */
        if (err instanceof NoBlocksProduced) {
          throw stageFailure(ARTICLE_HAD_NO_TEXT, { authored: err.message });
        }
        throw err;
      }
      const previousBlocks = run.previousBlocks;
      const { total, minted, carried, reused, retargeted } = run.stats;
      const kept = reused + carried;

      const fields = {
        slug: ctx.slug,
        step: "blocks",
        total,
        minted,
        carried,
        reused,
        /* Zero on nearly every article and on every re-run, which is the point:
           a page that links to its own sections is the case where stage 3
           renaming an id used to break something (blocks.ts § retargetAnchors),
           and this is the only place that says it happened. */
        retargeted,
        previousBlocks,
      };
      plog.info(fields, `blocks ${ctx.slug}: ${total} blocks, ${minted} minted, ${kept} kept`);

      /*
       * The one thing in this pipeline that quietly destroys reader data.
       *
       * Block ids are the spine: every comment, and later every note and
       * highlight, is anchored to one (docs/project/block-ids.md). Stage 3 is
       * meant to be idempotent — ids already in the HTML are reused, and ids the
       * previous run knew are carried over by matching the block's words, which
       * is what makes a re-extraction survivable. When that works, `minted` is 0
       * or nearly 0 on a re-run.
       *
       * **This used to be a warn here, and it is now a throw in src/blocks.ts.**
       * The warn was right about what to watch and wrong about two things. It
       * counted the previous ids by reading two files, which returns 0 once
       * there are no files — so it went silent at the moment it became true. And
       * a warn lets the step succeed: the reader's anchors are gone either way,
       * and a line in a log nobody is tailing is not a defence.
       *
       * `assertIdsCarried` replaces it, comparing the baseline's **ids** against
       * the output's rather than their counts — two equal totals made of
       * entirely different ids is the failure, not the healthy case — and it
       * refuses before either artefact is written.
       *
       * A *partial* loss — 5 of 139 survive — is just as real and is still not
       * flagged, because any cutoff would be a guess and a guessed alarm gets
       * ignored. `previousBlocks`, `carried` and `reused` are all in the info
       * line above, so that case is one query away instead.
       */
      /* **`blocksArtefact`, not a bare `{ blocks }`.** Every writer of this
         artefact goes through it — stage 3 here, stage 4 in src/hierarchy.ts, the
         Postgres export — because the stamp it adds is what lets a reader tell
         blocks cleaned by the current sanitiser policy from blocks cleaned by
         nothing. A plain `{ blocks: run.blocks }` compiles, writes, and makes
         every article read back as *predates the sanitiser* for ever. */
      return {
        parts: { blocks: blocksArtefact(run.blocks), stampedHtml: run.html },
        detail: `${total} blocks, ${minted} new ids (${kept} kept)`,
      };
    },
  },

  /* Stages 4 + 5 — one model call writes the structure and the gists together;
     src/hierarchy.ts says why they are not two passes. */
  hierarchy: {
    name: "hierarchy",
    label: "Building the hierarchy",
    /* `labels.json` is in here as well as the tree, because stage 4 is two model
       passes now and a directory with a tree but no labels is a half-run step,
       not a finished one. src/hierarchy.ts writes the tree last for the same reason. */
    produces: ["tree", "labels", "blocks"],
    /**
     * **No `stamp`, and it is not an oversight — one was written and withdrawn
     * on 2026-08-27.** Read this before adding one.
     *
     * Stage 4 cannot currently tell that stage 3 has run again: `stepIsDone`
     * asks only whether its three artefacts exist. The obvious fix is a stamp
     * hashing stage 3's blocks, and it works — `59e8e3a` had it, with tests.
     *
     * It was reverted because **`hierarchy` re-running silently drops artefacts that
     * are still marked current.** `arc` is joined to the tree by exact
     * block-**range** pair (`buildArcColumn` in src/web/tree.ts), and an entry
     * whose range matches no node is dropped from the reading view without a
     * word. A rebuilt tree may legitimately choose different boundaries, and
     * `arc` never gets the chance to notice: `cascadeForce` (src/jobs.ts) only
     * names steps **already in the job**, so a job of `steps: ["hierarchy"]` does
     * not run `arc` at all — and a stamp that is never consulted is no defence.
     * (This paragraph said *"`arc` has no stamp at all"* when it was written on
     * 2026-08-27, in `414f3f96`. `arc` gained one two days later, in the
     * `StepDefinition` below; the hazard survived the fix, for the reason just
     * given, so the decision here is unchanged and only its reason is.)
     *
     * The tree's own comment in src/web/tree.ts has said as much all along:
     * *"ids are positional and a re-run of `npm run hierarchy` renumbers them"*.
     *
     * **So a stamp here needs consumer invalidation first**, which does not
     * exist: `cascadeForce` is computed once from explicit force flags when the
     * job is created (src/jobs.ts), and cannot hear a step deciding at run time
     * that it is stale. Landing that is part of the transactional runner, not
     * of a stamp.
     *
     * **The Postgres artefact store needs no special case for this**, and an
     * earlier version of this comment said it did. `has` means readable outputs
     * plus a `done` run row, uniformly, in both stores; with no stamp,
     * `stepIsDone` returns true once `has` does, in both stores. Teaching
     * storage a private freshness rule for `hierarchy` would put the pipeline's logic
     * in the storage layer *and* walk straight back into the hazard above, by a
     * different door. GPT Sol, 2026-08-28;
     * docs/plans/260828b-artifacts-pg-has-sol.md.
     *
     * **What the runner must still do is record the hash.** Having no expected
     * stamp and recording no input are different things: `finishStepRun` has to
     * be given `hashBlocks(blocks)` for this step, because
     * `reasonsNotToPublish` compares `hierarchy.input_hash` against the stored blocks
     * and refuses the publication when they differ — so a `hierarchy` left carrying
     * `NO_INPUT_HASH` would make every article unpublishable.
     */
    async run(ctx, store, checkpoints) {
      /* **Stage 3's copy, through the store**, which is the same artefact
         `blocksPathFor` used to open by path — `output/<slug>.blocks.json`, not
         the copy this step is about to write into `data/`. Reading the other
         one would build the tree from the blocks the *last* run of this step
         produced. */
      const file = await store.read(ctx.slug, "blocks", "blocks");
      if (!file?.blocks) {
        throw stageFailure("ours", {
          generic: `No blocks for "${ctx.slug}" — run the blocks step first.`,
        });
      }
      const run = await generateHierarchy({
        blocks: file.blocks,
        slug: ctx.slug,
        /* Where the **label batches** are kept as they land, one row each, so a
           run that dies eight batches into a book costs one batch rather than
           eight. It was `ctx.dir` until 2026-09-01, which on Vercel is a
           job-scoped `/tmp` the retry never sees. */
        checkpoints,
        onProgress: ctx.report,
        signal: ctx.signal,
        /* Only the deepening wave reads it, and only to decide whether to start
           another scoped call — see `StepContext.deadlineAt`. With the flag off
           it changes nothing at all. */
        ...(ctx.deadlineAt !== undefined ? { deadlineAt: ctx.deadlineAt } : {}),
      });
      /* `run.elapsedMs`, not a timer around this closure. The stage times the
         model call itself, which is the number that answers "what does a tree
         cost"; a timer out here would fold in reading blocks.json and writing
         two files, and quietly drift as that IO changed. Same for the other two
         model steps. */
      plog.info(
        {
          slug: ctx.slug,
          step: "hierarchy",
          model: run.model,
          /* Three counts, not one, and `strandedSupplement` is the one that
             matters: it is how an operator learns the apparatus was left out of
             the structure on a run that otherwise reports success. */
          supplementNodes: run.supplementNodes,
          supplementBlocks: run.supplementBlocks,
          strandedSupplement: run.strandedSupplement,
          /* What the stage forgave the model, logged at zero as well as above
             it — an operator watching these climb is watching the structure
             prompt drift.

             **`repairedBlocks` and `largestRepair` are new since the tiling
             repair stopped being bounded at one block** (src/hierarchy.ts §
             `planChildRanges`). The count alone used to say everything,
             because every repair was the same size; it now covers both a
             boundary a paragraph out and a section handed forty blocks that
             belonged to its neighbour. The largest is the one that says "go and
             look", and it is not recoverable from the sum. */
          repairedRanges: run.repairedRanges,
          repairedBlocks: run.repairedBlocks,
          largestRepair: run.largestRepair,
          /* **Sections the answer proposed that were not stored.** The only one
             of these that means something was lost rather than moved, and since
             2026-08-31 the only remaining way a tiling fault costs the reader
             anything at all — nothing about the tiling refuses an answer now.
             src/hierarchy.ts § `BuildReport.droppedChildren`. */
          droppedChildren: run.droppedChildren,
          droppedHeadings: run.droppedHeadings,
          /* **Socratic questions written but not kept.** Nothing on screen
             distinguishes a question the model chose not to write from one
             this stage threw away, so this is the only place a prompt that
             had drifted into writing unusable ones would show up.
             src/hierarchy.ts § `questionFor`. */
          droppedQuestions: run.droppedQuestions,
          /* **Rungs that restated their parent**, spliced away rather than
             stored — two gist columns of identical extent is a duplicated cell
             the reader sees, not a wasted column. Nothing about it moves a
             block, so it is its own figure rather than a repair.
             src/hierarchy.ts § `collapseRestatedRungs`. */
          collapsedRungs: run.collapsedRungs,
          /* The third thing this stage forgives, and the only one with no trace
             in the product: a paragraph the model would not label twice running
             is a leaf with no row, which renders as nothing rather than as an
             error. Logged at zero like the two above, so that an article
             quietly losing ten labels is a line somebody can see rather than an
             absence nobody can. src/labels.ts § `droppedBudget`,
             docs/reusable/silent-success.md. */
          labelsDropped: run.labelsDropped,
          /* **What the checkpoints actually bought this run**, at zero as well
             as above it. `generateLabels` logs `{ asked, found }` at its read,
             which is what the store returned; these two are what the stage
             *accepted*, and the gap between them is a batch that was stored and
             then rejected as not covering the blocks it was asked about — a
             failure with no other symptom. Neither number was logged at all
             until 2026-09-04:
             docs/postmortems/260904a-a-retry-minted-a-fresh-name-so-the-checkpoints-could-never-be-found.md,
             recommendation 2. */
          labelBatches: run.labelBatches,
          labelsResumed: run.labelsResumed,
          /* What the label pass actually paid for, beside what it resumed. */
          labelCalls: run.labelCalls,
          /* **Was the tree bought or replayed?** Until 2026-09-05 this was
             printed only by `src/hierarchy.ts`'s own `main()`, and stage E of
             docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md
             deleted that CLI — so taking the deletion whole would have dropped
             the one signal that says which. It belongs here anyway: it is the
             field that says why a forced re-run was cheap, and without it the
             only way to tell is to infer it from a token count, which is what
             evals/deepen/ was reduced to doing. */
          structureResumed: run.structureResumed,
          /* **What the deepening wave did**, and `null` where nobody asked for
             one — which is every article until stage 8 moves the flag
             (src/hierarchy-deepen.ts § `DEEPEN_ENV`). Nested rather than eight
             flat fields, because it is one feature's story and it is read as
             one: how many sections were eligible, how many came back, what the
             verdicts said, and what the wave could not do — a section too large
             to ask about, a call the deadline would not admit, a 429. Every one
             of those leaves a correct article and a shallower tree, which is
             precisely the shape that needs a number rather than a symptom.
             docs/reusable/silent-success.md. */
          deepen: run.deepen,
          deepenFailed: run.deepenFailed,
          inputTokens: run.inputTokens,
          outputTokens: run.outputTokens,
          cacheReadTokens: run.cacheReadTokens,
          cacheWriteTokens: run.cacheWriteTokens,
          ms: run.elapsedMs,
          blocks: run.blocks,
          sections: run.internal,
        },
        `hierarchy ${ctx.slug}: ${run.internal} sections over ${run.blocks} blocks`,
      );
      /* The drop is said on the progress card too, and only when there is one.
         The log line above is where an operator would look afterwards; this is
         the one moment somebody is already watching, and a paragraph with no
         nav label leaves no other mark on the article. */
      /*
       * **All three artefacts in one `parts`, and only `inputHash` in the stamp.**
       *
       * One map, so the store writes the tree, the labels and stage 4's copy of
       * the blocks together. That is what replaces the write order this stage
       * used to keep by hand — labels, blocks, tree last — which was never the
       * crash-safety property its comments claimed. It held because `stepIsDone`
       * reads *file exists* as *step done* and `writeFile` truncates before it
       * writes. Under one map both halves of that reasoning are gone, and
       * `src/hierarchy.ts` now says so where it used to say the other thing.
       *
       * **`inputHash` and nothing else.** `STAMP_SOURCE.hierarchy` is `"labels"`, so
       * whatever is passed here is compared by `assertStampAgrees` against the
       * labels file's own stamp. `run.inputHash` *is* `labels.sourceHash`, so it
       * cannot clash; a `promptVersion` beside it would, because the labels file
       * is `labels/1` and the tree is `toc/2`, and that throw fails every
       * ingest. Verified against a real artefact rather than reasoned about.
       *
       * The hash comes back from the stage rather than being `hashBlocks(...)`
       * here, because a second computation of "the blocks hash" is exactly how
       * the two sides of that comparison come to disagree.
       *
       * **There is nothing to clean up, and that is the change of 2026-09-01.**
       * `run.clearCheckpoint` used to be here as a deliberate omission — it threw
       * the whole `labels-progress.json` away, and calling it before the
       * artefacts were stored would have discarded a paid label pass. One row
       * per batch removes the hazard rather than guarding it: there is no
       * whole-file manifest to delete, no `runId` deciding whose it is, and no
       * delete on success at all. Retention is the sweep's
       * (`scripts/checkpoints-sweep.ts`, `sweepPgCheckpoints`), which is where a
       * cache's lifetime belongs. src/store/checkpoints.ts § Retention.
       */
      /**
       * **The deepening clause is reader-scale, and the operator's numbers are
       * deliberately not here.**
       *
       * `detail` is persisted with the step and rendered on the reader's
       * progress card (`src/web/AddArticle.tsx`), so it takes the same shape as
       * the `labelsDropped` clause above: a sentence for the one moment somebody
       * is already watching. `withheld` and `uncheckpointed` are operator
       * telemetry about checkpoint rows — "0 saved for retry, 0 not saved" is
       * noise on a card — and they are in the log line above, which is where
       * `src/jobs.ts` says a step's real numbers belong.
       *
       * **Silent when the flag is off**, because a clause about a feature nobody
       * asked for reads, at zero, as "tried and found nothing" — the distinction
       * `deepen: null` exists to keep. Silent at `targets === 0` for the same
       * reason. A failure is *not* silent: the step succeeds and the reader gets
       * a shallower tree than the article was going to get, and that should not
       * be something only a log knows. ⟨Fable and GPT Sol, 2026-09-05, arbitrating
       * where the counters went when the CLI that printed them was deleted.⟩
       */
      const deepened =
        run.deepenFailed
          ? ", deepening failed (tree kept)"
          : run.deepen && run.deepen.targets > 0
            ? `, ${run.deepen.expanded} of ${run.deepen.targets} sections deepened`
            : "";
      return {
        parts: run.parts,
        stamp: { inputHash: run.inputHash },
        detail:
          `${run.internal} sections over ${run.blocks} blocks` +
          (run.labelsDropped > 0
            ? ` (${run.labelsDropped} paragraph${run.labelsDropped === 1 ? "" : "s"} unlabelled)`
            : "") +
          deepened,
      };
    },
  },

  /* Stage 4.5 — the article's own images, fetched and kept beside it.
     src/collect-assets.ts does the work; src/assets.ts is its pure half.

     **The only step with no model call and a network cost**, which is why it is
     in DEFAULT_INGEST_STEPS while the four after `arc` are not: nobody has to
     ask for it, because leaving it undone means every reader's browser
     announces itself to the publisher's CDN once per image, per read.

     It reads stage 4's `blocks.json` rather than the extracted HTML, so it
     fetches exactly the URLs the reader will ask for — and so its freshness is
     a hash of those URLs and of the PDF figure markers beside them. */
  assets: {
    name: "assets",
    label: "Fetching the images",
    produces: ["assets"],
    /* Two values, not three: what this step's inputs hash to, and this step's
       own version. **No model**, so no `generator` on the artefact and no
       `model` here — `sameStamp` compares only the fields the expected stamp
       declares, so naming one nothing writes would make every manifest look
       stale for ever. `ASSETS_VERSION` is the string the artefact carries; it
       is imported rather than spelled again here, because two copies of one
       version string that drift show up as an artefact that never regenerates.

       **Not `inputHashFor`, since 2026-09-06**, and that was a live instance of
       the family the comment on `articleInputHash` above records: `inputHashFor`
       is `hashBlocks`, which canonicalises `id`, `text`, `role` and `treatment`
       and **not** `block.html` (src/source-hash.ts). Adding a PDF figure marker
       to a captioned figure changes the html and nothing else, so a
       carried-forward empty manifest would have gone on reporting itself
       current and this step would never have run against a PDF's figures.
       `assetsInputHash` hashes what the step actually consumes — the image URLs
       in the blocks and the figure refs in the blocks — which is the rule
       `articleFingerprint` states and the three stages named above broke.
       GPT Sol, D1-4. */
    stamp: async (ctx, store) => {
      const file = await store.read(ctx.slug, "hierarchy", "blocks");
      /* `null` is *"we cannot tell"* and answers not-current, exactly as
         `inputHashFor` does — and must not be confused with a hash that fails to
         match. Both answer not-current; only one is a stale artefact. */
      if (!file?.blocks) return null;
      return { inputHash: assetsInputHash(file.blocks), promptVersion: ASSETS_VERSION };
    },
    async run(ctx, store) {
      const file = await store.read(ctx.slug, "hierarchy", "blocks");
      if (!file?.blocks) {
        /* `ours` rather than a fetch failure: nothing was refused, we simply
           cannot find the blocks this step is defined against. */
        throw stageFailure("ours", {
          generic: `No blocks for "${ctx.slug}" — run the hierarchy step first.`,
        });
      }
      const run = await collectAssets({
        blocks: file.blocks,
        signal: ctx.signal,
        onProgress: (done, total) => ctx.report(`${done}/${total} images`),
      });
      const figures = await recoverPdfFigures(ctx, store, file.blocks);
      /* No URLs and no hostnames. A log of the images in somebody's article is
         a reading history one step removed, and the counts are what an operator
         wants: `deduped` going from sometimes to never is how you find out the
         canonical keys have stopped being content hashes, and `failed` rising
         is how you find out a publisher has started refusing us. */
      plog.info(
        {
          slug: ctx.slug,
          step: "assets",
          images: run.assets.entries.length,
          stored: run.stored,
          failed: run.failed,
          deduped: run.deduped,
          kb: Math.round(run.bytes / 1024),
          ms: run.elapsedMs,
          /* What actually failed, from `collectAssets`, and only when there
             are any. Redacted and bounded there — no URLs, no tokens — and it
             carries the status, which is what says whether this is about the
             publisher or about us: a `CorruptObject` means something is at a
             canonical name that does not hash to it (src/store/blobs.ts), and
             a `Storage put failed (415)` on every image at once means our own
             bucket's allowlist has drifted. The *name* alone said "Error" to
             both. At most five distinct ones, then `"+N more"`, because the
             message no longer collapses the way a name did.
             src/collect-assets.ts § `describeStorageFailure`. */
          ...(run.storageErrors.length ? { storageErrors: run.storageErrors } : {}),
          /* Only for a PDF, and only counts — a log of which figures of which
             paper a reader has is a reading history one step removed, exactly
             as the image counts above are deliberately not URLs. */
          ...(figures
            ? {
                figures: figures.entries.length,
                figuresStored: figures.stored,
                figuresMs: figures.elapsedMs,
                ...(figures.storageErrors.length
                  ? { figureStorageErrors: figures.storageErrors }
                  : {}),
              }
            : {}),
        },
        `assets ${ctx.slug}: ${run.stored} stored, ${run.failed} failed`,
      );
      const failed = run.failed ? `, ${run.failed} left hot-linked` : "";
      /* **Spread onto the manifest rather than written by `collectAssets`**, so
         that the two halves of this step stay two functions: one is a network
         and a byte budget for URLs, the other is a PDF and a bucket, and
         neither needs to know the other ran. `pdfFigures` is *absent* rather
         than empty when there is nothing — for a web article, for a PDF whose
         transcription found no figures, and for an article ingested before this
         existed — because all three mean the same thing to the reading view and
         only the presence of a marker makes the field worth reading at all.
         src/assets.ts § `Assets`. */
      const assets: Assets = {
        ...run.assets,
        ...(figures && figures.entries.length ? { pdfFigures: figures.entries } : {}),
      };
      const drawn = figures?.stored ? `, ${figures.stored} figures recovered` : "";
      return {
        parts: { assets },
        detail: `${run.stored} images stored${failed}${drawn}`,
      };
    },
  },

  /* Stage 5b. */
  arc: {
    name: "arc",
    label: "Writing the arc",
    produces: ["arc"],
    /**
     * **Added 2026-08-29, and it fixes a live bug rather than only enabling the
     * deferral it was written for.**
     *
     * `FORCE_ONLY_WHEN_NAMED` above says of this step: *"it cannot tell whether
     * it is current, so its position is the only signal there is. Give it a
     * freshness check of its own and it belongs here too."* Position was never
     * quite enough — `cascadeForce` (src/jobs.ts) only names steps **already in
     * the job**, so a forced `steps: ["hierarchy"]` has never reached `arc`. The tree
     * is re-cut, `arc.json` still exists, `stepIsDone` sees a file and skips, and
     * the reading view then drops every arc entry whose range no longer matches a
     * node — with no error and no gap, because `TableView` falls back to the root
     * gist. So anyone who has refreshed just the table of contents already has a
     * truncated arc and no way of knowing.
     *
     * **Four inputs, like `ideas`, and for the same reason plus one.** Blocks and
     * tree because section boundaries move without a block changing, and this
     * stage writes one sentence per *part*; `structureHash` also covers titles and
     * gists, which matters because `renderParts` builds the prompt from them.
     * **And the metadata**, which is this step's own addition: `generateArc` hands
     * `meta.json` to `articleText`, which puts `TITLE:`, `BY:` and
     * `PUBLISHED IN:` at the head of the prompt — and those three are stage 2's
     * own reading of the page, so a re-extraction moves them. (An earlier note
     * here cited the reading view's rename instead; that is a shelf override no
     * generator reads. GPT Sol, 2026-08-31.)
     *
     * `null` is "we cannot tell", which the runner must not confuse with a hash
     * that fails to match: both answer not-current, but only one is a stale
     * artefact. Absent metadata is **not** one of those cases — `generateArc`
     * tolerates a missing `meta.json` on purpose, so "no meta" is a legitimate
     * input and `inputFingerprint` hashes it as one.
     */
    stamp: async (ctx, store) => {
      const article = await tryReadArticle(ctx.slug, store);
      if (!article) return null;
      return {
        inputHash: arcFingerprint(article.blocks, article.tree, article.meta),
        promptVersion: ARC_PROMPT_VERSION,
        model: CAPABLE_MODEL,
      };
    },
    async run(ctx, store) {
      const run = await generateArc({
        article: await readArticle(ctx.slug, store),
        onProgress: ctx.report,
        signal: ctx.signal,
        cacheArticle: ctx.cacheArticle,
      });
      plog.info(
        {
          slug: ctx.slug,
          step: "arc",
          model: run.model,
          inputTokens: run.inputTokens,
          outputTokens: run.outputTokens,
          cacheReadTokens: run.cacheReadTokens,
          cacheWriteTokens: run.cacheWriteTokens,
          ms: run.elapsedMs,
          blocks: run.blocks,
          parts: run.parts.length,
        },
        `arc ${ctx.slug}: ${run.arc.entries.length} sentences over ${run.parts.length} parts`,
      );
      return {
        parts: { arc: run.arc },
        detail: `${run.arc.entries.length} sentences, one per part`,
      };
    },
  },

  /* Stage 5c — the thread. In this list but not in DEFAULT_INGEST_STEPS: it
     runs when somebody asks for a thread, not on every ingest.

     It knows whether its artefact is *current* rather than merely present: the
     stamp compares the stored `sourceHash` against the blocks the store holds,
     and the prompt version and model id with it. Which is why `tweets` is also
     in FORCE_ONLY_WHEN_NAMED: it does not need the positional force-cascade to
     notice that the article moved, and being swept into one would only cost a
     model call for nothing. Read those two notes together; neither is safe on
     its own. */
  tweets: {
    name: "tweets",
    label: "Writing the thread",
    produces: ["tweets"],
    /* Was `threadIsCurrent(ctx.dir)`, which did these same three comparisons by
       hand and read the article's directory rather than the store — deleted in
       D0 (docs/plans/260827aa-delete-the-importer.md). The comparison belongs in one
       place (`sameStamp`); only the three values belong to the stage. */
    stamp: async (ctx, store) => {
      /* `articleInputHash`, not a blocks-only hash: this prompt reads the tree
         and the metadata as well as the blocks. See that function. */
      const inputHash = await articleInputHash(ctx, store);
      if (!inputHash) return null;
      return { inputHash, promptVersion: TWEETS_PROMPT_VERSION, model: CAPABLE_MODEL };
    },
    async run(ctx, store) {
      const run = await generateTweets({
        article: await readArticle(ctx.slug, store),
        profile: ctx.profile ?? null,
        onProgress: ctx.report,
        signal: ctx.signal,
        cacheArticle: ctx.cacheArticle,
      });
      const over = run.over > 0 ? `, ${run.over} over ${run.thread.limit}` : "";
      /* `run.thread.generator` is this stage's model id — it is already stored
         on the thread, because the stamp compares it to decide whether a thread
         needs rewriting. So unlike hierarchy and arc, nothing had to be added to
         src/tweets.ts to log it. */
      plog.info(
        {
          slug: ctx.slug,
          step: "tweets",
          model: run.thread.generator,
          inputTokens: run.inputTokens,
          outputTokens: run.outputTokens,
          cacheReadTokens: run.cacheReadTokens,
          cacheWriteTokens: run.cacheWriteTokens,
          ms: run.elapsedMs,
          posts: run.thread.tweets.length,
          over: run.over,
        },
        `tweets ${ctx.slug}: ${run.thread.tweets.length} posts${over}`,
      );
      return {
        parts: { tweets: run.thread },
        detail: `${run.thread.tweets.length} posts${over}`,
      };
    },
  },

  /* Stage 5d — the glossary. In this list but not in DEFAULT_INGEST_STEPS, for
     the same reason `tweets` is not: it costs a model call and it is a thing
     somebody asks for.

     The second step with a real `isDone`, and the first whose `run` is not
     idempotent in the ordinary sense: running it again on a *current* glossary
     adds terms rather than rewriting the ones there. That is deliberate and it
     is what "Find more terms" is (docs/project/glossary.md § Finding more), but
     it is also exactly why this step must never be forced by position — see
     FORCE_ONLY_WHEN_NAMED above. Read those two notes together. */
  glossary: {
    name: "glossary",
    label: "Finding the terms",
    produces: ["glossary"],
    /* The first step through the new seam, and the shape the other two follow.
       Three values — the blocks it would be written from, the prompt that would
       write it, the model that would run — where `glossaryIsCurrent` was a
       function doing the same three comparisons by hand. That function was
       deleted on 2026-08-28. This comment used to say it survived "because its
       CLI uses it"; glossary's `main()` never called it, and only its own tests
       did, so the sentence was keeping dead code alive. docs/plans/260828aj-simplification-wave-2.md § 0.5.

       `stamp` rather than `isDone` because the *comparison* belongs in one
       place (`sameStamp`) and only the four values belong to the stage. It is
       glossary that goes first purely because glossary is the one of the three
       that already exports its `PROMPT_VERSION` — see the note on `isDone`. */
    stamp: async (ctx, store) => {
      /* `articleInputHash`, not a blocks-only hash: the skeleton comes from the
         tree and the head from the metadata. See that function. */
      const inputHash = await articleInputHash(ctx, store);
      if (!inputHash) return null;
      return { inputHash, promptVersion: GLOSSARY_PROMPT_VERSION, model: CAPABLE_MODEL };
    },
    async run(ctx, store) {
      /*
       * **The store, not a path, and read before the stage runs.**
       *
       * The glossary's own file does two jobs at once, and landing D takes both
       * away in one move: `existingFor` decides whether this run *appends* to
       * the list — which is what the "Find more terms" button is — and
       * `idsByTerm` lends the list's ids to a rewrite. After D the file read
       * fails on every run and looks like a first pass, so "find more terms"
       * quietly becomes "replace the glossary", `passes` resets to 1, every
       * `?term=` link goes dead and every stored lookup is orphaned. Nothing
       * throws. docs/plans/260827aa-delete-the-importer.md § Three stages carry identity
       * in a file.
       *
       * `previousGlossaryFrom` asks the store instead, and refuses rather than
       * minting when there is a previous glossary it cannot read. A previous
       * glossary whose `sourceHash` no longer matches is *not* that case — the
       * article moved, and starting again is correct — which is the one
       * distinction this stage has that stage 3 does not.
       */
      const previous = await previousGlossaryFrom(store, ctx.slug);
      const run = await generateGlossary({
        article: await readArticle(ctx.slug, store),
        previous,
        profile: ctx.profile ?? null,
        onProgress: ctx.report,
        signal: ctx.signal,
        cacheArticle: ctx.cacheArticle,
      });
      const total = run.glossary.entries.length;
      plog.info(
        {
          slug: ctx.slug,
          step: "glossary",
          model: run.model,
          inputTokens: run.inputTokens,
          outputTokens: run.outputTokens,
          cacheReadTokens: run.cacheReadTokens,
          cacheWriteTokens: run.cacheWriteTokens,
          ms: run.elapsedMs,
          terms: total,
          added: run.added,
          pass: run.glossary.passes,
          /* The one number in this line that is a quality signal rather than a
             cost. An entry matching no block is the prompt's alias instruction
             not landing — the model named a term the article does not use in
             those words. It is not an error and must not fail the step, but it
             is the thing to watch when a glossary starts feeling wrong, and it
             is invisible unless it is written down. */
          unmatched: run.unmatched,
          /* **The scores the prompt requires and did not get** — src/glossary.ts
             § `GlossaryScoreDrops`. `*Absent` is the model ignoring an instruction
             that says both are mandatory; `*Rejected` is it answering `"high"`
             where a number belongs. Either one silently costs the panel its
             prioritised order, and this line is the only place it shows.
             Counts, never a term. docs/project/logging.md. */
          difficultyAbsent: run.scores.difficultyAbsent,
          difficultyRejected: run.scores.difficultyRejected,
          centralityAbsent: run.scores.centralityAbsent,
          centralityRejected: run.scores.centralityRejected,
        },
        `glossary ${ctx.slug}: ${total} terms (${run.added} new, pass ${run.glossary.passes})`,
      );
      const added = run.glossary.passes > 1 ? `, ${run.added} new` : "";
      return {
        parts: { glossary: run.glossary },
        detail: `${total} ${total === 1 ? "term" : "terms"}${added}`,
      };
    },
  },
  /**
   * **Stage 5h — the quotes**: the lines worth keeping, in the author's own
   * words. docs/project/quotes.md, docs/plans/260831j-quotes-mode.md.
   *
   * In `STEP_ORDER` but not in `DEFAULT_INGEST_STEPS`, for the reason `tweets`
   * established and `glossary`, `ideas` and `sketch` have followed:
   * everything up to `arc` makes the article readable, and everything after it
   * is a thing somebody asks for.
   *
   * A **converted** step, like `sketch` and unlike its eight other neighbours:
   * `generateQuotes` writes nothing and this returns the artefact as `parts`.
   * A step that wrote `<dir>/quotes.json` inside `run` works on a laptop and
   * cannot work through a store that puts the artefact in a Postgres column.
   */
  quotes: {
    name: "quotes",
    label: "Choosing the quotes",
    produces: ["quotes"],
    /**
     * Three values, not four — **the profile is deliberately not in here**, and
     * this is the one place `quotes` parts company with `ideas`.
     *
     * For `ideas` the profile is in the stamp because it decides what "assumed"
     * *means*: what a reader has to bring is defined by who they are, so an
     * artefact written for a different profile answers a different question.
     * A profile changes which *lines* are worth keeping here too — but it
     * cannot change what the author wrote, so an older list is a differently
     * chosen selection of the same real sentences rather than an answer to a
     * question nobody asked. That is the glossary's position, and the read path
     * still raises the banner and lets the reader decide.
     */
    stamp: async (ctx, store) => {
      /* `null` is "we cannot tell", which is not the same answer as a hash that
         fails to match. Both mean not-current; only one means stale. The
         metadata is not one of those cases — `generateQuotes` tolerates a
         missing `meta.json` and hashes "no meta" as a legitimate input, which
         is why `tryReadArticle` answers `null` for the other two and not for
         this one. */
      const article = await tryReadArticle(ctx.slug, store);
      if (!article) return null;
      return {
        inputHash: quotesFingerprint(article.blocks, article.tree, article.meta),
        promptVersion: QUOTES_PROMPT_VERSION,
        model: CAPABLE_MODEL,
      };
    },
    async run(ctx, store) {
      /* **The store, not a path.** The only thing the previous artefact is read
         for is its ids, and only when `sourceHash` matches — so after landing D
         this stage would keep working in every visible way while every
         `?quote=` link a reader holds went dead. `previousQuotesFrom` refuses
         when there is a previous artefact it cannot read, and returns `null`
         quietly when there is none. */
      const previous = await previousQuotesFrom(store, ctx.slug);
      const run = await generateQuotes({
        article: await readArticle(ctx.slug, store),
        previous,
        profile: ctx.profile ?? null,
        onProgress: ctx.report,
        signal: ctx.signal,
        cacheArticle: ctx.cacheArticle,
      });
      const total = run.quotes.quotes.length;
      plog.info(
        {
          slug: ctx.slug,
          step: "quotes",
          model: run.model,
          inputTokens: run.inputTokens,
          outputTokens: run.outputTokens,
          cacheReadTokens: run.cacheReadTokens,
          cacheWriteTokens: run.cacheWriteTokens,
          ms: run.elapsedMs,
          quotes: total,
          /* **`unfound` is the number this stage exists to watch.** It counts
             lines the model offered that are nowhere in the article — the model
             paraphrasing rather than copying, which is the one failure this
             feature may not have, and which is completely invisible from
             outside: a dropped quote looks exactly like a line the model chose
             not to offer. A run that starts returning several is the prompt
             having drifted. docs/reusable/silent-success.md. */
          unfound: run.dropped.unfound,
          wrongLength: run.dropped.wrongLength,
          overlapping: run.dropped.overlapping,
          overCap: run.dropped.overCap,
          malformed: run.dropped.malformed,
          /* **Fields, not quotes** — src/quotes.ts § `QuoteScoreDrops`. Nothing here
             cost anyone a quote; each is a number the model did not give us, or
             gave us wrong. An omission is permitted by this stage's prompt and a
             rejection is not, so they are separate keys. Counts, never a quote.
             docs/project/logging.md. */
          importanceAbsent: run.scores.importanceAbsent,
          importanceRejected: run.scores.importanceRejected,
          strikingAbsent: run.scores.strikingAbsent,
          strikingRejected: run.scores.strikingRejected,
          /* The profile's LENGTH, never the profile — it is the reader's own
             words about themselves. docs/project/logging.md. */
          profileChars: ctx.profile?.length ?? 0,
        },
        `quotes ${ctx.slug}: ${total} quotes (${run.dropped.unfound} not found)`,
      );
      return {
        parts: { quotes: run.quotes },
        detail: `${total} ${total === 1 ? "quote" : "quotes"}`,
      };
    },
  },
  /* Stage 5f — the ideas. In STEP_ORDER but not in DEFAULT_INGEST_STEPS, for
     the reason `tweets` and `glossary` established: everything up to
     `arc` makes the article readable, everything after it is a thing somebody
     asks for.

     **The first step whose stamp has four values rather than three**, and both
     additions close holes the others still have — see the notes below. */
  ideas: {
    name: "ideas",
    label: "Finding the ideas",
    produces: ["ideas"],
    /**
     * Four values, where most stamped steps declare three.
     *
     * **The blocks, the tree AND the metadata** — `articleFingerprint`, which
     * this stage's `inputFingerprint` is. It was the first step to fold the
     * tree in, for a reason that matters more here than anywhere: the prompt
     * shows the model the skeleton *before* the article precisely so that it
     * judges what the argument rests on, so re-cut the sections and that
     * judgment was made against a different question while a blocks-only hash
     * reports no change at all. The metadata joined on 2026-08-31, when all six
     * article-reading stages were completed against one definition.
     *
     * **And the profile.** Every other stage records a `profileHash` and lets
     * the read path put a banner in front of the reader; none of them puts it
     * in the stamp, so nothing regenerates. For a glossary that is a gap you
     * can argue for. Here the profile decides what "assumed" *means* — a
     * physicist reading a physics essay brings everything it assumes — so an
     * artefact written for a different profile is answering a different
     * question, not merely an older one.
     */
    stamp: async (ctx, store) => {
      /* `null` is "we cannot tell", which must not be confused with a hash that
         fails to match. Both answer not-current; only one is a stale artefact.
         The metadata is **not** one of those cases: `generateIdeas` tolerates a
         missing `meta.json` and hashes "no meta" as a legitimate input, which
         is why `tryReadArticle` answers `null` for the other two and not for
         this one. */
      const article = await tryReadArticle(ctx.slug, store);
      if (!article) return null;
      return {
        inputHash: ideasFingerprint(article.blocks, article.tree, article.meta),
        promptVersion: IDEAS_PROMPT_VERSION,
        model: CAPABLE_MODEL,
        profileHash: ctx.profile ? hashProfile(ctx.profile) : null,
      };
    },
    async run(ctx, store) {
      /*
       * **The store, not a path.** The only thing the previous artefact is read
       * for is its ids, and only when `sourceHash` matches — so after landing D
       * this stage would keep working in every visible way while every `?idea=`
       * link a reader holds went dead. `previousIdeasFrom` refuses when there
       * is a previous artefact it cannot read, and returns `null` quietly when
       * there is none.
       */
      const previous = await previousIdeasFrom(store, ctx.slug);
      const run = await generateIdeas({
        article: await readArticle(ctx.slug, store),
        previous,
        profile: ctx.profile ?? null,
        onProgress: ctx.report,
        signal: ctx.signal,
        cacheArticle: ctx.cacheArticle,
      });
      const total = run.ideas.ideas.length;
      const assumed = run.ideas.ideas.filter((i) => i.provenance === "assumed").length;
      plog.info(
        {
          slug: ctx.slug,
          step: "ideas",
          model: run.model,
          inputTokens: run.inputTokens,
          outputTokens: run.outputTokens,
          cacheReadTokens: run.cacheReadTokens,
          cacheWriteTokens: run.cacheWriteTokens,
          ms: run.elapsedMs,
          ideas: total,
          assumed,
          /* **The quality signals, and the reason this stage has more of them
             than its neighbours.** The glossary computes its own occurrences,
             so the model cannot be wrong about a block id; here the model names
             the ids, and every one of these counts is a way it was wrong that
             is completely invisible from outside — a dropped occurrence looks
             exactly like a passage the model chose not to name.

             `unanchored` is the one to watch. It counts ideas thrown away for
             having no verifiable passage at all, which is the failure this
             stage is most likely to have: naming a topic instead of finding a
             load-bearing proposition. A run that starts returning several is
             the prompt having drifted, and nothing else would report it.
             docs/reusable/silent-success.md. */
          unanchored: run.dropped.unanchored,
          /* The second one to watch, and it is about honesty rather than
             coverage: an assumed idea that cannot say which step fails without
             it is a block id lending the look of evidence to an unargued
             claim. A run that starts returning several means the prompt has
             drifted off the thing this mode exists to be careful about. */
          unargued: run.dropped.unargued,
          overCap: run.dropped.overCap,
          unknownIds: run.dropped.unknownIds,
          unquoted: run.dropped.unquoted,
          malformed: run.dropped.malformed,
          truncatedOccurrences: run.dropped.truncated,
          /* The profile's LENGTH, never the profile — it is the reader's own
             words about themselves. docs/project/logging.md. */
          profileChars: ctx.profile?.length ?? 0,
        },
        `ideas ${ctx.slug}: ${total} ideas (${assumed} to bring)`,
      );
      return {
        parts: { ideas: run.ideas },
        detail: `${total} ${total === 1 ? "idea" : "ideas"}, ${assumed} to bring`,
      };
    },
  },
  /* Stage 5i — the timeline. In STEP_ORDER but not in DEFAULT_INGEST_STEPS, for
     the reason `tweets`, `glossary`, `quotes` and `ideas` established:
     everything up to `arc` makes the article readable, everything after it is a
     thing somebody asks for.

     **The first step whose stamp reads the publication date**, and the only one
     — see its `stamp` below. docs/project/timeline.md,
     docs/plans/260831i-timeline-mode.md. */
  timeline: {
    name: "timeline",
    label: "Reading the dates",
    produces: ["timeline"],
    /**
     * **Three values, and the third is one no other step hashes: the
     * publication date.**
     *
     * `timelineFingerprint` is `datedArticleFingerprint` (src/source-hash.ts),
     * not the `articleFingerprint` four of these stages use and not the
     * `articleWithIdsFingerprint` `ideas` and `sketch` use. It is the blocks,
     * the tree and a metadata head that carries `publishedAt`.
     *
     * The date is **load-bearing here rather than defensive**. It is the
     * reference frame the parser reads a year-less "on July 7" against, and
     * nineteen of the twenty-four temporal expressions on the test article are
     * year-less — so a publisher re-dating a post changes almost every row of
     * this artefact, and not one word of any other. That is exactly why it is in
     * the hash of the stage that names it **and no other**: widening the shared
     * `MetaFingerprint` would have marked five paid artefacts stale over bytes
     * no model ever saw, on the first re-extraction, silently.
     *
     * **And no `profileHash`**, unlike `ideas` and `sketch` — a decision rather
     * than an omission. Who is reading changes what an *idea* is; it does not
     * change when something happened, so there is one fewer reason to
     * regenerate. docs/plans/260831i-timeline-mode.md § Freshness.
     */
    stamp: async (ctx, store) => {
      /* `tryReadArticle`, where `run` below takes `readArticle`, and the
         asymmetry is deliberate. This asks *what stamp would this step write if
         it ran right now*, and an unreadable article means we **cannot tell** —
         which `stepIsDone` turns into "not current, so re-run". That is the safe
         way to be wrong; a throw here is a failed job. `null` is not the same
         answer as a hash that fails to match: both mean not-current, only one
         means stale.

         The metadata is deliberately not one of those cases. `generateTimeline`
         tolerates a missing `meta.json` and hashes "no meta" as a legitimate
         input — it is the state most of the shelf is in, because `publishedAt`
         only arrives on re-extraction — which is why `tryReadArticle` answers
         `null` for the blocks and the tree and not for this. */
      const article = await tryReadArticle(ctx.slug, store);
      if (!article) return null;
      return {
        /* **`article.meta`, `null` and all — never a stub.** `generateTimeline`
           builds `{ title: fallbackHeadTitle(tree) }` for the *prompt* when
           there is no metadata, and hashing that instead would write a
           fingerprint this stamp could never reproduce: every article without
           metadata would report stale for ever, on every run, with nothing red.
           Both sides hash the same value because both read it from the same
           place. src/timeline.ts § `generateTimeline`, which has the note about
           why a green suite is not evidence of this being right. */
        inputHash: timelineFingerprint(article.blocks, article.tree, article.meta),
        promptVersion: TIMELINE_PROMPT_VERSION,
        model: CAPABLE_MODEL,
      };
    },
    async run(ctx, store) {
      /*
       * **The store, not a path**, for the reason `ideas` gives — and with more
       * riding on it. The only thing the previous artefact is read for is its
       * ids, and only when `sourceHash` matches, so a read that quietly answered
       * `null` would keep working in every visible way while every `?event=`
       * link a reader holds went dead. Here the ids cannot be re-derived
       * afterwards either: 26 of 27 survived a regeneration by evidence and only
       * 7 of 26 would have survived by label, measured. `previousTimelineFrom`
       * refuses when there is a previous artefact it cannot read, and returns
       * `null` quietly when there is none.
       */
      const previous = await previousTimelineFrom(store, ctx.slug);
      const run = await generateTimeline({
        article: await readArticle(ctx.slug, store),
        previous,
        onProgress: ctx.report,
        signal: ctx.signal,
        cacheArticle: ctx.cacheArticle,
      });
      const total = run.timeline.events.length;
      const dated = run.timeline.events.filter((e) => e.dating.kind === "dated").length;
      plog.info(
        {
          slug: ctx.slug,
          step: "timeline",
          model: run.model,
          inputTokens: run.inputTokens,
          outputTokens: run.outputTokens,
          cacheReadTokens: run.cacheReadTokens,
          cacheWriteTokens: run.cacheWriteTokens,
          ms: run.elapsedMs,
          events: total,
          dated,
          /* **Whether there was a reference frame at all**, as a boolean and
             never the date itself — the date is the publisher's, and this log
             is not where article facts go (docs/project/logging.md). It is the
             single most useful signal here: with no frame every year-less
             expression is refused, so a run of 26 events and 0 dated is correct
             on a frameless article and a broken parser on a framed one, and
             nothing else distinguishes them. */
          framed: run.frame !== null,
          /* The quality signals, in the shape `ideas` established, and every one
             of them is invisible from outside: a dropped event looks exactly
             like a happening the model chose not to name.

             `unanchored` and `datedLabel` are the two to watch. The first is
             this stage naming a theme instead of finding a passage. The second
             is the "never a date of your own" ban relocating from `when` into
             the label as prose — the exact move the glossary's lesson predicts,
             and the one a review already caught here once.

             `noYearFrame` is deliberately not a fault. On a frameless article it
             is every dated expression in the piece, which is the common case and
             not a regression. docs/reusable/silent-success.md. */
          unanchored: run.dropped.unanchored,
          datedLabel: run.dropped.datedLabel,
          unknownIds: run.dropped.unknownIds,
          unquoted: run.dropped.unquoted,
          unparseablePhrase: run.dropped.unparseablePhrase,
          phraseNotInOccurrence: run.dropped.phraseNotInOccurrence,
          noYearFrame: run.dropped.noYearFrame,
          overCap: run.dropped.overCap,
          malformed: run.dropped.malformed,
          /* The only signal that the model has misread the chronology, and it
             changes nothing on screen. A high count on a plainly linear article
             is the stage failing; on this test article, which recounts the same
             three months three times, it may be the stage working. */
          orderConflicts: run.dropped.orderConflicts,
        },
        `timeline ${ctx.slug}: ${total} events (${dated} dated)`,
      );
      return {
        parts: { timeline: run.timeline },
        detail: `${total} ${total === 1 ? "event" : "events"}, ${dated} dated`,
      };
    },
  },
  /* Stage 5j — the quiz. In STEP_ORDER but not in DEFAULT_INGEST_STEPS, for
     the reason `tweets`, `glossary`, `quotes`, `ideas` and `timeline`
     established: everything up to `arc` makes the article readable, everything
     after it is a thing somebody asks for.

     **No `previous`, and therefore no `BASELINE` row in
     src/store/artifacts.ts.** `ideas`, `quotes`, `glossary` and `timeline` all
     read their last artefact to lend its ids forward, because a reader holds
     `?idea=` and `?event=` links that must survive a re-run. A quiz question
     has no consumer that outlives its batch — v1 stores no attempts and there
     is no `?quiz=<id>` — so inheritance here would be machinery serving
     nothing, and `readBaseline` throws for a kind with no row precisely so that
     nobody can half-add it. docs/plans/260831al-review-quiz-sub-mode.md.
     A forced re-run therefore mints a fresh `batchId` and every question id
     with it, which is exactly what the mark route's 409 is about. */
  quiz: {
    name: "quiz",
    label: "Writing the questions",
    produces: ["quiz"],
    /**
     * `articleWithIdsFingerprint`, the one `ideas` and `sketch` use — the
     * blocks, the tree and a metadata head that carries `URL:`.
     *
     * The tree is in it for `ideas`' reason: `renderPrompt` shows the model the
     * skeleton before the article, so re-cutting the sections changes the
     * question being asked while every block stays byte-identical.
     *
     * **And no `profileHash`**, like `timeline` and unlike `ideas` and
     * `sketch`. There is a real argument for one — how hard a question is
     * depends on who is reading — and it was deferred rather than overlooked,
     * with the six touchpoints it would cost written down in the plan. Adding
     * it later needs no migration, because `profileHash` is a field on the JSON
     * artefact. docs/plans/260831al-review-quiz-sub-mode.md § No profile in v1.
     */
    stamp: async (ctx, store) => {
      /* `tryReadArticle`, where `run` below takes `readArticle` — the same
         asymmetry every stamped stage here has, and for the same reason: this
         asks *what stamp would this step write if it ran now*, and an
         unreadable article means we cannot tell, which `stepIsDone` turns into
         "not current, so re-run". A throw here would be a failed job. */
      const article = await tryReadArticle(ctx.slug, store);
      if (!article) return null;
      return {
        /* **`article.meta`, `null` and all — never a stub.** `generateQuiz`
           builds `{ title: fallbackHeadTitle(tree) }` for the PROMPT when there
           is no metadata and hands the fingerprint the real value, so both
           sides hash the same thing. Hashing the stub here instead would make
           every article without metadata report stale for ever, on every run,
           with nothing red — src/quiz.ts § `generateQuiz`.
           tests/stage-stamp-agreement.test.ts is what asks this out loud. */
        inputHash: quizFingerprint(article.blocks, article.tree, article.meta),
        promptVersion: QUIZ_PROMPT_VERSION,
        model: CAPABLE_MODEL,
      };
    },
    async run(ctx, store) {
      const run = await generateQuiz({
        article: await readArticle(ctx.slug, store),
        onProgress: ctx.report,
        signal: ctx.signal,
        cacheArticle: ctx.cacheArticle,
      });
      const questions = run.quiz.questions;
      const bands = { easy: 0, medium: 0, hard: 0 };
      for (const q of questions) bands[q.band]++;
      plog.info(
        {
          slug: ctx.slug,
          step: "quiz",
          model: run.model,
          inputTokens: run.inputTokens,
          outputTokens: run.outputTokens,
          cacheReadTokens: run.cacheReadTokens,
          cacheWriteTokens: run.cacheWriteTokens,
          ms: run.elapsedMs,
          questions: questions.length,
          /* The band spread, because it is the one thing about a batch that is
             invisible from outside and that the ordering depends on entirely.
             A batch of twelve that is all `medium` fails the quota and never
             gets here; a batch of three that is all `medium` passes, correctly,
             and is worth being able to see afterwards. */
          easy: bands.easy,
          medium: bands.medium,
          hard: bands.hard,
          /* The quality signals, in the shape `ideas` and `timeline` established
             and for the same reason: every one of them is invisible from
             outside, because a dropped question looks exactly like a question
             the model chose not to ask. `unanchored` is the one to watch — it
             is this stage asking about a theme instead of a passage.

             **Never a question, a reference answer or a quote.** This is a
             count of what was thrown away, not a record of it.
             docs/project/logging.md. */
          unanchored: run.dropped.unanchored,
          unknownIds: run.dropped.unknownIds,
          unquoted: run.dropped.unquoted,
          truncated: run.dropped.truncated,
          overCap: run.dropped.overCap,
          malformed: run.dropped.malformed,
          duplicate: run.dropped.duplicate,
        },
        `quiz ${ctx.slug}: ${questions.length} questions`,
      );
      return {
        parts: { quiz: run.quiz },
        detail: `${questions.length} ${questions.length === 1 ? "question" : "questions"}`,
      };
    },
  },
  /**
   * **The picture a model draws of the argument** — docs/project/diagram.md
   * § Sketch, docs/plans/260830j-sketch-diagram.md.
   *
   * **The first converted step in this pipeline, and for a while the only one.**
   * It returns `parts` and writes no file of its own. That is not a flourish —
   * a step that writes `<dir>/sketch.json` inside `run` works on a laptop and
   * cannot work through a store that puts the artefact in a Postgres column,
   * and `PipelineStep`'s types make the safe answer the one you get by doing
   * nothing. Every other article-reading stage followed it on 2026-08-31, and
   * the stages that acquire and cut the article rather than read it — `fetch`,
   * `extract`, `blocks` and `hierarchy` — converted the same day, so
   * `LEGACY_UNCONVERTED_STEPS` is now empty
   * (docs/plans/260831b-finish-the-database-move.md § Stage 2).
   */
  sketch: {
    name: "sketch",
    label: "Drawing the argument",
    produces: ["sketch"],
    /**
     * The blocks, the tree, the prompt, the model and the reader — all five.
     *
     * The same shape `ideas` uses two steps up and for the same two reasons.
     * **The tree as well as the blocks**, because the prompt shows the model
     * the outline before the article, so re-cutting the sections changes the
     * question with every block byte-identical. **And the profile**, because it
     * changes what the picture is *for*: a reader who has said they want the
     * evidence and not the history wants a different arrangement of the same
     * article, not a differently-worded one.
     */
    stamp: async (ctx, store) => {
      /* `null` is "we cannot tell", which is not the same answer as a hash that
         fails to match. Both mean not-current; only one means stale. The
         metadata is not one of those cases — `generateSketch` tolerates a
         missing `meta.json`, which is why `tryReadArticle` answers `null` for
         the other two and not for this one. */
      const article = await tryReadArticle(ctx.slug, store);
      if (!article) return null;
      return {
        inputHash: sketchFingerprint(article.blocks, article.tree, article.meta),
        promptVersion: SKETCH_PROMPT_VERSION,
        model: CAPABLE_MODEL,
        profileHash: ctx.profile ? hashProfile(ctx.profile) : null,
      };
    },
    async run(ctx, store) {
      const run = await generateSketch({
        article: await readArticle(ctx.slug, store),
        profile: ctx.profile ?? null,
        onProgress: ctx.report,
        signal: ctx.signal,
        cacheArticle: ctx.cacheArticle,
      });
      const s = run.score;
      plog.info(
        {
          slug: ctx.slug,
          step: "sketch",
          model: run.model,
          inputTokens: run.inputTokens,
          outputTokens: run.outputTokens,
          cacheReadTokens: run.cacheReadTokens,
          cacheWriteTokens: run.cacheWriteTokens,
          ms: run.elapsedMs,
          scenes: s.scenes,
          nodes: s.nodes,
          linked: s.linked,
          /* **The four quality signals, and this stage needs them more than any
             other.** Everything else here produces prose, which a reader can
             judge by reading. This produces geometry, and every way it goes
             wrong is invisible: `flow` under 1 is a picture that stops running
             down the page with the article, `widestGap` is how much of the
             piece nothing points into, `overlap` is boxes drawn on top of each
             other, and `overflowing` is text cut to fit. None of them is an
             error and none may fail the step — `accept` has already refused
             anything that is not a picture at all — but a run where they start
             drifting is a prompt that has stopped working, and that is
             completely invisible from outside. The scene itself is never
             logged: its node text is the article's own argument in the model's
             words. docs/project/logging.md. */
          flow: s.flow,
          widestGap: Number(s.reach.toFixed(3)),
          overlap: Number(s.overlap.toFixed(3)),
          overflowing: s.overflowing,
          faults: run.report.faults.length,
          written: run.report.written,
          profileChars: ctx.profile?.length ?? 0,
        },
        `sketch ${ctx.slug}: ${s.nodes} nodes over ${s.scenes} scenes, flow ${s.flow?.toFixed(2) ?? "n/a"}`,
      );
      return {
        parts: { sketch: run.sketch },
        detail: `${run.sketch.title} — ${s.nodes} nodes, ${s.scenes} scenes`,
      };
    },
  },
  /**
   * **The same argument painted** — docs/project/diagram.md § Illustrated,
   * docs/plans/260903c-illustrated-diagram-sub-mode.md.
   *
   * **The only step here whose input is another step's artefact**, which brings
   * two obligations nothing else in this table has.
   *
   * ## 1. It refuses to run without a current Sketch, and does not fetch one
   *
   * `useStepJob` posts `steps: [step]` and pipeline order does **not** pull
   * prerequisites in, so an Illustrated run on an article whose Sketch is
   * absent, stale, or drawn for a different profile would either crash or —
   * worse — quietly paint an argument the reader is not looking at.
   *
   * So `run` refuses, through `refuseToIllustrate` above — one of three
   * sentences naming the Sketch chip, all `blocked`. A retry skips the steps
   * that finished and would find the identical missing Sketch, so offering the
   * button would be a lie; `blocked` rather than the `ours` it carried until
   * 2026-09-03 because nothing here is misconfigured and the reader's way out
   * is a press away. See § the steps that know why they stopped in
   * src/messages.ts.
   *
   * **The client may name both steps, and since 2026-09-03 it does.** This
   * paragraph used to say *"not `enqueue(["sketch", "illustrated"])`, which is
   * the tempting version and is worse — it turns one press into a hidden $0.20
   * charge and a three-minute wait that nothing warned about"*. Greg asked for
   * the one press anyway, and the objection was to the **hiding** rather than to
   * the chain: `IllustratedView`'s refusal branches now offer it with both
   * prices and both waits on the button before it is pressed
   * (docs/project/diagram.md § Illustrated).
   *
   * **Nothing changes on this side of the seam.** The step still refuses rather
   * than pulling its own prerequisite in; what makes the chain safe is that
   * `STEP_ORDER` sequences one job and `stepIsDone` decides whether the Sketch
   * half runs at all — so a stale Sketch is re-drawn and a current one is
   * adopted, without this step knowing who asked.
   *
   * ## 2. Its fingerprint is the Sketch, not the article
   *
   * src/illustrated.ts § `inputFingerprint` has the reasoning. The consequence
   * for this table is that `stamp` reads the *sketch* rather than the article:
   * a forced Sketch redraw changes the scene with every article byte identical,
   * and an article-shaped stamp would leave a stale illustration reporting
   * itself current.
   *
   * **And `profileHash` is inherited from the Sketch**, not taken from
   * `ctx.profile`. A picture drawn for a reader's profile must not quietly
   * become an impersonal one because they cleared their box between the two
   * presses — and the comparison has to be against what the illustration will
   * *be* stamped with, which is what `generateIllustrated` is handed.
   */
  illustrated: {
    name: "illustrated",
    label: "Painting the argument",
    produces: ["illustrated"],
    /**
     * The Sketch, this stage's prompt, and the model that writes the brief.
     *
     * **No blocks, no tree, no metadata**, unlike every other stamp here, and
     * that is the whole point rather than an omission: what this was drawn from
     * is the scene. The article reaches the comparison one hop away — change it
     * and the Sketch goes stale, redraw the Sketch and this hash moves.
     *
     * `null` when there is no usable Sketch, which is "we cannot tell" and
     * therefore not-current — the same answer `tryReadArticle` gives its
     * neighbours, and it makes the step run, which is where the refusal is.
     */
    stamp: async (ctx, store) => {
      const sketch = await store.read(ctx.slug, "sketch", "sketch");
      if (!usableSketch(sketch)) return null;
      return {
        inputHash: illustratedFingerprint(sketch),
        promptVersion: ILLUSTRATED_PROMPT_VERSION,
        model: CAPABLE_MODEL,
        /* **The Sketch's, never `ctx.profile`.** The stamp has to predict what
           the artefact will carry, and `run` below hands `generateIllustrated`
           the Sketch's profile. Taking the reader's current one here would mark
           every illustration stale the moment they edited their profile box,
           and re-drawing it would then stamp the Sketch's anyway — a stage that
           never reports itself done and pays $0.30 an open to find out. */
        profileHash: sketch.profileHash ?? null,
      };
    },
    async run(ctx, store) {
      const sketch = await store.read(ctx.slug, "sketch", "sketch");
      if (!usableSketch(sketch)) refuseToIllustrate("no-sketch");

      const article = await readArticle(ctx.slug, store);
      /* **A stale Sketch is refused rather than painted, and the reason is the
         reader's money.** `loadIllustrated` reports `stale` when the Sketch has
         gone stale as well as when the plates have (src/store/pg.ts), so a
         picture painted from a superseded scene is **born stale**: $0.30 and
         three minutes for something the panel labels out of date the moment it
         lands. This is the whole of what the plan means by refusing rather than
         quietly illustrating an argument the reader is not looking at.

         It is checked here and NOT in `stamp`, which is the difference between
         *would we paint this again* and *may we paint it now*. A finished
         illustration whose Sketch has since drifted stays `done`, so nothing
         re-runs on its own and this sentence only ever appears when somebody
         actually asked. Both stores agree, because `stamp` is untouched. */
      if (sketchIsStale(sketch, article.blocks, article.tree, article.meta ?? null)) {
        refuseToIllustrate("stale-sketch");
      }
      /* **And a Sketch drawn for somebody else's profile.** Without this the
         panel loops: the picture inherits the Sketch's `profileHash`, the route
         answers `profileChanged: true` against the reader's current profile,
         the panel offers to paint again, and the next paint inherits the same
         hash and reports the same thing — one press of a $0.30 button per
         circuit, for ever. `profileIsStale` is the three-state rule
         (src/profile.ts): an artefact written deliberately without a profile,
         and a reader who has since cleared theirs, are both *not* a mismatch. */
      if (profileIsStale(sketch.profileHash, ctx.profile ? hashProfile(ctx.profile) : null)) {
        refuseToIllustrate("wrong-profile");
      }

      const run = await generateIllustrated({
        article,
        sketch,
        /* **`null`, and not `ctx.profile`, and the honest reading is that the
           personalisation is already in the scene.** The Sketch was drawn for a
           profile; this stage paints that scene, so the picture inherits the
           personalisation transitively and the artefact records whose it was —
           `profileHash`, set from the Sketch a few lines down and compared by
           `stamp` above.

           Handing the *brief* prompt `ctx.profile` as well was considered and
           not done: the stamp has to name one profile, and two sources for it
           (the reader's now, the Sketch's then) is a field that means different
           things on different runs. If the register a brief chooses should
           depend on the reader as well as on the scene, that is a product
           decision with a stamp question attached, not a parameter to add
           here. Plan § Profile, and who may see it. */
        profile: null,
        onProgress: ctx.report,
        signal: ctx.signal,
        cacheArticle: ctx.cacheArticle,
      });

      /* **Written here rather than in `generateIllustrated`**, which writes
         nothing on purpose (its header says why): the hash of the Sketch is a
         store-shaped fact, and a stage that stamped itself could not be
         re-rendered from a saved brief by the eval. */
      run.illustrated.sourceHash = illustratedFingerprint(sketch);
      run.illustrated.profileHash = sketch.profileHash ?? null;

      /* **The bytes, one plate at a time, and a failure here is that plate's
         alone.** The blob store is content-addressed and create-only, so a run
         that stores two plates and then fails leaves two orphans — accepted,
         and no sweep is built (src/illustrated-image.ts § Orphans). Throwing
         the whole run away instead would discard pictures already paid for. */
      let stored = 0;
      const settled: IllustratedPlate[] = [];
      for (const [i, plate] of run.illustrated.plates.entries()) {
        const draw = run.draws[i];
        if (!draw?.image) {
          settled.push(plate);
          continue;
        }
        try {
          const image = await storePlateImage({
            image: draw.image,
            ...(draw.mediaType ? { mediaType: draw.mediaType } : {}),
          });
          stored += 1;
          settled.push(plateDrawn(plate, image));
        } catch (err) {
          /* **A store failure is that plate's alone**, and it reads to the panel
             exactly like a failed image call: this plate has no picture.
             `plateFailed` is what builds that state — the three states are a
             union and neither field can be assigned. */
          settled.push(plateFailed(plate, err instanceof Error ? err.message : String(err)));
        }
      }
      run.illustrated.plates = settled;

      plog.info(
        {
          slug: ctx.slug,
          step: "illustrated",
          model: run.model,
          imageModel: run.imageModel,
          inputTokens: run.inputTokens,
          outputTokens: run.outputTokens,
          cacheReadTokens: run.cacheReadTokens,
          cacheWriteTokens: run.cacheWriteTokens,
          briefMs: run.briefMs,
          ms: run.elapsedMs,
          plates: run.illustrated.plates.length,
          stored,
          /* The two numbers that say whether the prompt has drifted off the
             article — `faults` rising is the signal the plan names. Never the
             vignettes themselves: `quote` is the article's own prose and
             `depicts` is a model's description of it. docs/project/logging.md. */
          faults: run.report.faults.length,
          written: run.report.written,
          kept: run.report.kept,
        },
        `illustrated ${ctx.slug}: ${stored} of ${run.illustrated.plates.length} plate(s) drawn`,
      );

      const missing = run.illustrated.plates.length - stored;
      return {
        parts: { illustrated: run.illustrated },
        detail:
          `${stored} plate(s) painted` + (missing > 0 ? `, ${missing} failed` : "") +
          ` — ${run.illustrated.style}`,
      };
    },
  },
  /* Stage 5n — the debate. In STEP_ORDER but not in DEFAULT_INGEST_STEPS, and in
     FORCE_ONLY_WHEN_NAMED, for the reasons every mode step after `arc` has plus
     one none of them has: **what this step returns is not in the article**. It
     reads the blocks, the tree and the metadata, and it comes back with pages
     off the open web, so re-fetching the article is no reason at all to buy the
     search again.

     **It is not an `ArticleStage`** — no row in `STAGE_EFFORT` or
     `ARTICLE_RENDERER`, and `sharesArticleCache` therefore answers false for it,
     which is both the safe answer and the true one: it is on chat/completions
     and shares no Anthropic cached prefix with anything.
     docs/plans/260905f-debate-mode-what-the-web-says-about-this-piece.md. */
  debate: {
    name: "debate",
    label: "Asking the web",
    produces: ["debate"],
    /**
     * `articleWithIdsFingerprint`, the one `ideas`, `sketch` and `quiz` use —
     * the blocks, the tree and a metadata head that carries `URL:`.
     *
     * The URL is doing more here than printing at the top of a prompt: pass A
     * asks the *web* about that address, and it is what every returned citation
     * is compared against to keep the article out of its own debate. An article
     * that moved is a different search.
     *
     * **Not the dated fingerprint**, unlike `timeline`: no publication date
     * appears in either prompt, so hashing one would spend up to $0.27 every
     * time a publisher re-dated a post. And **no `profileHash`**, like
     * `timeline` and `quiz`: who is reading does not change what the web said.
     */
    stamp: async (ctx, store) => {
      /* `tryReadArticle`, where `run` below takes `readArticle` — the same
         asymmetry every stamped stage here has, and for the same reason. */
      const article = await tryReadArticle(ctx.slug, store);
      if (!article) return null;
      return {
        /* **`article.meta`, `null` and all — never a stub**, for the reason
           `quiz` and `timeline` state above: `generateDebate` builds a stub for
           the PROMPT and hands the fingerprint the real value, and hashing the
           stub here would make every article without metadata report stale for
           ever with nothing red. */
        inputHash: debateFingerprint(article.blocks, article.tree, article.meta),
        promptVersion: DEBATE_PROMPT_VERSION,
        /* `modelFor("debate")` rather than `CAPABLE_MODEL`, and it is the only
           row here that differs: this step is on the chat wire, where
           `SPIDERYARN_DEBATE_MODEL` can override the model — and a stamp that
           named the default while the override wrote the artefact would report
           every run stale. src/models.ts § `resolveModel`. */
        model: modelFor("debate"),
      };
    },
    async run(ctx, store) {
      const run = await generateDebate({
        article: await readArticle(ctx.slug, store),
        onProgress: ctx.report,
        signal: ctx.signal,
      });
      const { direct, claims } = run.debate;
      plog.info(
        {
          slug: ctx.slug,
          step: "debate",
          model: run.model,
          ms: run.elapsedMs,
          /* **The alarm, and the only place a runaway shows up outside the
             `ai_calls` ledger.** No request parameter caps spend here: Stage 0b
             watched a cap of four results cost thirty-six searches. A run
             logging 36 is a prompt that has drifted toward thoroughness. */
          webSearches: run.webSearches,
          /* Per group, never summed, or this line cannot say which of the two
             searches lost rows. Counts and hostnames only — never a URL, never
             an extract, never a quotation. docs/project/logging.md. */
          directReturned: direct.counts.returnedSources,
          directReported: direct.counts.reportedRows,
          directKept: direct.counts.keptRows,
          directOverCap: direct.counts.omittedOverCap,
          /* `directnessUnverified` is the one to watch and it is *expected* to
             be large: it is the rule that a page in group one must name this
             article, and most pages a search returns do not. A run where it is
             zero and `directKept` is high on an obscure article is the rule
             failing open, not the web being kind. */
          directLost: direct.counts.lost,
          claimsReturned: claims.counts.returnedSources,
          claimsReported: claims.counts.reportedRows,
          claimsKept: claims.counts.keptRows,
          claimsOverCap: claims.counts.omittedOverCap,
          claimsLost: claims.counts.lost,
        },
        `debate ${ctx.slug}: ${direct.counts.keptRows} direct, ${claims.counts.keptRows} on its claims`,
      );
      return {
        parts: { debate: run.debate },
        detail:
          `${direct.counts.keptRows} about this piece, ` +
          `${claims.counts.keptRows} about what it claims`,
      };
    },
  },
};

/**
 * Is this a Sketch there is any point illustrating?
 *
 * **An empty scene list counts as no sketch**, the same rule `loadSketch`,
 * `sketchIsCurrent` and `readSketchFile` all keep: a column or a file can hold
 * `{"scenes": []}` from an import or a hand edit, and painting it would spend
 * $0.30 on a picture of nothing.
 */
function usableSketch(sketch: Sketch | null): sketch is Sketch {
  return sketch !== null && Array.isArray(sketch.scenes) && sketch.scenes.length > 0;
}

/**
 * Validate a step name that arrived over HTTP.
 *
 * `STEP_ORDER.includes`, not `value in STEPS`. The `in` operator walks the
 * prototype chain, so `"constructor"` and `"toString"` are both "in" any object
 * — they would pass this check, and then `STEPS["constructor"]` hands the runner
 * `Object` instead of a step. The failure surfaces as a property of undefined,
 * several layers from the request that caused it. Covered by tests/jobs.test.ts.
 */
export function isStepName(value: unknown): value is StepName {
  return typeof value === "string" && (STEP_ORDER as readonly string[]).includes(value);
}
