/**
 * Jobs as files under `data/_jobs/`, with an in-memory index in front.
 *
 * This is what `src/jobs.ts` did before there was a seam, moved rather than
 * rewritten, because it is what a laptop with no database still runs. The two
 * pieces of it that look incidental and are not:
 *
 * **Write, then rename.** A job file is read by whatever starts next after a
 * crash, so a half-written one is worse than a missing one: it parses as
 * nothing and takes the account of what happened with it. `rename` within a
 * directory is atomic, so a reader sees the old file or the new one.
 *
 * **One write at a time per job, and never rejecting.** Two writes for one job
 * can overlap, and one pair did — both renamed the same temp file, the second
 * got ENOENT, and the unhandled rejection *killed the dev server*. Serialising
 * is the right answer regardless: it is not worth having to prove, every time a
 * transition is added, that no two of them can ever be in flight together.
 *
 * ## What this adapter can and cannot promise, said plainly
 *
 * **One process.** The index is this process's memory and the single-running
 * rule is a variable in it, so two processes over one `data/` directory — a dev
 * server and a stage CLI, say — can both believe they hold the queue. That was
 * true before this file existed and is not a regression; it is the reason the
 * Postgres adapter exists, where the same rules are partial unique indexes and
 * hold across anything.
 *
 * So the fence here is real but local: the attempt token is compared, and a
 * stale claimant is refused, within the process that minted it. Across
 * processes it is not a fence at all. Nothing here pretends otherwise.
 */

import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { errorFields, log } from "../log.js";
import { INTERRUPTED } from "../messages.js";
import { environmentOwnerId } from "../owner.js";
import type { Job, JobStep, OwnerId } from "../types.js";
import {
  type ClaimOutcome,
  type JobEnding,
  type JobStore,
  StaleAttemptError,
  type StepOutcome,
} from "./jobs.js";

const ROOT = path.resolve(import.meta.dirname, "..", "..");

/**
 * `data/_jobs/`, and the underscore is load-bearing.
 *
 * Jobs live under `data/` because they are per-installation state like
 * everything else there. The prefix keeps them out of the article namespace:
 * `listArticles` walks `data/*` and skips names starting with `_` explicitly,
 * rather than relying on this directory happening to lack a blocks.json.
 */
const JOBS_DIR = path.join(ROOT, "data", "_jobs");

const TERMINAL = new Set(["done", "error", "cancelled"]);

/** The jobs this process knows about, live. Disk is what survives a restart. */
const index = new Map<string, Job>();
/** The attempt token each running job is held by. Never written to disk — it dies with the process. */
const attempts = new Map<string, { attempt: string; expires: number }>();
/** The work key each job was enqueued with. In memory, like the index it sits beside. */
const keys = new Map<string, string>();
/** Jobs the reader has dismissed. A late write must not bring one back. */
const forgotten = new Set<string>();
/** One write at a time per job, and the last one in flight for each. */
const writes = new Map<string, Promise<void>>();
/** Distinct per call, so two writes for the same job cannot share a temp file. */
let writeCounter = 0;

function jobFile(id: string): string {
  return path.join(JOBS_DIR, `${id}.json`);
}

/**
 * What one file holds: the job, plus the work key beside it.
 *
 * **`workKey` is not on `Job` and must not be.** It is not the reader's
 * business — `publicJob` would have to strip it alongside `ownerId` — and it is
 * derived from the *request* rather than from the record, so putting it on the
 * type would invite somebody to recompute it from a job whose steps have since
 * moved. Postgres keeps it in a column of its own for the same reason; here it
 * is a sibling key in the same document, so the two land in one atomic rename
 * and cannot disagree.
 *
 * Optional, because every file written before 2026-08-27 lacks it.
 */
type Stored = Job & { workKey?: string };

async function writeOnce(job: Job, workKey: string | undefined): Promise<void> {
  await mkdir(JOBS_DIR, { recursive: true });
  /* The suffix carries a counter as well as the pid — the pid alone is constant
     within a process, which is exactly the case that broke. */
  const tmp = `${jobFile(job.id)}.${process.pid}.${++writeCounter}.tmp`;
  const stored: Stored = { ...job, ...(workKey !== undefined && { workKey }) };
  await writeFile(tmp, `${JSON.stringify(stored, null, 2)}\n`, "utf8");
  await rename(tmp, jobFile(job.id));
}

/**
 * Queue a write behind whatever is already writing this job.
 *
 * **Never rejects.** A job record here is durability, and a full disk should not
 * be able to kill the reader's server from inside a background job. But it is
 * not nothing either — it is what the restart sweep reads — so a failure is said
 * out loud rather than swallowed.
 */
function persist(job: Job, workKey = keys.get(job.id)): Promise<void> {
  const next = (writes.get(job.id) ?? Promise.resolve())
    .then(() => (forgotten.has(job.id) ? undefined : writeOnce(job, workKey)))
    .catch((err: Error) => {
      /* `errorFields`, not `err.message`. This line used to print the message
         and throw the stack away — and the stack is the only part that says
         *which* write failed, out of the several this file queues. */
      log("jobs").error(
        { ...errorFields(err), jobId: job.id, slug: job.slug },
        `could not write the record for job ${job.id} — ${job.slug}`,
      );
    });
  writes.set(job.id, next);
  return next;
}

/**
 * Return anything left `running` or half-run by a process that has gone.
 *
 * **Single-process reasoning, and it is sound here:** this process has just
 * started, so nothing on disk can have work happening against it. That is
 * exactly the reasoning the Postgres adapter cannot use, and why it has a lease
 * instead. Left `queued` rather than failed, so a dev-server restart is a pause
 * and not an abandoned ingest.
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
    /* Nothing is going to deliver that abort now, and resuming a job somebody
       stopped would be the one interruption they *did* notice. */
    job.status = "cancelled";
    job.finishedAt = new Date().toISOString();
    delete job.cancelling;
    return true;
  }
  if (job.status !== "queued") {
    job.status = "queued";
    changed = true;
  }
  return changed;
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

  /* Collected and reported once, rather than a line each. `data/_jobs/` grows
     until retention runs, so "one warn per unreadable file" is bounded by
     nothing — and this runs on the first request after a cold start, where
     Vercel allows 256 log lines for the whole request. */
  const unreadable: string[] = [];
  for (const file of files) {
    let stored: Stored;
    try {
      stored = JSON.parse(await readFile(path.join(JOBS_DIR, file), "utf8")) as Stored;
    } catch {
      unreadable.push(file);
      continue;
    }
    const { workKey, ...job } = stored;
    /**
     * **A job written before jobs had owners belongs to this installation.**
     *
     * Restored on 2026-08-27 after the move here dropped it. Every read and
     * every list now filters on an exact `ownerId`, so a record without one is
     * invisible to everybody — not an error, not a warning, just gone. There
     * were **34** such files in `data/_jobs/` at the time, which is the whole
     * history of this laptop's ingests before 2026-08-27.
     *
     * Worth saying how it was lost, because the mechanism will happen again:
     * moving the loader made `environmentOwnerId` unused *in the file it moved
     * out of*, the typechecker said so, and I deleted the import. An unused
     * import is a symptom, not a verdict — here it was the last reference to a
     * behaviour, and removing it left code that compiled, passed and quietly
     * hid a third of the records.
     */
    if (!job.ownerId) job.ownerId = environmentOwnerId();
    if (sweepStopped(job as Job)) await persist(job as Job, workKey);
    index.set(job.id, job as Job);
    /* **The key comes back with the job, or an active job survives a restart
       unable to recognise its own repeat request.** Without it `enqueueOrGet`
       answers `sameWork: false` for a request identical to the one already
       running, and `enqueue` — whose reallocation cannot move a URL off a slug
       it legitimately owns — walks its whole retry budget and 409s a request
       that should have been handed the job. GPT Sol, 2026-08-27. */
    if (workKey !== undefined) keys.set(job.id, workKey);
  }

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

/** This owner's, and `undefined` for anybody else's — see `JobStore.get`. */
function ownedBy(id: string, owner: OwnerId): Job | undefined {
  const job = index.get(id);
  return job && job.ownerId === owner ? job : undefined;
}

/** The one job this process has running, if any. `jobs_only_one_running`, locally. */
function runningNow(): Job | undefined {
  return [...index.values()].find((j) => j.status === "running");
}

export const fsJobStore: JobStore = {
  async list(owner: OwnerId): Promise<Job[]> {
    await ready();
    return [...index.values()]
      .filter((j) => j.ownerId === owner)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  },

  async get(id: string, owner: OwnerId): Promise<Job | undefined> {
    await ready();
    const job = ownedBy(id, owner);
    // A copy. The index holds the live object and a caller that mutated what it
    // was handed would be writing to the store without going through it — which
    // is the thing having a store is for.
    return job ? structuredClone(job) : undefined;
  },

  async enqueueOrGet(
    job: Job,
    workKey: string,
  ): Promise<{ job: Job; created: boolean; sameWork: boolean }> {
    await ready();
    /* `jobs_active_slug`, locally. Synchronous from here to `index.set`, with no
       `await` in between, which is what makes it airtight *within this process*.
       Across processes it is not, and this adapter does not claim to be. */
    const held = [...index.values()].find(
      (j) => j.ownerId === job.ownerId && j.slug === job.slug && !TERMINAL.has(j.status),
    );
    if (held) {
      return { job: structuredClone(held), created: false, sameWork: keys.get(held.id) === workKey };
    }
    index.set(job.id, job);
    keys.set(job.id, workKey);
    await persist(job);
    return { job: structuredClone(job), created: true, sameWork: true };
  },

  async claim(
    id: string,
    owner: OwnerId,
    attempt: string,
    leaseMs: number,
  ): Promise<ClaimOutcome> {
    await ready();
    const job = ownedBy(id, owner);
    if (!job) return { kind: "gone" };
    if (TERMINAL.has(job.status)) return { kind: "finished", job: structuredClone(job) };
    if (job.cancelling === true) return { kind: "stopping", job: structuredClone(job) };
    if (job.status === "running") return { kind: "busy", why: "another request is inside this job" };
    const busy = runningNow();
    if (busy) return { kind: "busy", why: "another job is running" };

    job.status = "running";
    // A resumed job started once already, and the card's "how long has this been
    // going" should not restart every time a tab picks it back up.
    job.startedAt ??= new Date().toISOString();
    attempts.set(id, { attempt, expires: Date.now() + leaseMs });
    await persist(job);
    return { kind: "claimed", job: structuredClone(job) };
  },

  async releaseStep(
    id: string,
    attempt: string,
    steps: JobStep[],
    outcome: StepOutcome,
  ): Promise<Job> {
    const job = fenced(id, attempt);
    job.steps = steps;
    if (outcome.title !== undefined) job.title = outcome.title;
    /* Stop arrived while this step was running: the release is where it lands.
       Releasing to `queued` with `cancelling` still set is a state nothing
       moves on — the next claim reads the flag and answers `stopping` for
       ever. See the Postgres adapter. */
    if (job.cancelling) {
      job.status = "cancelled";
      job.finishedAt = new Date().toISOString();
      delete job.cancelling;
    } else {
      job.status = "queued";
    }
    attempts.delete(id);
    await persist(job);
    return structuredClone(job);
  },

  async noteProgress(id: string, attempt: string, steps: JobStep[]): Promise<Job> {
    const job = fenced(id, attempt);
    job.steps = steps;
    await persist(job);
    return structuredClone(job);
  },

  async finish(id: string, attempt: string, ending: JobEnding): Promise<Job> {
    /* A Stop arriving during the *last* step does not un-finish the job, where
       one arriving mid-job does — see the Postgres adapter for why the two
       read the same flag and answer differently on purpose. */
    const job = fenced(id, attempt);
    job.status = ending.status;
    job.steps = ending.steps;
    job.finishedAt = new Date().toISOString();
    delete job.cancelling;
    if (ending.error !== undefined) job.error = ending.error;
    else delete job.error;
    /* Deleted rather than left alone when there is no kind, so the field always
       describes *this* failure. A stale kind hides a button. */
    if (ending.failureKind !== undefined) job.failureKind = ending.failureKind;
    else delete job.failureKind;
    if (ending.title !== undefined) job.title = ending.title;
    attempts.delete(id);
    await persist(job);
    return structuredClone(job);
  },

  async failExpired(now: Date = new Date()): Promise<number> {
    await ready();
    let failed = 0;
    for (const [id, held] of attempts) {
      if (held.expires > now.getTime()) continue;
      const job = index.get(id);
      attempts.delete(id);
      if (!job || TERMINAL.has(job.status)) continue;
      job.status = "error";
      job.error = INTERRUPTED.message;
      job.failureKind = INTERRUPTED.kind;
      job.finishedAt = new Date().toISOString();
      delete job.cancelling;
      await persist(job);
      failed++;
    }
    return failed;
  },

  async activeForSlug(slug: string, owner: OwnerId): Promise<Job | undefined> {
    await ready();
    const held = [...index.values()].find(
      (j) => j.ownerId === owner && j.slug === slug && !TERMINAL.has(j.status),
    );
    return held ? structuredClone(held) : undefined;
  },

  async requestCancel(id: string, owner: OwnerId): Promise<Job | undefined> {
    await ready();
    const job = ownedBy(id, owner);
    if (!job || TERMINAL.has(job.status)) return undefined;
    /* Queued means over, right now: nobody is inside it to notice a flag, so
       the transition happens here or never. Running means ask the claimant —
       cancelling it out from under one would leave it writing artefacts for a
       job the reader has been told is finished. One decision rather than two
       calls; see the Postgres adapter for the gap the two-call version had. */
    if (job.status === "queued") {
      job.status = "cancelled";
      job.finishedAt = new Date().toISOString();
      delete job.cancelling;
      attempts.delete(id);
    } else {
      job.cancelling = true;
    }
    await persist(job);
    return structuredClone(job);
  },

  async forget(id: string, owner: OwnerId): Promise<boolean> {
    await ready();
    const job = ownedBy(id, owner);
    if (!job || !TERMINAL.has(job.status)) return false;
    await removeJob(id);
    return true;
  },

  async trimFinished(owner: OwnerId, keep: number): Promise<number> {
    await ready();
    const finished = [...index.values()].filter(
      (j) => j.ownerId === owner && TERMINAL.has(j.status),
    );
    if (finished.length <= keep) return 0;
    const doomed = finished
      .sort((a, b) => {
        // Successes before failures, so successes are what gets dropped; then
        // oldest first within each. A reader who loses a failure loses the only
        // account of what went wrong.
        const kind = Number(a.status !== "done") - Number(b.status !== "done");
        return kind !== 0 ? kind : a.createdAt < b.createdAt ? -1 : 1;
      })
      .slice(0, finished.length - keep);
    for (const job of doomed) await removeJob(job.id);
    return doomed.length;
  },
};

/**
 * The job this attempt still holds, or a refusal.
 *
 * The same three conditions the Postgres fence uses, and for the same reason:
 * without `status === "running"` a job already failed by `failExpired` would
 * accept its own former claimant's write. Throwing rather than returning,
 * because zero-changes-reads-as-success is the failure this exists to prevent.
 */
function fenced(id: string, attempt: string): Job {
  const job = index.get(id);
  const held = attempts.get(id);
  if (!job || job.status !== "running" || held?.attempt !== attempt) {
    throw new StaleAttemptError(id);
  }
  return job;
}

async function removeJob(id: string): Promise<void> {
  /* Marked forgotten *before* the unlink, so a write already queued behind this
     one cannot put the file back. */
  forgotten.add(id);
  index.delete(id);
  attempts.delete(id);
  keys.delete(id);
  await writes.get(id)?.catch(() => undefined);
  writes.delete(id);
  await unlink(jobFile(id)).catch(() => undefined);
  forgotten.delete(id);
}

/* ------------------------------------------------------------ test seams -- */

/**
 * **Two hooks that exist only so the parity tests can build states the API
 * cannot reach**, named loudly enough that nobody mistakes them for the store.
 *
 * They are here rather than in the test because the states they build are real
 * — a lease that has passed, and a terminal job still carrying its token — and
 * the Postgres adapter reaches both with two lines of SQL. Without an
 * equivalent here, the two adapters would be tested to different depths and the
 * word "parity" would be doing no work.
 */
export function expireLeaseForTests(id: string): void {
  const held = attempts.get(id);
  if (held) attempts.set(id, { ...held, expires: Date.now() - 1000 });
}

/** Put a token back on a job that has already ended — what the fence's third condition is for. */
export function reattachAttemptForTests(id: string, attempt: string): void {
  attempts.set(id, { attempt, expires: Date.now() + 60_000 });
}

/**
 * Put a settled job back into the state a stopped server leaves behind.
 *
 * The third seam, and it arrived when `get` started handing back a **clone**.
 * The advance tests used to reach this state by mutating the record `getJob`
 * returned — which worked only because that was the live object, i.e. because
 * the queue had no store. Copying is the store doing its job, so the way to
 * build "the process died under this job" moved in here beside the other two.
 *
 * Exactly what `sweepStopped` writes: `queued`, nothing running, the steps
 * before `from` still finished. `from` is how far the job is meant to have got.
 */
export async function pauseForTests(id: string, from: number): Promise<void> {
  const job = index.get(id);
  if (!job) throw new Error(`No such job to pause: ${id}`);
  job.status = "queued";
  delete job.error;
  delete job.finishedAt;
  delete job.failureKind;
  delete job.cancelling;
  attempts.delete(id);
  for (const step of job.steps.slice(from)) {
    step.status = "pending";
    delete step.error;
    delete step.detail;
    delete step.finishedAt;
  }
  await persist(job);
}

/**
 * Read `data/_jobs/` again, as a cold start would.
 *
 * Separate from `resetForTests` on purpose: that one is called in an
 * `afterEach` and re-reading four hundred files each time would make the parity
 * suite crawl. This is for the two behaviours that only exist *in* the loader —
 * the legacy-owner stamp and restoring a job's work key — and both of those are
 * invisible to every other seam.
 */
export async function reloadForTests(): Promise<void> {
  index.clear();
  attempts.clear();
  keys.clear();
  loaded = null;
  await ready();
}

/** Forget everything this process is holding, so one test file cannot leak into another. */
export function resetForTests(): void {
  index.clear();
  attempts.clear();
  keys.clear();
  writes.clear();
}
