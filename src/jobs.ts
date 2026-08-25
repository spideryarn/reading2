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
import { isSlug } from "./ingest.js";
import {
  assertProduced,
  contextPaths,
  DEFAULT_INGEST_STEPS,
  FORCE_ONLY_WHEN_NAMED,
  STEP_ORDER,
  STEPS,
  stepIsDone,
  type StepContext,
  urlForSlug,
} from "./pipeline.js";
import type { Job, JobStep, StepName } from "./types.js";

export type { Job, JobStatus, JobStep, StepName, StepStatus } from "./types.js";

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
      console.error(`Could not write the record for job ${job.id}: ${err.message}`);
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
   Anything on disk marked `running` or `queued` was left there by a process
   that is no longer alive — this one has just started and its queue is empty.
   Saying so out loud is the whole point: a status of `running` on disk does not
   mean work is happening, and a spinner that spins for ever is the worst of the
   available outcomes. Exactly the argument `sweepOrphaned` makes for orphaned
   comments in src/routes.ts, and the same fix.

   The steps keep their own statuses, so a swept job still shows which stages
   finished — and retrying it skips them. */

/** What a job left running by a dead process should say instead. */
export const STOPPED = "The server stopped before this finished.";

/**
 * Mark a job abandoned by a restart, in place. Returns true if anything changed.
 *
 * Pure and exported so it can be tested, because the thing it gets wrong is
 * invisible: leave a step at `running` and the panel shows a spinner for work
 * nothing is doing, for ever.
 */
export function sweepStopped(job: Job): boolean {
  if (job.status !== "running" && job.status !== "queued") return false;
  job.status = "error";
  job.error = STOPPED;
  job.finishedAt = new Date().toISOString();
  for (const step of job.steps) {
    if (step.status === "running") {
      step.status = "error";
      step.error = STOPPED;
    }
  }
  return true;
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

  for (const file of files) {
    let job: Job;
    try {
      job = JSON.parse(await readFile(path.join(JOBS_DIR, file), "utf8")) as Job;
    } catch {
      continue; // an unreadable job record is not worth failing a page load over
    }
    if (sweepStopped(job)) await persist(job);
    jobs.set(job.id, job);
  }
}

/** Load once, and make every entry point wait for it. */
function ready(): Promise<void> {
  loaded ??= loadFromDisk();
  return loaded;
}

/* ------------------------------------------------------------------ running -- */

function newStep(name: StepName, force: boolean): JobStep {
  return { name, label: STEPS[name].label, status: "pending", ...(force ? { force: true } : {}) };
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
  // Cancelled while it sat in the queue. `cancelJob` cannot mark it for us —
  // p-queue no longer removes it (see the note at `queue.add`) — so the check
  // belongs here, before anything is written.
  if (controller.signal.aborted) {
    job.status = "cancelled";
    job.finishedAt = new Date().toISOString();
    delete job.cancelling;
    await persist(job);
    return;
  }

  job.status = "running";
  job.startedAt = new Date().toISOString();
  await persist(job);

  const { dir, htmlFile } = contextPaths(job.slug);

  for (const step of job.steps) {
    if (controller.signal.aborted) {
      job.status = "cancelled";
      job.finishedAt = new Date().toISOString();
      delete job.cancelling;
      await persist(job);
      return;
    }

    const ctx: StepContext = {
      slug: job.slug,
      ...(job.url ? { url: job.url } : {}),
      dir,
      htmlFile,
      // In memory only. Persisting at this rate would be two writes a second
      // per running job, to record something nobody reads afterwards.
      report: (detail: string) => {
        step.detail = detail;
      },
      signal: controller.signal,
    };

    if (!step.force && (await stepIsDone(STEPS[step.name], ctx))) {
      step.status = "skipped";
      step.detail = "already done";
      await persist(job);
      continue;
    }

    step.status = "running";
    step.startedAt = new Date().toISOString();
    delete step.error;
    await persist(job);

    try {
      step.detail = await STEPS[step.name].run(ctx);
      await assertProduced(STEPS[step.name], ctx);
      // Checked after as well as before. A step that ignores the signal runs to
      // completion regardless, and continuing into the next one would spend a
      // model call on a job the reader has already stopped.
      if (controller.signal.aborted) throw new Error("Cancelled");
      step.status = "done";
      step.finishedAt = new Date().toISOString();
      // The title only exists once extraction has run, and the moment it does
      // is the moment the progress card can stop calling the article by its slug.
      if (step.name === "extract") job.title = step.detail;
      await persist(job);
    } catch (err) {
      const message = (err as Error).message;
      step.status = "error";
      step.error = message;
      step.finishedAt = new Date().toISOString();
      job.status = controller.signal.aborted ? "cancelled" : "error";
      job.error = message;
      job.finishedAt = new Date().toISOString();
      delete job.cancelling;
      await persist(job);
      return;
    }
  }

  job.status = "done";
  job.finishedAt = new Date().toISOString();
  delete job.cancelling;
  await persist(job);
  await prune();
}

/* -------------------------------------------------------------------- api -- */

export interface EnqueueRequest {
  slug: string;
  url?: string;
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
  const slug = request.url ? await freeSlug(request.slug, request.url) : request.slug;
  const url = request.url ?? (await urlForSlug(slug));
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
  if (running && sameWork(running, names, forced)) return running;

  const job: Job = {
    id: mintId(),
    slug,
    ...(url ? { url } : {}),
    steps: names.map((n) => newStep(n, forced.has(n))),
    status: "queued",
    createdAt: new Date().toISOString(),
  };

  jobs.set(job.id, job);
  const controller = new AbortController();
  aborts.set(job.id, controller);
  await persist(job);

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

/** The same steps, forced the same way — the only case a caller can safely share. */
function sameWork(job: Job, names: StepName[], forced: Set<StepName>): boolean {
  if (job.steps.length !== names.length) return false;
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
 */
async function freeSlug(slug: string, url: string): Promise<string> {
  const taken = async (candidate: string) => {
    const existing = await urlForSlug(candidate);
    return existing !== undefined && existing !== url;
  };
  if (!(await taken(slug))) return slug;

  const host = new URL(url).hostname.replace(/^www\./, "").replace(/\.[a-z]+$/, "");
  const withHost = `${host.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${slug}`;
  if (isSlug(withHost) && !(await taken(withHost))) return withHost;

  for (let n = 2; n < 100; n++) {
    const numbered = `${slug}-${n}`;
    if (!(await taken(numbered))) return numbered;
  }
  throw Object.assign(new Error(`Too many articles already called "${slug}".`), { status: 409 });
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
    steps: old.steps.map((s) => s.name),
    force: forceForRetry(old.steps),
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
