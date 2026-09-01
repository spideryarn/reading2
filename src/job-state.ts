/**
 * **What state an import is in, as the reader sees it** — one place, so the
 * cards stop each working it out for themselves.
 *
 * Beside src/job-failure.ts, which is the precedent: one function that decides
 * what a card offers, called from every surface that offers it. This is the
 * same shape for the other half of the question — not *may I press Retry* but
 * *what is happening right now, and what should it say*.
 *
 * Two surfaces read it and they are mirror images of one another.
 * `JobCard` (src/web/AddArticle.tsx) renders `step.error` and never
 * `job.error`; `JobProgress` (src/web/JobProgress.tsx) renders the job's
 * sentence and never a step's. Check which you are writing for before adding
 * anything here — getting it backwards is what shipped an interrupted import
 * with no explanation anywhere on the card
 * (tests/interrupted-job-card.test.tsx).
 *
 * ## What is deliberately not an input
 *
 * **The lease.** `Job` on the wire carries none. `leaseExpiresAt` lives on the
 * Postgres row and in the filesystem adapter's `attempts` map and never
 * reaches `publicJob`, so *running, and its claimant is dead* is invisible here
 * until the server reconciles it — `settleExpired`, called from `listJobs` in
 * src/jobs.ts. That is the design and not a gap: the lease is the correctness
 * clock and it is compared against database time, and re-deriving ownership in
 * a browser from two clocks that disagree is the bug this plan exists to stop.
 * Elapsed time here is a **display** clock and decides nothing but a sentence.
 *
 * A consequence worth knowing: this can be handed a `running` job that the
 * server has just settled, for **one poll**. Nothing below is wrong for that
 * frame — the worst case is one more second of a duration that was already
 * true, and Stop on an already-settled job is a no-op.
 *
 * **The clock.** `now` is a parameter. Everything else here is a function of
 * the record, and a mapper that reaches for `Date.now()` is a mapper nothing
 * can test.
 *
 * **The driver's health.** See § Transport health is not a job state.
 *
 * docs/plans/260831ao-a-stuck-ingest-job-the-reader-can-see-and-clear.md § Stage 4.
 */
import { jobWorthRetrying } from "./job-failure.js";
import { INTERRUPTED } from "./messages.js";
import type { Job, JobStep, StepName } from "./types.js";

/**
 * The eight things an import can look like to somebody watching it.
 *
 * Eight rather than `JobStatus`'s five, and every extra one is a difference
 * the reader can act on.
 *
 * `queued` and `running` become four. *Waiting*, *working*, *this has gone on
 * longer than it should* and *you pressed Stop and it has not landed yet* want
 * four different sentences, and two of them cannot be read off the record at
 * all — one needs a clock and one needs `cancelling`, which no status carries.
 *
 * `error` becomes two, because "your tab went away" and "this article cannot
 * be imported" are the same status and completely different news; only one of
 * them is worth pressing Retry on twice.
 *
 * And `cancelled` is `stopped`, because the word on the button was Stop.
 */
export type JobDisplayState =
  /** Queued. Nothing is driving it this instant; the next poll will. */
  | "waiting"
  /** A step is running and is taking about as long as that step takes. */
  | "working"
  /** A step is running and has gone past what that step has ever taken. */
  | "slow"
  /** Stop has been pressed and the claimant has not let go yet. */
  | "stopping"
  /** It stopped part-way and whatever was running it never came back. */
  | "interrupted"
  /** A step failed, and said why. */
  | "failed"
  /** The reader stopped it. */
  | "stopped"
  /** Every step finished. */
  | "done";

export interface JobDisplay {
  state: JobDisplayState;
  /**
   * The step the reader is waiting on, or null.
   *
   * Only ever a **running** step. A job between steps has none, which is a
   * fraction of a second in practice and honestly nothing to time.
   */
  step: JobStep | null;
  /**
   * How long that step has been going, or null when we cannot say.
   *
   * **The step's clock and never the job's.** `job.startedAt` is
   * `coalesce(startedAt, now())` in src/store/pg-jobs.ts, so it survives a
   * retry and measures how old the job is rather than how long the attempt in
   * front of the reader has been running — a card reading "1h 4m" over a step
   * that restarted twenty seconds ago is telling somebody something untrue.
   * `step.startedAt` is re-stamped every time a step starts (src/jobs.ts), so
   * it belongs to the current attempt. GPT Sol, 2026-09-01.
   */
  elapsedMs: number | null;
  /**
   * A whole sentence about what this step usually takes, or null.
   *
   * **Null wherever nothing measured it**, and that is the whole rule. A
   * sentence rather than a fragment the surfaces glue "This step" onto: two
   * surfaces gluing produce two chances to end up with "This step usually a
   * few minutes", which is exactly what the first version of this did.
   * See `STEP_TIMING`.
   */
  usually: string | null;
  /** Whether to offer Retry. `jobWorthRetrying`, asked rather than absorbed. */
  retryable: boolean;
  /** The one sentence this state needs, or null when it needs none. */
  sentence: string | null;
}

/* ------------------------------------------------------------- the words --
   Reader-facing copy, and it follows docs/project/copy.md even though none of
   it is a model failure: say what happened in words that assume nothing, and
   say what to do next when there is anything. No bracketed codes, because a
   code is for quoting when something went wrong and none of these is a thing
   going wrong.

   Constants rather than inline strings so the tests can assert identity and
   the wording stays free to change — the same discipline copy.md asks for with
   "match on the code, not the prose". */

/** Queued: something will pick it up, and nothing is stuck. */
export const WAITING_TO_CONTINUE = "Waiting to continue.";

/**
 * Past what this step has ever taken. **It names the way out**, because the
 * one thing worse than a long wait is a long wait you cannot end.
 */
export const TAKING_LONGER = "This is taking longer than usual — you can stop it.";

/**
 * Stop pressed. Says **what it is waiting for**, which a disabled button
 * reading "Stopping…" does not: the claimant finishes the step it is inside
 * and hands the job back, and until it does there is nothing to see.
 */
export const STOPPING_AFTER_STEP = "Stopping after the current step…";

/**
 * The tab is the worker, said out loud.
 *
 * `pump` in src/jobs.ts opens with `if (process.env.VERCEL) return`, so in
 * production the only thing that calls `POST /api/jobs/:id/advance` is a
 * browser. Until there is a background runner, calling this a queue without
 * saying so promises something the app does not do. The second sentence is the
 * true and reassuring half: closing every tab pauses an import, it does not
 * lose one.
 */
export const KEEP_A_TAB_OPEN =
  "Keep a Spideryarn tab open while this imports. If you close them all, it will continue when you return.";

/**
 * What a measured slow step usually takes. One sentence per shape of answer.
 *
 * **Whole sentences, in one place, glued to nothing.** The first version stored
 * the fragment "usually a few minutes" and let each surface write "This step "
 * in front of it, which put "This step usually a few minutes." on the card and
 * would have needed fixing in two places.
 *
 * **Vague on purpose, and vague to the width of the actual spread.** The two
 * steps have genuinely different shapes — see `STEP_TIMING` — so they get
 * different sentences rather than one that is loose enough to cover both: a
 * reader told "a few minutes" who waits two is being talked down to, and one
 * told "two or three" who waits twelve has been misled by the reassurance
 * rather than reassured. What neither says is a single number, because the
 * spread is three-to-one and a number the data cannot support is
 * docs/reusable/silent-success.md with a decimal point on it.
 */
export const STEP_USUALLY_A_FEW_MINUTES = "This step usually takes a few minutes.";
export const STEP_USUALLY_A_COUPLE_OF_MINUTES = "This step usually takes two or three minutes.";

/**
 * The poll works and the driver does not.
 *
 * `drive` in src/web/jobEngine.ts catches a failed `/advance`, waits, and
 * retries for ever without a word, so a job whose advance route keeps
 * answering 500 sits confidently at `running` while every status poll looks
 * healthy — docs/reusable/silent-success.md, in the one loop built to prevent
 * a stalled ingest. It **keeps trying**, and says so, because there is nothing
 * for the reader to do and giving up would be worse.
 */
export const DRIVER_STALLED =
  "Spideryarn can see this import but cannot continue it right now. It will keep trying.";

/* ------------------------------------------------------------ the clocks -- */

/**
 * How long a step has to run before *taking longer than usual* is true of it,
 * and what to tell the reader it usually takes.
 *
 * **Every number here is either measured or a guess and says which**, which is
 * the discipline `STEP_BUDGET_MS` in src/jobs.ts learned the hard way: a
 * reader who cannot tell a measurement from a guess reasons about the guesses
 * as though they were facts. `usually` is present **only where there is a
 * measurement**, so a step nobody has timed says nothing about how long it
 * takes rather than inventing a reassurance.
 *
 * ## Why this is not `STEP_BUDGET_MS`
 *
 * They answer different questions and must be allowed to differ. That table is
 * the **claimant's** deadline — how long a step may take before starting it
 * risks a mid-step kill — so it is rounded up hard and being wrong there
 * costs a killed step. This is a **sentence**, and being wrong here costs a
 * sentence. It also cannot import that one: src/jobs.ts is the server's queue,
 * and this module is in the browser bundle (tests/client-imports.test.ts).
 *
 * ## Why per step and not one number for the whole job
 *
 * Six minutes into `hierarchy` is an ordinary run and six minutes into `fetch`
 * is a fetch that is never coming back. One threshold is wrong for one of them
 * whichever number you pick.
 */
interface StepTiming {
  slowAfterMs: number;
  usually?: string;
}

/**
 * **MEASURED** 2026-09-01 from `data/_ai-calls.jsonl`.
 *
 * - **`hierarchy`: 6 real ingest runs over 3 articles — 163s, 182s, 270s,
 *   549s, 604s, 772s; median 409s.** Grouped by `jobId` and read as
 *   `max(finishedAt) − min(startedAt)`, because the step fans out into up to
 *   eleven calls on one article and summing them double-counts everything that
 *   overlapped.
 * - **`sketch`: 13 drawings — 121s to 199s, median 144s.** One model call per
 *   article, so the call's own `durationMs` *is* the step.
 *
 * **The methodology is not pedantry, and the first draft of this table got it
 * wrong.** Grouping `sketch` by `runId` and taking the wall clock gave
 * "129–411s, median 287s", which went into this comment before anybody looked
 * at the rows: the long ones are **eval batches of several articles under one
 * `runId`** with a null `articleSlug`, so the span covered work on three
 * different pieces. That is the exact trap `STEP_BUDGET_MS`'s header in
 * src/jobs.ts warns about, met from the other direction — and the wrong number
 * would have promised a reader three minutes more than the step has ever
 * taken. Read the rows, not just the aggregate.
 *
 * Nothing else gets a `usually`. `timeline` has 4 runs and `quiz` has 12 but
 * all on one article, and everything else is under a minute anyway — a
 * reassurance about a step nobody has timed is an invention, and a
 * reassurance about a step that finishes in twelve seconds is noise.
 *
 * **The thresholds are not the measurements plus a bit.** `hierarchy` is ten
 * minutes: past its median but *inside* `LEASE_MS` (12.67 min), so a genuinely
 * abandoned job says "taking longer than usual" for a couple of minutes and
 * then the server's own sweep settles it and the card says what really
 * happened. That order is the right one — the display clock speaks first and
 * tentatively, the lease speaks last and decides. `sketch` is seven minutes:
 * twice its worst recorded run, because the cost of being early here is one
 * unnecessary sentence and the cost of being late is a reader watching a
 * spinner with nothing to go on.
 */
const STEP_TIMING: Partial<Record<StepName, StepTiming>> = {
  hierarchy: { slowAfterMs: 600_000, usually: STEP_USUALLY_A_FEW_MINUTES },
  sketch: { slowAfterMs: 420_000, usually: STEP_USUALLY_A_COUPLE_OF_MINUTES },
};

/**
 * **GUESS**, for every step that has not been measured — and the direction of
 * the guess is the point. Three minutes is comfortably past everything in the
 * log that is not `hierarchy` or `sketch` (the slowest is `timeline` at 125s),
 * so a false "taking longer than usual" is unlikely; and a reader whose fetch
 * has been going for three minutes is right to be told.
 */
const SLOW_AFTER_MS = 180_000;

const timingFor = (name: StepName): StepTiming => STEP_TIMING[name] ?? { slowAfterMs: SLOW_AFTER_MS };

/**
 * A duration the way a person says it. Never a percentage.
 *
 * **There is deliberately no progress bar anywhere this feeds.** Response size
 * and provider latency are both unknown before the fact, so a percentage would
 * be a number we made up, shown in the one shape a reader is entitled to trust
 * — docs/reusable/silent-success.md with a number on it. An elapsed time is
 * something we actually know.
 */
export function elapsedLabel(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/**
 * How long this step has been going, or null when we cannot say.
 *
 * Two clocks lie, in opposite directions, and neither may be shown or reasoned
 * about. A `startedAt` that will not parse is `NaN` — and every comparison
 * against `NaN` is false, so the slow test would fall out right by accident;
 * it is written out because falling out right by accident is how the next edit
 * breaks it. One in the **future** is a client whose clock is behind the
 * server's, and a negative duration is not a duration. `earlier` in
 * AddArticle.tsx spells the same guard out for the same reason.
 */
function elapsedOf(step: JobStep, now: number): number | null {
  if (step.startedAt === undefined) return null;
  const at = Date.parse(step.startedAt);
  if (!Number.isFinite(at)) return null;
  const ms = now - at;
  return ms < 0 ? null : ms;
}

/**
 * **The classifier, named exactly.** An interruption is the canonical
 * `INTERRUPTED` sentence and nothing looser.
 *
 * It is *not* derivable from `failureKind: "retry"`, which was the obvious
 * shortcut and is wrong: a busy AI service, a 502, a timeout and a dozen other
 * ordinary failures are all retryable, and none of them is an import whose
 * engine walked away. The three places that end a job this way all write this
 * exact string — `settleExpired` in src/store/pg-jobs.ts, `settleAbandoned` in
 * src/store/jobs-fs.ts, and `sweepStopped` in src/jobs.ts — so the identity is
 * the whole of the test.
 *
 * The alternative was reading the `[jb-gone]` code back out with
 * `kindOfMessage`. Rejected: that mechanism exists for the surfaces that store
 * `err.message` and have nowhere else to put a kind (src/messages.ts § Why
 * this exists rather than a `kind` field), and a job is not one of them.
 */
function isInterrupted(job: Job): boolean {
  return job.error === INTERRUPTED.message;
}

const activeStep = (job: Job): JobStep | null =>
  job.steps.find((s) => s.status === "running") ?? null;

/**
 * What this job looks like to the person watching it.
 *
 * @param now milliseconds, injected. See the header.
 */
export function displayJob(job: Job, now: number): JobDisplay {
  const step = activeStep(job);
  const elapsedMs = step ? elapsedOf(step, now) : null;
  const timing = step ? timingFor(step.name) : null;
  const state = stateOf(job, elapsedMs, timing?.slowAfterMs);
  return {
    step,
    elapsedMs,
    /* **Nothing to say once it is past usual**, which is the one place these
       two could contradict each other: "this step usually takes a few minutes"
       under "this is taking longer than usual" is a reassurance that has
       already been disproved on the same card. */
    usually: state === "slow" ? null : (timing?.usually ?? null),
    retryable: jobWorthRetrying(job),
    state,
    sentence: SENTENCES[state],
  };
}

/**
 * The mapping itself, kept small enough to read in one go.
 *
 * **`cancelling` is checked before anything else about an active job**, and
 * the order is load-bearing: a job the reader has just stopped may well also
 * be past its threshold, and *"this is taking longer than usual — you can stop
 * it"* under a Stop they already pressed is the app not listening.
 */
function stateOf(job: Job, elapsedMs: number | null, slowAfterMs?: number): JobDisplayState {
  switch (job.status) {
    case "queued":
      return job.cancelling === true ? "stopping" : "waiting";
    case "running":
      if (job.cancelling === true) return "stopping";
      return elapsedMs !== null && slowAfterMs !== undefined && elapsedMs > slowAfterMs
        ? "slow"
        : "working";
    case "error":
      return isInterrupted(job) ? "interrupted" : "failed";
    case "cancelled":
      return "stopped";
    case "done":
      return "done";
  }
}

/**
 * One sentence per state, and **five of the eight say nothing**, which is the
 * part worth defending. A finished import is explained by the article now on
 * the shelf; a stopped one by the reader having stopped it; a failed or
 * interrupted one by the failed step's own message, which is already on the
 * card and already says whether another go is worth it. A second widget
 * repeating any of those is the app talking over itself — the same argument
 * `jobWorthRetrying` makes about not explaining a hidden button.
 *
 * A total map rather than a `switch` with a `default`, so a ninth state cannot
 * be added without deciding this. `RETRYABLE` in src/messages.ts is the same
 * shape for the same reason, and it is there because the comparison version
 * silently stopped charging the cost it claimed to.
 */
const SENTENCES: Record<JobDisplayState, string | null> = {
  waiting: WAITING_TO_CONTINUE,
  working: null,
  slow: TAKING_LONGER,
  stopping: STOPPING_AFTER_STEP,
  interrupted: null,
  failed: null,
  stopped: null,
  done: null,
};

/* --------------------------------- transport health is not a job state -- */

/**
 * **How many failed `/advance` calls in a row before we say so.**
 *
 * Each failure is followed by an eight-second wait (`IDLE_MS` in
 * src/web/jobEngine.ts § `step`), so three is about twenty-four seconds of a
 * driver getting nowhere: long enough that one blip and one dev-server restart
 * say nothing, short enough that the reader hears it before they have decided
 * the app is broken.
 */
export const DRIVER_STALLED_AFTER = 3;

/**
 * Whether this tab can see the job but cannot move it.
 *
 * **A separate question from `displayJob`, on purpose**, and the plan asked for
 * the decision to be written down. Three reasons it is not a ninth
 * `JobDisplayState`:
 *
 * 1. **It is not a fact about the job.** The job is running, and it is the
 *    *connection* that is unwell. Folding it in would make it override
 *    `working`, and the two things the reader needs are precisely both at
 *    once: *Building the hierarchy · 6m 2s* **and** *cannot continue it right
 *    now*.
 * 2. **It is not on `Job` at all.** The count lives in the engine's snapshot,
 *    per tab, and is durable nowhere. `displayJob` is pure over the record the
 *    server sent, and this module is imported by both sides.
 * 3. **It is a communication failure, not an ownership one** — the plan's own
 *    words. Nothing about it changes who may write the job, which is the line
 *    the lease guards.
 *
 * The count is `driverFailures` on the snapshot: incremented per job by a
 * failed advance, reset by any success, and dropped when the job leaves the
 * list or goes terminal. It could not be trusted until the duplicate-drive-loop
 * bug was fixed in stage 1b, because two loops were incrementing one counter.
 */
export function driverStalled(failures: Readonly<Record<string, number>>, id: string): boolean {
  return (failures[id] ?? 0) >= DRIVER_STALLED_AFTER;
}
