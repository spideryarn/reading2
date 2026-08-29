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
 * transactional — docs/plans/transactional-stage-runner.md, which is not built.
 *
 * See docs/project/ingest-queue.md for the design and the library choice, and
 * docs/plans/durable-queue-and-uploads.md for the review that took the first
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
/* The store the pipeline reads and writes through. Named for the role rather
   than imported under its own name, because the role is what changes: the
   stages still write files themselves, so this is the filesystem one until
   step 11 half B moves the writes behind the seam, at which point this is the
   single line that picks Postgres instead. Deliberately not routed through
   src/store/index.ts — that file is the *reader's* store, and switching the
   pipeline over is a separate decision from switching reads over. */
import { costStore, totalRows } from "./store/ai-calls.js";
import { fsArtifacts as pipelineStore } from "./store/artifacts-fs.js";
import { fsJobStore } from "./store/jobs-fs.js";
import { pgJobStore } from "./store/pg-jobs.js";
import { mintAttempt, StaleAttemptError, type JobEnding, type JobStore } from "./store/jobs.js";
import { STORE } from "./store/live.js";
import { readRaw } from "./fetch.js";
import { failureKindOf } from "./job-failure.js";
import { isSlug, normaliseUrl, urlKey } from "./ingest.js";
import { errorFields, log, type Log, since } from "./log.js";
import { captureFailure } from "./monitoring.js";
import { currentOwnerId, type OwnerId, runAsOwner } from "./owner.js";
import { fsStoreSession } from "./store/session.js";
import type { JobTransition, StoreSession } from "./store/session.js";
import {
  articleExists,
  contextPaths,
  DEFAULT_INGEST_STEPS,
  FORCE_ONLY_WHEN_NAMED,
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
 * The lease is under Vercel's 300-second kill, so an invocation cannot outlive
 * its own claim — but that is a fact about one host, not a guarantee, and on a
 * laptop a model call can run as long as it likes. So the claimant sets **its
 * own timer** at `LEASE_MS - DEADLINE_MARGIN_MS` and aborts the step itself.
 *
 * That ordering is the whole point and it is why there is no heartbeat. A lease
 * that can be renewed means an expired lease says *probably dead*; a lease
 * nothing renews, with the claimant guaranteed to have unwound before it lapses,
 * means an expired lease says *definitely over its own deadline*. Only the
 * second is safe to act on, and `noteProgress` deliberately does not touch it.
 */
const LEASE_MS = 4 * 60_000;
const DEADLINE_MARGIN_MS = 20_000;

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
 * artefact the one before it wrote — so `["arc", "toc"]` run as asked would
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
 * docs/postmortems/toc-max-tokens.md for the failure that started it.
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
 * for it to be" is not a question the artefacts can answer — a forced `toc`
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
  note: () => Promise<void>,
  session: StoreSession,
  decide: () => JobTransition,
): Promise<{ outcome: StepOutcome; after?: Job; transition?: JobTransition }> {
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
    ...(job.guidance !== undefined && { guidance: job.guidance }),
    ...(job.profile !== undefined && { profile: job.profile }),
  };

  /* `session.reads`, not the store directly. The preflight and the run phase
     have to ask the same store, or a step decides whether to skip by looking at
     one place and does its work against another — which under Postgres means
     files on disk answering for rows in a draft. */
  if (!stillForced(step) && (await stepIsDone(STEPS[step.name], ctx, session.reads))) {
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
    const { result: product } = await collectSpend(() => STEPS[step.name].run(ctx, session.reads), {
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
    const after = await session.commit(ctx, STEPS[step.name], attempt, product, transition);
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
    return { outcome: "ran", after, transition };
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
  const after = await session.settleJob({ kind: "end", jobId: job.id, attempt, ending });
  await noteEnded(job, ending, jlog, startedMs);
  return after;
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
 * [GPT Sol](../docs/plans/durable-queue-and-uploads-review-sol.md) was right
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
   watching it. Designed in docs/plans/job-queue-rethink.md § Decided, and it is
   what makes docs/plans/ingest-resume.md work.
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
 * one article — the fault docs/plans/job-queue-rethink.md names in pgmq — and
 * the guess is only safe once every durable write is inside the fenced
 * transaction, which is docs/plans/transactional-stage-runner.md and is not
 * built.
 *
 * What makes an expired lease *mean* something in the meantime is the
 * claimant's own deadline: see `LEASE_MS`. It aborts itself first, so a lapsed
 * lease says "the process is gone" rather than "the process is slow".
 *
 * @returns null if there is no such job, so the route can 404.
 */
export async function advanceJob(id: string): Promise<Advanced | null> {
  const owner = currentOwnerId();

  /**
   * **The lease's enforcement, and it lives here rather than on a timer.**
   *
   * `failExpired` existed from the day the store was written and **nothing
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
   * It fails the job rather than taking it over — see the header — so the
   * reader sees a job that stopped and a Retry button, not a job that silently
   * restarted somewhere else.
   */
  const swept = await store.failExpired();
  if (swept > 0) {
    log("jobs").warn({ count: swept }, `failed ${swept} job(s) whose claimant stopped answering`);
  }

  /* `mintAttempt`, **not** `mintId`. `jobs.attempt_id` is a uuid column, and a
     `spya-` token is rejected by Postgres on the claim — the first statement of
     every advance. See the note on `mintAttempt`. */
  const attempt = mintAttempt();
  const outcome = await store.claim(id, owner, attempt, LEASE_MS);

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

  const job = outcome.job;
  /**
   * **The session, built here and nowhere else** — immediately after the claim
   * succeeded, and used for the whole of it.
   *
   * Not per step, and not per job. Every `/advance` mints a new attempt and runs
   * one step, and a Postgres draft reference embeds that attempt, so a session
   * built once per job is stale on the second request; one built per step could
   * not carry a draft at all. One per successful claim is the lifetime that
   * matches what a claim *is*, and it is what D1b needs
   * (docs/plans/delete-the-importer-d1-design-sol.md, finding 3).
   *
   * On the filesystem it holds no transaction and says so out loud
   * (src/store/session.ts). `src/jobs.ts:57` still picks the filesystem artefact
   * store; this line is where the Postgres session goes.
   */
  const session = fsStoreSession({ artifacts: pipelineStore, jobs: store });
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
   * run for as long as it likes, the lease lapses, `failExpired` marks the job
   * interrupted — and the step is still running, still spending, about to write
   * artefacts for a job that has been failed. Aborting ourselves first makes an
   * expired lease mean *the process is gone*, which is the only reading it is
   * safe to act on. See `LEASE_MS`.
   */
  let overran = false;
  const deadline = setTimeout(() => {
    overran = true;
    controller.abort(new Error(INTERRUPTED.message));
  }, LEASE_MS - DEADLINE_MARGIN_MS);

  const note = async () => {
    await store.noteProgress(job.id, attempt, job.steps);
  };

  try {
    /**
     * **What the job record should say once this step's artefacts are written.**
     *
     * Called from inside `runStep`, immediately before the commit, so that the
     * step's completion and the job's transition are one act — the boundary D1b
     * makes atomic. It used to be computed here, *after* `runStep` returned, and
     * that is precisely the shape the review said D1b would have to re-cut
     * (docs/plans/delete-the-importer-d1-design-sol.md, finding 1).
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
      const finished = job.steps.every((s) => s.status === "done" || s.status === "skipped");
      if (finished) {
        return { kind: "end", jobId: job.id, attempt, ending: endingFrom(job, "done") };
      }
      /* Not over: **let the claim go.** One claim covers one step, so the next
         request — a different token — can have it. Holding it across requests
         would leave the job `running` with a token nobody holds and every later
         advance told `busy` until the lease lapsed, which is this endpoint
         deadlocking itself on the happy path. GPT Sol, 2026-08-27. */
      return {
        kind: "release",
        jobId: job.id,
        attempt,
        steps: job.steps,
        fields: { ...(job.title !== undefined && { title: job.title }) },
      };
    };

    for (const step of job.steps) {
      const ran = await runStep(job, step, controller, jlog, note, session, transitionAfter);

      if (ran.outcome === "skipped") continue;

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

      /* It ran, and the commit inside it already moved the job — released the
         claim, or ended the job. One step per call, so stop here even if the
         next one would only skip: the caller comes straight back for it, and a
         request that returns keeps every step inside its own serverless
         invocation, which is the whole reason this endpoint exists. */
      const after = ran.after as Job;
      const ended = ran.transition?.kind === "end";
      if (ended && ran.transition?.kind === "end") {
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
        await noteEnded(job, ran.transition.ending, jlog, startedMs);
      }
      return { job: after, ran: step.name, busy: false, done: ended };
    }

    // Every step skipped: there was nothing left to do. A job re-added after
    // its article was already on the shelf lands here on its first call — and
    // it never reaches `commit`, which is why the ending goes through the
    // session's other door rather than being the one job write that does not.
    const after = await endJob(job, attempt, endingFrom(job, "done"), jlog, startedMs, session);
    return { job: after, ran: null, busy: false, done: true };
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
  guidance?: string;
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
  const workKey = workKeyFor(
    names,
    forced,
    request.guidance,
    request.profile,
    request.upload,
    request.url,
  );

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
   * **20 tries.** `freeSlug` and `freeUploadSlug` already walk to `-99`, so a
   * loop this long only runs when somebody else takes the name in the gap
   * between our asking and our inserting — twenty of those in a row is not a
   * collision, it is a fault.
   */
  let slug = request.url
    ? await freeSlug(request.slug, request.url)
    : request.upload
      ? await freeUploadSlug(request.slug, request.upload.id)
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
      ...(request.guidance ? { guidance: request.guidance } : {}),
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
       * re-allocating rather than appending a counter is right too: the racing
       * job is in the store now, so `freeSlug` sees it this time and derives the
       * next free name properly, where a counter would have to guess and could
       * land on a finished article's slug that only `articleExists` knows about.
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
        : await freeUploadSlug(request.slug, (request.upload as JobUpload).id);
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
  guidance?: string,
  profile?: string,
  upload?: JobUpload,
  url?: string,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        steps: names.map((n) => [n, forced.has(n)]),
        upload: upload?.id ?? "",
        guidance: guidance ?? "",
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
 * The job already working on this article, if there is one.
 *
 * Deliberately not exported. The check belongs *inside* `enqueue`, after its
 * awaits and immediately before the insert, because that is the only place with
 * no gap: `enqueue` awaits `ready()` and a read of meta.json, and two requests
 * arriving together will both get past any check made before those.
 */
async function activeFor(slug: string): Promise<Job | undefined> {
  return store.activeForSlug(slug, currentOwnerId());
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
 * The guidance is part of the comparison, and has to be. Without it, a reader
 * who presses "Write them again", changes their mind about what they are after,
 * and presses it once more gets handed the *first* job: it succeeds, the panel
 * refreshes, and the summaries are the ones written to the note they replaced.
 * Nothing anywhere would say so. Same trap the `steps` comparison was added
 * for, one field later.
 *
 * `?? ""` on both sides so "no steer" and "" are one case rather than two that
 * fail to match each other.
 */
export function sameWork(
  job: Job,
  names: StepName[],
  forced: Set<StepName>,
  guidance?: string,
  profile?: string,
  upload?: JobUpload,
  url?: string,
): boolean {
  if (job.steps.length !== names.length) return false;
  /* **Two uploads are never one piece of work**, whatever they are called and
     whatever steps they name. This is belt and braces — `freeUploadSlug` never
     hands two attempts the same slug, so `activeFor` should not have found the
     other one at all — and it is here because the cost of the two mechanisms
     disagreeing is that a reader watches somebody else's document succeed
     under their own filename. Sol's finding on the plan: `sameWork` compares
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
  if ((job.guidance ?? "") !== (guidance ?? "")) return false;
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
 * A slug for this URL that is not already some other article's.
 *
 * `slugFromUrl` takes the last path segment, so `a.example/news` and
 * `b.example/news` both come out as `news` — and the second one is the
 * dangerous case, not the first. Every artefact is already on disk, so all five
 * steps skip, the job reports success in about a second, and the reader is
 * shown *a different publication's article* under the headline they pasted.
 * Nothing errors, and the check anyone would run — "is it on the shelf?" —
 * says yes. [Silent success](docs/reusable/silent-success.md) again.
 *
 * So: if a directory already holds a `meta.json` for a different URL, move
 * aside. The host first, which is the same disambiguation `slugFromUrl` already
 * applies to bare numeric ids and reads far better than a number; a counter
 * after that, for the case where even the host matches.
 *
 * The add box's preview can therefore be one slug out on a collision. That is
 * the right way round: the box guesses before asking, the server knows, and the
 * job card shows what the server decided.
 *
 * ## "A different URL" is a judgement, not a string comparison
 *
 * > And will this de-dupe correctly if near-identical versions of the url are
 * > used, e.g. http vs https or without url protocol or capitalised similar
 * > non-significant changes, or if we already have the article?
 * >
 * > — Greg, 2026-08-26
 *
 * It did not. This compared the two URLs as **strings**, so every one of those
 * spellings read as a different article: adding `http://x.test/piece` when the
 * shelf held `https://x.test/piece` stepped aside to `x-piece`, re-fetched it,
 * re-extracted it, and paid for a second tree and a second arc — and then put
 * two cards on the shelf under the same headline. Nothing errored, and the
 * check anyone would run said the article was there. `urlKey` (src/ingest.ts)
 * is the comparison now, and it is the only thing in the codebase that decides
 * whether two addresses are one article.
 *
 * ## The claim lookup, and why it is an argument
 *
 * A slug can be spoken for by two different things, and the second only exists
 * for a few minutes: a `meta.json` on disk, or **a job that is queued or
 * running right now** and has not written one yet. Without the second, two
 * different articles with the same last path segment added within a minute of
 * each other both get the bare slug — and the later one is then handed the
 * earlier one's job by `activeFor` below and quietly never happens.
 *
 * Passing the lookup in also means every decision above can be tested without a
 * filesystem, a network or a queue, which is
 * [`tests/jobs.test.ts`](../tests/jobs.test.ts) § freeSlug. The default is the
 * one line those tests do not cover.
 */
export async function freeSlug(
  slug: string,
  url: string,
  claimedBy: (candidate: string) => Promise<string | undefined> = onShelfOrInFlight,
): Promise<string> {
  const wanted = urlKey(url);
  const taken = async (candidate: string) => {
    const claim = await claimedBy(candidate);
    return claim !== undefined && urlKey(claim) !== wanted;
  };
  if (!(await taken(slug))) return slug;

  const host = new URL(normaliseUrl(url)).hostname.replace(/^www\./, "").replace(/\.[a-z]+$/, "");
  const withHost = `${host.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${slug}`;
  if (isSlug(withHost) && !(await taken(withHost))) return withHost;

  for (let n = 2; n < 100; n++) {
    const numbered = `${slug}-${n}`;
    if (!(await taken(numbered))) return numbered;
  }
  throw Object.assign(new Error(`Too many articles already called "${slug}".`), { status: 409 });
}

/**
 * A slug for an uploaded file that is **not already something else's**, ever.
 *
 * The sibling of `freeSlug`, and the difference is the whole of it: `freeSlug`
 * may *adopt* an existing slug, because the thing that decides is `urlKey` and
 * two spellings of one address really are one article. An upload has no address
 * to compare, so there is nothing that could make two of them the same article
 * — and Greg's answer settles what that means:
 *
 * > If it was previously uploaded by a different user, then reuse the source
 * > object, but add a new per-user article object.
 * >
 * > — Greg, 2026-08-26
 *
 * A new article every time. The source object is shared by content hash in the
 * blob store (`canonicalKey`), which is where sharing belongs; the *article* is
 * per-reader and per-upload, so two files called `paper.pdf` get two of them.
 *
 * **The existence check is `articleExists`, not `urlForSlug`.** An uploaded
 * article has no URL in its `meta.json`, so the lookup `freeSlug` uses reads
 * `undefined` for one and calls the slug free. That is the exact collision the
 * plan's test asserts against, and it fails open — every step finds an
 * artefact, skips, and the reader is shown a different document under their own
 * filename in about a second. See docs/reusable/silent-success.md.
 *
 * The counter is deliberately the only fallback. `freeSlug` can prefix a host
 * because a URL has one; a filename has nothing equivalent, and prefixing the
 * upload id would make a directory name nobody can read.
 */
export async function freeUploadSlug(
  slug: string,
  uploadId: string,
  claimed: (candidate: string, mine: string) => Promise<boolean> = slugIsSpokenFor,
): Promise<string> {
  if (!(await claimed(slug, uploadId))) return slug;
  for (let n = 2; n < 100; n++) {
    const numbered = `${slug}-${n}`;
    if (isSlug(numbered) && !(await claimed(numbered, uploadId))) return numbered;
  }
  throw Object.assign(new Error(`Too many articles already called "${slug}".`), { status: 409 });
}

/**
 * Is this slug something *other* than this upload's own article?
 *
 * The `mine` argument is what makes Retry work, and leaving it out is a bug
 * that only shows on the second attempt: without it, retrying a job whose
 * `paper.pdf` already reached stage 3 finds `data/paper/` occupied — by itself
 * — steps aside to `paper-2`, and re-runs from the top, paying for the
 * transcription a second time and leaving a half-built `paper` behind. An
 * article is this upload's own when its manifest says so, which is a fact on
 * disk rather than a flag anyone has to remember to pass.
 *
 * A job in flight counts as a claim too. A finished `meta.json` is not the only
 * way a slug is spoken for — two uploads a few seconds apart would otherwise
 * both find the directory empty and both take it.
 */
async function slugIsSpokenFor(candidate: string, mine: string): Promise<boolean> {
  const other = await activeFor(candidate);
  if (other && other.upload?.id !== mine) return true;
  if (!(await articleExists(candidate))) return false;
  const manifest = await readRaw(contextPaths(candidate).dir);
  return !(manifest?.origin === "upload" && manifest.uploadId === mine);
}

/**
 * What already lays claim to a slug: the article on disk, or the job on its way
 * to becoming one.
 *
 * `meta.json` first and it wins outright — a finished article is a fact, and an
 * in-flight job for the same slug is by definition working on that same
 * article, since it got the slug from here in the first place.
 */
async function onShelfOrInFlight(candidate: string): Promise<string | undefined> {
  return (await urlForSlug(candidate)) ?? (await activeFor(candidate))?.url;
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
 * the uploaded filename, the reader's guidance text and the error message. It
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
 * **Force is recomputed, not copied.** A refresh forces all five steps, so
 * copying the flags across would make Retry re-fetch, re-extract and re-split
 * an article whose first three stages had already succeeded — and pay for the
 * model call again — which is the opposite of what Retry says it does. What
 * carries over is the *reason* those steps were forced, which only still
 * applies to the ones that have not run yet: force from the first step that did
 * not finish, and let `cascadeForce` take it from there.
 */
export async function retryJob(id: string): Promise<Job | null> {
  /* Somebody else's is `null`, as a missing one is — and this one spends money,
     so it is the worst of the four to leave open. */
  const old = await store.get(id, currentOwnerId());
  if (!old) return null;

  return await enqueue({
    slug: old.slug,
    ...(old.url ? { url: old.url } : {}),
    ...(old.upload ? { upload: old.upload } : {}),
    steps: old.steps.map((s) => s.name),
    force: forceForRetry(old.steps),
    // Copied, unlike force. The steer is not a thing the first attempt used up
    // — a retry of a summary run that was steered is still that run.
    ...(old.guidance ? { guidance: old.guidance } : {}),
    ...(old.profile ? { profile: old.profile } : {}),
  });
}

/**
 * What a retry should force, given how far the original got.
 *
 * Nothing, for an ordinary failure — the steps that succeeded are still good,
 * and skipping them is the whole point of Retry. Something only when the
 * original was forced, and then only from the first step that did not finish:
 * a refresh that died during `toc` has already re-fetched and re-extracted, and
 * making Retry do all of that again is the opposite of picking up where it
 * stopped. `cascadeForce` takes it from there.
 */
export function forceForRetry(steps: JobStep[]): StepName[] {
  if (!steps.some((s) => s.force)) return [];
  const unfinished = steps.find((s) => s.status !== "done" && s.status !== "skipped");
  return unfinished ? [unfinished.name] : [];
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
