/**
 * The ingest queue: one article at a time, and a record of how it went.
 *
 * > There should be some kind of queue that processes things … and ideally a
 * > progress indicator.
 * >
 * > — Greg, 2026-08-25
 *
 * Three things live here — the queue (p-queue, concurrency 1), the job records
 * and their persistence under `data/_jobs/`, and the sweep that turns jobs
 * abandoned by a server restart into visible errors. The *pipeline* is
 * src/pipeline.ts; this file knows how to run a list of steps and nothing about
 * what any of them do.
 *
 * See docs/project/ingest-queue.md for the design, the library choice, and an
 * honest account of what "idempotent" does and does not mean here yet.
 */
import PQueue from "p-queue";
import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { mintId } from "./ids.js";
/* The store the pipeline reads and writes through. Named for the role rather
   than imported under its own name, because the role is what changes: the
   stages still write files themselves, so this is the filesystem one until
   step 11 half B moves the writes behind the seam, at which point this is the
   single line that picks Postgres instead. Deliberately not routed through
   src/store/index.ts — that file is the *reader's* store, and switching the
   pipeline over is a separate decision from switching reads over. */
import { fsArtifacts as pipelineStore } from "./store/artifacts-fs.js";
import { readRaw } from "./fetch.js";
import { failureKindOf } from "./job-failure.js";
import { isSlug, normaliseUrl, urlKey } from "./ingest.js";
import { errorFields, log, type Log, since } from "./log.js";
import {
  articleExists,
  assertProduced,
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
import type { FailureKind } from "./messages.js";
import type { Job, JobStep, JobUpload, StepName } from "./types.js";

/* `JobStatus` and `StepStatus` were on this line too and nothing imported them
   from either module — they are only ever used structurally, inside types.ts,
   as the type of `Job.status` and `JobStep.status`. */
export type { Job, JobStep, StepName } from "./types.js";

const ROOT = path.resolve(import.meta.dirname, "..");

/**
 * `data/_jobs/`, and the underscore is load-bearing.
 *
 * Jobs live under `data/` because they are per-installation state like
 * everything else there, and `data/` is gitignored. The prefix keeps them out
 * of the article namespace: `listArticles` walks `data/*` and skips names
 * starting with `_` explicitly (src/api.ts) rather than relying on this
 * directory happening to lack a blocks.json.
 */
const JOBS_DIR = path.join(ROOT, "data", "_jobs");

/**
 * The jobs this process knows about, live.
 *
 * In memory as well as on disk because progress is written far more often than
 * it is worth persisting — the model steps report every half second — and
 * because a poll should never lose a race with a write. Disk is what survives a
 * restart; this map is what answers a request.
 */
const jobs = new Map<string, Job>();

/** Abort handles for jobs that are queued or running, so they can be cancelled. */
const aborts = new Map<string, AbortController>();

/**
 * Concurrency 1, deliberately.
 *
 * Three of the six steps are long model calls billed by the token, and one is a
 * fetch of somebody else's server. Running two articles at once would double
 * the spend rate, halve the politeness, and make the progress display a race —
 * for a single reader adding a handful of articles a day, in exchange for
 * nothing. Raise it here if that ever stops being true.
 */
const queue = new PQueue({ concurrency: 1 });

function jobFile(id: string): string {
  return path.join(JOBS_DIR, `${id}.json`);
}

/**
 * One write at a time per job, and the last one in flight for each.
 *
 * Two writes for one job can overlap, and one pair did: cancelling a running
 * job made p-queue reject the outer promise — whose `.catch` wrote the job as
 * cancelled — while `runJob` was independently unwinding and writing the same
 * job from its own error path. Both renamed the same temp file, the second got
 * ENOENT because the first had already moved it, and the unhandled rejection
 * **killed the dev server**.
 *
 * That particular pair is gone (the signal no longer goes to `queue.add` — see
 * the note there), but serialising is the right answer regardless: it is not
 * worth having to prove, every time a transition is added, that no two of them
 * can ever be in flight together.
 */
const writes = new Map<string, Promise<void>>();

/** Jobs the reader has dismissed. A late write must not bring one back. */
const forgotten = new Set<string>();

/** Distinct per call, so two writes for the same job cannot share a temp file. */
let writeCounter = 0;

async function writeOnce(job: Job): Promise<void> {
  await mkdir(JOBS_DIR, { recursive: true });
  /* Write, then rename. A job file is read by whatever starts next after a
     crash, so a half-written one is worse than a missing one: it parses as
     nothing and takes the record of what happened with it. `rename` within a
     directory is atomic, so a reader sees the old file or the new one, never
     half of either. The suffix carries a counter as well as the pid — the pid
     alone is constant within a process, which is exactly the case that broke. */
  const tmp = `${jobFile(job.id)}.${process.pid}.${++writeCounter}.tmp`;
  await writeFile(tmp, `${JSON.stringify(job, null, 2)}\n`, "utf8");
  await rename(tmp, jobFile(job.id));
}

/**
 * Queue a write behind whatever is already writing this job.
 *
 * **Never rejects.** A job record is a convenience — the in-memory map is what
 * answers every request — and a full disk should not be able to kill the reader's
 * server from inside a background job. But it is not nothing either: it is what
 * the restart sweep reads, so a failure is said out loud rather than swallowed.
 */
function persist(job: Job): Promise<void> {
  const next = (writes.get(job.id) ?? Promise.resolve())
    .then(() => (forgotten.has(job.id) ? undefined : writeOnce(job)))
    .catch((err: Error) => {
      /* `errorFields`, not `err.message`. This line used to be a `console.error`
         that printed the message and threw the stack away — and the stack is the
         only part that says *which* write failed, out of the several this file
         queues. That loss is the whole reason the logger exists. */
      log("jobs").error(
        { ...errorFields(err), jobId: job.id, slug: job.slug },
        `could not write the record for job ${job.id} — ${job.slug}`,
      );
    });
  writes.set(job.id, next);
  // Drop the chain once it drains, so finished jobs do not sit in this map for
  // as long as the process lives.
  void next.then(() => {
    if (writes.get(job.id) === next) writes.delete(job.id);
  });
  return next;
}

/* ---------------------------------------------------------------- startup --
   Anything on disk marked `running` was left there by a process that is no
   longer alive — this one has just started and its queue is empty. Saying so
   out loud is the whole point: a status of `running` on disk does not mean work
   is happening, and a spinner that spins for ever is the worst of the available
   outcomes. Exactly the argument `sweepOrphaned` makes for orphaned comments in
   src/routes.ts.

   What it says instead changed on 2026-08-26, and the change is the whole of
   `docs/plans/ingest-resume.md` § 2. */

/**
 * A job the process stopped under is **waiting**, not failed.
 *
 * Returns true if anything changed, so the caller knows whether to write.
 *
 * ## Why this stopped meaning `error`
 *
 * It used to mark the job `error` with *"The server stopped before this
 * finished"*, and mark its running step `error` too. That reasoning was sound
 * for one long-lived process — this process has just started, so nothing can be
 * running, so anything that says it is running is a lie — and it is wrong the
 * moment work is *expected* to pause and continue. Closing a tab, restarting
 * the dev server, or a serverless instance being torn down between steps are
 * all interruptions, not faults, and calling them failures put a red card and a
 * Retry button in front of the reader for something that had gone perfectly
 * well up to that point.
 *
 * With `POST /api/jobs/:id/advance` (`advanceJob` below) there is now something
 * that picks a paused job back up, so "waiting" is a state with a way out of it
 * rather than a nicer word for stuck.
 *
 * ## Why `queued` and not a sixth status
 *
 * Because `queued` already means exactly this: *nobody is running this job and
 * it still has work to do*. A `waiting` or `paused` member of `JobStatus` would
 * have to be learned by every switch over it — `isBusy` in
 * src/web/useJobs.ts, `activeFor` and `prune` and `forgetJob` here, the busy
 * check on the card in src/web/AddArticle.tsx — and every one of those would
 * want to treat it the way it already treats `queued`. A status nothing
 * distinguishes is not a status.
 *
 * The one thing this loses is the *reason* the job stopped, and it is worth
 * losing: a job that carries on where it left off does not need to explain an
 * interruption the reader may never have noticed.
 *
 * ## The running step goes back to `pending`, not to `error`
 *
 * It did not fail; it did not happen. `beginStep`'s marker in the artefact
 * store (src/store/artifacts.ts) is what stops its half-written output being
 * mistaken for a finished one, so `stepIsDone` will answer false and the step
 * will run again — which is the resume, and it is derived from the artefacts
 * rather than from this status.
 *
 * ## Except when the reader had already pressed Stop
 *
 * `cancelling` means an abort was asked for and had not landed when the process
 * went. Nothing is going to deliver it now, and resuming a job somebody stopped
 * would be the one interruption they *did* notice. So that one lands
 * `cancelled`, which is what they asked for.
 */
export function sweepStopped(job: Job): boolean {
  if (job.status !== "running" && job.status !== "queued") return false;

  let changed = false;
  for (const step of job.steps) {
    if (step.status === "running") {
      step.status = "pending";
      delete step.startedAt;
      changed = true;
    }
  }

  if (job.cancelling) {
    markCancelled(job);
    return true;
  }

  if (job.status !== "queued") {
    job.status = "queued";
    changed = true;
  }
  return changed;
}

/** The three statuses a job never leaves. */
function isFinished(job: Job): boolean {
  return job.status === "done" || job.status === "error" || job.status === "cancelled";
}

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

let loaded: Promise<void> | null = null;

async function loadFromDisk(): Promise<void> {
  let files: string[] = [];
  try {
    files = (await readdir(JOBS_DIR)).filter((f) => f.endsWith(".json"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    return; // nothing has ever been queued here
  }

  /* Collected and reported once, rather than a line each.
     `data/_jobs/` grows without limit until `prune` runs, so "one warn per
     unreadable file" is bounded by nothing — and this runs on the first request
     after a cold start, where Vercel allows 256 log lines for the whole
     request. A hundred corrupt records would spend the entire budget saying the
     same thing a hundred times, and bury the request that triggered it.
     A count, plus enough names to go and look. Raised by GPT/Codex in review. */
  const unreadable: string[] = [];

  for (const file of files) {
    let job: Job;
    try {
      job = JSON.parse(await readFile(path.join(JOBS_DIR, file), "utf8")) as Job;
    } catch {
      unreadable.push(file);
      continue;
    }
    if (sweepStopped(job)) await persist(job);
    jobs.set(job.id, job);
  }

  /* Still not worth failing a page load over — but not worth passing over in
     silence either. A record that will not parse means a process died in the
     middle of writing it, which is a thing that happened rather than a thing
     that is missing, and the file names are the only clue left to it. */
  if (unreadable.length > 0) {
    log("jobs").warn(
      { count: unreadable.length, files: unreadable.slice(0, 5), of: files.length },
      `skipped ${unreadable.length} unreadable job record(s) of ${files.length}`,
    );
  }
}

/** Load once, and make every entry point wait for it. */
function ready(): Promise<void> {
  loaded ??= loadFromDisk();
  return loaded;
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
 * **Never throws.** A failure is an outcome, recorded on the job and on the
 * step, because both callers have to persist the same story about it.
 */
async function runStep(
  job: Job,
  step: JobStep,
  controller: AbortController,
  jlog: Log,
): Promise<StepOutcome> {
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

  if (!stillForced(step) && (await stepIsDone(STEPS[step.name], ctx, pipelineStore))) {
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
    await persist(job);
    return "skipped";
  }

  /* Timed here rather than read back off `startedAt`/`finishedAt`. Those are
     ISO strings because they go to the browser, and a duration you have to
     subtract two strings to get is a duration nobody charts. */
  const stepStarted = Date.now();
  step.status = "running";
  step.startedAt = new Date().toISOString();
  delete step.error;
  jlog.debug({ step: step.name }, `step starting: ${step.name} — ${job.slug}`);
  await persist(job);

  try {
    /* Bracketing the run, not decorating it. A step that dies between two of
       its own writes leaves artefacts that all exist and all parse and
       describe two different generations, and nothing about the files can
       say so — so the marker is what says so. It is cleared only on the
       success path below, which means a throw, a cancel or a kill all leave
       the step honestly not-done. See `beginStep` in
       src/store/artifacts.ts. */
    const attempt = await pipelineStore.beginStep(job.slug, step.name);
    step.detail = await STEPS[step.name].run(ctx);
    await assertProduced(STEPS[step.name], ctx, pipelineStore);
    /* **Before the abort check, not after.** A cancel here is about the job,
       not about this step: `run` returned and its postcondition passed, so
       the work is real and paid for. Clearing the marker after the throw
       would leave a completed step looking interrupted, and the Retry that
       follows a cancel would buy the same model call twice. */
    await pipelineStore.finishStep(job.slug, step.name, attempt);
    step.status = "done";
    step.finishedAt = new Date().toISOString();
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
    jlog.info({ step: step.name, ms: since(stepStarted) }, `step done: ${step.name} — ${job.slug}`);
    // The title only exists once extraction has run, and the moment it does
    // is the moment the progress card can stop calling the article by its slug.
    if (step.name === "extract") job.title = step.detail;
    await persist(job);
    return "ran";
  } catch (err) {
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
        { step: step.name, ms: since(stepStarted) },
        `step cancelled: ${step.name} — ${job.slug}`,
      );
    } else {
      jlog.error(
        { ...errorFields(err), step: step.name, ms: since(stepStarted) },
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
      await persist(job);
      return "cancelled";
    }
    job.status = "error";
    job.error = message;
    recordFailureKind(job, failureKindOf(err));
    job.finishedAt = new Date().toISOString();
    delete job.cancelling;
    await persist(job);
    return "failed";
  }
}

/**
 * Every step is done or skipped: close the job off.
 *
 * Shared by both drivers for the same reason `runStep` is — the pruning and the
 * one-line-per-job log are part of finishing, not part of looping.
 */
async function finishDone(job: Job, jlog: Log, startedMs: number): Promise<void> {
  job.status = "done";
  job.finishedAt = new Date().toISOString();
  delete job.cancelling;
  await persist(job);
  jlog.info({ ms: since(startedMs), status: "done" }, `job done: ${job.slug}`);
  await prune();
}

/**
 * Run one job's steps in order, stopping at the first failure.
 *
 * **Stopping is right, not lazy.** Every step consumes the artefact the one
 * before it wrote, so carrying on past a failure would run the two expensive
 * model calls against whatever stale file happened to be on disk — and produce
 * a tree for the previous version of the article, which looks entirely fine.
 */
async function runJob(job: Job, controller: AbortController): Promise<void> {
  /* A child logger, made here and used locally. Not a module-level "current
     job" variable: Vercel's Fluid Compute runs several requests concurrently in
     one instance, so a shared one would stamp lines with whichever article was
     most recently started — intermittently, and only in production. Rule 4 at
     the top of src/log.ts. */
  const jlog = log("jobs").child({ jobId: job.id, slug: job.slug });
  const jobStarted = Date.now();

  /* One line per job however it ends, so an ingest can be found by its end as
     well as its start. `warn` for a cancel, because the reader chose it and it
     is neither a fault nor a clean finish. An `error` outcome stays at `info`
     here on purpose — the step that failed has already logged the stack at
     `error`, and repeating it would double every failure in an alert count. */
  const finished = (status: Job["status"]) => {
    const line = { ms: since(jobStarted), status };
    if (status === "cancelled") jlog.warn(line, `job cancelled: ${job.slug}`);
    else jlog.info(line, `job ${status}: ${job.slug}`);
  };

  // Cancelled while it sat in the queue. `cancelJob` cannot mark it for us —
  // p-queue no longer removes it (see the note at `queue.add`) — so the check
  // belongs here, before anything is written.
  if (controller.signal.aborted) {
    markCancelled(job);
    await persist(job);
    finished("cancelled");
    return;
  }

  job.status = "running";
  job.startedAt = new Date().toISOString();
  await persist(job);

  for (const step of job.steps) {
    if (controller.signal.aborted) {
      markCancelled(job);
      await persist(job);
      finished("cancelled");
      return;
    }

    const outcome = await runStep(job, step, controller, jlog);
    if (outcome === "cancelled" || outcome === "failed") {
      finished(job.status);
      return;
    }

    /* Checked after as well as before — a step that ignores the signal runs
       to completion regardless, and starting the next one would spend a
       model call on a job the reader has already stopped.
       **And checked here, after this step is recorded done, rather than by
       throwing.** Unwinding a finished step through `runStep`'s catch marked it
       `error`, and `forceForRetry` then forces the first step that is not
       done — so pressing Stop as `toc` finished, then Retry, bought that
       model call a second time. Moving `finishStep` earlier did not fix that
       on its own, because the *job record*, not the marker, is what Retry
       reads. Found by review, 2026-08-26; the first fix for it was
       incomplete.

       Only after a step that actually **ran**. A skip costs nothing and did not
       observe the signal, so the check at the top of the next turn is the right
       place to notice a cancel that arrived during one. */
    if (outcome === "ran" && controller.signal.aborted) {
      jlog.debug({ step: step.name }, `job cancelled after ${step.name} — ${job.slug}`);
      markCancelled(job, "Cancelled");
      await persist(job);
      finished("cancelled");
      return;
    }
  }

  await finishDone(job, jlog, jobStarted);
}

/* ------------------------------------------------------------- advancing --

   The other way a job moves: one step per HTTP request, driven by whoever is
   watching it. Designed in docs/plans/job-queue-rethink.md § Decided, and it is
   what makes docs/plans/ingest-resume.md work.
   -------------------------------------------------------------------------- */

/**
 * Jobs an `advanceJob` call is inside a step of, right now, in this process.
 *
 * Separate from `aborts` even though `advanceJob` writes to both, because the
 * two answer different questions: `aborts` is *"can this be stopped"* and is
 * also set for every job sitting in the p-queue, while this is *"is a request
 * already running a step of this one"*. Keeping them apart is what lets the
 * log line say which of the two owners turned a caller away.
 */
const advancing = new Set<string>();

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
 * ## How this and the in-process queue keep out of each other's way
 *
 * They do not share work; they take turns, and the rule is **advance refuses
 * while the queue owns the job**.
 *
 * `enqueue` puts an `AbortController` in `aborts` the moment it creates a job
 * and removes it only when the p-queue's promise for that job has settled — so
 * `aborts.has(id)` is exactly "this process still intends to run it". Advance
 * checks that first and answers `busy`, which the client reads as *wait and ask
 * again*. Nothing is lost: the queue is finishing the job, and the browser's
 * poll shows it happening.
 *
 * That makes advance a **no-op for a job this process queued**, which is most
 * jobs on this laptop, and exactly the point. What is left for it is the case
 * the queue cannot serve: a job whose process is gone. On Vercel that is every
 * job after the invocation that started it freezes; here it is a job that
 * survived a dev-server restart, which `sweepStopped` now leaves `queued` and
 * waiting rather than marking failed.
 *
 * **What this deliberately does not do:** take a job away from an owner that
 * has stopped making progress. A frozen instance that still holds an entry in
 * `aborts` will keep answering `busy` for as long as it lives, and no amount of
 * elapsed time will change that answer. Guessing that an owner is dead is how
 * two runners end up writing one article — the fault
 * docs/plans/job-queue-rethink.md names in pgmq — and the honest fix is the
 * attempt token and the fenced write, which is item 2 and item 3 of that plan's
 * list and is not built yet. Until then the recovery is Stop, then Retry.
 *
 * @returns null if there is no such job, so the route can 404.
 */
export async function advanceJob(id: string): Promise<Advanced | null> {
  await ready();
  const job = jobs.get(id);
  if (!job) return null;

  // Already over. Safe to call for ever, which is what makes a client loop that
  // races its own poll harmless.
  if (isFinished(job)) return { job, ran: null, busy: false, done: true };

  /* Somebody else has it. The p-queue (see the note above) or another request
     mid-step. `cancelling` counts too: Stop has been pressed and the abort has
     not landed, so starting another step would spend a model call on a job the
     reader has already stopped. */
  if (aborts.has(job.id) || advancing.has(job.id) || job.cancelling === true) {
    return { job, ran: null, busy: true, done: false };
  }

  /* A child logger, made here and used locally — never a module-level "current
     job". Rule 4 at the top of src/log.ts, and it matters more here than in
     `runJob`: several advance requests for *different* jobs really can be in
     flight in one instance at once. */
  const jlog = log("jobs").child({ jobId: job.id, slug: job.slug });
  const startedMs = Date.now();
  const controller = new AbortController();

  /* Claimed **synchronously**, before the first `await` below. Two requests
     arriving together are two turns of one event loop, so as long as nothing
     yields between the check above and these two lines, the second one sees the
     claim. Put an `await` in that gap and both start a step. */
  advancing.add(job.id);
  aborts.set(job.id, controller);

  try {
    if (job.status !== "running") {
      job.status = "running";
      // `??=`: a resumed job started once already, and the card's "how long has
      // this been going" should not restart every time a tab picks it back up.
      job.startedAt ??= new Date().toISOString();
      await persist(job);
    }

    for (const step of job.steps) {
      const outcome = await runStep(job, step, controller, jlog);

      if (outcome === "skipped") continue;

      if (outcome === "cancelled" || outcome === "failed") {
        /* Read off the outcome rather than off `job.status`, which the compiler
           has narrowed to "running" from the assignment above and cannot know
           `runStep` just changed. Same two lines `runJob`'s `finished` writes:
           `warn` for a cancel, because the reader chose it and it is neither a
           fault nor a clean finish; `info` for an error, because the step that
           failed has already logged the stack. */
        const status = outcome === "cancelled" ? "cancelled" : "error";
        const line = { ms: since(startedMs), status, step: step.name };
        if (status === "cancelled") jlog.warn(line, `job cancelled: ${job.slug}`);
        else jlog.info(line, `job error: ${job.slug}`);
        return { job, ran: step.name, busy: false, done: true };
      }

      // It ran. One step per call, so stop here — even if the next one would
      // only skip. The caller comes straight back for it, and a request that
      // returns keeps every step inside its own serverless invocation, which
      // is the whole reason this endpoint exists.
      if (controller.signal.aborted) {
        jlog.debug({ step: step.name }, `job cancelled after ${step.name} — ${job.slug}`);
        markCancelled(job, "Cancelled");
        await persist(job);
        return { job, ran: step.name, busy: false, done: true };
      }
      const finished = job.steps.every((s) => s.status === "done" || s.status === "skipped");
      if (finished) await finishDone(job, jlog, startedMs);
      return { job, ran: step.name, busy: false, done: finished };
    }

    // Every step skipped: there was nothing left to do. A job re-added after
    // its article was already on the shelf lands here on its first call.
    await finishDone(job, jlog, startedMs);
    return { job, ran: null, busy: false, done: true };
  } finally {
    advancing.delete(job.id);
    // Only ours. `aborts` is keyed by job id and this call put the entry there,
    // so deleting it here cannot take the p-queue's — the check at the top
    // guarantees there wasn't one.
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
  await ready();

  // `DEFAULT_INGEST_STEPS`, not `STEP_ORDER`. They were the same list until
  // `tweets` arrived — a step you can ask for by name that must not run on
  // every add, because it costs a model call nobody asked for.
  const names = orderSteps(request.steps ?? DEFAULT_INGEST_STEPS);
  if (names.length === 0) {
    throw Object.assign(new Error("A job needs at least one step."), { status: 400 });
  }

  // A fresh add carries a URL; a late step run on its own takes it from disk.
  // When both exist and disagree, `freeSlug` has already moved us to a slug of
  // our own, so this cannot silently adopt somebody else's article.
  let slug = request.url
    ? await freeSlug(request.slug, request.url)
    : request.upload
      ? await freeUploadSlug(request.slug, request.upload.id)
      : request.slug;
  /* **Never for an upload**, and not only because it would find nothing. It
     reads the `meta.json` at `slug`, and `slug` can still move below — so a
     URL read here from an article we then step aside from would be carried onto
     a job for a *different* document. It is also an `await`, and the
     reconciliation below has to be the last thing before the insert. */
  const url = request.url ?? (request.upload ? undefined : await urlForSlug(slug));
  const forced = cascadeForce(names, new Set(request.force ?? []));

  // Already in hand: hand back the job doing it rather than starting a second
  // one over the same files. A double-click on Add is all it takes, and the
  // second job would run every step against artefacts the first had just
  // written, report a row of successes, and cost two more model calls for a
  // result nobody asked for.
  //
  // **Only for an identical request.** Matching on the slug alone would let a
  // queued `{steps:["arc"]}` swallow a refresh that arrived a second later —
  // the caller gets a job id, watches it succeed, and the refresh never
  // happened. Anything else queues behind, which is safe: concurrency is 1 and
  // a cancelled job now really does release its slot last (see `queue.add`).
  const running = activeFor(slug);
  if (running && sameWork(running, names, forced, request.guidance, request.profile, request.upload))
    return running;

  /* **The last word on the slug, and it has to be here rather than in
     `freeUploadSlug`.** That function does I/O — `articleExists` reads a file —
     so between the answer it gives and the `jobs.set` below there is an `await`
     that another request can run inside. Two uploads called `paper.pdf`,
     arriving together, both see `paper` free and both take it; `sameWork` says
     they are different work, so neither is handed the other's job, and the
     second one's steps then find the first one's artefacts, skip, and report a
     row of successes over somebody else's document.

     From here to `jobs.set` there is no `await`, and `activeFor` reads the same
     in-memory map, so re-asking synchronously closes the window completely
     *within this process*. Across processes it does not, and nothing in this
     file does — that is the same gap `data/_jobs/` has, and it closes when the
     queue moves to Postgres (docs/plans/job-queue-rethink.md).

     Uploads only. A URL is allowed to land on an existing slug: `freeSlug`
     compares `urlKey`, so an occupied slug means *the same article*, which is
     exactly what should be joined rather than avoided. GPT Sol, 2026-08-27. */
  if (request.upload) {
    for (let tries = 0; tries < 20; tries++) {
      const held = activeFor(slug);
      /* Free, or held by this very upload (a retry). Either way it is ours, and
         **this check is the last thing before the insert with no `await` after
         it** — which is what makes it airtight rather than merely narrower. */
      if (!held || held.upload?.id === request.upload.id) break;
      /* Re-allocated rather than bumped with a counter. The racing job is in
         the map now, so `freeUploadSlug` *sees* it this time and derives the
         next free name properly — where a counter appended here would have to
         guess, and could land on a finished article's slug that only
         `articleExists` knows about. */
      slug = await freeUploadSlug(request.slug, request.upload.id);
    }
  }

  const job: Job = {
    id: mintId(),
    slug,
    ...(url ? { url } : {}),
    ...(request.upload ? { upload: request.upload } : {}),
    steps: names.map((n) => newStep(n, forced.has(n), request.upload !== undefined)),
    status: "queued",
    createdAt: new Date().toISOString(),
    ...(request.guidance ? { guidance: request.guidance } : {}),
    ...(request.profile ? { profile: request.profile } : {}),
  };

  jobs.set(job.id, job);
  const controller = new AbortController();
  aborts.set(job.id, controller);
  await persist(job);

  /* The step list and the forced list, because "why did this job cost two model
     calls" and "why did it finish in a second" are both answered here and
     nowhere else. Not the URL: `slug` already identifies the article, and the
     log is a reading history either way — see the note on `url` in src/log.ts. */
  log("jobs").info(
    { jobId: job.id, slug, steps: names, forced: [...forced] },
    `job queued: ${slug} — ${names.join(", ")}${forced.size ? ` (forced: ${[...forced].join(", ")})` : ""}`,
  );

  /* **No `signal` on `queue.add`.**
   *
   * It looks like exactly the right option and it is a trap. p-queue races the
   * running task against the signal: on abort it rejects the outer promise and
   * *starts the next task immediately*, without waiting for the aborted one to
   * unwind. Verified against the installed version — the order is
   * `old-start, new-start, old-rejected, old-end`.
   *
   * Which means cancelling a running job releases the slot while its stage is
   * still running. Press Stop and then Retry and the retry's `blocks` can be
   * rewriting the HTML and the ids while the cancelled one is still writing
   * them, because `runBlocks` does not watch the signal. Concurrency 1 stops
   * being true at precisely the moment it matters.
   *
   * So the signal stays inside `runJob`, which checks it between every step and
   * hands it to the steps that can use it. The promise this queues settles only
   * when the job has really stopped.
   */
  void queue
    .add(() => runJob(job, controller))
    .catch(async (err: Error) => {
      // `runJob` handles its own step failures, so anything reaching here is a
      // bug in it — and must be visible rather than swallowed.
      //
      // Visible to the *reader* was all this did: the card turned red and said
      // the message. The stack — the only part that says where the bug is —
      // went nowhere at all, and this is the one path where nobody can guess it
      // from the step that failed, because no step failed.
      log("jobs").error(
        { ...errorFields(err), jobId: job.id, slug: job.slug },
        `the job runner threw — ${job.slug}`,
      );
      job.status = "error";
      job.error = err.message;
      job.finishedAt = new Date().toISOString();
      delete job.cancelling;
      await persist(job);
    })
    .finally(() => {
      aborts.delete(job.id);
    });

  return job;
}

/**
 * The job already working on this article, if there is one.
 *
 * Deliberately not exported. The check belongs *inside* `enqueue`, after its
 * awaits and immediately before the insert, because that is the only place with
 * no gap: `enqueue` awaits `ready()` and a read of meta.json, and two requests
 * arriving together will both get past any check made before those.
 */
function activeFor(slug: string): Job | undefined {
  return [...jobs.values()].find(
    (j) => j.slug === slug && (j.status === "queued" || j.status === "running"),
  );
}

/**
 * The same steps, forced the same way, steered the same way — the only case a
 * caller can safely share.
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
function sameWork(
  job: Job,
  names: StepName[],
  forced: Set<StepName>,
  guidance?: string,
  profile?: string,
  upload?: JobUpload,
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
  const other = activeFor(candidate);
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
  return (await urlForSlug(candidate)) ?? activeFor(candidate)?.url;
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

/** Drop the oldest finished jobs once there are too many. Successes go first. */
async function prune(): Promise<void> {
  const finished = [...jobs.values()].filter(
    (j) => j.status !== "queued" && j.status !== "running",
  );
  if (finished.length <= KEEP_FINISHED) return;
  const doomed = finished
    .sort((a, b) => {
      // Successes before failures, so successes are what gets dropped; then
      // oldest first within each.
      const kind = Number(a.status !== "done") - Number(b.status !== "done");
      return kind !== 0 ? kind : a.createdAt < b.createdAt ? -1 : 1;
    })
    .slice(0, finished.length - KEEP_FINISHED);
  for (const job of doomed) await forgetJob(job.id).catch(() => {});
}

/** Newest first, so the homepage shows what just happened at the top. */
export async function listJobs(): Promise<Job[]> {
  await ready();
  return [...jobs.values()].sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
  );
}

export async function getJob(id: string): Promise<Job | null> {
  await ready();
  return jobs.get(id) ?? null;
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
  await ready();
  const job = jobs.get(id);
  if (!job) return null;
  if (job.status === "done" || job.status === "error" || job.status === "cancelled") {
    return job;
  }
  job.cancelling = true;
  aborts.get(id)?.abort();
  if (job.status === "queued") {
    job.status = "cancelled";
    job.finishedAt = new Date().toISOString();
  }
  await persist(job);
  return job;
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
  await ready();
  const old = jobs.get(id);
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
  await ready();
  const job = jobs.get(id);
  if (!job) return false;
  if (job.status === "queued" || job.status === "running") {
    throw Object.assign(new Error("That job is still running. Cancel it first."), {
      status: 409,
    });
  }
  jobs.delete(id);
  forgotten.add(id);
  await writes.get(id)?.catch(() => {});
  try {
    await unlink(jobFile(id));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  return true;
}
