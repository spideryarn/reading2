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
 * Postgres adapter exists, where the same rules are enforced by the database and
 * hold across anything.
 *
 * So the fence here is real but local: the attempt token is compared, and a
 * stale claimant is refused, within the process that minted it. Across
 * processes it is not a fence at all. Nothing here pretends otherwise.
 *
 * **And "one process" had to be made true, because it was not.** It said
 * *process* and meant *module*, and those stopped being the same thing the day
 * the API became a Vite config dependency: saving any file the **server**
 * imports restarts the dev server in place, re-evaluating this file with empty
 * Maps while the request inside a step keeps running. (Only the server's graph —
 * a client-only module gets ordinary HMR and no restart.) `QueueState` below is
 * what closed that: the state has the lifetime of the process now, which is the
 * lifetime this file always claimed for it.
 * docs/postmortems/260902c-the-truncation-retry-cost-storm.md.
 */

import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { errorFields, log } from "../log.js";
import { INTERRUPTED } from "../messages.js";
import { environmentOwnerId } from "../owner.js";
import { processSingleton } from "../process-state.js";
import type { Job, JobStep, OwnerId } from "../types.js";
import {
  type ClaimOutcome,
  type EnqueueOutcome,
  type EnqueueTicket,
  type ExpirySettlement,
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

/**
 * **Everything this adapter knows, and it belongs to the process rather than to
 * this module.**
 *
 * The single-running rule and the attempt tokens below are a **lock**, and a
 * second copy of a lock is not a slower lock, it is no lock at all. This module
 * is re-evaluated whenever the dev server restarts — which is every save to a
 * file the server imports, because the API is a Vite config dependency — and the
 * restart does not stop the request that is already inside a step. Before
 * 2026-09-02 the new copy therefore began with empty Maps, `loadFromDisk` swept
 * a `running` job back to `queued` believing nobody could be inside it, and the
 * browser's next advance started the same eight-minute model call again. Eleven
 * of them, once, on one job.
 * docs/postmortems/260902c-the-truncation-retry-cost-storm.md, and
 * src/process-state.ts for the mechanism and for what else belongs here.
 *
 * **`loaded` and `writeCounter` are in here too, and they have to be.** A
 * private `loaded` puts the new copy through `loadFromDisk` — which is the sweep
 * that hands the job away — and a private `writeCounter` lets two copies mint
 * the same `.pid.N.tmp` name for one job. Two scalars in an object rather than
 * two `let`s is the price of a value the module cannot own.
 *
 * The header above still says "one process", and that is now true rather than
 * hoped. Across two *processes* it remains what it always was: not a fence.
 */
interface QueueState {
  /** The jobs this process knows about, live. Disk is what survives a restart. */
  index: Map<string, Job>;
  /** The attempt token each running job is held by. Never written to disk. */
  attempts: Map<string, { attempt: string; expires: number }>;
  /**
   * What each job was enqueued with. In memory, like the index it sits beside.
   *
   * A whole `EnqueueTicket` rather than the bare work key it held until
   * 2026-09-02: a name reservation and a source claim are two more facts that
   * arbitrate an article's queue, and they belong beside the work key for the
   * same reason it is not on `Job` — none of the three is something a reader is
   * ever shown. See ./jobs.ts § `EnqueueTicket`.
   */
  tickets: Map<string, EnqueueTicket>;
  /** Jobs the reader has dismissed. A late write must not bring one back. */
  forgotten: Set<string>;
  /** One write at a time per job, and the last one in flight for each. */
  writes: Map<string, Promise<void>>;
  /** Distinct per call, so two writes for the same job cannot share a temp file. */
  writeCounter: number;
  /** The one read of `data/_jobs/`, memoised. Null until somebody asks. */
  loaded: Promise<void> | null;
}

/* Bump the version whenever a field above is added or renamed: a dev server that
   restarts in place keeps the object an older copy made, and the alternative to
   failing loudly is reading `undefined` out of the queue's own index.

   **And bump it to something distinguishable, not to today's date.** This said
   `"2026-09-02"` when `keys` became `tickets`, on 2026-09-02 — so the obvious
   bump was to the value it already had, which reads like a version bump, passes
   review, and guards nothing. `processSingleton` compares strings and cannot
   tell a careful bump from a lazy one. Never touch the *name*: a second key is a
   second lock universe with the first claimant still running inside the old one,
   which is the bug src/process-state.ts exists to prevent. */
const state = processSingleton<QueueState>("jobs-fs", "2026-09-02-tickets", () => ({
  index: new Map(),
  attempts: new Map(),
  tickets: new Map(),
  forgotten: new Set(),
  writes: new Map(),
  writeCounter: 0,
  loaded: null,
}));

/* Bound locally so the rest of this file reads as it always did. These are the
   *same objects* every copy of the module sees, which is the whole point; the
   two scalars are reached through `state` because a `const` cannot be. */
const { index, attempts, tickets, forgotten, writes } = state;

function jobFile(id: string): string {
  return path.join(JOBS_DIR, `${id}.json`);
}

/**
 * What one file holds: the job, plus the enqueue ticket's fields beside it.
 *
 * **None of these is on `Job` and none of them must be.** They are not the
 * reader's business — `publicJob` would have to strip them alongside `ownerId` —
 * and each is derived from the *request* rather than from the record, so putting
 * them on the type would invite somebody to recompute one from a job whose steps
 * have since moved, or to infer `reservesName` back out of `url`. Postgres keeps
 * all three in columns for the same reason; here they are sibling keys in the
 * same document, so they land in one atomic rename and cannot disagree with the
 * job they belong to.
 *
 * Every field is optional, because files written before each was added lack it.
 * **A record with no `reservesName` is read as not reserving**, which is the
 * safe direction: it can never wrongly block a name.
 */
type Stored = Job & Partial<EnqueueTicket>;

async function writeOnce(job: Job, ticket: EnqueueTicket | undefined): Promise<void> {
  await mkdir(JOBS_DIR, { recursive: true });
  /* The suffix carries a counter as well as the pid — the pid alone is constant
     within a process, which is exactly the case that broke. */
  const tmp = `${jobFile(job.id)}.${process.pid}.${++state.writeCounter}.tmp`;
  const stored: Stored = { ...job, ...ticket };
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
function persist(job: Job, ticket = tickets.get(job.id)): Promise<void> {
  const next = (writes.get(job.id) ?? Promise.resolve())
    .then(() => (forgotten.has(job.id) ? undefined : writeOnce(job, ticket)))
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

/**
 * **End a job nobody is inside any more**, the way both expiry paths need it.
 *
 * One function because `settleExpired` and the lapsed-claim branch of
 * `requestCancel` must write the *same* fields — the bug that costs most here
 * is one of them forgetting a field the other clears, which is what
 * `draftRevisionId` was in the Postgres adapter. The two Postgres statements
 * share a `case` for the same reason.
 *
 * `as` forces the cancelled ending for the reader who is pressing Stop right
 * now, since `cancelling` is not on the record yet and never will be.
 *
 * **The running step settles differently on the two endings**, and the
 * Postgres `settledSteps` says why at length. Cancelled: back to `pending`
 * with `startedAt` dropped, as `sweepStopped` writes it, and no sentence —
 * nothing failed. Interrupted: `error`, carrying `INTERRUPTED.message` and a
 * `finishedAt`, exactly as `runStep` records a step that threw, **because the
 * card renders `step.error` and never `job.error`** — settling both endings to
 * `pending` left an expired job showing a muted step and a Retry button with
 * no explanation anywhere. GPT Sol, 2026-09-01, finding 2.
 */
function settleAbandoned(job: Job, as?: "cancelled"): void {
  const cancelled = as === "cancelled" || job.cancelling === true;
  const stamp = new Date().toISOString();
  for (const step of job.steps) {
    if (step.status !== "running") continue;
    if (cancelled) {
      step.status = "pending";
      delete step.startedAt;
    } else {
      step.status = "error";
      step.error = INTERRUPTED.message;
      step.finishedAt = stamp;
    }
  }
  job.status = cancelled ? "cancelled" : "error";
  if (cancelled) {
    /* Cleared rather than left, so the record always describes *this* ending.
       A job that failed a step, was retried and is then stopped would otherwise
       carry the old sentence under a status saying the reader stopped it. */
    delete job.error;
    delete job.failureKind;
  } else {
    job.error = INTERRUPTED.message;
    job.failureKind = INTERRUPTED.kind;
  }
  job.finishedAt = stamp;
  delete job.cancelling;
}

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
    const { workKey, reservesName, urlKey, ...job } = stored;
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
    /* **The ticket comes back with the job, or an active job survives a restart
       unable to recognise its own repeat request.** Without the work key
       `enqueueOrGet` cannot answer `sameWork` for a request identical to the one
       already running, and `enqueue` — whose reallocation cannot move a URL off
       a slug it legitimately owns — walks its whole retry budget and 409s a
       request that should have been handed the job. GPT Sol, 2026-08-27.

       **`reservesName` defaults to false for a record that predates it**, which
       is the direction that can only fail to block a name rather than wrongly
       block one — the plan's § 1e. A record with no work key at all keeps none:
       an empty string would be a key, and every keyless job would then dedupe
       onto every other one. */
    const ticket: EnqueueTicket | undefined =
      workKey === undefined
        ? undefined
        : { workKey, reservesName: reservesName === true, ...(urlKey !== undefined && { urlKey }) };
    if (sweepStopped(job as Job)) await persist(job as Job, ticket);
    index.set(job.id, job as Job);
    if (ticket) tickets.set(job.id, ticket);
  }

  if (unreadable.length > 0) {
    log("jobs").warn(
      { count: unreadable.length, files: unreadable.slice(0, 5), of: files.length },
      `skipped ${unreadable.length} unreadable job record(s) of ${files.length}`,
    );
  }
}

/**
 * Load once, and make every entry point wait for it.
 *
 * **A failed load is not memoised**, and it had to stop being once `loaded`
 * outlived the module. A rejected promise cached here used to be cleared by the
 * next dev-server restart, which is often — so a transient unreadable directory
 * healed itself. Kept in process state it would survive every restart, and only
 * stopping the server would clear it: a one-off `EACCES` turning into a queue
 * that is broken until somebody works out why. Success is still loaded exactly
 * once, which is the property that matters. GPT Sol, reviewing the built code.
 */
function ready(): Promise<void> {
  state.loaded ??= loadFromDisk().catch((err: unknown) => {
    state.loaded = null;
    throw err;
  });
  return state.loaded;
}

/** This owner's, and `undefined` for anybody else's — see `JobStore.get`. */
function ownedBy(id: string, owner: OwnerId): Job | undefined {
  const job = index.get(id);
  return job && job.ownerId === owner ? job : undefined;
}

/**
 * How many jobs this process has running, **excluding** `mine`.
 *
 * The cap, locally. It was `runningNow()`, returning the one running job there
 * could be, because `jobs_only_one_running` allowed exactly one; with a
 * configurable N what the caller needs is a count.
 *
 * `mine` is left out so that re-claiming a job that is already running is
 * classified as *another request is inside this job* rather than as the cap.
 * The status check above refuses it either way — this only keeps the reason
 * honest, which is the same care src/store/pg-jobs.ts § `claim` takes.
 */
function runningCount(mine: string): number {
  let running = 0;
  for (const job of index.values()) if (job.status === "running" && job.id !== mine) running += 1;
  return running;
}

/**
 * Is another job in the way on this article — **older, or already running**?
 *
 * The Postgres `blockedByAnother`, over the in-memory index, and the two
 * conditions are the two things it is: the article's order, and the article's
 * mutex.
 *
 * **A running job blocks whatever its timestamp says.** A row that arrives
 * after a newer one has already started has nothing older than it on the
 * article, so an order-only rule lets it claim — and this adapter has no index
 * underneath to refuse the second runner, so it would simply run two jobs on
 * one `data/<slug>/` directory and report both as claimed. That is worse than
 * the Postgres version of the same mistake, which at least ends in a `23505`.
 * GPT Sol, reviewing the built stage 1, finding 2.
 *
 * Same order as Postgres — `(createdAt, id)` — and `createdAt` compares as a
 * string because every writer of it is `new Date().toISOString()`, whose
 * lexical order is its chronological one.
 *
 * **The id tie-break is equivalent to Postgres's only while Postgres orders the
 * id alphabet the way JavaScript does.** `<` here is UTF-16 code units; there
 * it is whatever collation `jobs.id` has, and src/db/schema.ts does not pin `C`.
 * Job ids are `spya-` plus lower-case base36 (src/ids.ts), so every collation
 * anybody is likely to have agrees — but nothing checks it, and a database
 * created under a collation that sorts digits and letters differently would
 * give the two adapters different answers for jobs queued in the same
 * millisecond. Not a demonstrated failure; written down so the next person does
 * not find it by being wrong. GPT Sol, 2026-09-02.
 *
 * **Global on the slug, with no owner in it**, exactly as the index is: two
 * owners can build toward one name, and what the line protects is the article's
 * shared `data/<slug>/` directory rather than one person's tidiness.
 *
 * **A predecessor that is stopping still counts.** Stop on a queued job settles
 * it terminal at once, so it leaves by itself; a *running* one keeps
 * `cancelling` until its claimant lets go, and until then it is still inside the
 * article. See the contract in ./jobs.ts § `claim`.
 */
function blockedByAnother(job: Job): boolean {
  for (const other of index.values()) {
    if (other.id === job.id || other.slug !== job.slug || TERMINAL.has(other.status)) continue;
    if (other.status === "running") return true;
    if (other.createdAt < job.createdAt) return true;
    if (other.createdAt === job.createdAt && other.id < job.id) return true;
  }
  return false;
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

  async enqueueOrGet(job: Job, ticket: EnqueueTicket): Promise<EnqueueOutcome> {
    await ready();
    /* **The four unique indexes, locally**, asked in the order the Postgres
       adapter asks them and with the same predicates — see `tryEnqueue` there
       for why the address is asked before the name, and `EnqueueOutcome` for
       what each answer means. Synchronous from here to `index.set`, with no
       `await` in between, which is what makes it airtight *within this process*.
       Across processes it is not, and this adapter does not claim to be. */
    const active = [...index.values()].filter((j) => !TERMINAL.has(j.status));

    const mine = active.find(
      (j) =>
        j.ownerId === job.ownerId &&
        j.slug === job.slug &&
        tickets.get(j.id)?.workKey === ticket.workKey &&
        j.cancelling !== true,
    );
    if (mine) return { kind: "sameWork", job: structuredClone(mine) };

    if (ticket.reservesName && ticket.urlKey !== undefined) {
      const source = active.find(
        (j) =>
          j.ownerId === job.ownerId &&
          tickets.get(j.id)?.reservesName === true &&
          tickets.get(j.id)?.urlKey === ticket.urlKey,
      );
      if (source) return { kind: "sourceTaken", job: structuredClone(source) };
    }

    if (ticket.reservesName) {
      const name = active.find(
        (j) => j.slug === job.slug && tickets.get(j.id)?.reservesName === true,
      );
      if (name) return { kind: "nameTaken", job: structuredClone(name) };
    }

    /* **Queued, always, whatever the caller handed us.** `enqueueOrGet` takes a
       whole `Job`, and keeping its `status` let a caller insert a `running` row
       that never passed the cap check and carries no attempt token — one more
       running job than the machine agreed to, arriving through the door marked
       "enqueue", and `runningCount` would then count it against everybody else.
       Nothing does that today; the contract simply should not allow it. The
       Postgres adapter is sealed the same way. GPT Sol, reviewing stage 1.

       **One normalised object, used three times.** The first version of this
       built the queued copy for the index and then persisted and returned
       `job` — the caller's own object — so a `running` job came out queued in
       memory, running in `data/_jobs/`, and running in the `created` outcome
       the route answers with. Two of the three contradicted the paragraph above
       them, and no test noticed because every caller already hands over a
       queued job. The reload hides it too: `sweepStopped` turns a loaded
       `running` record back into a queued one, so the only honest way to see
       the file is to read it. GPT Sol, reviewing the built stage 1, finding 6;
       tests/jobs-fs-load.test.ts. */
    const queued: Job = { ...job, status: "queued" };
    index.set(queued.id, queued);
    tickets.set(queued.id, ticket);
    await persist(queued);
    return { kind: "created", job: structuredClone(queued) };
  },

  async claim(
    id: string,
    owner: OwnerId,
    attempt: string,
    leaseMs: number,
    maxRunning: number,
  ): Promise<ClaimOutcome> {
    await ready();
    const job = ownedBy(id, owner);
    if (!job) return { kind: "gone" };
    if (TERMINAL.has(job.status)) return { kind: "finished", job: structuredClone(job) };
    if (job.cancelling === true) return { kind: "stopping", job: structuredClone(job) };
    if (job.status === "running") return { kind: "busy", why: "another request is inside this job" };
    /* **The article's line first, the cap second** — the order the Postgres
       adapter takes, and for the reason written out there: both refuse, so the
       order changes only which *reason* comes back, and the article is a fact
       about this job while the cap is a fact about the machine this second. */
    if (blockedByAnother(job)) {
      return { kind: "busy", why: "another job on this article is ahead of it" };
    }
    const running = runningCount(id);
    if (running >= maxRunning) {
      return { kind: "busy", why: `already running ${running} of ${maxRunning} jobs` };
    }

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

  /**
   * The Postgres `settleExpired`, on one process's `attempts` map.
   *
   * **It does not always fail**, which is why it is no longer called
   * `failExpired`: a job carrying `cancelling` is a reader who pressed Stop and
   * whose claimant then went away without ever reading the flag, so it settles
   * as `cancelled`. `sweepStopped` above already answers that way on restart;
   * this is the same answer for the same state, reached a different way.
   *
   * **`owner` is a filter on the map**, which is the whole of what the Postgres
   * `where owner_id = $owner` is here. It exists because `listJobs` sweeps from
   * inside a reader's request — see the contract in src/store/jobs.ts — and a
   * request-scoped sweep must not reach anybody else's row.
   *
   * It is a filter on **everything**, the `attempts.delete` included: an
   * owner-scoped call has to leave the other owner's job in exactly the state
   * it found it, and dropping their token would revoke a live claimant's write
   * authority (src/store/job-fence.ts) without settling the job — the one
   * outcome worse than not sweeping at all. **And the recovery is not the
   * table-wide sweep**, which this comment said until GPT Sol read it on
   * 2026-09-01: that sweep iterates `attempts` too, so deleting the entry is
   * exactly what makes the running row invisible to it. What would recover such
   * a row is a restart's `sweepStopped`, or its own owner pressing Stop. A
   * wrong reason for a right rule is still a wrong reason, and the next person
   * to weigh this trade would have weighed it against a safety net that is not
   * there. An entry with no job behind it belongs to nobody, so an
   * owner-scoped call leaves that alone too.
   */
  async settleExpired(now: Date = new Date(), owner?: OwnerId): Promise<ExpirySettlement[]> {
    await ready();
    const settled: ExpirySettlement[] = [];
    for (const [id, held] of attempts) {
      if (held.expires > now.getTime()) continue;
      const job = index.get(id);
      if (owner !== undefined && job?.ownerId !== owner) continue;
      attempts.delete(id);
      if (!job || TERMINAL.has(job.status)) continue;
      settleAbandoned(job);
      await persist(job);
      settled.push({ id, status: job.status as ExpirySettlement["status"] });
    }
    return settled;
  },

  async requestCancel(id: string, owner: OwnerId): Promise<Job | undefined> {
    await ready();
    const job = ownedBy(id, owner);
    if (!job || TERMINAL.has(job.status)) return undefined;
    /* Queued means over, right now: nobody is inside it to notice a flag, so
       the transition happens here or never. Running with a live claim means ask
       the claimant — cancelling it out from under one would leave it writing
       artefacts for a job the reader has been told is finished. One decision
       rather than two calls; see the Postgres adapter for the gap the two-call
       version had.

       **Running with a lapsed claim means over too**, and it is the same branch
       as queued. The claimant aborts itself inside its own lease, so a lapsed
       claim says the process is gone rather than slow, and there is provably
       nobody left to read a flag. Two dev tabs is the local way to reach it.
       A `running` job with no entry in `attempts` at all is the same state:
       nothing here holds it. That cannot happen in one process — `claim` writes
       the entry and `sweepStopped` requeues anything running at load — which
       is the analogue of `jobs_running_is_fenced` refusing a running row with
       no lease. */
    const held = attempts.get(id);
    if (job.status === "queued" || held === undefined || held.expires <= Date.now()) {
      settleAbandoned(job, "cancelled");
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

  /**
   * **The rule lives in src/store/pg-jobs.ts § `trimFinished`** — why it ranks
   * by when a job finished, what the interleave preserves of the old
   * preference, and what depends on a just-ended job surviving its own sweep.
   * Read it there and keep this side matching; the pair used to state it at
   * length twice, which is how they drifted.
   *
   * In JavaScript that is: rank each kind newest-finished first, take one from
   * each side in turn, keep the first `keep` of the result.
   *
   * **This side sorts what it keeps and slices from the back**, the same way
   * round as Postgres. Until 2026-09-03 it did the opposite — sorted the doomed
   * and sliced from the front — and carried a paragraph warning about the
   * inversion. There is nothing left to warn about.
   */
  async trimFinished(owner: OwnerId, keep: number): Promise<number> {
    await ready();
    const finished = [...index.values()].filter(
      (j) => j.ownerId === owner && TERMINAL.has(j.status),
    );
    if (finished.length <= keep) return 0;
    const successes = finished.filter((j) => j.status === "done").sort(byNewestFinished);
    const others = finished.filter((j) => j.status !== "done").sort(byNewestFinished);
    /* The non-success first at every rank, which is `order by rank, is_done`
       there: false sorts before true, so a tie of rank goes to the failure. */
    const kept: Job[] = [];
    for (let rank = 0; rank < Math.max(successes.length, others.length); rank++) {
      const other = others[rank];
      if (other) kept.push(other);
      const success = successes[rank];
      if (success) kept.push(success);
    }
    const doomed = kept.slice(keep);
    for (const job of doomed) await removeJob(job.id);
    return doomed.length;
  },
};

/**
 * `finished_at desc nulls last, created_at desc, id desc`, in JavaScript.
 *
 * The last two keys are there because neither timestamp is a total order — two
 * jobs queued, or ended, in the same millisecond are not rare. Without the id
 * the comparator answered the same thing for every tied pair, so what actually
 * got dropped was whichever the `Map` happened to hold first, and that is not a
 * rule anything can be held to. Highest id survives, on both adapters; the
 * parity suite was red before that key existed.
 *
 * The same collation caveat as `blockedByAnother` above applies: `<` is UTF-16
 * code units here and whatever collation `jobs.id` carries there, and the
 * schema does not pin `C`.
 *
 * `finishedAt` is absent rather than null on a `Job`, and an absent one sorts
 * to the back of its kind — the conservative answer for a legacy or malformed
 * terminal row, matching `nulls last`.
 */
function byNewestFinished(a: Job, b: Job): number {
  if (a.finishedAt !== b.finishedAt) {
    if (a.finishedAt === undefined) return 1;
    if (b.finishedAt === undefined) return -1;
    return a.finishedAt < b.finishedAt ? 1 : -1;
  }
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/**
 * The job this attempt still holds, or a refusal.
 *
 * The same four conditions the Postgres fence uses (src/store/job-fence.ts),
 * and for the same reasons. Without `status === "running"` a job already
 * settled by `settleExpired` would accept its own former claimant's write. And
 * **without the lease, expiry revokes nothing** — the claim is only safe to
 * act on as expired because the claimant aborts itself first, and a fence that
 * ignores the deadline is what makes that a promise nobody keeps.
 *
 * `held.expires > Date.now()`, so the boundary matches Postgres: at the
 * instant of expiry the claim is over, not live. Throwing rather than
 * returning, because zero-changes-reads-as-success is the failure this exists
 * to prevent.
 */
function fenced(id: string, attempt: string): Job {
  const job = index.get(id);
  const held = attempts.get(id);
  if (
    !job ||
    job.status !== "running" ||
    held?.attempt !== attempt ||
    held.expires <= Date.now()
  ) {
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
  tickets.delete(id);
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
 * Put a chosen `finishedAt` on a job that has already ended.
 *
 * The fourth seam, and it exists because retention orders terminal jobs by
 * **when they finished** (src/store/pg-jobs.ts § `trimFinished`) and no
 * `JobStore` operation can choose or tie that stamp — every terminal transition
 * reads the clock for itself. A fixture that wanted two finishes in the same
 * instant, or three finishes in an order other than the one the calls happened
 * in, had no way to say so. Postgres reaches it with a one-line `update`.
 *
 * **Async, and it persists**, unlike `expireLeaseForTests` and
 * `reattachAttemptForTests` above — those two write to `attempts`, which lives
 * only in memory, whereas `finishedAt` is on the record. Mutating the index
 * alone would leave the file on disk carrying the old stamp, and the next
 * `ready()` after a `reloadForTests` would put it back.
 */
export async function stampFinishedForTests(id: string, iso: string): Promise<void> {
  const job = index.get(id);
  if (!job) throw new Error(`No such job to stamp: ${id}`);
  job.finishedAt = iso;
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
  tickets.clear();
  state.loaded = null;
  await ready();
}

/**
 * Forget the jobs a test made — **from the disk as well as from memory**.
 *
 * The first version cleared the four maps and nothing else, which looked like
 * cleanup and was not: `data/_jobs/` is where a job actually lives, so every
 * run of the parity suite left its ~20 records behind. They were `queued`, and
 * retention only trims *finished* jobs, so nothing would ever have removed
 * them. By the time it was noticed there were **537**, every one of them read
 * and swept at each cold start, and they had begun to show up as a timeout in
 * an unrelated suite that walks the shelf.
 *
 * **By id, never by sweep.** `index` holds the reader's real jobs too, loaded
 * from that same directory — clearing what is in memory is safe, deleting what
 * is on disk is not. So the caller names what it made, which is the same rule
 * `tests/store-job-draft.test.ts` had to learn about `running` rows.
 */
export async function forgetForTests(ids: readonly string[]): Promise<void> {
  for (const id of ids) await removeJob(id).catch(() => undefined);
  index.clear();
  attempts.clear();
  tickets.clear();
  writes.clear();
  forgotten.clear();
}

/** Forget everything this process is holding **in memory**. Leaves the disk alone. */
export function resetForTests(): void {
  index.clear();
  attempts.clear();
  tickets.clear();
  writes.clear();
}
