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
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { generateArc } from "./arc.js";
import { type BlocksRun, NoBlocksProduced, previousBlocksFrom, runBlocks } from "./blocks.js";
import { runExtract } from "./extract.js";
import { fetchDocument, type RawManifest, readRaw, writeRaw } from "./fetch.js";
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
import { stageFailure } from "./job-failure.js";
import { runPdfExtract } from "./pdf-read.js";
import { generateSummaries, PROMPT_VERSION as SUMMARY_PROMPT_VERSION } from "./summarise.js";
import { log } from "./log.js";
import { ARTICLE_RENDERER, type ArticleStage, CAPABLE_MODEL, STAGE_EFFORT } from "./models.js";
import { hashBlocks } from "./source-hash.js";
import { hashProfile } from "./profile.js";
import { type RejectReason, looksLikePdf, MAX_UPLOAD_BYTES, rejectionFailure, stagingKey } from "./source.js";
import { readUpload, rejectUpload, settleUpload } from "./upload-records.js";
import { fsLocations } from "./store/artifacts-fs.js";
import { blobStore, CONTENT_TYPE, storeRawSource } from "./store/blobs.js";
import {
  type ArtifactKind,
  type ArtifactStore,
  sameStamp,
  type StepStamp,
} from "./store/artifacts.js";
import { generateToc } from "./toc.js";
import { generateTweets, PROMPT_VERSION as TWEETS_PROMPT_VERSION } from "./tweets.js";
import type { JobUpload, Meta, StepName } from "./types.js";

const ROOT = path.resolve(import.meta.dirname, "..");

/**
 * One line per step, saying what the step cost.
 *
 * **Why the logging lives here rather than in the stages.** Every model stage
 * already counts its own tokens and times its own call, and then hands those
 * numbers back in its run object — which the `run()` closures below receive and
 * currently reduce to a sentence for a progress bar. The stage CLIs print them;
 * the queue threw them away. So "what did this article's tree cost?" had no
 * answer once the web UI became the normal way to ingest, which is open question
 * Q7 in docs/project/open-questions.md.
 *
 * The numbers are all in scope *here*, at the seam the queue already owns, so
 * this file can answer that question without a single edit inside somebody
 * else's stage — see architecture.md#stage-ownership. The two exceptions are two
 * lines each: `toc` and `arc` keep `CAPABLE_MODEL` private, so they now return it.
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
 * Every step there is, in pipeline order.
 *
 * This constant does two jobs and both need every name: `orderSteps` sorts by
 * `indexOf` here (a name that is missing gets `-1` and sorts to the **front**,
 * so it would run before `fetch`), and `isStepName` below is what decides which
 * names the API will accept at all.
 *
 * It used to do a third — being the default for a job that named no steps — and
 * that is `DEFAULT_INGEST_STEPS` now, because `tweets` was the first step that
 * belongs in the order and not in the default. `glossary` is the second, and
 * the pair of them is what turned that from an exception into the shape of the
 * list: everything up to `arc` makes the article readable, and everything after
 * it is a thing somebody asks for. See
 * docs/plans/tweet-thread-page.md#the-one-real-snag-stated-precisely and
 * docs/project/glossary.md.
 */
export const STEP_ORDER: StepName[] = [
  "fetch",
  "extract",
  "blocks",
  "toc",
  "arc",
  "tweets",
  "glossary",
  "summary",
  "ideas",
];

/**
 * What "add this URL" runs: every step that makes the article readable.
 *
 * Not `tweets`, not `glossary`, and not `summary`. Each costs model calls over
 * the whole article and each is a thing you go to — a page, and two modes — so
 * each is generated when somebody asks for it, `{ steps: ["tweets"] }` or
 * `{ steps: ["glossary"] }` or `{ steps: ["summary"] }`, and never as a side
 * effect of adding an article. Greg was asked about the first two and said no
 * to both, directly (2026-08-25); `summary` follows the rule they established,
 * and it is the most expensive of the three — several batched calls rather than
 * one. See docs/project/summaries.md.
 */
export const DEFAULT_INGEST_STEPS: StepName[] = ["fetch", "extract", "blocks", "toc", "arc"];

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
 * this change, and the two must be read together: `tweets` has an `isDone` of
 * its own that compares the thread's `sourceHash` against the blocks on disk.
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
 * stored `sourceHash` against the blocks on disk. **And one thing more that
 * `tweets` does not have to worry about** — forcing this step *appends* a batch
 * of terms rather than replacing the list (src/glossary.ts § `generateGlossary`),
 * so being swept into the cascade would not merely waste a model call, it would
 * lengthen the reader's glossary as a side effect of re-fetching the article.
 *
 * `summary` is here on the same two grounds as `tweets` — it reads the blocks
 * and the tree, nothing reads what it writes, and its `stamp` compares its
 * stored `sourceHash`, prompt version and model against what the store has. It
 * is also the one step where being swept in costs the most: it is not one model
 * call but one per part, so a cascade would multiply a wasted regeneration by
 * the width of the article.
 */
export const FORCE_ONLY_WHEN_NAMED: ReadonlySet<StepName> = new Set<StepName>([
  "tweets",
  "glossary",
  "summary",
  /* Same two reasons as the three above: it reads `blocks.json` and
     `tree.json`, nothing reads what it writes, so the positional cascade would
     buy a model call for nothing. Unlike the glossary, forcing it does not
     silently lengthen anything — `ideas` replaces rather than appends — but the
     first reason stands on its own. */
  "ideas",
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
  /** `data/<slug>` — where the durable artefacts live. */
  dir: string;
  /** `output/<slug>.html` — the debug page, and what stage 3 reads and writes ids into. */
  htmlFile: string;
  /** Say something short about how this step is going. Shown live; not persisted. */
  report(detail: string): void;
  signal: AbortSignal;
  /**
   * A free-text steer from the reader, for the steps that take one.
   *
   * Only `summary` reads it today. It is on the context rather than passed as
   * an argument for the same reason `url` is: a step's inputs arrive one way,
   * and the queue does not need to know which steps care.
   *
   * **It is not part of any step's freshness check.** A steer is a reason to
   * force a rewrite — which is what the button carrying it does — not a reason
   * for the next ordinary run to believe the artefact has gone stale. See the
   * `summary` step's `stamp` below, and the note it points at in
   * src/summarise.ts.
   */
  guidance?: string;
  /**
   * Who is reading, already rendered — `renderProfile` in src/profile.ts.
   *
   * Resolved once by whoever queued the job and carried here, never read from
   * storage by a step. Read the note on `Job.profile` in src/types.ts for why
   * that matters: a step that resolved it itself would let a profile edited
   * mid-run split one artefact across two profiles.
   *
   * **Not part of any step's `isDone` either**, and for a different reason from
   * `guidance` above. A steer is left out because it is a reason to force a
   * rewrite rather than evidence of staleness. The profile is left out because
   * staleness against a profile is a separate question with its own answer —
   * `profileIsStale` in src/profile.ts — which the reader's panel asks and the
   * pipeline does not.
   */
  profile?: string;
  /**
   * Whether this step should pay to cache the article it is about to send.
   *
   * True only when a *later step in this same job* renders the same article the
   * same way and asks the model to think about it at the same effort — which is
   * what `sharesArticleCache` decides. A cache write costs 1.25x, so marking a
   * prefix nobody reads is a straight loss, and on the ordinary ingest path
   * (which stops at `arc`) nobody does read it.
   *
   * Steps that do not read the whole article ignore this.
   */
  cacheArticle: boolean;
}

export interface PipelineStep {
  name: StepName;
  /** Present tense, naming the actual thing — "Fetching the page", never "Loading". */
  label: string;
  /**
   * Every file this step writes.
   *
   * A step counts as done when **all** of them are present, which is the only
   * safe reading for the two steps that write more than one: `extract` writes
   * the HTML and `meta.json`, `toc` writes `tree.json` and its copy of
   * `blocks.json`. Checking only the first would let a crash between the two
   * writes leave a step that reports itself finished with half its output, and
   * the stage after it would consume the missing half.
   *
   * **For most steps this is still an existence check, not a correctness
   * check** — unless the step supplies `isDone` below. See the honest account of
   * the gap in
   * docs/project/ingest-queue.md#idempotent-is-the-goal-this-is-a-step-towards-it.
   */
  outputs(ctx: StepContext): string[];
  /**
   * The same list said the other way: **what** this step produces, rather than
   * where it lands.
   *
   * `outputs` is repo paths, and after the move to Postgres there are no paths
   * — the tree is a column, not a file. So a step names the *kinds* of thing it
   * makes (src/store/artifacts.ts) and an `ArtifactStore` decides where those
   * go. The file adapter maps them back to exactly the paths `outputs` returns,
   * which is what tests/pipeline-artifact-store.test.ts asserts step by step.
   *
   * **Both are here on purpose, for now.** Landing the new declaration beside
   * the old one, with a test holding them together, is what makes the swap
   * checkable before anything depends on it. `outputs` goes when the Postgres
   * adapter lands and `assertProduced` stops needing a path — see
   * docs/plans/postgres-storage-implementation.md § The order.
   */
  produces: readonly ArtifactKind[];
  /**
   * Optional: what stamp would this step write if it ran right now?
   *
   * The **currency** half of "is this step done", and the replacement for the
   * three near-identical `…IsCurrent` functions. The store reads the recorded
   * stamp (`stampFor`); this says what it ought to be; `sameStamp` compares
   * them once, in one place, instead of the same three lines living in
   * src/tweets.ts, src/glossary.ts and src/summarise.ts.
   *
   * `null` means *we cannot tell* — the blocks it would be hashed against are
   * not readable — and that answers not-current. The safe way to be wrong here
   * is a model call; the other way round is a stale artefact served for ever.
   *
   * Adding one to `toc` or `arc` is now four lines rather than a whole
   * function, which is the point. Neither has one yet, and the interface says
   * so out loud rather than letting bare existence look like freshness.
   */
  stamp?(ctx: StepContext, store: ArtifactStore): Promise<StepStamp | null>;
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
   * Kept optional, and kept out of `outputs`, on purpose: this is the only
   * place in the interface that can read a file's *contents*, so a step that
   * gets it wrong burns a model call every run. Adding one is a deliberate act.
   * `assertProduced` still uses `outputs`, because "did you write the file"
   * stays a separate question from "was it worth writing".
   *
   * **`stamp` above is what replaces this, and two steps are still here** —
   * `tweets` and `summary`.
   *
   * The reason used to be that both kept `PROMPT_VERSION` module-private, so a
   * `stamp` for either would have written the version out a second time in this
   * file: two copies of one string, free to drift, and the drift showing up as
   * an artefact that never regenerates. **That reason has gone** — both export
   * it now (`tweets/2`, `summary/3`), as `glossary` did when it made the move.
   * What is left is one `stamp` line here and one deletion in each stage.
   *
   * Worth doing before the artefacts leave the filesystem rather than after:
   * both of these `isDone` implementations read `ctx.dir`, and under Postgres
   * there is no directory to read. docs/plans/transactional-stage-runner.md § D.
   */
  isDone?(ctx: StepContext, store: ArtifactStore): Promise<boolean>;
  /**
   * Do the work. The returned string is the one-line summary kept on the
   * finished step.
   *
   * **The store is an argument, like `isDone`'s and `stamp`'s, and it has no
   * default** — for the reason `stepIsDone` gives at length: a default lets a
   * Postgres caller that forgot it compile cleanly and get a confident answer
   * about the filesystem. Only `blocks` reads it today, because stage 3 is the
   * only stage whose *previous output* is an input it cannot do without
   * (docs/project/block-ids.md); the two stages with the same shape, `glossary`
   * and `ideas`, are the next piece of work and this is the seam they take.
   */
  run(ctx: StepContext, store: ArtifactStore): Promise<string>;
}

/**
 * Are the ids stage 3 recorded actually in the HTML beside them?
 *
 * **The one check that can tell `extractedHtml` from `stampedHtml`**, which the
 * filesystem cannot: they are the same path, and both are "some non-empty
 * text". So after a re-extraction — stage 2 overwriting the HTML with
 * Readability's output, ids nowhere in it — an old `blocks.json` sits beside
 * new unstamped HTML, every path exists, every path parses, and `blocks`
 * reported itself done. The stage after it then serves an article whose
 * paragraphs have no anchors, and every comment in it points at nothing. Found
 * by review, 2026-08-26, as the second of three criticals in this seam.
 *
 * **Every** id in `blocks.json` has to be in the HTML — all of them, not a
 * sample. Verified against the real articles in `data/` — 360 blocks and 360
 * ids, 141 and 141 — so that is the actual invariant rather than an
 * approximation that starts failing on a long page.
 *
 * **What it does not prove**, said plainly because the first version of this
 * comment claimed more: it is a membership test, not a binding. Two ids swapped
 * between elements, an id parked on an unrelated wrapper, or a duplicate id all
 * pass. It catches the case it was built for — a re-extraction wiping every id —
 * and not a corrupted stamping. The stronger version is a generation token
 * written by stage 3 into both `blocks.json` and the HTML, which is cheap here
 * *because* both files have one writer: the reason a token was rejected for
 * `extract` (a later step legitimately rewrites its HTML) does not apply.
 * Raised by review 2026-08-26 and not built; see
 * docs/plans/postgres-storage-implementation.md.
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
 * Cheap enough to run on every skip check: one pass of the HTML with a regex,
 * then a set lookup per block. And the cost of being wrong is small in the
 * direction it can be wrong — stage 3 makes no model call, and re-running it
 * carries the ids over rather than minting new ones.
 */
async function htmlCarriesItsIds(ctx: StepContext, store: ArtifactStore): Promise<boolean> {
  const file = await store.read(ctx.slug, "blocks", "blocks");
  const html = await store.read(ctx.slug, "blocks", "stampedHtml");
  if (!file?.blocks?.length || !html) return false;
  const stamped = new Set<string>();
  for (const [, id] of html.matchAll(/\sid="(spya-[a-z0-9]{6})"/g)) stamped.add(id!);
  return file.blocks.every((block) => stamped.has(block.id));
}

/** Stage 3's own artefact, beside the HTML. Stage 4 copies it into `data/<slug>/`. */
function blocksPathFor(ctx: StepContext): string {
  return ctx.htmlFile.replace(/\.html$/, ".blocks.json");
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
 * docs/plans/delete-the-importer.md § Three stages carry identity in a file.
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
 * artefacts and `toc` writes three, so a rerun that replaces one of them with a
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
  store: ArtifactStore,
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

/**
 * The fingerprint of the blocks a late stage would be written against today.
 *
 * `data/<slug>/blocks.json` — stage 4's copy, not stage 3's — because that is
 * the one the late stages read and the one their `sourceHash` was computed
 * from. Reading the other would make every artefact look stale the moment
 * stage 3 ran without stage 4.
 *
 * `null` when the blocks cannot be read at all, which is *"we cannot tell"* and
 * must not be confused with a hash that fails to match. Both answer
 * not-current; only one of them is a stale artefact.
 */
async function inputHashFor(ctx: StepContext, store: ArtifactStore): Promise<string | null> {
  const file = await store.read(ctx.slug, "toc", "blocks");
  if (!file?.blocks) return null;
  return hashBlocks(file.blocks);
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
 * docs/plans/postgres-storage-implementation.md § Step 11 half B, stage 5.
 */
export async function assertProduced(
  step: PipelineStep,
  ctx: StepContext,
  store: ArtifactStore,
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
 */
export async function articleExists(slug: string): Promise<boolean> {
  try {
    await readFile(path.join(ROOT, "data", slug, "meta.json"), "utf8");
    return true;
  } catch {
    return false;
  }
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

/** The source URL for a slug, from its meta.json. Undefined if there isn't one yet. */
export async function urlForSlug(slug: string): Promise<string | undefined> {
  try {
    const meta = JSON.parse(
      await readFile(path.join(ROOT, "data", slug, "meta.json"), "utf8"),
    ) as Meta;
    return meta.url;
  } catch {
    return undefined;
  }
}

/**
 * Everything a step needs to know about where this article's files go.
 *
 * The definition itself is `fsLocations` in src/store/artifacts-fs.ts, because
 * the store is the layer allowed to know about paths at all. This stays here,
 * and stays exported, so the callers that already use it did not have to move.
 */
export function contextPaths(slug: string): { dir: string; htmlFile: string } {
  return fsLocations(slug);
}

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
    throw stageFailure(
      "ours",
      `No source URL for "${ctx.slug}". Its meta.json has none, and none was given.`,
    );
  }
  return ctx.url;
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
 * > — docs/plans/pdf-upload-and-storage.md, on GPT Sol's review
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
async function acquireUpload(ctx: StepContext, upload: JobUpload): Promise<string> {
  const record = await readUpload(upload.id);
  if (!record) {
    /* `ours`: the bytes may well be sitting in Storage perfectly intact, and
       there is nothing the reader can do about our having lost the note saying
       they are theirs. */
    throw stageFailure("ours", `No record of upload ${upload.id}.`);
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
    throw stageFailure(failure.kind, failure.message);
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

  await mkdir(ctx.dir, { recursive: true });
  await writeFile(path.join(ctx.dir, "raw.pdf"), got);
  const manifest: RawManifest = {
    kind: "pdf",
    file: "raw.pdf",
    /* **No URL, and none invented.** `RawManifest` used to require two, which
       is exactly the assumption docs/plans/pdf-upload-and-storage.md § 5 warned
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
  await writeFile(
    path.join(ctx.dir, "raw.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

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
  return `${kb} KB`;
}

/**
 * What stage 2 says when Readability finds no article in the page.
 *
 * **Matched on its sentence, which is the one place here that does that, and it
 * is worth saying why.** Every other permanent failure in the pipeline is
 * tagged where it is thrown (`stageFailure`, src/job-failure.ts). This one is
 * thrown in src/extract.ts, which belongs to stage 2, so the tag is applied at
 * the seam instead — and a sentence is all the seam has to go on.
 *
 * A match on prose is exactly the kind of thing that rots quietly, so it does
 * not rest on care: tests/job-failure.test.ts runs the real extractor over a
 * page Readability refuses and asserts the classification, which goes red the
 * day that sentence changes.
 *
 * The claim itself is about a **retry** rather than a re-run, and it holds
 * because Retry never re-runs a step that finished: `forceForRetry` forces from
 * the first unfinished step, which is this one, so `fetch` stays done and stage
 * 2 re-reads byte-for-byte the page it has already refused.
 */
const READABILITY_REFUSED = /^Readability could not parse this page\./;

/**
 * The pipeline.
 *
 * Stage numbers here are the ones in architecture.md § Pipeline. The one that
 * looks missing is sanitising, which is not a step of its own: it happens
 * *inside* `blocks`, at the top of `splitIntoBlocks`, so that the stored
 * blocks.json is already safe and no later consumer has to remember. See
 * src/sanitize.ts.
 */
export const STEPS: Record<StepName, PipelineStep> = {
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
    outputs: (ctx) => [path.join(ctx.dir, "raw.json")],
    produces: ["raw"],
    async run(ctx) {
      /* **The one branch in the whole pipeline that knows where an article came
         from.** An upload has nothing to fetch — the bytes are already ours —
         so this half verifies them and writes the same manifest the other half
         does. See `acquireUpload`, and the label this step shows, which is not
         "Fetching the page" when there is nothing to fetch. */
      if (ctx.upload) return await acquireUpload(ctx, ctx.upload);
      const url = requireUrl(ctx);
      const host = new URL(url).hostname;
      ctx.report(host);
      const doc = await fetchDocument(url, { signal: ctx.signal });
      const manifest = await writeRaw(ctx.dir, doc);
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
      return `${kb} KB`;
    },
  },

  /* Stage 2. Reads what stage 1 wrote rather than re-fetching, which is the
     whole point of splitting the two.

     **Two extractors, one artefact.** A web page goes through Readability; a
     PDF goes through a model that reads its pages. Both write `article.html`
     and `meta.json`, and stage 3 onwards cannot tell which produced them —
     which is the entire design. See docs/plans/pdf-ingestion.md.

     The branch is on **what stage 1 says it fetched**, never on the URL: a
     `.pdf` address that served a Cloudflare challenge is HTML, an
     `application/octet-stream` that starts `%PDF-` is a PDF, and stage 1
     already looked at the bytes (docs/project/fetching.md). */
  extract: {
    name: "extract",
    label: "Extracting the article",
    outputs: (ctx) => [ctx.htmlFile, path.join(ctx.dir, "meta.json")],
    produces: ["extractedHtml", "meta"],
    async run(ctx) {
      const manifest = await readRaw(ctx.dir);
      /* **Only the HTML half needs a URL**, and it needs it as a base for
         relative links rather than as a thing to fetch. A PDF does not: it
         carries no relative hrefs, and an uploaded one has no address at all.
         Asking for one up here — which this did — is what made `requireUrl` the
         first thing an upload hit, three stages after the last thing that could
         have supplied one. */
      /* No manifest means an article fetched before `raw.json` existed. Those
         all have a `raw.html`, so HTML is the right assumption — and a wrong
         one would fail loudly on the read below rather than quietly. */
      if (manifest?.kind !== "pdf") {
        const url = requireUrl(ctx);
        const html = await readFile(path.join(ctx.dir, manifest?.file ?? "raw.html"), "utf8");
        try {
          const result = await runExtract({ html, url, outFile: ctx.htmlFile, dataDir: ctx.dir });
          return result.meta.title;
        } catch (err) {
          /* Only the one sentence. Everything else this can throw — a full
             disk, a directory that vanished — is ordinary bad luck, and hiding
             a Retry that would have worked is the costlier way to be wrong. */
          if (READABILITY_REFUSED.test((err as Error).message)) {
            throw stageFailure("blocked", (err as Error).message);
          }
          throw err;
        }
      }

      const bytes = new Uint8Array(await readFile(path.join(ctx.dir, manifest.file)));
      const result = await runPdfExtract({
        bytes,
        ...(ctx.url ? { url: ctx.url } : {}),
        /* The last rung of the title ladder is the filename, and for an upload
           that is the reader's own — which is very often the best name anybody
           has for a scan. For a fetched PDF it stays the URL's last segment,
           which is what it always was. */
        ...(manifest.filename ? { filename: manifest.filename } : {}),
        outFile: ctx.htmlFile,
        dataDir: ctx.dir,
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
          model: result.meta.method,
        },
        `extract ${ctx.slug}: ${result.pages} pages of PDF in ${result.chunks} chunks`,
      );
      return result.meta.title;
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
     * step reporting itself unfinished until `toc` had run too — so a retry
     * would redo stage 3 every time, and `{ steps: ["blocks"] }` could never
     * skip itself.
     */
    outputs: (ctx) => [blocksPathFor(ctx), ctx.htmlFile],
    produces: ["blocks", "stampedHtml"],
    /* Presence is not enough here, and this is the only step where that is
       true for a reason other than cost — see `htmlCarriesItsIds`. */
    isDone: (ctx, store) => htmlCarriesItsIds(ctx, store),
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

      let run: BlocksRun;
      try {
        run = await runBlocks({ htmlFile: ctx.htmlFile, previous });
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
           classified and this is not the change that decides it. */
        if (err instanceof NoBlocksProduced) throw stageFailure("blocked", err.message);
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
      return `${total} blocks, ${minted} new ids (${kept} kept)`;
    },
  },

  /* Stages 4 + 5 — one model call writes the structure and the gists together;
     src/toc.ts says why they are not two passes. */
  toc: {
    name: "toc",
    label: "Building the table of contents",
    /* `labels.json` is in here as well as the tree, because stage 4 is two model
       passes now and a directory with a tree but no labels is a half-run step,
       not a finished one. src/toc.ts writes the tree last for the same reason. */
    outputs: (ctx) => [
      path.join(ctx.dir, "tree.json"),
      path.join(ctx.dir, "labels.json"),
      path.join(ctx.dir, "blocks.json"),
    ],
    produces: ["tree", "labels", "blocks"],
    /**
     * **No `stamp`, and it is not an oversight — one was written and withdrawn
     * on 2026-08-27.** Read this before adding one.
     *
     * Stage 4 cannot currently tell that stage 3 has run again: `stepIsDone`
     * asks only whether its three artefacts exist. The obvious fix is a stamp
     * hashing stage 3's blocks, and it works — `59e8e3a` had it, with tests.
     *
     * It was reverted because **`toc` re-running silently drops artefacts that
     * are still marked current.** `arc` and `summary` are joined to the tree by
     * exact block-**range** pair (`buildArcColumn` and the summary column in
     * src/web/tree.ts), and an entry whose range matches no node is dropped
     * from the reading view without a word. A rebuilt tree may legitimately
     * choose different boundaries, so:
     *
     * - `arc` has no stamp at all, so it stays "done" and simply loses entries.
     * - `summary` hashes only the blocks, so where the blocks did *not* change —
     *   a tree we cannot date, rather than one we know is stale — it also stays
     *   current and loses entries.
     *
     * The tree's own comment in src/web/tree.ts has said as much all along:
     * *"ids are positional and a re-run of `npm run toc` renumbers them"*.
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
     * storage a private freshness rule for `toc` would put the pipeline's logic
     * in the storage layer *and* walk straight back into the hazard above, by a
     * different door. GPT Sol, 2026-08-28;
     * docs/plans/artifacts-pg-has-sol.md.
     *
     * **What the runner must still do is record the hash.** Having no expected
     * stamp and recording no input are different things: `finishStepRun` has to
     * be given `hashBlocks(blocks)` for this step, because
     * `reasonsNotToPublish` compares `toc.input_hash` against the stored blocks
     * and refuses the publication when they differ — so a `toc` left carrying
     * `NO_INPUT_HASH` would make every article unpublishable.
     */
    async run(ctx) {
      const run = await generateToc({
        blocksPath: blocksPathFor(ctx),
        outDir: ctx.dir,
        onProgress: ctx.report,
        signal: ctx.signal,
      });
      /* `run.elapsedMs`, not a timer around this closure. The stage times the
         model call itself, which is the number that answers "what does a tree
         cost"; a timer out here would fold in reading blocks.json and writing
         two files, and quietly drift as that IO changed. Same for the other two
         model steps. */
      plog.info(
        {
          slug: ctx.slug,
          step: "toc",
          model: run.model,
          /* Three counts, not one, and `strandedSupplement` is the one that
             matters: it is how an operator learns the apparatus was left out of
             the structure on a run that otherwise reports success. */
          supplementNodes: run.supplementNodes,
          supplementBlocks: run.supplementBlocks,
          strandedSupplement: run.strandedSupplement,
          inputTokens: run.inputTokens,
          outputTokens: run.outputTokens,
          cacheReadTokens: run.cacheReadTokens,
          cacheWriteTokens: run.cacheWriteTokens,
          ms: run.elapsedMs,
          blocks: run.blocks,
          sections: run.internal,
        },
        `toc ${ctx.slug}: ${run.internal} sections over ${run.blocks} blocks`,
      );
      return `${run.internal} sections over ${run.blocks} blocks`;
    },
  },

  /* Stage 5b. */
  arc: {
    name: "arc",
    label: "Writing the arc",
    outputs: (ctx) => [path.join(ctx.dir, "arc.json")],
    produces: ["arc"],
    async run(ctx) {
      const run = await generateArc({
        dir: ctx.dir,
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
      return `${run.arc.entries.length} sentences, one per part`;
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
    outputs: (ctx) => [path.join(ctx.dir, "tweets.json")],
    produces: ["tweets"],
    /* Was `threadIsCurrent(ctx.dir)`, which did these same three comparisons by
       hand and read the article's directory rather than the store — deleted in
       D0 (docs/plans/delete-the-importer.md). The comparison belongs in one
       place (`sameStamp`); only the three values belong to the stage. */
    stamp: async (ctx, store) => {
      const inputHash = await inputHashFor(ctx, store);
      if (!inputHash) return null;
      return { inputHash, promptVersion: TWEETS_PROMPT_VERSION, model: CAPABLE_MODEL };
    },
    async run(ctx) {
      const run = await generateTweets({
        dir: ctx.dir,
        profile: ctx.profile ?? null,
        onProgress: ctx.report,
        signal: ctx.signal,
        cacheArticle: ctx.cacheArticle,
      });
      const over = run.over > 0 ? `, ${run.over} over ${run.thread.limit}` : "";
      /* `run.thread.generator` is this stage's model id — it is already stored
         on the thread, because the stamp compares it to decide whether a thread
         needs rewriting. So unlike toc and arc, nothing had to be added to
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
      return `${run.thread.tweets.length} posts${over}`;
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
    outputs: (ctx) => [path.join(ctx.dir, "glossary.json")],
    produces: ["glossary"],
    /* The first step through the new seam, and the shape the other two follow.
       Three values — the blocks it would be written from, the prompt that would
       write it, the model that would run — where `glossaryIsCurrent` was a
       function doing the same three comparisons by hand. That function was
       deleted on 2026-08-28. This comment used to say it survived "because its
       CLI uses it"; glossary's `main()` never called it, and only its own tests
       did, so the sentence was keeping dead code alive. docs/plans/simplification-wave-2.md § 0.5.

       `stamp` rather than `isDone` because the *comparison* belongs in one
       place (`sameStamp`) and only the four values belong to the stage. It is
       glossary that goes first purely because glossary is the one of the three
       that already exports its `PROMPT_VERSION` — see the note on `isDone`. */
    stamp: async (ctx, store) => {
      const inputHash = await inputHashFor(ctx, store);
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
       * throws. docs/plans/delete-the-importer.md § Three stages carry identity
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
        dir: ctx.dir,
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
        },
        `glossary ${ctx.slug}: ${total} terms (${run.added} new, pass ${run.glossary.passes})`,
      );
      const added = run.glossary.passes > 1 ? `, ${run.added} new` : "";
      return `${total} ${total === 1 ? "term" : "terms"}${added}`;
    },
  },
  summary: {
    name: "summary",
    label: "Writing the summaries",
    outputs: (ctx) => [path.join(ctx.dir, "summary.json")],
    produces: ["summary"],
    /* Was `summariesAreCurrent(ctx.dir)` — the same three comparisons by hand,
       against the article's directory rather than the store. D0, as `tweets`
       above. The function is still in src/summarise.ts and now has no caller;
       it goes in a follow-up, because that file is being edited elsewhere. */
    stamp: async (ctx, store) => {
      const inputHash = await inputHashFor(ctx, store);
      if (!inputHash) return null;
      return { inputHash, promptVersion: SUMMARY_PROMPT_VERSION, model: CAPABLE_MODEL };
    },
    async run(ctx) {
      const run = await generateSummaries({
        dir: ctx.dir,
        ...(ctx.guidance !== undefined && { guidance: ctx.guidance }),
        profile: ctx.profile ?? null,
        onProgress: ctx.report,
        signal: ctx.signal,
      });
      const { missing } = run.summaries;
      plog.info(
        {
          slug: ctx.slug,
          step: "summary",
          model: run.model,
          inputTokens: run.inputTokens,
          outputTokens: run.outputTokens,
          ms: run.elapsedMs,
          sections: run.targets,
          batches: run.batches,
          /* The two quality signals in this line, and the reason partial
             salvage is safe to have at all. `missing` is how many sections came
             out of this run with no summary; `failedBatches` is how many groups
             gave up entirely after their one repair attempt. Both are normally
             zero, neither is an error, and a run that quietly starts returning
             a handful every time is the prompt or the model having moved —
             which is exactly the failure that is invisible unless it is
             counted. See docs/reusable/silent-success.md. */
          missing,
          failedBatches: run.failedBatches,
          /* How many doors back into the article these summaries carry, and
             how many lead nowhere. A run that starts reporting `cited: 0` is
             the model having stopped citing — which breaks nothing visible and
             turns a summary back into a substitute for the passage rather than
             a way in. src/summarise.ts § countCitations. */
          cited: run.cited,
          unknownCited: run.unknownCited,
          /* The steer's LENGTH, never the steer. It is the reader's own words
             about what they are reading for, which is exactly the kind of thing
             docs/project/logging.md keeps out of the log. The number is enough
             to answer "was one sent at all". */
          guidanceChars: ctx.guidance?.length ?? 0,
          /* The same rule again, and it matters more here: this one is about
             the person rather than about the article. A length answers "was one
             sent", which is the only question the log is entitled to ask.
             docs/project/logging.md. */
          profileChars: ctx.profile?.length ?? 0,
        },
        `summary ${ctx.slug}: ${run.targets - missing}/${run.targets} sections in ${run.batches} groups`,
      );
      const short = missing > 0 ? `, ${missing} missing` : "";
      return `${run.targets - missing} of ${run.targets} sections${short}`;
    },
  },
  /* Stage 5f — the ideas. In STEP_ORDER but not in DEFAULT_INGEST_STEPS, for
     the reason `tweets`, `glossary` and `summary` established: everything up to
     `arc` makes the article readable, everything after it is a thing somebody
     asks for.

     **The first step whose stamp has four values rather than three**, and both
     additions close holes the others still have — see the notes below. */
  ideas: {
    name: "ideas",
    label: "Finding the ideas",
    outputs: (ctx) => [path.join(ctx.dir, "ideas.json")],
    produces: ["ideas"],
    /**
     * Four values, where every other stamped step declares three.
     *
     * **The blocks AND the tree.** `inputHashFor` above hashes only the blocks,
     * which `StepStamp`'s own docstring has flagged as wrong for exactly this
     * family of stages since it was written: section boundaries can move
     * without a single block changing. It matters more here than anywhere
     * because the prompt shows the model the skeleton *before* the article
     * precisely so that it judges what the argument rests on — re-cut the
     * sections and that judgment was made against a different question, while
     * a blocks-only hash reports no change at all.
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
      const blocksFile = await store.read(ctx.slug, "toc", "blocks");
      const tree = await store.read(ctx.slug, "toc", "tree");
      /* `null` is "we cannot tell", which must not be confused with a hash that
         fails to match. Both answer not-current; only one is a stale artefact. */
      if (!blocksFile?.blocks || !tree) return null;
      return {
        inputHash: ideasFingerprint(blocksFile.blocks, tree),
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
        dir: ctx.dir,
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
      return `${total} ${total === 1 ? "idea" : "ideas"}, ${assumed} to bring`;
    },
  },
};

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
  return typeof value === "string" && (STEP_ORDER as string[]).includes(value);
}
