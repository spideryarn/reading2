/**
 * The ingest queue: one article at a time, and a record of how it went.
 *
 * > There should be some kind of queue that processes things … and ideally a
 * > progress indicator.
 * >
 * > — Greg, 2026-08-25
 *
 * Two things live here — running a list of steps, and deciding *which* step and
 * *whether*. Where the job records live is no longer this file's business: they
 * are behind `JobStore` (src/store/jobs.ts), which has a filesystem adapter
 * writing the same `data/_jobs/<id>.json` as before and a Postgres one. The
 * *pipeline* is src/pipeline.ts; this file knows how to run a list of steps and
 * nothing about what any of them do.
 *
 * ## What changed on 2026-08-27, and why every line of it is deletion
 *
 * This module held a `Map`, a write queue, a load-from-disk, a restart sweep
 * and a p-queue. All five were correct and all five were **one process's**, so
 * `POST /api/jobs` creating a job in instance A and `POST /api/jobs/<id>/advance`
 * landing on instance B meant a 404 on a job that plainly existed. They moved
 * to src/store/jobs-fs.ts unchanged; what replaced them here is a **claim**.
 *
 * The claim is the whole design and it is three lines of SQL: an attempt token,
 * a lease, and every write fenced on `id = $id and attempt_id = $attempt and
 * status = 'running'`. One claim covers one step and is then released, because
 * a claim held across requests leaves the job `running` with a token nobody
 * holds and the next advance is told `busy` until the lease lapses — the
 * endpoint deadlocking itself on the happy path.
 *
 * **An expired lease is not a takeover.** The job is failed and Retry is the
 * reader's to press. Guessing that an owner is dead is how two runners end up
 * writing one article, and it only becomes safe when the artefact writes are
 * transactional — docs/plans/260827j-transactional-stage-runner.md, which is not built.
 *
 * See docs/project/ingest-queue.md for the design and the library choice, and
 * docs/plans/260827h-durable-queue-and-uploads.md for the review that took the first
 * version of this apart.
 */
import { createHash } from "node:crypto";
import {
  type SpendReport,
  collectSpend,
  emptySpend,
  formatNanos,
  spendFields,
} from "./ai-spend.js";
import { mintId } from "./ids.js";
/* The artefact store the **filesystem** session writes through, and nothing
   else uses it: under Postgres a claim's session writes into its own draft and
   never touches a disk (`claimSession`). Named for the role rather than imported
   under its own name, because that is what the role was — the one line that
   would pick Postgres instead — and it is kept so while the filesystem branch
   is still what every laptop runs. Stage 4 deletes the branch and this import
   with it. Deliberately not routed through src/store/index.ts, which is the
   *reader's* store. */
import { costStore, totalRows } from "./store/ai-calls.js";
import { fsArtifacts as pipelineStore } from "./store/artifacts-fs.js";
import { fsJobStore } from "./store/jobs-fs.js";
import { pgJobStore } from "./store/pg-jobs.js";
/* The refusal a publication answers with, by name, because the walk has to tell
   it apart from a database fault: one is a draft that is not fit to be an
   article and ends the job with something a person can act on, the other is a
   500. Imported from the module that defines it rather than through
   src/store/revisions.js, which does not re-export it. See `walkClaim`. */
import { PublishRefused } from "./store/pg-revisions.js";
import { mintAttempt, StaleAttemptError, type JobEnding, type JobStore } from "./store/jobs.js";
import { STORE } from "./store/live.js";
import { failureKindOf, jobWorthRetrying } from "./job-failure.js";
import { slugWithShortId, urlKey } from "./ingest.js";
import { runInJob } from "./job-scope.js";
import { errorFields, log, type Log, since } from "./log.js";
import { captureFailure } from "./monitoring.js";
import { currentOwnerId, type OwnerId, runAsOwner } from "./owner.js";
import { slugForUrlKey } from "./store/find-article.js";
import { fsStoreSession } from "./store/session.js";
import type { JobSettlement, JobTransition, StoreSession } from "./store/session.js";
import { openPgStoreSession } from "./store/pg-session.js";
import {
  contextPaths,
  DEFAULT_INGEST_STEPS,
  FORCE_ONLY_WHEN_NAMED,
  type PipelineStep,
  sharesArticleCache,
  STEP_ORDER,
  STEPS,
  stepIsDone,
  type StepContext,
  stepLabel,
  urlForSlug,
} from "./pipeline.js";
import { INTERRUPTED, type FailureKind } from "./messages.js";
import type { Job, JobStep, JobUpload, StepName } from "./types.js";

/* `JobStatus` and `StepStatus` were on this line too and nothing imported them
   from either module — they are only ever used structurally, inside types.ts,
   as the type of `Job.status` and `JobStep.status`. */
export type { Job, JobStep, StepName } from "./types.js";

/**
 * **Where the job records live is no longer this file's business.**
 *
 * `data/_jobs/`, the in-memory `Map`, the serialised writes, the tombstones and
 * the load-from-disk all moved to src/store/jobs-fs.ts, unchanged, behind
 * `JobStore`. Selected here rather than in src/store/index.ts for the same
 * reason src/upload-records.ts selects its own: that file is the *reader's*
 * store and it imports fs.ts, which imports src/pipeline.ts, which this file
 * imports — asking from there would be an import cycle, and `npm run check`
 * gates on cycles.
 */
const store: JobStore = STORE === "postgres" ? pgJobStore : fsJobStore;

/**
 * Abort handles for steps **this process** is running, so they can be stopped.
 *
 * The one piece of queue state that is still a `Map` and has to be. An
 * `AbortController` cannot be shared between instances — a signal is a thing a
 * running function is listening to, and a second instance has no function to
 * interrupt. So Stop is two halves: `requestCancel` writes `cancelling` where
 * everybody can see it, and this aborts the step if the step happens to be
 * here. An instance that is not running it reads the flag at its next step
 * boundary instead, which is a moment later and correct.
 */
const aborts = new Map<string, AbortController>();

/**
 * How long a claim is good for, and how long before that the claimant stops.
 *
 * The claimant sets **its own timer** at `LEASE_MS - DEADLINE_MARGIN_MS` and
 * aborts the step itself, because on a laptop a model call can run as long as
 * it likes.
 *
 * ## The invariant, and why raising one of these alone makes things worse
 *
 *     LEASE_MS - DEADLINE_MARGIN_MS  <  the platform's kill (vercel.json maxDuration)
 *
 * The self-abort has to fire **before** the host kills the function, or the
 * lease stops meaning *the process is gone* — which is the one reading
 * `settleExpired` is safe to act on. Raise `LEASE_MS` on its own and the deadline
 * moves past the kill, so it never fires: instead of a step that ends itself
 * cleanly as interrupted, the function dies mid-step with a live lease and the
 * job sits `running` until a later advance sweeps it. That is strictly worse
 * than what it replaced, and it deploys green — it only shows up on a long
 * step. `tests/jobs-lease-budget.test.ts` pins the invariant rather than the
 * numbers, so the next person to raise one cannot forget the other.
 *
 * **Why 420s.** Measured per-article step totals from `data/_ai-calls.jsonl`:
 * `hierarchy` 324.0s over three calls, `summarise` 240.3s over ten. Both exceed the
 * 220s deadline these constants used to give, so a long step could not complete
 * through the job path **on any machine** — it only ever succeeded via the CLI,
 * which takes no lease. The deadline is bounded above too: the route loop must
 * reserve a whole deadline before starting a step, so too large a value refuses
 * the last short step of an article that would have fitted. Half the invocation
 * budget is the ceiling, and 400s is that.
 *
 * That ordering is the whole point and it is why there is no heartbeat. A lease
 * that can be renewed means an expired lease says *probably dead*; a lease
 * nothing renews, with the claimant guaranteed to have unwound before it lapses,
 * means an expired lease says *definitely over its own deadline*. Only the
 * second is safe to act on, and `noteProgress` deliberately does not touch it.
 */
/**
 * **760s is a symptom of ephemeral scratch, not a property of the job model.**
 *
 * It is this large only because one claim has to cover an entire job, and one
 * claim has to cover an entire job only because a handoff would land on a cold
 * instance with an empty `/tmp` and re-run everything. `advanceJobToCompletion`
 * releases "only on intentional handoff or terminal settlement" — the escape
 * valve is already in the shape; it is unusable today for that one reason.
 *
 * **When D3–D5 put artefacts in Postgres a handoff costs nothing, the claim can
 * shrink, and this number becomes wrong rather than merely conservative.** The
 * cost it carries meanwhile is a dead claimant unreclaimable for ~12.5 minutes
 * instead of ~7. Do not leave that lying around after its cause has gone.
 *
 * The arithmetic it has to satisfy, measured rather than assumed —
 * `tests/jobs-lease-budget.test.ts` pins it:
 *
 *     fetch ~10s + extract ~5s + blocks ~5s + hierarchy 320.4s + assets ≤180s ≈ 520s
 *     520s  <  740s self-abort  <  800s platform kill
 *
 * 420s was right for the one-step-per-request shape this replaces, where every
 * step got a fresh deadline. Under a claim that walks the whole job it is a
 * per-step constraint in a per-claim world: `hierarchy` alone at 320.4s would have
 * eaten four fifths of it, and the ordinary article would have aborted four
 * fifths of the way through the one step nobody can afford to repeat.
 */
export const LEASE_MS = 760_000;
export const DEADLINE_MARGIN_MS = 20_000;

/** What `SPIDERYARN_JOB_CONCURRENCY` is called, in one place so it cannot be misspelt twice. */
export const CONCURRENCY_ENV = "SPIDERYARN_JOB_CONCURRENCY";

/**
 * **How many jobs may run at once, anywhere.**
 *
 * > Ok, so let's run multiple jobs across articles. … Certainly having one job
 * > across all owners doesn't seem feasible. Can't we rely on Vercel and the LLM
 * > providers to scale?
 * >
 * > — Greg, 2026-08-30
 *
 * The answer was mostly yes: what stopped it was a **policy**, not a resource.
 * `jobs_only_one_running` was a unique index on the constant `(true)`, chosen
 * when this was one reader on one laptop and *"in exchange for nothing"*
 * (docs/project/ingest-queue.md). It is gone; this is what replaced it, counted
 * inside the `queue_state` lock — src/store/pg-jobs.ts § `claim`.
 *
 * **Three, asked and answered**, 2026-08-30: enough to ingest one article,
 * ingest a second, and answer a reader asking for a glossary, all at once. It
 * supersedes the "default to 2" recorded earlier the same day in
 * docs/plans/260830am-faster-ingest-and-concurrency.md, which was answering a narrower
 * question.
 *
 * **What the number is actually rationing is spend and provider rate limits**,
 * not CPU or connections — there is no spend cap anywhere in this repo, and the
 * label and summary fan-outs each multiply by N. It is not rationing
 * correctness: two jobs never run on one article, which is `jobs_active_slug`'s
 * job and not this one.
 *
 * Read at call time rather than frozen at import, so a test can move it and a
 * deployment can set it without a rebuild — the rule src/store/data-root.ts
 * states for the same reason. A value that is not a positive whole number is
 * **ignored rather than obeyed**: `SPIDERYARN_JOB_CONCURRENCY=0` would stop
 * every ingest in the account and read exactly like the queue being wedged.
 */
export const DEFAULT_JOB_CONCURRENCY = 3;

export function jobConcurrency(): number {
  const asked = Number(process.env[CONCURRENCY_ENV]);
  return Number.isInteger(asked) && asked > 0 ? asked : DEFAULT_JOB_CONCURRENCY;
}

/**
 * **How long one step is allowed to be**, so the claimant can tell whether the
 * next one fits before it starts it.
 *
 * One claim now walks a whole job (`advanceJobWith`), so the deadline bounds the
 * **claim** and not the step. Without this table the last thing a long ingest
 * does is start a step it cannot finish: the self-abort fires half way through,
 * the job ends `error` with `INTERRUPTED`'s wording, and on Vercel the scratch
 * directory that held everything the earlier steps produced goes with the
 * invocation. Checked first, the same job hands the claim back **intact** and
 * stays `queued`, and the next request continues.
 *
 * Every number is either measured or a generous guess and **says which**, which
 * is the discipline `tests/jobs-lease-budget.test.ts` learned the hard way:
 * `summarise` was quoted at 240.3s for a day before anybody noticed it was ten
 * overlapping calls summed, and `assets` carried a 300s figure derived from
 * policy constants until the step was run for the first time and took 7.1s. A
 * reader who cannot tell a measurement from a guess will reason about the
 * guesses as though they were facts.
 *
 * **Wrong in the pessimistic direction is cheap and wrong in the optimistic
 * direction is not.** Too large a number hands the claim back a step early —
 * one more request, and on a warm instance the steps already done are skipped
 * for free. Too small a number is the mid-step kill this table exists to
 * prevent. So round up.
 */
export const STEP_BUDGET_MS: Record<StepName, number> = {
  /* GUESS, generous. Network only, no model call. Never measured. */
  fetch: 10_000,
  /* GUESS, generous. Readability over HTML; a long PDF is slower and this
     number does not cover it. */
  extract: 5_000,
  /* GUESS, generous. Deterministic, no model call. */
  blocks: 5_000,
  /* MEASURED 2026-08-30, the worst in data/_ai-calls.jsonl: one call, so its
     sum and its wall clock agree and no grouping argument applies. This is the
     number the whole budget turns on, and `LEASE_MS` is sized around it. */
  hierarchy: 320_400,
  /* Its own wall-clock cap rather than a measurement — `ASSETS_BUDGET_MS` in
     src/collect-assets.ts, which the step enforces on itself. Measured cost on
     the corpus's worst article (10 images) is 7.1s; the cap is there for a
     publisher that hangs. Not imported, deliberately: this file would then
     depend on a pipeline stage's module for a constant it only compares
     against, and the two are allowed to differ — this one has to be the
     *claimant's* worst case, which is the cap plus whatever unwinding costs. */
  assets: 185_000,
  /* MEASURED 2026-08-29, one call: 10.4s on the bigger-brains article. Rounded
     up hard because it is a model call and one measurement is one sample. */
  arc: 60_000,
  /* GUESS. A model call over the whole article, in the same family as `arc`. */
  tweets: 90_000,
  /* GUESS. Fans out over the article; no wall-clock measurement recorded. */
  glossary: 120_000,
  /* GUESS, in `glossary`'s family: one call over the whole article, at the same
     effort, with a shorter answer than the glossary's because a quote is copied
     rather than composed. Never measured on its own. */
  quotes: 120_000,
  /* GUESS, in `glossary`'s family and never measured on its own. */
  ideas: 120_000,
  /* **MEASURED** 2026-08-31, four runs of the stage on the test article, read
     from `data/_ai-calls.jsonl` as `finishedAt − startedAt`: 78.7s, 95.6s,
     124.9s, 100.8s. Each run is one call under its own `runId`, so the sum and
     the wall clock are the same number and this table's summing trap does not
     apply — the artefact's own `elapsedMs` agrees with the fourth to 3ms.
     **Rounded up to twice the worst, because four samples on ONE article is one
     article.** That article is at the dense end of what this mode will see —
     4,000 words narrating three months three times over — but it is also the
     only piece this has ever run on, and the answer budget is 20,000 tokens, so
     a longer piece has room to be slower than anything measured here. */
  timeline: 240_000,
  /* **MEASURED**, twelve stage-1 generations on 2026-08-31, read from
     `data/_ai-calls.jsonl` (`job: "quiz"`): 35.1s to 62.8s, one call each under
     its own `runId`, so the summing trap in this table's header does not apply.
     Rounded to twice the worst and then some, for `timeline`'s reason: twelve
     samples on ONE article (data/noema-mythology-of-conscious-ai, 4,000 words)
     is one article, the answer budget here is 10,000 tokens, and the cost of
     being under is a mid-step kill rather than a slow step. */
  quiz: 150_000,
  /* **MEASURED**, over seven draws of five articles on 2026-08-30: 121–194
     seconds, one model call each, the longest being the constitution at 194.4s
     with the shape-claims section added to the prompt. Rounded up hard, because
     this is the slowest single call in the app and the cost of being under is a
     mid-step kill. Grouped by `runId` from `data/_ai-calls.jsonl` and read as
     `max(finishedAt) − min(startedAt)` — summing durations would have said 408s
     for a batch of three separate articles, which is the trap this table's
     header warns about from the other direction. */
  sketch: 240_000,
};

/**
 * The reader stopped it — the same four fields wherever that is decided.
 *
 * Four assignments written out at four call sites is four chances to forget
 * `delete job.cancelling`, which is the one that matters: leave it set and the
 * card's Stop button stays disabled on a job that has already stopped.
 */
function markCancelled(job: Job, message?: string): void {
  job.status = "cancelled";
  if (message !== undefined) job.error = message;
  job.finishedAt = new Date().toISOString();
  delete job.cancelling;
}

/**
 * The steps a job will run: de-duplicated, and in pipeline order whatever order
 * they arrived in.
 *
 * Sorting matters more than it looks. The steps are a chain — each consumes the
 * artefact the one before it wrote — so `["arc", "hierarchy"]` run as asked would
 * build the arc from the previous tree and then replace that tree. Both steps
 * would report success and the arc would describe an article nobody is reading.
 */
export function orderSteps(names: StepName[]): StepName[] {
  return [...new Set(names)].sort((a, b) => STEP_ORDER.indexOf(a) - STEP_ORDER.indexOf(b));
}

/**
 * Forcing a step forces every step after it.
 *
 * **This is the correction that makes "refresh from source" mean anything.**
 * A refresh asks for `fetch` and `extract` to run again — but the three stages
 * after them all find their artefacts still on disk from last time, skip
 * themselves, and report a row of ticks. The result is a fresh article under
 * last week's tree and last week's arc: every gist describing paragraphs that
 * have moved, and nothing anywhere saying so. A textbook
 * [silent success](docs/reusable/silent-success.md) — the pipeline reports
 * success while the reading view quietly shows the wrong thing.
 *
 * The pipeline is a chain, so invalidating a step invalidates everything
 * downstream of it by definition. Anything else is asking each caller to
 * remember a rule the pipeline already knows.
 *
 * **Except that it is not entirely a chain any more.** `tweets` hangs off the
 * blocks and the tree rather than continuing from the arc, and nothing consumes
 * what it writes, so its position in `STEP_ORDER` says nothing about whether
 * forcing the arc should cost another model call. `FORCE_ONLY_WHEN_NAMED` in
 * src/pipeline.ts holds the steps position cannot speak for, and that note is
 * the one to read: taking a step out of the cascade is only safe when the step
 * can tell for itself whether it is current, which is why `tweets` is in there
 * and `arc` is not.
 */
export function cascadeForce(steps: StepName[], forced: Set<StepName>): Set<StepName> {
  // Only ever names from `steps`. A force naming a step this job is not running
  // is not an error — "refresh" sends the same two names whatever the job — but
  // it must not end up in the set, where it would read as a step that was
  // forced and then somehow never ran.
  const first = steps.findIndex((name) => forced.has(name));
  if (first === -1) return new Set();
  return new Set(
    // Named explicitly, or swept in by position — and the second only applies to
    // steps the cascade is allowed to speak for.
    steps.slice(first).filter((name) => forced.has(name) || !FORCE_ONLY_WHEN_NAMED.has(name)),
  );
}

/* ------------------------------------------------------------------ running -- */

/**
 * Say what kind of failure stopped this job, or say nothing.
 *
 * What kind of failure it was is what decides whether the card offers Retry —
 * `jobWorthRetrying` in src/job-failure.ts, and
 * docs/postmortems/260826a-toc-max-tokens.md for the failure that started it.
 *
 * **Deleted rather than left alone when there is no kind**, so the field always
 * describes *this* failure. A retry is a new job today, so nothing can carry a
 * kind over — but nothing in the shape of a `Job` promises that, and a stale
 * kind would hide a button rather than merely be untidy.
 */
function recordFailureKind(job: Job, kind: FailureKind | undefined): void {
  if (kind) job.failureKind = kind;
  else delete job.failureKind;
}

function newStep(name: StepName, force: boolean, upload: boolean): JobStep {
  return {
    name,
    label: stepLabel(name, upload),
    status: "pending",
    ...(force ? { force: true } : {}),
  };
}

/**
 * Should this step run even though its artefact is already on disk?
 *
 * `force` is a **request**, and a request is spent once it has been honoured.
 * Inside `runJob` that distinction never comes up — a job runs its steps once,
 * top to bottom, and every step reaches the runner at `pending`. It comes up
 * the moment `advanceJob` runs one step per request: the second call would read
 * the same `force: true` on a step the first call had just re-run, force it
 * again, and keep forcing it for ever. A refresh would never finish and would
 * bill a model call a minute for as long as a tab was open.
 *
 * **This is the one thing advance has to remember rather than derive**, and it
 * is worth naming why, because the rule everywhere else is the opposite (see
 * `advanceJob`). "Has this step's output been rebuilt since the reader asked
 * for it to be" is not a question the artefacts can answer — a forced `hierarchy`
 * writes a `tree.json` that looks exactly like the one it replaced. The job
 * record is the only account of it there is.
 */
function stillForced(step: JobStep): boolean {
  return step.force === true && step.status !== "done";
}

/** What one step of a job did. */
type StepOutcome = "skipped" | "ran" | "cancelled" | "failed";

/**
 * Run — or skip — exactly one step, recording all of it on the job.
 *
 * The single implementation of "do this step", shared by the two things that
 * drive a job: `runJob`, which loops it until the job ends, and `advanceJob`,
 * which calls it once per HTTP request. Two copies of this would be two places
 * to keep the marker discipline, the cancel bookkeeping and the failure kinds
 * in step, and they would drift on the first change to any of them.
 *
 * **Never throws — with one exception, and it is not a step failure.** A failure
 * is an outcome, recorded on the job and on the step, because both callers have
 * to tell the same story about it. The exception is `StaleAttemptError` out of
 * `note`: that does not mean the step went wrong, it means *this claimant no
 * longer owns this job*, and carrying on would spend a model call whose result
 * nothing will accept. It propagates, and `advanceJob` turns it into `busy`.
 *
 * **The one job write this makes is the step's own transition**, and it makes it
 * through `session.commit` so that the artefacts, the step's completion and the
 * job's move are one act — the thing D1b turns into one transaction. Everything
 * else about the job is mutated in memory and committed by the caller: `note` is
 * called at the two moments a reader would notice, a skip and a step starting,
 * and the endings that have no product go through `session.settleJob`.
 *
 * `decide` is the caller's, and it is called **immediately before** the commit
 * rather than after the step returns. That is the ordering the atomic boundary
 * needs: the job transition has to be known while there is still a transaction
 * to put it in. It sees this step already marked `done` in memory, and the title
 * already on the job, because both are inputs to what the transition says.
 */
async function runStep(
  job: Job,
  step: JobStep,
  controller: AbortController,
  jlog: Log,
  /* The caller's progress write. It answers with the job row as it now stands —
     which is how the walk notices a Stop pressed on another instance — but that
     is the caller's business and nothing here reads it. */
  note: () => Promise<unknown>,
  session: StoreSession,
  registry: StepRegistry,
  decide: () => JobTransition,
): Promise<{ outcome: StepOutcome; settlement?: JobSettlement }> {
  const { dir, htmlFile } = contextPaths(job.slug);

  const ctx: StepContext = {
    slug: job.slug,
    ...(job.url ? { url: job.url } : {}),
    ...(job.upload ? { upload: job.upload } : {}),
    dir,
    htmlFile,
    // In memory only. Persisting at this rate would be two writes a second
    // per running job, to record something nobody reads afterwards.
    report: (detail: string) => {
      step.detail = detail;
    },
    signal: controller.signal,
    /* Only pay to cache the article if something still to come in *this job*
       can read it. `job.steps` is the whole plan, so the steps after this one
       are the ones that could — see `sharesArticleCache`, and
       docs/project/prompt-caching.md for why the answer is usually no. */
    cacheArticle: sharesArticleCache(
      step.name,
      job.steps.slice(job.steps.indexOf(step) + 1).map((s) => s.name),
    ),
    ...(job.profile !== undefined && { profile: job.profile }),
  };

  /* `session.reads`, not the store directly. The preflight and the run phase
     have to ask the same store, or a step decides whether to skip by looking at
     one place and does its work against another — which under Postgres means
     files on disk answering for rows in a draft. */
  if (!stillForced(step) && (await stepIsDone(registry[step.name], ctx, session.reads))) {
    /* **A step this job already ran keeps saying so.** `runJob` never meets
       this case — it visits each step once, at `pending` — but `advanceJob`
       walks the whole list on every call, so without the guard the second
       request would relabel the first request's work `skipped` and replace
       whatever it reported ("12 KB", the article's title) with "already done".
       The reader would watch the card lose its own progress, one row per step.

       The `stepIsDone` check still runs and still decides. This only chooses
       the word for a yes. */
    if (step.status !== "done") {
      step.status = "skipped";
      step.detail = "already done";
    }
    // `debug`, not `info`. Most steps of most jobs skip — a re-run of one
    // stage skips the four before it — so at `info` this would be the bulk of
    // the log and the lines that matter would be sitting in it.
    jlog.debug({ step: step.name }, `step skipped: ${step.name} — ${job.slug}`);
    await note();
    return { outcome: "skipped" };
  }

  /* Timed here rather than read back off `startedAt`/`finishedAt`. Those are
     ISO strings because they go to the browser, and a duration you have to
     subtract two strings to get is a duration nobody charts. */
  const stepStarted = Date.now();
  step.status = "running";
  step.startedAt = new Date().toISOString();
  delete step.error;
  jlog.debug({ step: step.name }, `step starting: ${step.name} — ${job.slug}`);
  await note();

  /* Filled by `collectSpend`'s `onDone` below, which fires on both paths — so
     this is readable from the `catch` as well as from the success path. */
  let spend: SpendReport = emptySpend();

  try {
    /* Bracketing the run, not decorating it. A step that dies between two of
       its own writes leaves artefacts that all exist and all parse and
       describe two different generations, and nothing about the files can
       say so — so the marker is what says so. It is cleared only on the
       success path below, which means a throw, a cancel or a kill all leave
       the step honestly not-done. See `beginStep` in
       src/store/artifacts.ts. */
    const attempt = await session.beginStep(job.slug, step.name);
    /* **The one place that knows a step is over.** A step is not a model call
       — summarise batches per parent, labels fans out — so no stage can report
       its own total, and threading one up would be a return-type change on
       seven of them. `collectSpend` is ambient (src/ai-spend.ts), so the stages
       say nothing and this still gets the whole bill.

       What it is told about the work is below rather than here. */
    const { result: product } = await collectSpend(() => registry[step.name].run(ctx, session.reads), {
      /* **Everything the ledger cannot work out for itself.** A gateway sees a
         model id and a body; this is the frame that knows whose article it is,
         which job, and which step — so it says so once and every call inside
         inherits it. `job.ownerId` rather than `currentOwnerId()`, because a job
         outlives the request that made it and carries its owner deliberately
         (src/owner.ts § `runAsOwner`). */
      attribution: {
        scopeKind: "job_step",
        ownerId: job.ownerId,
        articleSlug: job.slug,
        jobId: job.id,
        stepName: step.name,
      },
      /* An arrow rather than `costStore.record`, because the filesystem adapter's
         methods call each other through `this`. */
      sink: (row) => costStore.record(row),
      /* `onDone` rather than the resolved value, because it fires on the failure
         path too: a step that threw had usually already paid for the call that
         threw, and the retry after it pays again. */
      onDone: (report) => {
        spend = report;
      },
    });
    step.detail = product.detail;
    /* **Marked done before the commit, not after, and that is the ordering the
       atomic boundary needs.** `decide` below asks whether this was the job's
       last step, and it cannot answer that about a step still marked `running`.
       The title is the same: it is a field of the transition, so it has to be on
       the job before the transition is worked out. If the commit refuses, the
       catch below puts both back — `step.status = "error"` — and the job ends as
       a failure, which is what it always did.

       The title only exists once extraction has run, and the moment it does is
       the moment the progress card can stop calling the article by its slug. */
    step.status = "done";
    step.finishedAt = new Date().toISOString();
    if (step.name === "extract") job.title = product.detail;

    /* **The whole of what used to be four calls, three here and one in the
       caller.** `commit` validates the product against `produces` before it
       writes anything, writes it if the step has been converted, runs the
       postcondition, clears the marker, and moves the job on — and under D1b's
       Postgres session those happen in one transaction.

       **Still before the abort check, not after.** A cancel here is about the
       job, not about this step: `run` returned and its postcondition passed, so
       the work is real and paid for. Clearing the marker after the throw would
       leave a completed step looking interrupted, and the Retry that follows a
       cancel would buy the same model call twice. */
    const transition = decide();
    /* **The settlement that happened, not the one that was asked for.** A
       release resolves to *cancelled* when a Stop landed while the step ran, and
       reading the outcome off `transition` would have this call report a job
       that is still working and `/advance` answer `done: false` about a job that
       is over. GPT Sol, 2026-08-29; see `JobSettlement` in
       src/store/session.ts. */
    const settlement = await session.commit(ctx, registry[step.name], attempt, product, transition);
    /* **`step.detail` is deliberately not logged**, though it is the obvious
       thing to put here and the first version did.

       `detail` is whatever a step chose to return, so what it holds is a
       different kind of thing for each one — and for `extract` it is the
       article's title, which is article content on a line that goes out at
       production `info`. The generic field is the problem rather than the
       title: a step added later can put anything in it, and nothing in this
       file would notice.

       Nothing diagnostic is lost. src/pipeline.ts logs each step's real
       numbers — tokens, model, block counts — under the `pipeline`
       component, where the fields are named and auditable. Found by
       GPT/Codex reviewing this change. */
    jlog.info(
      { step: step.name, ms: since(stepStarted), ...spendFields(spend) },
      `step done: ${step.name} — ${job.slug}`,
    );
    return { outcome: "ran", settlement };
  } catch (err) {
    /* **The one thing that is not a step failure, and it has to leave first.**
       `commit` now carries the job's own release or finish, and those are fenced:
       a claim that moved on while we were inside the step throws
       `StaleAttemptError`. Recording that as an error on the step would be this
       claimant writing a verdict on a job it no longer owns — and the write would
       be refused anyway. It propagates, and `advanceJob` turns it into `busy`,
       exactly as it always did when `note` threw it. */
    if (err instanceof StaleAttemptError) throw err;
    const message = (err as Error).message;
    /* A cancel unwinds through here too — the `throw new Error("Cancelled")`
       above, and any step that honours the signal by throwing. The reader
       pressing Stop is not a fault of the step's, and giving it an `error`
       line would make Stop the most common error in the log. The job's own
       `warn` below is the record of it.

       The message string says which step and which article and stops there:
       an error's own text can carry the URL, or whatever a remote server put
       in a body, and rule 3 in src/log.ts is that `redact` cannot reach
       anything inside `msg`. The full error goes in the object, where it can. */
    if (controller.signal.aborted) {
      jlog.debug(
        { step: step.name, ms: since(stepStarted), ...spendFields(spend) },
        `step cancelled: ${step.name} — ${job.slug}`,
      );
    } else {
      /* **The cost goes on the failure line too.** A step that failed has
         usually already paid for the call that failed, and the reader's Retry
         pays for it again — so a bill that only counts successes reads low
         exactly where somebody is trying to find out why it is high. */
      /* Reported, and only on this branch. A cancel unwinds through the same
         catch and is not a fault — the `if` above is what separates them, and
         it is the same test that keeps Stop out of the error log. An ingest
         step failing is the "happened while nobody was watching" case this
         whole exercise is for: the reader sees a red card, and without this
         nobody else ever hears about it. */
      captureFailure(err, { step: step.name, slug: job.slug, jobId: job.id });
      jlog.error(
        { ...errorFields(err), step: step.name, ms: since(stepStarted), ...spendFields(spend) },
        `step failed: ${step.name} — ${job.slug}`,
      );
    }
    step.status = "error";
    step.error = message;
    step.finishedAt = new Date().toISOString();
    if (controller.signal.aborted) {
      markCancelled(job, message);
      /* Not on a cancel: the reader stopped it, and a stopped job is always
         worth starting again. */
      recordFailureKind(job, undefined);
      return { outcome: "cancelled" };
    }
    job.status = "error";
    job.error = message;
    recordFailureKind(job, failureKindOf(err));
    job.finishedAt = new Date().toISOString();
    delete job.cancelling;
    return { outcome: "failed" };
  }
}

/**
 * The job is over, however it ended: write it once, fenced, and tidy up.
 *
 * **One write per ending, not three.** `runStep` used to persist the failure
 * and then the caller persisted the job around it; with a fenced store that
 * would be two statements either of which can be refused, and a job left
 * half-ended. So `runStep` records the story in memory and this commits it.
 *
 * Retention runs on **this job's owner** rather than sweeping everybody, which
 * is both cheaper and more correct: the old version walked every job in the
 * process's memory, and a store cannot enumerate owners without reading every
 * row it has.
 */
/**
 * **What the whole ingest cost**, for the line that says the job is over.
 *
 * Asked of the ledger rather than accumulated on the job, and that is the
 * decision worth writing down. A job is not one process run: `advanceJob` runs
 * some steps and returns, and the browser calls it again, so there is no frame
 * that spans a job and no total that could simply be carried. The two options
 * were a running figure on the job row — which is a second ledger, kept in both
 * job stores, free to diverge after an ambiguous write — or a query over the
 * rows, which is what the rows are for. GPT Sol's call, 2026-08-28.
 *
 * **It reports zero calls, never a zero cost.** A ledger that cannot be read is
 * a different thing from a job that spent nothing, and `aiCostStatus` is what
 * separates them: without it, a database that was down all afternoon reports
 * every ingest as free.
 */
async function jobSpend(job: Job, jlog: Log): Promise<Record<string, unknown>> {
  let read: Awaited<ReturnType<typeof costStore.forJob>>;
  try {
    read = await costStore.forJob(job.id);
  } catch (err) {
    jlog.warn({ ...errorFields(err) }, "could not read what this job cost");
    return { aiCostStatus: "unavailable" };
  }
  const { rows, unreadable } = read;
  if (rows.length === 0) {
    /* An unreadable ledger and a job that spent nothing must not look the same,
       so a damaged ledger says so even when it has no rows to show for this
       job. */
    return unreadable > 0 ? { aiCostStatus: "partial", aiUnreadable: unreadable } : {};
  }
  const { credits, upstream, unpriced } = totalRows(rows);
  return {
    aiCalls: rows.length,
    aiCostNanos: credits + upstream,
    aiCost: formatNanos(credits + upstream),
    /* Only when it is not zero, so an ordinary line stays short and an unusual
       one says why. Each of these is a claim that the number above is wrong.  */
    ...(upstream > 0 ? { aiUpstreamNanos: upstream } : {}),
    ...(unpriced > 0 ? { aiUnpriced: unpriced } : {}),
    /* **The total is short and this is the only place that can say so.** A
       damaged line is a call that happened and cannot be read; a partial total
       presented as a whole one is the failure this ledger exists to prevent.
       GPT Sol raised it — the first version dropped `unreadable` on the floor
       between the store and this line. */
    ...(unreadable > 0 ? { aiCostStatus: "partial", aiUnreadable: unreadable } : {}),
  };
}

async function endJob(
  job: Job,
  attempt: string,
  ending: JobEnding,
  jlog: Log,
  startedMs: number,
  session: StoreSession,
): Promise<Job> {
  /* **Through the session, like every other terminal job write in this file.**
     The endings that reach here have no product to commit — a step that failed,
     a step the reader cancelled, and a claim where every step skipped — so they
     take the session's other door rather than the store directly. One seam for
     D1b to make transactional, rather than one seam and three exceptions. */
  const settled = await session.settleJob({ kind: "end", jobId: job.id, attempt, ending });
  await noteEnded(job, ending, jlog, startedMs);
  /* `settleJob` takes only an ending, so the settlement is always `ended` —
     but the union carries `kept` for the between-steps case and the compiler
     cannot see that this door never passes one. Narrowed rather than asserted,
     so that a future `keep` reaching here is a visible bug and not a cast. */
  if (settled.kind === "kept") throw new Error(`${job.id}: an ending settled as "kept"`);
  return settled.job;
}

/**
 * The log line and the retention sweep that follow **any** ending.
 *
 * Split out of `endJob` because the successful last step ends the job from
 * inside `session.commit` — the transition is part of the commit — and still has
 * to say so in the log and still has to trim. Two callers, one account of what
 * an ending sounds like.
 */
async function noteEnded(
  job: Job,
  ending: JobEnding,
  jlog: Log,
  startedMs: number,
): Promise<void> {
  const line = { ms: since(startedMs), status: ending.status, ...(await jobSpend(job, jlog)) };
  /* `warn` for a cancel, because the reader chose it and it is neither a fault
     nor a clean finish. An `error` outcome stays at `info` — the step that
     failed has already logged the stack at `error`, and repeating it would
     double every failure in an alert count. */
  if (ending.status === "cancelled") jlog.warn(line, `job cancelled: ${job.slug}`);
  else jlog.info(line, `job ${ending.status}: ${job.slug}`);
  /* **After the return value is decided, and it cannot change it.** The finish
     has committed; retention is housekeeping. Letting it throw made a job that
     really had ended answer 500 to the request that ended it — the browser then
     re-polls, finds the job done, and the only trace is a 500 in the log for a
     thing that worked. Said out loud rather than swallowed, because a retention
     sweep that has stopped working is worth knowing about. */
  await store.trimFinished(job.ownerId, KEEP_FINISHED).catch((err: Error) => {
    jlog.error({ ...errorFields(err), owner: job.ownerId }, "could not trim finished jobs");
  });
}

/**
 * The ending for a step the **claimant** stopped, not the reader.
 *
 * An error rather than a cancel, because the reader did not ask for it and the
 * card has to offer Retry; `INTERRUPTED`'s wording rather than whatever the
 * abort happened to carry, because "Cancelled" in front of somebody who never
 * pressed Stop is a lie about their own actions.
 */
function interruptedEnding(job: Job): JobEnding {
  return {
    status: "error",
    steps: job.steps,
    error: INTERRUPTED.message,
    failureKind: INTERRUPTED.kind,
    ...(job.title !== undefined && { title: job.title }),
  };
}

/** What `runStep` left on the job, as the ending the store wants. */
function endingFrom(job: Job, status: JobEnding["status"]): JobEnding {
  return {
    status,
    steps: job.steps,
    ...(job.error !== undefined && { error: job.error }),
    ...(job.failureKind !== undefined && { failureKind: job.failureKind }),
    ...(job.title !== undefined && { title: job.title }),
  };
}

/**
 * Keep advancing one job until there is nothing left to do.
 *
 * **The replacement for p-queue, and for `runJob`.** Both are gone, and so is
 * the library: concurrency 1 is no longer a promise a package makes, it is
 * `jobs_only_one_running` — a partial unique index the database enforces across
 * every instance, where p-queue could only speak for this one.
 *
 * The first draft of this exited on `busy`, and
 * [GPT Sol](../docs/plans/260827h-durable-queue-and-uploads-review-sol.md) was right
 * that a loop which exits on `busy` is not a pump: job A takes the single slot,
 * job B's loop is told `busy` once and stops, and nothing ever restarts it.
 * What "close the tab and it still finishes" means on a laptop is that
 * something keeps asking. So `busy` **backs off and asks again**.
 *
 * **Not started on Vercel.** A pump cannot outlive the invocation that made it,
 * so all it could produce there is a `running` row whose claimant is already
 * frozen. The browser is the only driver in production, which is the whole
 * reason the advance endpoint exists.
 *
 * `runAsOwner`, because a job outlives the request that made it and an
 * AsyncLocalStorage context is captured when an async resource is made. Without
 * it the pump runs in whoever's continuation happened to start it — measured,
 * not guessed, when this was a p-queue callback: with concurrency 1, the whole
 * of Bob's job ran in Alice's context. src/owner.ts § `runAsOwner`.
 */
const PUMP_BACKOFF_MS = 250;
const PUMP_BACKOFF_MAX_MS = 5_000;

function pump(id: string, owner: OwnerId): void {
  if (process.env.VERCEL) return;
  void runAsOwner(owner, async () => {
    let backoff = PUMP_BACKOFF_MS;
    for (;;) {
      let advanced: Advanced | null;
      try {
        advanced = await advanceJob(id);
      } catch (err) {
        /* `advanceJob` records its own step failures, so anything reaching here
           is a bug in it — and must be visible rather than swallowed. Visible
           to the *reader* is not enough: the card turning red says the message
           and loses the stack, which is the only part that says where the bug
           is, and this is the one path where nobody can guess it from the step
           that failed, because no step failed. */
        log("jobs").error({ ...errorFields(err), jobId: id }, "the job pump threw");
        captureFailure(err, { jobId: id, phase: "pump" });
        return;
      }
      if (!advanced || advanced.done) return;
      if (!advanced.busy) {
        backoff = PUMP_BACKOFF_MS;
        continue;
      }
      /* Somebody else has it — another instance, another tab, or the single
         running slot is taken by a different job. Either way the answer is the
         same: wait and ask again. Doubling to a ceiling rather than a fixed
         wait, because the common case is a step that takes a second and the
         expensive case is a model call that takes two minutes. */
      await new Promise((r) => setTimeout(r, backoff));
      backoff = Math.min(backoff * 2, PUMP_BACKOFF_MAX_MS);
    }
  });
}

/* ------------------------------------------------------------- advancing --

   The other way a job moves: one step per HTTP request, driven by whoever is
   watching it. Designed in docs/plans/260826q-job-queue-rethink.md § Decided, and it is
   what makes docs/plans/260826s-ingest-resume.md work.
   -------------------------------------------------------------------------- */

/** What one `POST /api/jobs/:id/advance` did. */
export interface Advanced {
  /** The job as it now stands — the same record `GET /api/jobs/:id` returns. */
  job: Job;
  /** The step this call ran, if it ran one. Null when it only skipped, or was turned away. */
  ran: StepName | null;
  /** Somebody else is running a step of this job. Nothing was done; ask again shortly. */
  busy: boolean;
  /** There is nothing left to do. The caller's loop stops on this and only this. */
  done: boolean;
}

/**
 * Run **exactly one** not-yet-done step of a job, and say what happened.
 *
 * This is the browser-driven half of the queue, and the whole of the design is
 * in three properties:
 *
 * **The caller cannot name a step.** It says *advance this job* and the server
 * works out which step that means. So a client cannot skip a stage, re-order
 * two, or run one twice — the three things that produce an article whose tree
 * describes a previous version of its own text, with a row of green ticks over
 * it.
 *
 * **What is done is derived, not remembered.** Every step is asked
 * `stepIsDone`, which reads the *artefacts* (src/pipeline.ts): does this step's
 * output exist, was it made from this article, by this prompt, by this model,
 * and did the run that wrote it finish. So a job resumed a week later starts
 * wherever the files say, and there is no second account of progress that can
 * drift from the first. `stillForced` above is the one deliberate exception and
 * says why.
 *
 * **It is idempotent.** On a finished job it does nothing and reports `done`.
 * Called twice at once, the second call is turned away with `busy` rather than
 * starting a second runner over the same files.
 *
 * ## How two callers keep out of each other's way
 *
 * They do not, and they do not need to. There is **one claim**, and whoever
 * takes it runs; everybody else is told `busy` and asks again. The pump is not
 * privileged — it is this same function in a loop.
 *
 * That replaced a rule that had to be agreed rather than enforced: *advance
 * refuses while the in-process queue owns the job*, checked by asking whether
 * this process held an `AbortController` for it. Sound inside one process, and
 * meaningless the moment there are two — instance B has no entry for a job
 * instance A is halfway through, so it would cheerfully start a second runner
 * over the same article and neither would know.
 *
 * ## What this deliberately does not do
 *
 * **Take a job away from a claimant whose lease has run out.** The job is
 * failed, with a sentence saying it was interrupted, and Retry is the reader's
 * to press. Guessing that an owner is dead is how two runners end up writing
 * one article — the fault docs/plans/260826q-job-queue-rethink.md names in pgmq — and
 * the guess is only safe once every durable write is inside the fenced
 * transaction, which is docs/plans/260827j-transactional-stage-runner.md and is not
 * built.
 *
 * What makes an expired lease *mean* something in the meantime is the
 * claimant's own deadline: see `LEASE_MS`. It aborts itself first, so a lapsed
 * lease says "the process is gone" rather than "the process is slow".
 *
 * @returns null if there is no such job, so the route can 404.
 */
export async function advanceJob(id: string): Promise<Advanced | null> {
  return advanceJobWith(id, PRODUCTION);
}

/**
 * The two things a claim runs with, and the **only** two a caller may replace.
 *
 * ## Why this exists at all, since production never passes anything
 *
 * Three of the tests this stage owes cannot honestly be written without it. The
 * Postgres session's preflight-over-misleading-files claim, its all-skipped
 * path, and its handling of a release that resolves to cancellation are all
 * claims about **the coordinator driving that session** — and production is
 * hardwired to `fsStoreSession` and will stay that way until D2. A test that
 * called a session method directly would be proving something else: the whole
 * point of the first of those is that `stepIsDone` goes through `session.reads`
 * and not through a store the caller happens to have. GPT Sol, 2026-08-29,
 * docs/plans/260827aa-delete-the-importer-d1b-design-sol.md finding 4.
 *
 * ## Narrow means these two and no more
 *
 * Not an injection framework and not a seam for anything else in this file:
 * `store`, `costStore`, the abort map and the lease are all still module-level
 * and still not replaceable. A session and a step registry are exactly what a
 * different *storage backend* changes, which is why they are the two.
 *
 * **Production behaviour does not change.** `PRODUCTION` builds the same session
 * from the same filesystem store `advanceJob` built inline before, and nothing
 * selects Postgres — src/jobs.ts still imports `fsArtifacts`.
 */
export interface AdvanceParts {
  /**
   * Built **once per successful claim**, which is the lifetime a claim has: a
   * Postgres draft reference embeds the attempt token, so one per job is stale
   * on the second request and one per step could not carry a draft at all.
   */
  readonly session: (job: Job, attempt: string) => Promise<StoreSession>;
  /** Which `PipelineStep` each name means, so a test can supply converted fakes. */
  readonly steps: StepRegistry;
  /**
   * How long this claim has, in milliseconds, before it must stop starting
   * steps. Defaults to `LEASE_MS`, which is what production passes.
   *
   * **A seam, for the same reason `steps` is one.** The walk hands the job back
   * when the deadline will not cover the next step, and that branch decides
   * whether a job stays resumable or is killed mid-step with a live lease — so
   * it is exactly the branch a test must be able to reach. Without this a test
   * would have to wait out a twelve-minute lease or stub the clock, and a
   * branch that expensive to reach is one nobody covers.
   */
  readonly leaseMs?: number;
}

/** The pipeline's own shape, named so `AdvanceParts` can say it once. */
export type StepRegistry = { [K in StepName]: PipelineStep<K> };

/**
 * The session one claim runs on, and **the one place a finished job publishes.**
 *
 * Two stores, one seam. Which one a claim gets is decided here and nowhere else,
 * on the live flag and nothing else — `SPIDERYARN_STORE` unset is a laptop and
 * gets the filesystem session it has always had; `postgres` gets a session over
 * this claim's own draft revision, whose `commit` is one transaction.
 *
 * ## The Postgres side
 *
 * `openPgStoreSession` opens — or reopens — the draft this claim writes into,
 * and returns a session that writes every step's product straight into it
 * (src/store/pg-session.ts). A `done` ending publishes that draft and finishes
 * the job in the same transaction, through whichever of the two doors the
 * ending arrives at: `commit`, when the last step ran, and `settleJob`, when
 * every step skipped.
 *
 * **This replaced a decorator on 2026-09-01, and the decorator is worth one
 * sentence because its absence is the whole of stage 3.** `publishingSession`
 * wrapped the filesystem session and, at the end of a `done` job, copied the
 * files the stages had written into a draft and published that. It existed
 * because the stages wrote their own files inside `run()` and returned nothing a
 * session could write, so `pgStoreSession` would have refused every one of them
 * by name (`LEGACY_UNCONVERTED_STEPS`, src/pipeline.ts). That list is empty:
 * every one of the thirteen steps returns its product, so the copy has nothing
 * left to do and the files it copied from are not written at all under Postgres.
 * docs/plans/260831b-finish-the-database-move.md § Stage 3 — the flip.
 *
 * **Async because opening the draft is a database call**, which is new: the
 * filesystem session needs nothing awaited to build, and this signature was
 * async for the interface's sake before it was async for a reason.
 *
 * ## The filesystem side, which is unchanged
 *
 * **Gated on the live store, and nothing else.** With `SPIDERYARN_STORE` unset
 * the session is byte-for-byte what it was: no draft, no publication, no
 * database. That is what every laptop runs and what `data/` is for, and the flip
 * must not alter it — tests/claim-session-files.test.ts is that half of
 * the claim, and it proves it by taking `DATABASE_URL` away, so any database
 * call at all would throw. `pipelineStore` — the aliased `fsArtifacts` import at
 * the top of this file — is the artefact store that branch writes through, and
 * nothing else uses it.
 *
 * **Exported so a test can drive the real one.** `advanceJobWith` takes a
 * session because a test must be able to supply fake *steps* — the thirteen real
 * ones cost money and reach the network — but the session under them has to be
 * production's, or a test of the publication would be a test of its own wiring.
 * See `AdvanceParts` for how narrow "narrow" is, and
 * tests/claim-session-postgres.test.ts for the proof that this line selects what
 * it says it selects.
 */
export async function claimSession(job: Job, attempt: string): Promise<StoreSession> {
  if (STORE !== "postgres") return fsStoreSession({ artifacts: pipelineStore, jobs: store });
  return await openPgStoreSession({
    slug: job.slug,
    job: { id: job.id, attemptId: attempt },
  });
}

/**
 * What a job card says when the publication failed for a reason of its own.
 *
 * A whole sentence and no detail, because the detail is usually a database
 * error whose message carries the bound parameters of the statement that failed
 * — the job's `steps` and its title, which is the article's. See `walkClaim`,
 * and src/store/db-errors.ts for the rule this is one end of.
 *
 * **There is one of these now, and there were two until 2026-09-01.**
 * `publishingSession` carried the same sentence, deliberately, for as long as it
 * owned the other end of this path; the duplication ended when the flip deleted
 * that file (docs/plans/260831b-finish-the-database-move.md § Stage 3 — the
 * flip). If a second copy is ever wanted, move this one to src/messages.ts
 * rather than writing the sentence out twice and leaving them to drift.
 */
const COULD_NOT_PUBLISH =
  "Everything ran, but putting the finished article on your shelf did not go through. " +
  "Nothing was published and your library is unchanged. Trying again is safe.";

const PRODUCTION: AdvanceParts = { session: claimSession, steps: STEPS };

/**
 * `advanceJob`, with the session and the step registry named rather than
 * assumed. See `AdvanceParts` for why it is exported and how narrow "narrow" is.
 */
export async function advanceJobWith(
  id: string,
  parts: AdvanceParts,
): Promise<Advanced | null> {
  const owner = currentOwnerId();

  /**
   * **The lease's enforcement, and it lives here rather than on a timer.**
   *
   * `settleExpired` existed from the day the store was written and **nothing
   * called it** — GPT Sol's first finding on the built queue, and the worst of
   * them, because it turned the lease from a deadline into a note. Kill an
   * instance mid-step and its job stays `running` for ever with a token nobody
   * holds; every later advance answers `busy`, the browser retries for ever,
   * and the local pump backs off for ever. The old in-memory queue self-healed
   * on restart because a dead process left an empty `Map`. This did not, which
   * makes it a regression rather than a gap.
   *
   * Called at the top of every advance rather than from a scheduler, for three
   * reasons. There is no scheduler on Vercel, and inventing one would be a
   * second mechanism to keep alive. This is the exact moment somebody wants the
   * slot, so a sweep that never runs is a sweep nobody needed. And it is one
   * indexed `UPDATE` over rows that are almost always none.
   *
   * It settles the job rather than taking it over — see the header — so the
   * reader sees a job that stopped and a Retry button, not a job that silently
   * restarted somewhere else.
   */
  /* **The outcomes, and this line is the only account of them there is.** The
     claimant that held these jobs is gone and logged nothing on its way out, so
     `settled 1 job(s)` is a fact that can be joined to nothing — which job, whose
     article, how far it had got. GPT Sol asked for it by name
     (docs/plans/260830a-v1-imports-review-sol.md § Remaining operational points), and it
     matters more now that one claim covers a whole ingest: a sweep here is
     up to twelve minutes of somebody's work ending.

     **"settled", not "failed".** Since 2026-09-01 a row carrying `cancelling`
     comes back `cancelled` rather than `error`, so a line saying *failed* would
     be untrue of exactly the jobs a reader chose to stop — and the statuses are
     in the object beside the ids, so the log can say which was which. */
  const swept = await store.settleExpired();
  if (swept.length > 0) {
    log("jobs").warn(
      { count: swept.length, settled: swept },
      `settled ${swept.length} job(s) whose claimant stopped answering`,
    );
  }

  /* `mintAttempt`, **not** `mintId`. `jobs.attempt_id` is a uuid column, and a
     `spya-` token is rejected by Postgres on the claim — the first statement of
     every advance. See the note on `mintAttempt`. */
  const attempt = mintAttempt();
  /* The cap is read here, at the moment somebody wants a slot, rather than
     frozen at import — see `jobConcurrency`. The store enforces it; deciding it
     is not the store's business, the same division `LEASE_MS` already has. */
  const outcome = await store.claim(id, owner, attempt, LEASE_MS, jobConcurrency());

  switch (outcome.kind) {
    /* Somebody else's is `gone`, as a missing one is. This is the route that
       runs a pipeline step, so leaving it open was somebody else's model spend
       on demand. */
    case "gone":
      return null;
    /* Already over. Safe to call for ever, which is what makes a client loop
       that races its own poll harmless. */
    case "finished":
      return { job: outcome.job, ran: null, busy: false, done: true };
    /* Held by another claimant, or the single running slot is taken by a
       different job, or Stop has been pressed and the abort has not landed.
       All three are *wait and ask again*, which is what the client does. */
    case "busy":
      return { job: (await store.get(id, owner)) as Job, ran: null, busy: true, done: false };
    case "stopping":
      return { job: outcome.job, ran: null, busy: true, done: false };
  }

  /**
   * **Everything the claim covers happens in here, and that is not a wrapper.**
   *
   * `runInJob` puts this job's id in scope for the whole of the claimed body —
   * the session, every step, and the settlement — and `dataRoot()` reads it to
   * pick `/tmp/spideryarn/<owner>/<job>/` on a deployed instance
   * (src/store/data-root.ts). It was written on 2026-08-30 and **nothing called
   * it**: the bundle had `currentJobId()` and an `AsyncLocalStorage` and no way
   * to fill it, so a deployed step reached `dataRoot()` with no scope and threw
   * before it started. Every import on production failed at step one, in 16ms.
   * GPT Sol, docs/plans/260830k-v1-stages01-review-sol.md critical 1.
   *
   * Here rather than in the route, deliberately: the route is not where the job
   * is known to be *ours*, and a scope opened around a claim that was refused
   * would name a job somebody else is inside.
   */
  return await runInJob(outcome.job.id, () => walkClaim(outcome.job, attempt, owner, parts));
}

/**
 * Walk **every** step of one claimed job, on one claim, and settle it.
 *
 * ## Why the whole job rather than one step
 *
 * Because on Vercel each `POST /api/jobs/:id/advance` may land on a different
 * instance with an empty disk. The old shape — claim, run one step, release —
 * is correct on a laptop and cannot finish an ingest on a serverless host at
 * all: step 2 looks for what step 1 wrote and finds nothing, so it runs step 1
 * again. **A loop at the route cannot fix that**, which is the finding this
 * function exists for: every `advanceJob` takes its own claim, so between one
 * call's release and the next call's claim a second tab can take the job, on a
 * second instance, with its own partial scratch — and the two alternate,
 * restarting from their own halves. GPT Sol, docs/plans/260830a-v1-imports-review-sol.md
 * critical 3.
 *
 * So the claim is taken once and **kept** across steps: `transitionAfter`
 * returns `keep`, which finishes the step and writes nothing to the `jobs` row.
 * What the reader sees between steps is `noteProgress`, which is a progress bar
 * and deliberately does not renew the lease.
 *
 * ## What ends the walk
 *
 * Five things, and each has a branch below: the job runs out of steps, a step
 * fails, a step is cancelled, a Stop lands between two steps, or there is not
 * enough of the claimant's own deadline left for the next step — the last being
 * the only one that hands the claim back with the job still to do.
 */
async function walkClaim(
  job: Job,
  attempt: string,
  owner: OwnerId,
  parts: AdvanceParts,
): Promise<Advanced | null> {
  /**
   * **The session, built here and nowhere else** — immediately after the claim
   * succeeded, and used for the whole of it.
   *
   * Not per step, and not per job. Every `/advance` mints a new attempt, and a
   * Postgres draft reference embeds that attempt, so a session built once per
   * job is stale on the second request; one built per step could not carry a
   * draft at all. One per successful claim is the lifetime that matches what a
   * claim *is*, and it is what D1b needs
   * (docs/plans/260827aa-delete-the-importer-d1-design-sol.md, finding 3).
   *
   * **A claim is now a whole job rather than one step, and this line did not
   * have to change** — which is the evidence that "one per claim" was the right
   * lifetime rather than a coincidence of the old shape.
   *
   * On the filesystem it holds no transaction and says so out loud
   * (src/store/session.ts). `PRODUCTION` above is what supplies it, and it still
   * picks the filesystem artefact store; that is the line the Postgres session
   * replaces in D2, and this one does not change.
   */
  const session = await parts.session(job, attempt);
  /* A child logger, made here and used locally — never a module-level "current
     job". Rule 4 at the top of src/log.ts, and it matters more here than
     anywhere: several advance requests for *different* jobs really can be in
     flight in one instance at once. */
  const jlog = log("jobs").child({ jobId: job.id, slug: job.slug });
  const startedMs = Date.now();
  const controller = new AbortController();
  aborts.set(job.id, controller);

  /**
   * **The claimant's own deadline, and it has to fire before the lease.**
   *
   * Without this the lease is a promise nobody keeps: a local model call can
   * run for as long as it likes, the lease lapses, `settleExpired` marks the job
   * interrupted — and the step is still running, still spending, about to write
   * artefacts for a job that has been failed. Aborting ourselves first makes an
   * expired lease mean *the process is gone*, which is the only reading it is
   * safe to act on. See `LEASE_MS`.
   *
   * **One timer for the whole claim, not one per step**, and it is not reset
   * between them. It cannot be: `noteProgress` deliberately does not renew the
   * lease, so a per-step timer would let the lease expire underneath a claimant
   * that is still working, and renewing the lease instead would turn it into a
   * heartbeat — after which an expired lease means *probably dead* rather than
   * *definitely over its own deadline*, and `settleExpired` stops being safe.
   * GPT Sol, docs/plans/260830k-v1-stages01-review-sol.md § 3. What bounds a *step* is
   * `STEP_BUDGET_MS`, checked before the step starts rather than while it runs.
   */
  let overran = false;
  /** When this claimant stops, on the clock `Date.now()` reads. */
  const deadlineAt = startedMs + (parts.leaseMs ?? LEASE_MS) - DEADLINE_MARGIN_MS;
  const deadline = setTimeout(() => {
    overran = true;
    controller.abort(new Error(INTERRUPTED.message));
  }, deadlineAt - Date.now());

  /**
   * Write what the card should say, **without letting go of the claim.**
   *
   * The one job write that is neither a release nor a finish, and the walk needs
   * it twice over. A step's completion reaches the `jobs` row through it now
   * that a non-final commit writes nothing there — so without it the card would
   * show a job stuck on step one for the whole ingest — and it is also the only
   * thing that reads the row back mid-job, which is how a Stop pressed on
   * *another instance* is noticed at all: that instance has no `AbortController`
   * of ours to pull, so `cancelling` on the row is the whole of the message.
   */
  /* **Hands the written row back**, because the walk reads `cancelling` off it
     between steps — a Stop pressed on another instance arrives there and
     nowhere else. `runStep` ignores the return; see its `note` parameter. */
  const note = async (): Promise<Job> => await store.noteProgress(job.id, attempt, job.steps);

  try {
    /**
     * **What the job record should say once this step's artefacts are written.**
     *
     * Called from inside `runStep`, immediately before the commit, so that the
     * step's completion and the job's transition are one act — the boundary D1b
     * makes atomic. It used to be computed here, *after* `runStep` returned, and
     * that is precisely the shape the review said D1b would have to re-cut
     * (docs/plans/260827aa-delete-the-importer-d1-design-sol.md, finding 1).
     *
     * Everything it reads is already true by the time it is called: the step is
     * marked `done` in memory, the title is on the job, and the signal is the
     * same signal the step just finished under.
     */
    const transitionAfter = (): JobTransition => {
      /* **Whose abort was it?** A step that watches its signal unwinds through
         `runStep`'s catch and never reaches here; a step that ignores it runs to
         completion and lands exactly here — and if the thing that aborted was
         our own deadline rather than the reader, calling it "cancelled" tells
         them they stopped something they did not. GPT Sol found the
         mislabelling; the deadline had a branch on the failure path and none on
         the success path. */
      if (controller.signal.aborted) {
        const ending = overran
          ? interruptedEnding(job)
          : (markCancelled(job, "Cancelled"), endingFrom(job, "cancelled"));
        return { kind: "end", jobId: job.id, attempt, ending };
      }
      /* The step that has just finished is already `done` in memory, so this is
         the next one the walk would reach — and `undefined` means the job is
         over. */
      const next = job.steps.find((s) => s.status !== "done" && s.status !== "skipped");
      if (!next) {
        return { kind: "end", jobId: job.id, attempt, ending: endingFrom(job, "done") };
      }
      /* **There is more to do and time to do it in: keep the claim.** This is
         the ordinary path, and it is the change that makes an import work on a
         host where the next request would land on a different disk. Nothing is
         written to the `jobs` row here at all — the loop's `note` does that,
         outside the commit, because a progress bar is not worth widening an
         artefact transaction for. */
      if (deadlineAt - Date.now() >= STEP_BUDGET_MS[next.name]) return { kind: "keep" };
      /* **Not enough of our own deadline left for the next step: hand back.**
         Deliberate, and the difference between this and doing nothing is the
         difference between a job that stays `queued` and resumable and a job
         killed inside a step with a live lease, unreclaimable until it lapses.
         Nobody takes the job away from us here — we put it down.

         What it costs on a deployed instance is the scratch directory, since
         the next request may be somewhere else; `stepIsDone` derives what is
         finished from the artefacts, so a warm instance resumes for free and a
         cold one re-runs. That trade is v1's, and it is stated in
         docs/plans/260830d-v1-imports-on-vercel.md rather than discovered. */
      return {
        kind: "release",
        jobId: job.id,
        attempt,
        steps: job.steps,
        fields: { ...(job.title !== undefined && { title: job.title }) },
      };
    };

    /**
     * The last step this call actually ran, for the answer the client gets.
     *
     * A walk can run several, and `Advanced.ran` is one name — so it is the
     * **last**, which is the one the reader's card is showing when the response
     * lands. Nothing branches on it; the field is diagnostic, and `done` is what
     * the client's loop reads (src/web/useJobs.ts § `drive`).
     */
    let lastRan: StepName | null = null;

    for (const step of job.steps) {
      const ran = await runStep(
        job,
        step,
        controller,
        jlog,
        note,
        session,
        parts.steps,
        transitionAfter,
      );

      if (ran.outcome === "skipped") continue;
      lastRan = step.name;

      if (ran.outcome === "cancelled" || ran.outcome === "failed") {
        /* Read off the outcome rather than off `job.status`: `runStep` records
           the story on the record in memory and this is the one write that
           commits it. An overrun is neither a cancel nor a step's fault — the
           step was interrupted by its own claimant — so it ends as an error
           the reader may retry, with `INTERRUPTED`'s wording rather than
           whatever the abort happened to say. */
        const ending = overran
          ? interruptedEnding(job)
          : endingFrom(job, ran.outcome === "cancelled" ? "cancelled" : "error");
        const after = await endJob(job, attempt, ending, jlog, startedMs, session);
        return { job: after, ran: step.name, busy: false, done: true };
      }

      /* It ran, and the commit inside it decided what happens to the claim.
         **`settlement`, not the transition that was asked for**: a release
         resolves to *cancelled* when Stop landed while the step ran, and reading
         the outcome off our own request would report `done: false` for a job the
         store has already ended — and skip `noteEnded`, so the ending would
         never be logged and retention would never run. */
      const settlement = ran.settlement as JobSettlement;

      if (settlement.kind === "ended") {
        if (overran) {
          jlog.warn(
            { step: step.name },
            `step ${step.name} ran past its deadline and ignored the signal — ${job.slug}`,
          );
        } else if (controller.signal.aborted) {
          jlog.debug({ step: step.name }, `job cancelled after ${step.name} — ${job.slug}`);
        }
        /* The finish itself happened inside the commit; this is the half of
           `endJob` that is not a store write. */
        await noteEnded(job, settlement.ending, jlog, startedMs);
        return { job: settlement.job, ran: step.name, busy: false, done: true };
      }

      if (settlement.kind === "released") {
        /* The deliberate handback — `transitionAfter`'s budget branch, and the
           only way this arrives. Said at `info` because it is a decision rather
           than an event: somebody reading the log of a job that took two
           requests should be able to see that we chose it and why. */
        jlog.info(
          { step: step.name, leftMs: deadlineAt - Date.now() },
          `handing the claim back after ${step.name}: not enough deadline left for the next step — ${job.slug}`,
        );
        return { job: settlement.job, ran: step.name, busy: false, done: false };
      }

      /**
       * **Kept, so the walk goes on — and these two lines are what makes that
       * safe to do.**
       *
       * The commit wrote nothing to the `jobs` row (see `JobTransition`), so
       * `noteProgress` is what tells the card this step finished, and its
       * answer is the only look this walk takes at the row it holds. That look
       * is not housekeeping: **Stop pressed on another instance arrives here and
       * nowhere else.** `requestCancel` sets `cancelling` on the row and aborts
       * the local `AbortController` if the claimant happens to be in this
       * process; on Vercel it usually is not, so without this check a reader
       * who pressed Stop would watch the remaining steps run to completion and
       * be billed for them.
       *
       * The cost is that Stop is only honoured at a step boundary — a reader
       * stopping mid-`hierarchy` waits for `hierarchy`. Said out loud in
       * docs/plans/260830d-v1-imports-on-vercel.md § Risks rather than discovered.
       */
      const noted = await note();
      if (noted.cancelling) {
        jlog.debug({ step: step.name }, `stop noticed after ${step.name} — ${job.slug}`);
        /* The same word `transitionAfter` uses when a Stop lands *during* a
           step, because it is the same event and the reader must not be able to
           tell which side of a step boundary they hit. */
        markCancelled(job, "Cancelled");
        const after = await endJob(
          job,
          attempt,
          endingFrom(job, "cancelled"),
          jlog,
          startedMs,
          session,
        );
        return { job: after, ran: step.name, busy: false, done: true };
      }
    }

    /* Nothing left to run. Two ways here and they are one case: **every** step
       skipped — a job re-added after its article was already on the shelf, on
       its first call — or the steps after the last one that ran all skipped.
       Neither reaches `commit`, which is why the ending goes through the
       session's other door rather than being the one job write that does not.
       Under Postgres that door is what publishes the draft this claim has been
       writing into (src/store/pg-session.ts, case 5), so it is load-bearing
       rather than tidy. */
    /**
     * **And that door can fail, which is the one ending with no catcher of its
     * own.**
     *
     * A publication that goes wrong out of `commit` — the last step ran —
     * unwinds through `runStep`, which records it on the step and on the job,
     * and the walk ends the job as an error a few lines above. This door has no
     * `runStep` around it: `endJob` throws, the walk's outer `catch` re-raises
     * anything that is not a `StaleAttemptError`, and the job row is `running` with
     * its draft pointer held until the lease lapses — every advance until then
     * answering `busy`, the local pump stopping at once, and the eventual
     * `settleExpired` recording a generic interruption rather than the conflict a
     * person could act on. GPT Sol, 2026-08-31,
     * docs/plans/260831b-stage3-items3and4-review-sol.md finding 2.
     *
     * So it is recorded here **the same way `runStep` records the one that comes
     * out of `commit`** — the job failed, and the second `endJob` is the
     * settlement that fails the draft and clears the pointer. One rule for a
     * publication that did not happen, reached through either door.
     *
     * **Every failure, not only `PublishRefused`.** A narrower catch was written
     * first and would have been a regression at the flip, which is why it is
     * wide: `publishingSession` — the decorator `pgStoreSession` replaced on
     * 2026-09-01 — terminalised the job for *any* non-stale failure on this
     * path, and catching only the refusal would have left a database error doing
     * exactly what the finding describes, put there by the change that removed
     * the decorator. GPT Sol, 2026-09-01. The reader's position makes it worse
     * rather than better: a job stuck `running` is neither `error` nor
     * `cancelled`, so `retryJob` now refuses it and there is no button either.
     *
     * **`StaleAttemptError` keeps going.** It does not mean the publication
     * failed, it means this claimant no longer owns the job — the settlement
     * below is fenced on the same attempt and could only be refused too. The
     * walk's outer `catch` answers `busy` and the client asks again.
     *
     * **A second failure is not swallowed.** An `error` ending publishes
     * nothing, so the recovery cannot fail the same way; if it fails anyway the
     * throw goes out, because a job we could not record the ending for is not a
     * job to report as ended.
     */
    let after: Job;
    try {
      after = await endJob(job, attempt, endingFrom(job, "done"), jlog, startedMs, session);
    } catch (err) {
      if (err instanceof StaleAttemptError) throw err;
      captureFailure(err, { slug: job.slug, jobId: job.id, phase: "publish" });
      /* **The class, never the message.** A raw driver error carries the failed
         statement's bound parameters — the job's `steps` and the article's title
         — and `errorFields` puts the message straight into the line, where
         redaction cannot reach it. `guardDbStore` has already logged the
         SQLSTATE, the table and the constraint on the way out, and
         `captureFailure` above has the stack. src/store/db-errors.ts,
         docs/project/logging.md. */
      jlog.error(
        { errorType: err instanceof Error ? err.name : typeof err },
        `could not publish a claim where every step skipped — ${job.slug}`,
      );
      job.status = "error";
      /* **`PublishRefused`'s own words, or nothing.** That message is ours — a
         slug and a list of reasons naming revision ids — and it is the one a
         person can act on. Anything else may be a driver error with the article
         in it, and this string goes onto the job card and into the `jobs` row.
         src/store/db-errors.ts is the rule this is one end of. */
      job.error = err instanceof PublishRefused ? err.message : COULD_NOT_PUBLISH;
      /* `retry` for anything that is not the refusal, because another go really
         is the right move — a database that was briefly unreachable is exactly
         what re-running fixes. The refusal keeps `failureKindOf`, which reads
         `undefined` and so offers the retry as well; naming them separately is
         what keeps a *future* refusal that declares itself `bug` from being
         quietly relabelled. */
      recordFailureKind(job, err instanceof PublishRefused ? failureKindOf(err) : "retry");
      job.finishedAt = new Date().toISOString();
      delete job.cancelling;
      after = await endJob(job, attempt, endingFrom(job, "error"), jlog, startedMs, session);
    }
    return { job: after, ran: lastRan, busy: false, done: true };
  } catch (err) {
    /* **The claim went somewhere else while we were inside a step.** Not a step
       failure and not ours to record: the row says somebody else owns this job,
       so any write we made would be refused anyway. Report it the way a losing
       claimant is reported, and let the client ask again. */
    if (err instanceof StaleAttemptError) {
      jlog.warn({ jobId: job.id }, `lost the claim mid-step — ${job.slug}`);
      const now = await store.get(job.id, owner);
      return now ? { job: now, ran: null, busy: true, done: false } : null;
    }
    throw err;
  } finally {
    clearTimeout(deadline);
    // Only ours. `aborts` is keyed by job id and this call put the entry there,
    // so deleting it here cannot take another claimant's — it has none in this
    // process, because the claim is what stops two of us being inside one job.
    aborts.delete(job.id);
  }
}

/* -------------------------------------------------------------------- api -- */

export interface EnqueueRequest {
  slug: string;
  url?: string;
  /**
   * The file this article is being made from, when it came off the reader's disk.
   *
   * **Mutually exclusive with `url` in practice**, though not in the type: a
   * job acquires its document one way or the other, and it is the route's job
   * to refuse a request naming both. Typed as optional-and-optional rather than
   * a union because the third shape is real and common — `{ slug, steps }`, a
   * late stage re-run on an article already on the shelf, which has neither.
   */
  upload?: JobUpload;
  /**
   * Which steps to run. Sorted into pipeline order here.
   *
   * Defaults to `DEFAULT_INGEST_STEPS` — everything that makes the article readable,
   * which is no longer everything there is. `tweets` has to be named.
   */
  steps?: StepName[];
  /**
   * Steps to run even though their artefacts already exist.
   *
   * This is what "refresh from source" is: the same default steps, with `fetch`
   * forced. Nothing else in the machinery has to know that a refresh is a
   * different kind of thing, because it isn't.
   *
   * A refresh therefore leaves an existing `tweets.json` alone — it isn't in
   * the job, so `cascadeForce` cannot reach it. The thread is then describing
   * an older article, which is exactly what its `sourceHash` exists to make
   * visible. Rewriting it is `{ steps: ["tweets"], force: ["tweets"] }`.
   *
   * **Forcing one step forces every step after it** — see `cascadeForce`, and
   * read its note before changing this. Forcing only the front of the pipeline
   * is how you get a fresh article under a stale tree, with five green ticks
   * over it.
   */
  force?: StepName[];
  /**
   * A free-text steer for the steps that take one — today, only `summary`.
   *
   * The queue does not interpret it. It carries it onto the job, so that it
   * survives a restart and so that two differently-steered requests are two
   * different jobs (`sameWork` below).
   */
  /**
   * Who is reading, **already rendered** — `renderProfile` in src/profile.ts.
   *
   * Resolved by the route, once, and carried from here. That is the whole point
   * of it being on the request rather than read inside each step: a summary run
   * is several batches in flight at once, and a reader who edits their profile
   * while one is running would otherwise get an artefact written from two
   * profiles and stamped with whichever finished last.
   *
   * Absent means "run without a profile", which is a real answer — the reader
   * unticked the box — and the artefacts record it as `profileHash: null`.
   */
  profile?: string;
}

/**
 * Queue a job and return it immediately, before any of it has run.
 *
 * Returning early is the point — the caller is an HTTP handler and the work
 * takes minutes. The job record is the receipt; `GET /api/jobs/:id` is how you
 * find out what happened to it.
 */
export async function enqueue(request: EnqueueRequest): Promise<Job> {
  // `DEFAULT_INGEST_STEPS`, not `STEP_ORDER`. They were the same list until
  // `tweets` arrived — a step you can ask for by name that must not run on
  // every add, because it costs a model call nobody asked for.
  const names = orderSteps(request.steps ?? DEFAULT_INGEST_STEPS);
  if (names.length === 0) {
    throw Object.assign(new Error("A job needs at least one step."), { status: 400 });
  }
  const owner = currentOwnerId();
  const forced = cascadeForce(names, new Set(request.force ?? []));
  /* **`request.url`, not the URL the loop reads off disk below.** They differ
     for a late step run on an existing article — the request carries none and
     the job gets one from `meta.json` — and the key has to be a property of the
     *request*, or two callers asking for the same thing would hash differently
     depending on what happened to be on disk when each of them asked. */
  const workKey = workKeyFor(names, forced, request.profile, request.upload, request.url);

  /* **The loop is the deduplication, and the insert is what decides.**
   *
   * This used to be: look for an active job on this slug, compare it with
   * `sameWork`, and insert if nothing matched — with a long comment explaining
   * why there must be no `await` between the look and the insert. That comment
   * is gone with the code, because the look and the insert are now one
   * statement: `enqueueOrGet` inserts and lets `jobs_active_slug` refuse, and
   * the row that comes back is either the job already doing this work or the
   * job holding the name for something else.
   *
   * Which is the difference between narrower and closed. Two instances each
   * scanning their own memory each found nothing and each started paying for
   * the same article, and no amount of care about `await` placement in one
   * process could have stopped it.
   *
   * **20 tries**, and since every minted slug ends in a random short id
   * (src/ingest.ts § `slugWithShortId`) a second pass now means one of two
   * things: the slug we adopted for this URL has a job on it doing different
   * work, which is answered with a 409 below; or a one-in-771-million id
   * collision. Twenty of those in a row is not a collision, it is a fault.
   *
   * **An upload gets a minted slug outright.** There is no address to compare,
   * so there is nothing that could make two uploads one article —
   *
   * > If it was previously uploaded by a different user, then reuse the source
   * > object, but add a new per-user article object.
   * >
   * > — Greg, 2026-08-26
   *
   * — and the short id makes that a mint rather than a search. `freeUploadSlug`
   * and `slugIsSpokenFor` were the search, and both are gone with it.
   */
  let slug = request.url
    ? await freeSlug(request.slug, request.url)
    : request.upload
      ? slugWithShortId(request.slug)
      : request.slug;

  for (let tries = 0; ; tries++) {
    if (tries >= 20) {
      throw Object.assign(new Error(`Too many articles already called "${request.slug}".`), {
        status: 409,
      });
    }

    /* **Never for an upload**, and not only because it would find nothing. It
       reads the `meta.json` at `slug`, and `slug` can still move below — so a
       URL read here from an article we then step aside from would be carried
       onto a job for a *different* document. */
    const url = request.url ?? (request.upload ? undefined : await urlForSlug(slug));

    const wanted: Job = {
      id: mintId(),
      /* Read here rather than inside the pump, because by the time the pump
         gets to it the request is long gone. src/owner.ts § `runAsOwner`. */
      ownerId: owner,
      slug,
      ...(url ? { url } : {}),
      ...(request.upload ? { upload: request.upload } : {}),
      steps: names.map((n) => newStep(n, forced.has(n), request.upload !== undefined)),
      status: "queued",
      createdAt: new Date().toISOString(),
      ...(request.profile ? { profile: request.profile } : {}),
    };

    const { job, created, sameWork } = await store.enqueueOrGet(wanted, workKey);

    if (!created) {
      /* Already in hand: hand back the job doing it rather than starting a
         second one over the same files. A double-click on Add is all it takes.

         **Only for identical work.** Matching on the slug alone would let a
         queued `{steps:["arc"]}` swallow a refresh that arrived a second later
         — the caller gets a job id, watches it succeed, and the refresh never
         happened. */
      if (sameWork) {
        /* **And give it a pump**, because the job we are handing back may have
           nobody driving it. That is not a rare state: a job left `queued` by a
           dev-server restart is exactly what `sweepStopped` produces, and
           asking for it again is exactly what a reader does next. Without this
           they get a job id back and watch a card that never moves.

           Two pumps for one job is harmless — the second is told `busy`, backs
           off, and takes the next step when the first releases — which is the
           same arrangement as a pump plus an open browser tab, and the whole
           reason the claim exists. */
        pump(job.id, owner);
        return job;
      }

      /**
       * The slug is taken by **different** work, and what to do about that
       * depends entirely on whether this request is *asking for* an article or
       * *naming* one.
       *
       * **A URL or an upload is asking for one.** Re-allocating is right, and
       * asking `freeSlug` again rather than appending a counter is right too:
       * the racing job is in the store now, so the lookup sees it this time and
       * either adopts its slug (same URL) or mints a fresh one. A counter would
       * have to guess, and could land on a finished article's slug.
       *
       * **Anything else is naming one**, and moving it is the worst thing this
       * function could do. `{slug: "paper", steps: ["summary"]}` means *summarise
       * paper*. If `paper` has a glossary job running, the old code appended a
       * counter and made it a summary job for `paper-2` — a different article,
       * already on the shelf, which it would then summarise perfectly
       * successfully. GPT Sol found it; the plan had said 409 and the code had
       * not. So: 409, in the reader's words.
       */
      if (!request.url && !request.upload) {
        throw Object.assign(
          new Error(`That article already has a job running. Wait for it, or stop it first.`),
          { status: 409 },
        );
      }
      const next = request.url
        ? await freeSlug(request.slug, request.url)
        : slugWithShortId(request.slug);
      /* **No progress is not something to retry twenty times.** `freeSlug` will
         keep handing back the same name when the held slug is legitimately this
         URL's — which is exactly what happens to a filesystem job that survived
         a restart without its work key. Spinning to the retry budget and then
         409ing hides that behind a generic message; saying it once does not. */
      if (next === slug) {
        throw Object.assign(
          new Error(`That article already has a job running. Wait for it, or stop it first.`),
          { status: 409 },
        );
      }
      slug = next;
      continue;
    }

    /* The step list and the forced list, because "why did this job cost two
       model calls" and "why did it finish in a second" are both answered here
       and nowhere else. Not the URL: `slug` already identifies the article, and
       the log is a reading history either way — see the note in src/log.ts. */
    log("jobs").info(
      { jobId: job.id, slug, steps: names, forced: [...forced] },
      `job queued: ${slug} — ${names.join(", ")}${forced.size ? ` (forced: ${[...forced].join(", ")})` : ""}`,
    );

    pump(job.id, owner);
    return job;
  }
}

/**
 * A fingerprint of exactly what `sameWork` compares, computed once.
 *
 * **Immutable, which `job.steps` is not.** Statuses move as a job runs, so a
 * key derived from the record on each comparison would answer differently at
 * the end of a job than at the start — and the question being asked is *is this
 * the same request*, which does not change because a step finished.
 *
 * It has to hash the same five things `sameWork` reads and nothing else, or
 * there are two rules for one question and they drift. `tests/jobs.test.ts`
 * holds them together: for a set of jobs, the two must agree every time.
 */
export function workKeyFor(
  names: StepName[],
  forced: Set<StepName>,
  profile?: string,
  upload?: JobUpload,
  url?: string,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        steps: names.map((n) => [n, forced.has(n)]),
        upload: upload?.id ?? "",
        profile: profile ?? "",
        /* **`urlKey`, not the URL.** `http://x.test/p` and `https://x.test/p/`
           are one article — src/ingest.ts is the only thing in this codebase
           that gets to decide that — so hashing the raw string would make two
           spellings of one address two pieces of work, and the dedup this key
           exists for would stop working for the commonest case of all. */
        source: url ? urlKey(url) : "",
      }),
    )
    .digest("hex");
}


/**
 * The same steps, forced the same way, steered the same way — the only case a
 * caller can safely share.
 *
 * **Nothing in production calls this any more, and that is deliberate.** The
 * store compares `workKeyFor`'s hash, because the comparison has to happen
 * inside the statement that inserts. What this is now is the **specification**
 * that hash has to satisfy, written as prose a person can check — and
 * `tests/jobs.test.ts` § the work key holds the two together over a grid, so a
 * field added here and forgotten there turns something red rather than
 * silently making two requests one.
 *
 * Which makes deleting it the wrong tidy-up. A hash is not readable, and "what
 * counts as the same piece of work" is a decision worth being able to read.
 *
 * **A `guidance` steer used to be compared here and is gone**, with the box that
 * fed it (docs/plans/260830o-steer-becomes-the-profile.md). What it was defending
 * against now lives entirely on `profile` one line down: a reader who changes
 * what they are after and presses the button again is asking for a *different
 * artefact*, and being handed the first job would refresh the panel with
 * summaries written to the intent they replaced, with nothing anywhere saying
 * so.
 *
 * **Removing it moved every parameter after it**, and `guidance` and `profile`
 * were both `string | undefined`, so nothing in the type system could have
 * caught a call site left with its arguments shifted by one. Both call sites
 * were changed by hand and `tests/jobs.test.ts` holds this and `workKeyFor` to
 * the same answer for a set of jobs, which is what would catch a drift here.
 *
 * `?? ""` on both sides so "no profile" and "" are one case rather than two
 * that fail to match each other.
 */
export function sameWork(
  job: Job,
  names: StepName[],
  forced: Set<StepName>,
  profile?: string,
  upload?: JobUpload,
  url?: string,
): boolean {
  if (job.steps.length !== names.length) return false;
  /* **Two uploads are never one piece of work**, whatever they are called and
     whatever steps they name. This is belt and braces — a minted short id
     never hands two attempts the same slug, so `activeFor` should not have
     found the other one at all — and it is here because the cost of the two mechanisms
     disagreeing is that a reader watches somebody else's document succeed
     under their own filename. Sol's finding on the plan: `sameWork` compared
     steps, guidance and profile only, and had no upload identity at all. */
  if ((job.upload?.id ?? "") !== (upload?.id ?? "")) return false;
  /* **And the URL, which was missing until 2026-08-27.**
   *
   * `freeSlug` derives a slug from the last path segment, so `a.example/news`
   * and `b.example/news` both want `news`. Added at the same moment, both see
   * the slug free, both build a job whose every *other* work parameter is
   * identical — and the second one loses the `jobs_active_slug` conflict, is
   * told this is the same work, and is handed the first URL's job. The reader
   * watches it succeed and their article was never fetched. GPT Sol found it in
   * the built queue; `freeSlug`'s own docstring has warned about this pair of
   * URLs since the day it was written, one layer down.
   *
   * `urlKey` rather than the string, so two spellings of one address stay one
   * piece of work — src/ingest.ts § `urlKey`. */
  if ((job.url ? urlKey(job.url) : "") !== (url ? urlKey(url) : "")) return false;
  /* And the profile, for the identical reason one field up — plus a sharper
     one. Unticking "use your profile" and pressing the button again is a
     request for a *different artefact*, not a retry of the one already
     running. Without this line the reader is handed the profiled job, it
     succeeds, and the panel shows a glossary stamped with the profile they had
     just asked it not to use. */
  if ((job.profile ?? "") !== (profile ?? "")) return false;
  return job.steps.every(
    (s, i) => s.name === names[i] && (s.force === true) === forced.has(s.name),
  );
}

/**
 * **The slug this URL should use: the one it already has, or a fresh one.**
 *
 * Two answers and no ladder between them, since 2026-08-31.
 *
 * ## The half that must never break: adoption
 *
 * > And will this de-dupe correctly if near-identical versions of the url are
 * > used, e.g. http vs https or without url protocol or capitalised similar
 * > non-significant changes, or if we already have the article?
 * >
 * > — Greg, 2026-08-26
 *
 * It did not. This compared two URLs as **strings**, so every one of those
 * spellings read as a different article: adding `http://x.test/piece` when the
 * shelf held `https://x.test/piece` stepped aside, re-fetched it, re-extracted
 * it, and paid for a second tree and a second arc — and then put two cards on
 * the shelf under the same headline. Nothing errored, and the check anyone
 * would run said the article was there. `urlKey` (src/ingest.ts) is the
 * comparison now, and it is the only thing in the codebase that decides
 * whether two addresses are one article.
 *
 * ## The lookup is by URL, and the short id is what forced that
 *
 * It used to be by *name*: derive the candidate slug from the URL, ask what
 * was already under it, and compare that article's URL with this one. That
 * only worked because the name was a function of the address.
 *
 * Slugs now end in a random short id (`why-trees-spya-k3m9qt`,
 * src/ingest.ts § `slugWithShortId`), which cannot be guessed — so a probe by
 * name would find nothing, mint a second article for a URL already on the
 * shelf, and pay for it. The same bug as 2026-08-26, arriving through the door
 * the fix for it had left open. So the question is asked the other way round:
 * *which slug already holds this URL?*
 *
 * ## The half that was deleted
 *
 * The host prefix and the `-2`…`-99` counter are gone, and so is
 * `freeUploadSlug` — nothing collides any more, because nothing has to share a
 * name. docs/plans/260831b-finish-the-database-move.md § Stage 3 item 0.
 *
 * ## The lookup is an argument
 *
 * A slug can be spoken for by two things, and the second only exists for a few
 * minutes: an article on the shelf, or **a job that is queued or running right
 * now** and has not published one yet. Without the second, two adds of one URL
 * a second apart get two slugs, `enqueueOrGet` sees no conflict (it conflicts
 * on the slug), and the reader pays twice.
 *
 * Passing the lookup in also means every decision here can be tested without a
 * filesystem, a network or a queue, which is
 * [`tests/jobs.test.ts`](../tests/jobs.test.ts) § freeSlug. The default is the
 * one line those tests do not cover.
 */
export async function freeSlug(
  slug: string,
  url: string,
  alreadyHolding: (urlKey: string) => Promise<string | undefined> = slugAlreadyHolding,
): Promise<string> {
  return (await alreadyHolding(urlKey(url))) ?? slugWithShortId(slug);
}

/**
 * Which of this reader's slugs already holds this URL — the shelf first, then
 * the queue.
 *
 * The shelf wins outright: a finished article is a fact, and an in-flight job
 * for the same address is by definition working on that same article.
 *
 * **`urlKey` on both sides**, which is why this cannot be a `where` clause.
 * The comparison is a JavaScript function over a normalised address, so the
 * rows come back and are matched here — see src/store/find-article.ts for what
 * that costs and why it is affordable.
 */
async function slugAlreadyHolding(key: string): Promise<string | undefined> {
  return (await slugForUrlKey(key)) ?? (await inFlightSlugForUrlKey(key));
}

/**
 * The queued or running job for this address, if there is one.
 *
 * A scan rather than a query, because `JobStore` has no lookup by URL and the
 * list is small by construction — active jobs plus at most `KEEP_FINISHED`
 * records per reader. Adding a store method for it would mean the same
 * `urlKey` comparison in two adapters, and `urlKey` is not SQL.
 *
 * `queued` and `running` are the two statuses `jobs_active_slug` reserves a
 * slug for (src/store/pg-jobs.ts § `ACTIVE`); a cancelled or failed job is not
 * holding anything.
 */
async function inFlightSlugForUrlKey(key: string): Promise<string | undefined> {
  for (const job of await store.list(currentOwnerId())) {
    if (job.status !== "queued" && job.status !== "running") continue;
    if (job.url && urlKey(job.url) === key) return job.slug;
  }
  return undefined;
}

/**
 * How many finished jobs to keep.
 *
 * The records are the only account of what happened, so they outlive the card
 * on the homepage — but one per ingest, for ever, means the `_jobs` directory,
 * the in-memory map and **every poll response** grow without bound. Fifty is
 * far more than anyone scrolls back through and small enough that the list
 * stays a list.
 *
 * Failures are kept preferentially: they are the ones worth reading later, and
 * the successes have an article on the shelf to speak for them.
 */
const KEEP_FINISHED = 50;

/**
 * Newest first, so the homepage shows what just happened at the top.
 *
 * **Yours, inside a request.** Until 2026-08-27 this returned everybody's, and
 * a job record is not a small disclosure: it carries the slug, the source URL,
 * the uploaded filename and the error message. It
 * was also the index a stranger needed to start naming other people's slugs at
 * the rest of the API. GPT Sol, 2026-08-27.
 */
export async function listJobs(): Promise<Job[]> {
  return store.list(currentOwnerId());
}

/**
 * **`null` for somebody else's job, exactly as for one that does not exist.**
 *
 * Every caller in src/routes.ts turns `null` into a 404, so answering this way
 * gives the right status without a second decision — and 404 is the right
 * status: "no such job" is all a stranger should learn about an id they guessed.
 */
export async function getJob(id: string): Promise<Job | null> {
  return (await store.get(id, currentOwnerId())) ?? null;
}

/**
 * Stop a job, whether it has started or not.
 *
 * Every step gets the signal, including the two model calls — the SDK takes an
 * `AbortSignal` and the fetch layer folds it into its own deadline. The tokens
 * already streamed are paid for either way, so there is nothing to save by
 * letting the call finish, and quite a lot to lose: Stop that does nothing for
 * two minutes is Stop that looks broken.
 *
 * `cancelling` is set because the abort is not instant. Between the click and
 * the step actually unwinding, the job is still `running`, and a Stop button
 * that stays a Stop button reads as a click that missed.
 */
export async function cancelJob(id: string): Promise<Job | null> {
  const owner = currentOwnerId();
  const job = await store.get(id, owner);
  // Somebody else's is `null`, exactly as a missing one is.
  if (!job) return null;
  if (job.status === "done" || job.status === "error" || job.status === "cancelled") return job;

  /* **One call, because the store decides which kind of stop this is.** A
     queued job ends outright; a running one is asked, and reads the flag at its
     next step boundary. It was two calls — cancel-if-idle, then ask — until GPT
     Sol pointed out that a claimant releasing between them leaves the job
     `queued` with `cancelling` set, which nothing ever moves on.

     The local abort comes after, and only helps in the common case that the
     claimant is this very process — which is what makes Stop feel instant
     rather than "at the end of this model call". Another instance's claimant
     reads the flag instead, a step boundary later. */
  const asked = await store.requestCancel(id, owner);
  aborts.get(id)?.abort();
  return asked ?? job;
}

/**
 * Queue the same work again, skipping whatever already succeeded.
 *
 * A new job rather than a mutated one: what went wrong the first time is worth
 * keeping, and overwriting it would erase the only evidence at exactly the
 * moment somebody is trying to work out what happened.
 *
 * **Force is recomputed, not copied**, and since 2026-08-31 the recomputation
 * gives a forced job its whole force back. An ordinary failure forces nothing —
 * the steps that succeeded are still good. A *refresh* forces again everything
 * it forced the first time, because in Postgres those steps' work went into a
 * draft that the failure threw away: see `forceForRetry` below, which is where
 * the reasoning and its cost are written down.
 *
 * ## Only a job that failed, and only one the card would have offered
 *
 * **The server is the authority, and until 2026-08-31 it checked nothing but
 * ownership.** That was harmless while a retry of a finished job forced nothing
 * — every step found its artefacts current and skipped — and it stopped being
 * harmless the same day, when `forceForRetry` began re-forcing everything the
 * original forced. A successful forced refresh could then be POSTed to its own
 * `/retry` endpoint, re-force every step, pay for the PDF transcription again,
 * and be done to each completed replacement job in turn, for as long as somebody
 * kept asking. GPT Sol, docs/plans/260831b-stage3-items3and4-review-sol.md
 * finding 3.
 *
 * The two refusals below are exactly what the card already decides
 * (src/web/AddArticle.tsx): a job that ended in a *failure*, and one
 * `jobWorthRetrying` says could come out differently. The rule is written twice
 * because the two ask different questions — the button asks what to draw, this
 * asks whether to spend — and a client is not where a spending rule lives.
 *
 * **`jobWorthRetrying`'s direction is preserved rather than tightened.** A job
 * carrying no `failureKind` at all — every job recorded before that field
 * existed, and every one the restart sweep marked — is retryable and must stay
 * so: refusing what nobody classified would take the button away from exactly
 * the jobs another go would fix. See src/job-failure.ts § *Which way to be
 * wrong*.
 *
 * **A refusal is a 409, not a 404.** `null` here means *no such job of yours*
 * and src/routes.ts answers 404 to it; a job that is plainly there and is not a
 * candidate is a different answer, and a conflict is the honest one. Thrown with
 * a numeric `status` rather than returned, because that is this codebase's mark
 * for a failure somebody chose and worded — `handleApi` reads it off the error —
 * so the route keeps its one line and the rule stays in one place. Both messages
 * are made of words we chose and nothing else: they are written to the log.
 */
export async function retryJob(id: string): Promise<Job | null> {
  /* Somebody else's is `null`, as a missing one is — and this one spends money,
     so it is the worst of the four to leave open. */
  const old = await store.get(id, currentOwnerId());
  if (!old) return null;
  if (old.status !== "error" && old.status !== "cancelled") {
    throw Object.assign(new Error("That job hasn't failed, so there is nothing to try again."), {
      status: 409,
    });
  }
  if (!jobWorthRetrying(old)) {
    throw Object.assign(
      new Error("Another go at that job would fail in the same way, so it is not offered."),
      { status: 409 },
    );
  }

  return await enqueue({
    slug: old.slug,
    ...(old.url ? { url: old.url } : {}),
    ...(old.upload ? { upload: old.upload } : {}),
    steps: old.steps.map((s) => s.name),
    force: forceForRetry(old.steps),
    // Copied, unlike force. The steer is not a thing the first attempt used up
    // — a retry of a summary run that was steered is still that run.
    ...(old.profile ? { profile: old.profile } : {}),
  });
}

/**
 * What a retry should force, given what the original forced.
 *
 * **Nothing, for an ordinary failure.** No step carried a force flag, so the
 * steps that succeeded are still good and skipping them is the whole point of
 * Retry. That half has never changed and is where the money is.
 *
 * **Everything the original forced, for a refresh** — from the earliest of them,
 * whatever happened afterwards. This said *"only from the first step that did
 * not finish"* until 2026-08-31, and that was the fourth fault of
 * docs/plans/260831b-finish-the-database-move.md: once the pipeline commits
 * through Postgres, the three steps that "finished" wrote into a **draft**, the
 * failure discarded that draft, and the retry's new draft is copied from the
 * revision the reader is still on. So the finished steps find last week's
 * artefacts current, skip, and `hierarchy` runs over the old article — a refresh
 * silently gone, under a row of green ticks (docs/reusable/silent-success.md).
 * `tests/retry-after-a-failed-refresh.test.ts` has the sequence in full.
 *
 * **Greg's decision 8: a failed refresh starts over.** The alternative — keeping
 * the failed draft so a retry can adopt its completed work — is written up in
 * that plan's § *Appendix: someday maybe*. The cost of this answer is stated
 * rather than hidden: a refresh that dies at `hierarchy` pays for a PDF transcription
 * a second time, and the per-chunk checkpoints that would prevent it are written
 * to a job-scoped `/tmp` no later job can see (landing D2).
 *
 * The whole forced set rather than only its first member, because `cascadeForce`
 * cannot always reconstruct the rest: it refuses to sweep in a step in
 * `FORCE_ONLY_WHEN_NAMED` (src/pipeline.ts) that nobody named, so a `tweets` the
 * reader explicitly asked to redo would be dropped. Handing back exactly what
 * was forced makes the retry ask for exactly what the original asked for; the
 * cascade is idempotent over that set, so `enqueue` recomputes the same flags.
 */
export function forceForRetry(steps: JobStep[]): StepName[] {
  return steps.filter((s) => s.force).map((s) => s.name);
}

/**
 * Forget a finished job. Its artefacts are untouched; only the record goes.
 *
 * The unlink waits for whatever is still writing this job. Terminal status
 * lands in the live map before its `persist` completes, so a poll can show
 * `done` and the reader can dismiss it while the rename is still in flight —
 * and an unlink that got there first would be undone by it, the forgotten job
 * reappearing at the next restart. Tombstoning as well as waiting, because a
 * write queued behind the delete would do the same thing.
 */
export async function forgetJob(id: string): Promise<boolean> {
  // `false` for somebody else's, as for a missing one — and the store is what
  // refuses a job that is still going, so there is one rule rather than two.
  return store.forget(id, currentOwnerId());
}
