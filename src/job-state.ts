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
import { codeOfMessage, INTERRUPTED_CODE } from "./messages.js";
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
   say what to do next when there is anything. No bracketed codes: a code is for
   quoting when something went wrong, and a status or a duration is not a thing
   going wrong.

   **`DRIVER_STALLED` is the edge of that rule and not an instance of it.**
   Repeated transport failure *is* a problem and is exactly the kind of thing a
   reader would report — GPT Sol, 2026-09-01. It has no code today because it
   resolves itself far more often than not and a code invites a bug report about
   a dev-server restart; if it starts arriving in real reports, give that one
   sentence a code rather than widening the rule.

   Constants rather than inline strings so the tests can assert identity and
   the wording stays free to change — the same discipline copy.md asks for with
   "match on the code, not the prose". */

/** Queued: something will pick it up, and nothing is stuck. */
export const WAITING_TO_CONTINUE = "Waiting to continue.";

/**
 * **The request has gone and the queue has not answered yet.**
 *
 * Not a job state — there is no job to have one — which is why it is a bare
 * constant here rather than a member of `displayJob`'s table. It is the gap
 * between a press (or a mode starting itself) and the first poll that sees what
 * the press made, and without a word for it `JobProgress` drew its run button
 * again inside that gap. src/web/JobProgress.tsx § `starting`.
 */
export const STARTING = "Starting…";

/**
 * Past what this step has ever taken. **It names the way out**, because the
 * one thing worse than a long wait is a long wait you cannot end.
 *
 * **Only for a step whose "usual" we have actually written down**, which is the
 * rule `RUNNING_A_WHILE` exists to keep. See `slowSentence`.
 */
export const TAKING_LONGER = "This is taking longer than usual — you can stop it.";

/**
 * The same way out, with the statistical claim taken off it.
 *
 * Every step that nobody has timed still gets a threshold (`SLOW_AFTER_MS`) and
 * still needs the way out named — a reader whose fetch has been going four
 * minutes is right to be told, and a guess in the safe direction is worth
 * having. What it must not do is say *longer than usual*, because for those
 * steps **we have never said what usual is**, and this module's own rule is
 * that an unmeasured step says nothing about its duration. Saying it anyway is
 * the reassurance-shaped invention `STEP_TIMING` is written to prevent, wearing
 * a warning's clothes.
 *
 * GPT Sol, 2026-09-01, reviewing stage 5: *"Keep the safety warning, but use
 * different copy… Reserve 'usual' for measured steps."*
 */
export const RUNNING_A_WHILE = "This step has been running for a while — you can stop it.";

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

/*
 * **`ARTICLE_IS_BUSY` and `WORKING_ON_THIS_ARTICLE` were here, and both are
 * gone**, on 2026-09-02 with the refusal they were written for.
 *
 * *"Spideryarn is already busy with this article. Wait for that to finish, or
 * stop it and ask again."* was `enqueue`'s answer when the article a reader
 * named already had an active job doing different work — the sentence Greg hit
 * pressing Ideas while Glossary was running. There is nothing left to say it
 * about: a second, different job for one article is queued now rather than
 * refused, and the card it gets already reads *Waiting to continue.*
 * `WORKING_ON_THIS_ARTICLE` was the label the blocker's band borrowed when it
 * sat between two steps, and there is no blocker's band either.
 *
 * Deleted rather than left, because dead copy for a refusal that cannot happen
 * is the next agent's wrong turn. `docs/project/copy.md` used `ARTICLE_IS_BUSY`
 * as its worked example of *a refusal that is an answer and therefore gets no
 * code*; the rule survives there without it.
 * docs/plans/260902e-a-per-article-job-queue-that-appends-and-modes-that-start-themselves.md § 1g.
 */

/**
 * What a measured step usually takes. **One step has earned one of these.**
 *
 * **A whole sentence, in one place, glued to nothing.** The first version stored
 * the fragment "usually a few minutes" and let each surface write "This step "
 * in front of it, which put "This step usually a few minutes." on the card and
 * would have needed fixing in two places.
 *
 * **Vague on purpose, and vague to the width of the actual spread** — thirteen
 * `sketch` runs between 121 and 199 seconds, so "two or three minutes" is the
 * honest width. What it does not say is a single number, because a number the
 * data cannot support is docs/reusable/silent-success.md with a decimal point
 * on it.
 *
 * There was a second sentence here, `STEP_USUALLY_A_FEW_MINUTES`, and
 * `hierarchy` had it. It was deleted on 2026-09-01 rather than reworded,
 * because the measurement under it turned out to be a median of five failures
 * — see `STEP_TIMING`. A constant nothing can say truthfully is worse than no
 * constant, because the next step to be measured will reach for it.
 */
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
 * Six minutes into `hierarchy` is well inside what that step has been seen
 * doing — the longest recorded attempt was still making successful model calls
 * at eight — and six minutes into `fetch` is a fetch that is never coming back.
 * One threshold is wrong for one of them whichever number you pick.
 */
interface StepTiming {
  slowAfterMs: number;
  /**
   * The measured sentence, where there is one. **Absent is the default and the
   * common case.**
   *
   * It decides two things, and tying them to one field is deliberate: what to
   * say while the step runs, and — through `slowSentence` — whether the warning
   * past `slowAfterMs` is allowed to use the word *usual*. A step cannot end up
   * measured enough for one and not the other.
   */
  usually?: string;
}

/**
 * **RE-MEASURED 2026-09-01, on the clock the reader is actually watching.**
 *
 * ## The method, written down so the next person can repeat it rather than invent one
 *
 * Read every `data/_jobs/*.json`. Take each step whose **own** `status` is
 * `"done"`, and compute
 * `Date.parse(step.finishedAt) − Date.parse(step.startedAt)`.
 *
 * That is the same subtraction `displayJob` shows on the card, over the same
 * two fields, so a number derived this way is one the card can be held to.
 * Successful steps only, because *"this step usually takes N"* is a promise
 * about finishing.
 *
 * Over the 21 records on this machine (12 done jobs, 7 error, 2 queued):
 *
 * ```
 * hierarchy   n=1   187s
 * sketch      n=1   159s
 * ideas       n=2   114s, 129s
 * summary     n=2    51s, 103s
 * glossary    n=3    20s,  29s, 36s
 * arc         n=2    10s,  31s
 * quotes      n=1    12s
 * fetch, extract, blocks, assets — seconds
 * ```
 *
 * ## What the previous version of this comment measured instead
 *
 * It grouped `data/_ai-calls.jsonl` by `jobId` and took
 * `max(finishedAt) − min(startedAt)`, and reported *"`hierarchy`: 6 real ingest
 * runs — 163s, 182s, 270s, 549s, 604s, 772s; median 409s"*. Both halves of that
 * are wrong, and neither is a rounding error:
 *
 * - **Five of those six jobs failed at `hierarchy`.** Their step durations were
 *   0s, 67s, 270s, 492s and 498s. So the median was a **time to failure**
 *   printed on a card as a time to finish.
 * - **It is the wrong clock.** A step's model calls do not begin when the step
 *   begins or end when it ends, and `displayJob` shows neither end of that
 *   span. A number that cannot be reproduced from the two fields on screen
 *   cannot be checked against the screen.
 *
 * **The tell was there and was argued away.** One of the six "runs" was 772
 * seconds, and no step can run that long: the claimant aborts itself at
 * `LEASE_MS − DEADLINE_MARGIN_MS` = 740s (src/jobs.ts). A measurement that is
 * impossible under the code's own deadline is not a measurement, and noticing
 * that and explaining it is how a wrong number survives two reviews.
 * docs/reusable/silent-success.md. Found by GPT Sol reviewing stage 5.
 *
 * ## `hierarchy` therefore says nothing about how long it usually takes
 *
 * **One successful attempt is not "usually".** `usually` is absent, and the
 * reader gets the elapsed time and no promise about it.
 *
 * It keeps a **threshold**, which is a different and weaker claim — not *this
 * is what the step takes* but *past here, stop assuming this is normal* — and
 * three facts fix it at ten minutes:
 *
 * 1. `SLOW_AFTER_MS`, the default it would otherwise fall back to, is **below
 *    the only successful run there has ever been** (180s against 187s). Letting
 *    it default would put a warning under the one shape of run we have evidence
 *    for, every time.
 * 2. Hierarchy steps have been seen doing genuine work for **498 seconds**: the
 *    two longest failures ran 15 and 17 model calls each, every one of them
 *    successful, before the answer overran its token budget. A step still
 *    fanning out at eight minutes is not evidently stuck.
 * 3. The claimant kills itself at 740s. Ten minutes leaves about 140 seconds in
 *    which the sentence is on screen before the server's own sweep settles the
 *    job and the card says what really happened. That order is the right one:
 *    the display clock speaks first and tentatively, the lease speaks last and
 *    decides.
 *
 * ## `sketch` keeps its sentence, and this is exactly what is under it
 *
 * One `job_step` too — but a `sketch` step is **one model call**, and there are
 * **thirteen** of those in `data/_ai-calls.jsonl` under `job: "sketch"`, every
 * one of them `ok`: 121, 124, 125, 129, 135, 143, 144, 145, 159, 166, 181, 194,
 * 199 seconds. Median 144s.
 *
 * Substituting a call duration for a step duration is only allowed because the
 * one occasion we can compare them says they are the same: the single real
 * ingest step ran **159s** and its single model call ran **159s**. So "two or
 * three minutes" is thirteen successful observations wide, not one.
 *
 * (Twelve of the thirteen are `eval` and `cli` rather than reader traffic. That
 * is a real caveat about *what was drawn*, not about the clock, and it is why
 * the sentence gives a range rather than a number.)
 *
 * Threshold seven minutes: past twice the worst of the thirteen. The cost of
 * being early is one unnecessary sentence; the cost of being late is a reader
 * watching a spinner with nothing to go on.
 *
 * ## Nothing else gets a `usually`
 *
 * `ideas` at n=2 and `summary` at n=2 are the closest, and two is not "usually"
 * either. Everything else finishes inside a minute, where a reassurance is
 * noise. When one of them reaches enough runs, add it here — with the method
 * above, not with an aggregate over the call log.
 */
/**
 * ## `illustrated` needs a threshold for the opposite reason, and gets no
 * `usually` for `hierarchy`'s
 *
 * The default 180s threshold is **below the fastest run this step has ever
 * had**, so left to default it would put *"this has been running for a while —
 * you can stop it"* under every single Illustrated job, a couple of minutes
 * before the median one finishes. That is the reassurance-shaped invention in
 * reverse: an alarm the code knows is false at the moment it raises it.
 *
 * Three end-to-end runs are recorded in `evals/results/illustrated-2026-09-03/`
 * and `-03b/`, each a brief call plus three image calls: **273s, 308s and
 * 417s**. Ten minutes is past the worst of them with room, and inside the 740s
 * at which the claimant kills itself — so the sentence still has time to appear
 * before the server settles the job.
 *
 * **No `usually`, at n=3.** The bar this file sets is thirteen observations for
 * `sketch` and "two is not usually" for `ideas`; three is nearer the second. The
 * empty state in src/web/IllustratedView.tsx does quote a range before the
 * press, which is a different promise — *this is what you are about to buy*,
 * where being vague and early is the honest thing — and it is a range for
 * exactly this reason. When there are enough runs, add the sentence here with
 * the method above rather than an aggregate over the call log.
 */
const STEP_TIMING: Partial<Record<StepName, StepTiming>> = {
  hierarchy: { slowAfterMs: 600_000 },
  /* **MEASURED**, and it needs a row for the same reason `hierarchy` does: the
     fallback below is 180 s, and the worst recorded label pass is **682 s**, so
     without this every long article would raise the alarm — an alarm the code
     knows is false at the moment it raises it, which is the failure this file's
     header is about. Ten minutes, matching `hierarchy`'s, is past the worst
     measured pass and inside the 740 s at which the claimant kills itself.

     **No `usually`**, at the bar this file sets: the 682 s figure comes from the
     measurement in
     docs/plans/260906a-labels-leave-the-blocking-hierarchy-step.md rather than
     from a spread of runs of the step under its own name, and this step has
     never run under its own name at all. A guessed-shaped threshold does not buy
     a "usual" — see `SLOW_AFTER_MS` below. */
  labels: { slowAfterMs: 600_000 },
  sketch: { slowAfterMs: 420_000, usually: STEP_USUALLY_A_COUPLE_OF_MINUTES },
  illustrated: { slowAfterMs: 600_000 },
};

/**
 * **GUESS**, for every step that has not been measured — and the direction of
 * the guess is the point. Three minutes is past every successful step in
 * `data/_jobs` that is not `hierarchy` or `sketch` (the slowest is `ideas` at
 * 129s), so a false alarm is unlikely; and a reader whose fetch has been going
 * for three minutes is right to be told.
 *
 * **A guessed threshold does not buy a "usual".** The step it fires on gets
 * `RUNNING_A_WHILE` and not `TAKING_LONGER` — see `slowSentence`. Three minutes
 * being past everything recorded is a reason to raise a hand; it is not a
 * measurement of how long the step takes, and the two must not be allowed to
 * sound alike on a card.
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
 * **The classifier, named exactly.** An interruption is the ending that
 * `[jb-gone]` names, and nothing looser.
 *
 * It is *not* derivable from `failureKind: "retry"`, which was the obvious
 * shortcut and is wrong: a busy AI service, a 502, a timeout and a dozen other
 * ordinary failures are all retryable, and none of them is an import whose
 * engine walked away. The three places that end a job this way all write
 * `INTERRUPTED.message` — `settleExpired` in src/store/pg-jobs.ts,
 * `settleAbandoned` in src/store/jobs-fs.ts, and `sweepStopped` in src/jobs.ts
 * — and that sentence carries `[jb-gone]`, which is the part of it that is a
 * contract.
 *
 * ## It was `job.error === INTERRUPTED.message`, and that was wrong
 *
 * The argument for full-message equality was *a job is a struct, so it does not
 * need a code parsed out of prose*. GPT Sol, 2026-09-01: **"the 'a job is a
 * struct' argument supports adding an explicit cause such as
 * `endingKind: 'interrupted'`; it does not support comparing a struct's prose
 * field."** Right on both counts. Comparing the whole sentence makes the copy
 * load-bearing: reword it — for tone, for `docs/project/copy.md`, for a typo —
 * and every job **already stored** stops being an interruption and starts
 * reading as an ordinary failure, with no test anywhere failing. That is the
 * exact accident the stable four-character code exists to prevent.
 *
 * ## And a structured field would not have been enough on its own
 *
 * An `endingKind` column is the better long-term answer and should be added the
 * next time this area is opened, alongside the code rather than instead of it.
 * It is not the answer today for two reasons. It is a migration plus a write in
 * three settle paths plus `publicJob` plus the parity suite — in a file
 * (src/jobs.ts) another stage is mid-way through. And, decisively, **it would
 * only classify jobs settled after it landed.** Every interrupted job the
 * reader can see right now carries the sentence and no field, so the code is
 * what classifies the records that exist, not a stopgap for the ones that do
 * not.
 *
 * `codeOfMessage` and not `kindOfMessage`: the kind of `jb-gone` is `retry`,
 * which is precisely the too-broad answer this function exists to refuse.
 */
function isInterrupted(job: Job): boolean {
  return job.error !== undefined && codeOfMessage(job.error) === INTERRUPTED_CODE;
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
    sentence: state === "slow" ? slowSentence(timing) : SENTENCES[state],
  };
}

/**
 * **Which warning a slow step gets, and it turns on one thing.**
 *
 * *"Longer than usual"* is a claim about a distribution, and this module only
 * has one for the steps that carry a `usually` sentence. Everything else is on
 * `SLOW_AFTER_MS`, a guess — a good guess, in the safe direction, and still not
 * grounds to tell somebody their step is unusual. So the two questions are tied
 * to one field: **we say "usual" exactly where we have said what usual is.**
 * One field rather than two means no step can ever be measured for one sentence
 * and not the other.
 *
 * Both name the way out, which is the half that matters either way: a reader
 * looking at a spinner needs to know they may end it more than they need to
 * know how it compares.
 */
function slowSentence(timing: StepTiming | null): string {
  return timing?.usually !== undefined ? TAKING_LONGER : RUNNING_A_WHILE;
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
 *
 * **`slow` is the one state not in here**, and its absence is deliberate rather
 * than an oversight: it is the only state whose sentence is not a function of
 * the state alone — it depends on whether the *step* was measured. `Exclude`
 * rather than a `slow: null` entry nobody reads, so that a hand reaching in to
 * "fill the gap" gets a compiler error instead of a second, silent answer.
 * `slowSentence` is where it is decided.
 */
const SENTENCES: Record<Exclude<JobDisplayState, "slow">, string | null> = {
  waiting: WAITING_TO_CONTINUE,
  working: null,
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
 * **About sixteen seconds**, and the arithmetic is worth doing out loud because
 * this comment said twenty-four until 2026-09-01. `drive` calls `/advance`
 * *immediately*, and the eight-second wait (`IDLE_MS` in src/web/jobEngine.ts §
 * `step`) comes **after** a failure, not before it — so the three failures land
 * at roughly 0s, 8s and 16s, and the count reaches three at the third failure,
 * before its own wait. Two gaps, not three. GPT Sol, 2026-09-01.
 *
 * Sixteen seconds is long enough that one blip and one dev-server restart say
 * nothing, and short enough that the reader hears it before they have decided
 * the app is broken. The number stays at three; only the description of it was
 * wrong.
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
