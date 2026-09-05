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
 * status = 'running'`. One claim covers a whole **job** — `walkClaim` runs
 * every step on it, because on a serverless host the next request lands on a
 * different instance — and is then put down, because a claim held past its
 * claimant leaves the job `running` with a token nobody holds and the next
 * advance is told `busy` until the lease lapses, the endpoint deadlocking
 * itself on the happy path. Three doors out: a release between steps, a pause
 * from inside one, and the finish. (This said *"one claim covers one step"*,
 * which was the shape until 2026-08-30.)
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
  type AiCallRow,
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
import { pgJobStore } from "./store/pg-jobs.js";
/* The refusal a publication answers with, by name, because the walk has to tell
   it apart from a database fault: one is a draft that is not fit to be an
   article and ends the job with something a person can act on, the other is a
   500. Imported from the module that defines it rather than through
   src/store/revisions.js, which does not re-export it. See `walkClaim`. */
import { PublishRefused } from "./store/pg-revisions.js";
import {
  DraftGoneError,
  mintAttempt,
  StaleAttemptError,
  type ExpirySettlement,
  type JobEnding,
  type JobStore,
} from "./store/jobs.js";
import { failureKindOf, jobWorthRetrying, readerFailureOf } from "./job-failure.js";
import { slugWithShortId, urlKey } from "./ingest.js";
import { runInJob } from "./job-scope.js";
import { errorFields, log, type Log, since } from "./log.js";
import { captureFailure } from "./monitoring.js";
import { currentOwnerId, type OwnerId, runAsOwner } from "./owner.js";
import { processSingleton } from "./process-state.js";
import { slugForUrlKey } from "./store/find-article.js";
import type { JobSettlement, JobTransition, StoreSession } from "./store/session.js";
import { openPgStoreSession } from "./store/pg-session.js";
import {
  articleExists,
  contextPaths,
  DEFAULT_INGEST_STEPS,
  FORCE_ONLY_WHEN_NAMED,
  type PipelineStep,
  cacheArticleForStep,
  STEP_ORDER,
  STEPS,
  stepIsDone,
  type StepContext,
  stepLabel,
  urlForSlug,
} from "./pipeline.js";
import { INTERRUPTED, STEP_STOPPED, type FailureKind } from "./messages.js";
import type { Job, JobStep, JobUpload, StepName } from "./types.js";

/* `JobStatus` and `StepStatus` were on this line too and nothing imported them
   from either module — they are only ever used structurally, inside types.ts,
   as the type of `Job.status` and `JobStep.status`. */
export type { Job, JobStep, StepName } from "./types.js";

/**
 * **Where the job records live is no longer this file's business.**
 *
 * `data/_jobs/`, the in-memory `Map`, the serialised writes and the tombstones
 * moved to src/store/jobs-fs.ts behind `JobStore`, and there was a flag here
 * choosing between that and `pgJobStore` until 2026-09-05. There is one store
 * now, so this is a binding rather than a choice.
 *
 * Bound here rather than in src/store/index.ts for the same reason
 * src/upload-records.ts binds its own: that file is the *reader's* store and it
 * imports fs.ts, which imports src/pipeline.ts, which this file imports — asking
 * from there would be an import cycle, and `npm run check` gates on cycles.
 */
const store: JobStore = pgJobStore;

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
 *
 * **Keyed to the process rather than to this module**, and that is not the same
 * hedge as the sentence above. "A second instance has no function to interrupt"
 * is true of a second *machine* and false of a second copy of this module in
 * this process — which is what every dev-server restart makes, while the step it
 * abandoned is still running and still listening. A private `Map` meant Stop
 * reached nothing at all after a save. src/process-state.ts, and
 * docs/postmortems/260902c-the-truncation-retry-cost-storm.md.
 */
const aborts = processSingleton<Map<string, AbortController>>(
  "jobs.aborts",
  "2026-09-02",
  () => new Map(),
);

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
 * **Why the deadline is minutes and not seconds.** Measured per-article step
 * wall times from `data/_ai-calls.jsonl`: `hierarchy` **320.4s in a single
 * call**, which is the longest step this project has ever measured and the
 * number everything here is sized around. It exceeds the 220s deadline these
 * constants used to give, so a long step could not complete through the job path
 * **on any machine** — it only ever succeeded via the CLI, which takes no lease.
 * (This paragraph was headed *"Why 420s"* and argued for a number two revisions
 * out of date; the reasoning was still right, so what is corrected is the claim
 * it was attached to. `hierarchy` also read "324.0s over three calls", which was
 * three unrelated runs collapsed by a null slug —
 * tests/jobs-lease-budget.test.ts § the longest step.)
 *
 * The deadline is bounded above too, and the ceiling is the invariant above: it
 * must fire before the platform's kill, with enough margin to unwind.
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
 * claim had to cover an entire job because a handoff would land on a cold
 * instance with an empty `/tmp` and re-run everything.
 *
 * **That cause has gone, and this paragraph used to predict its own expiry.** It
 * said the escape valve "is unusable today for that one reason" and that a
 * handoff would cost nothing once D3–D5 put artefacts in Postgres. They did: a
 * claim writes into a draft revision, `stepIsDone` reads the *artefacts* through
 * the session, and a handoff to a cold instance now costs a claim and a round
 * trip rather than the work. Two hand-backs already rely on it — the
 * between-steps release in `walkClaim`, and `pauseForDeadline` from inside a
 * step (src/store/jobs.ts).
 *
 * **So the number is now conservative rather than forced, and it is kept
 * deliberately.** What it buys is that the one step nobody can afford to repeat
 * gets a whole window: `hierarchy` at 320.4 s measured, 658–778 s on a
 * 142-page PDF. What it costs is a claimant that is *actually* dead — killed,
 * frozen, deployed over — being unreclaimable for ~12.5 minutes rather than ~7,
 * and that cost is now bounded by the pause: a claimant that is merely slow puts
 * the job down at 740 s instead of leaving it to lapse. Shrinking the lease is a
 * separate piece of work and wants the step budgets re-measured first.
 *
 * The arithmetic it has to satisfy, measured rather than assumed and **for an
 * ordinary web page** — `tests/jobs-lease-budget.test.ts` pins it:
 *
 *     fetch ≤110s + extract ~10s + blocks ~5s + hierarchy 320.4s + assets ≤185s = 630.4s
 *     630.4s  <  740s self-abort  <  800s platform kill
 *
 * **That sum is elapsed time, and since 2026-09-04 it is no longer the number of
 * requests.** `STEP_BUDGET_MS.hierarchy` is now 700s, so a walk that has spent
 * ~125s on `fetch → extract → blocks` hands the claim back rather than starting
 * the one step it cannot restart cheaply, and the ordinary article takes two.
 * The arithmetic below still has to hold — a job that cannot fit one invocation
 * is a job nothing can recover — but "fits one claim" and "takes one request"
 * are now different claims about it. See `STEP_BUDGET_MS` § `hierarchy`.
 *
 * **Re-measured 2026-09-04, and the old line said 520s.** It quoted `fetch ~10s`
 * and `extract ~5s`, both of which this same file falsified in the same change
 * that raised `MAX_PAGES` ⟨GPT Sol⟩: `fetch` is bounded by src/fetch.ts's three
 * 30s attempts rather than by a single request, and `extract`'s 10s is the *HTML*
 * branch. `assets` is its own cap, which moved from 180s to 185s to include the
 * unwinding.
 *
 * **And a PDF does not fit, has never claimed to, and that is not a hole.** The
 * PDF branch of `extract` is a fan-out of model calls whose ceiling is
 * `STEP_BUDGET_MS.extract` — 700s, most of one whole window on its own. Measured
 * in a browser on 2026-09-04: a 144-page paper spent nearly all of the first
 * window in `extract` and had `hierarchy` cut off by the deadline, so it took
 * **two claims**. What makes that cheap rather than ruinous is the per-chunk
 * checkpoints and a retry that lands on the same article
 * (src/pdf-read.ts § `CHUNK_CONCURRENCY`, `slugForRetry`) — and what the sum
 * above is really pinning is that the *ordinary* article still fits one.
 *
 * **`extract` stopped being the expensive half later the same day**, when
 * `CHUNK_CONCURRENCY` went 16 → 100 and the 142-page paper's extract went
 * 394s → 69s measured. The budget above is unchanged and is still a *ceiling*
 * rather than a forecast — retries stack on top of a fan-out and no number
 * bounds them — but the walk it describes now spends its first window on
 * `hierarchy`, not on transcription. **It still takes two claims**, because
 * `hierarchy` measured 658–778s and no arithmetic makes that share a window with
 * anything.
 *
 * 420s was right for the one-step-per-request shape this replaces, where every
 * step got a fresh deadline. Under a claim that walks the whole job it is a
 * per-step constraint in a per-claim world: `hierarchy` alone at 320.4s would have
 * eaten four fifths of it, and the ordinary article would have aborted four
 * fifths of the way through the one step nobody can afford to repeat.
 */
export const LEASE_MS = 760_000;
export const DEADLINE_MARGIN_MS = 20_000;

/**
 * **The claimant's own deadline, as the reason it aborts with** — so that
 * "nobody came back" and "the reader pressed Stop" can be told apart by anyone
 * holding the signal.
 *
 * They could not be, until 2026-09-04. Stop and the deadline abort the *same*
 * `AbortController` — deliberately, because a step listening for one is
 * listening for both — and `runStep`'s catch decided with a bare
 * `controller.signal.aborted`. So a job killed by its own 740 s deadline took
 * the branch written for a reader who chose to stop, and the card said **"You
 * stopped this before it finished."** to somebody who had pressed nothing.
 * Found in a browser run on a 144-page PDF, at 742.8 s; raising `MAX_PAGES` to
 * 250 is what turns that from rare into routine.
 *
 * **A class rather than the message string**, which was the other way to tell
 * them apart and was available: the deadline already aborted with
 * `new Error(INTERRUPTED.message)`, so `reason.message === INTERRUPTED.message`
 * would work today and would silently stop working the day somebody reworded a
 * sentence — docs/project/copy.md says copy stays freely rewritable, and pinning
 * one here would make that false without saying so. The type carries the fact
 * the code needs and the message goes on carrying the one the reader needs.
 *
 * It keeps `INTERRUPTED`'s wording and `Error`'s `name`, so nothing downstream
 * that reads either sees a change: this is a *narrowing* of what was already
 * thrown, not a new thing to handle.
 */
class DeadlineReached extends Error {
  constructor() {
    super(INTERRUPTED.message);
  }
}

/**
 * **How many times a job may be given back to the queue after its claimant
 * stopped answering, before it is ended instead.** Two — so **three** lease
 * windows in all, counting the one the job was claimed under to begin with.
 *
 * Read that sentence twice, because the constant and its justification meant
 * two different things for a day. It was three, and the paragraph beside it
 * counted *attempts* — so the code bought four lease windows while the reasoning
 * argued for three. Two is the number that makes them agree, and the reasoning
 * is the half that was right. GPT Sol, reviewing the built stage 3, finding 2.
 *
 * `settleExpired` used to end every lapsed claim outright, so a deploy landing
 * mid-ingest cost the reader their job and left them a Retry button. It now puts
 * the job back to `queued` on the same row, which is what the filesystem store's
 * `sweepStopped` has always done at restart, and which keeps the slug, the
 * article, the article's checkpoints **and the draft** — the last of those since
 * 2026-09-04, because without it the next window re-mints every block id and the
 * checkpoints, though still there, name an identity that has moved. The contract
 * is src/store/jobs.ts § `settleExpired`; enforcing the number is the store's,
 * deciding it is ours, the same division `LEASE_MS` and `jobConcurrency` already
 * have.
 *
 * **A lapsed lease and a step that overran are not the same event, and this
 * budget covers both.** A lapse is *nobody came back* — the claimant was frozen,
 * killed or deployed over, and stopped saying anything. A claimant that reaches
 * its own deadline is still here: it aborts its step, unwinds cleanly, and since
 * 2026-09-04 hands the job back through `pauseForDeadline`
 * (src/store/jobs.ts) rather than ending it. That was listed as *recommended,
 * not built* in
 * docs/plans/260903k-pdf-page-cap-refused-with-no-reason-given.md, and was built
 * by stage 3 of docs/plans/260904b-a-long-pdf-finishes-without-a-retry-click.md.
 *
 * **So "three windows" is three in total, not three of each**, and this is the
 * sentence to read twice. One counter, two spenders: a lapse followed by one
 * cooperative pause leaves only the third window. Nothing arbitrates between
 * them beyond the count, deliberately — a job that has burned three windows any
 * way at all is a job that is not making progress.
 *
 * **And the pause is why there is a cap on this at all now, rather than merely a
 * good idea.** Every hand-back before it was preceded by a *completed* step
 * (`transitionAfter`'s `release`), so progress was structurally guaranteed and
 * no counter could have been needed. A mid-step pause breaks that guarantee: a
 * step that can never fit in 740 s would pause, re-claim and spend another
 * window for ever.
 *
 * **Why there is a number at all:** without one, a job that overruns every lease
 * requeues for ever, buying model calls nobody is waiting for. That is the
 * failure mode this whole area is about, wearing a different hat.
 *
 * **Why three windows.** A resumption is worth having when the *next* attempt
 * can finish, and each one starts with every checkpointed chunk already banked,
 * so the work left shrinks every time. Measured on 2026-09-03 against the
 * document that prompted this: a 144-page paper plans 48 chunks and finishes
 * inside one 740s deadline at the mean call duration, and needs a second attempt
 * only on a bad tail. One window is therefore the ordinary case, two covers the
 * tail, and three covers a deploy landing during the second. A job still
 * unfinished after three is not making progress, and looping past that is
 * re-buying whatever is not checkpointed for a reader who is no longer watching.
 *
 * **And nothing here requires progress before granting a window**, which is what
 * makes the number the whole of the protection. The requeue is decided by
 * `settleExpired` from the lease alone — it has no view of what the attempt got
 * done — so a step whose paid call is *not* checkpointed can be bought once per
 * window. Three windows is three of those. A progress test (say, "requeue only
 * if a checkpoint landed") would be the tighter rule and is not built: the two
 * expensive fan-outs are checkpointed already, so what it would save is the
 * `assets` outline call and little else, at the price of a second concept in the
 * sweep. Worth revisiting if a third un-checkpointed paid step ever appears.
 *
 * **And the budget is per job, not per article, which is deliberate.** Pressing
 * Retry makes a *new* job with a fresh two — so the reader is the outer loop.
 * That is the same shape Stop has: the machine gives up before the person does.
 *
 * **The filesystem store counts this in memory, which is weaker parity and is
 * accepted.** `src/store/jobs-fs.ts` keeps the counter in a `Map` that a restart
 * empties, so a job that has spent its budget gets a fresh one after a
 * dev-server restart. The argument in that file is that a restart there *is*
 * `sweepStopped`, which requeues everything running with no budget at all — but
 * it does mean the cap is not durable locally, and locally is where paid
 * development happens. Not built on: there is no articles table under that store
 * to hang a durable count on, and Postgres is what ships
 * (docs/project/database.md). GPT Sol, reviewing the built stage 3, finding 2.
 *
 * The ending when it is used up is `INTERRUPTED`, which is what a lapsed claim
 * has always written and is honest here: *"This stopped part-way through … the
 * steps that finished are kept, so trying again picks up where it left off."*
 * Since 2026-09-03 that last clause is true rather than aspirational — a retry
 * lands on the same article, so it really does pick up (`slugForRetry`). A
 * sentence that also said *how many times we tried* would be better and needs a
 * new `ReaderFacingFailure`; it is not written here because src/messages.ts is
 * being edited elsewhere.
 */
export const REQUEUE_BUDGET = 2;

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
 * correctness: two jobs never *run* on one article, which is the article's own
 * line — the predecessor rule in `claim` and `jobs_one_running_per_slug` behind
 * it (src/store/jobs.ts) — and not this one.
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
  /* **MEASURED** 2026-09-04, and the measurement is the smaller half of the
     number.

     `fetchDocument` took 107–893 ms over five real addresses off this box
     (paulgraham, gwern, a 1.3 MB Wikipedia article, slatestarcodex, a 5.6 MB
     arXiv PDF). What bounds the step is not that: it is `DEFAULTS` in
     src/fetch.ts, **three attempts of 30 s each** with a backoff capped at 10 s
     between them, so a hanging retryable origin costs about **110 s**. An
     earlier draft of this comment said 30 s, having read `timeoutMs` and not the
     retry loop it sits inside ⟨Sol, 2026-09-04⟩ — which is the same mistake in
     miniature that the whole table's header is about.

     On top of that sits the page count added on 2026-09-04
     (`refuseAnOverlongPdf`, src/pipeline.ts): 1.5–1.8 s on the first PDF a
     process sees, because that is when pdf.js loads, and 17–33 ms after —
     measured on four files from 8 to 144 pages and 0.1 MB to 11 MB, with no
     trend against either. The storage put is the one part still unmeasured, and
     it is the reason for the rounding rather than a gap.

     It read *"GUESS, generous. Network only, no model call. Never measured"*
     until then, and 10 s was under a single one of its own three timeouts. */
  fetch: 150_000,
  /* **A CEILING, and the two branches of this step are two different steps.**
     ⟨measured 2026-09-04⟩

     *HTML* is Readability: 0.95 s, 1.2 s, 2.8 s and **5.2 s** over the four real
     pages above, the worst being Wikipedia's 1.3 MB *Consciousness*. So the 5 s
     that stood here was already under the worst ordinary web page, never mind
     the note beside it admitting it did not cover a PDF.

     *PDF* is `runPdfExtract`, and **no number can bound it**, which is why this
     is a ceiling and not a measurement. 250 pages plans ~84 chunks; at
     `CHUNK_CONCURRENCY` 100 — raised from 16 on 2026-09-04 — that is one wave
     rather than six, and the real 142-page paper's extract went from **394 s to
     248 s** measured. Not to 45 s, because one wave of calls is not one call:
     the step is now bounded by its slowest chunk asked twice rather than by how
     many waves it needs. What stops this being a bound at all is the same as it
     ever was: on top of it sit two retry layers
     this file cannot see, `ATTEMPTS` for a chunk that fails its check and
     `TRANSPORT_ATTEMPTS` with backoff for one that never answered
     (src/pdf-read.ts). A first draft of this row said 600 s and read as though
     588 + 12 were a budget; it was arithmetic pretending to be a bound ⟨Sol,
     2026-09-04⟩.

     So the question is not "how long does a PDF extract take" but "is there
     enough of this claim left to be worth starting one at all", and the answer
     is as much of the window as can be reserved without the step becoming
     unstartable. The deadline is `LEASE_MS - DEADLINE_MARGIN_MS` = 740 s; a
     budget at or over that never fits and the job would sit `queued` for ever.
     **700 s** leaves the 40 s a preceding `fetch` needs to have run and still
     admit — and when it does not, the claim is handed back and the next one
     runs `extract` first, which this table never gates: the walk checks the
     budget *between* steps, so the first step of any claim always starts
     (`advanceJobWith`'s loop, below). That is what makes a number this large
     safe rather than a way to wedge a job — and it is also the limit of what it
     buys. A claim that *begins* at `extract` gets whatever is left of its
     deadline, however little; this row protects the ordinary
     `fetch → extract` walk and nothing else.

     Being over-large costs an HTML article one extra request, which is the cheap
     direction this table's header says to round in. Being under-large is what
     shipped: a PDF extract admitted with 100 s left, self-aborting at 100 s.
     That is survivable now rather than ruinous, because the per-chunk
     checkpoints are keyed on the article and a retry keeps it (`slugForRetry`),
     so the paid chunks are banked — but a wasted lease window is still a wasted
     lease window, and `REQUEUE_BUDGET` above allows two of them. */
  extract: 700_000,
  /* GUESS, generous. Deterministic, no model call. */
  blocks: 5_000,
  /* **A CEILING, and the reasoning is `extract`'s above, for the same reason.**
     ⟨measured 2026-09-04 on Kuhn, *A Landscape of Consciousness*, 142 pages⟩

     **MEASURED 2026-08-30**, on ordinary articles: the worst `hierarchy` in
     data/_ai-calls.jsonl is **320.4 s** in a single call, so its sum and its
     wall clock agree and no grouping argument applies. That number stood here
     until 2026-09-04 and is still the one `LEASE_MS` is sized around — it is
     what an ordinary web page costs, and `tests/jobs-lease-budget.test.ts` goes
     on asserting the whole HTML ingest against it.

     **MEASURED 2026-09-04**, on the 142-page paper this plan is about: the
     structure call **alone** is 508 s and the whole step is **658–778 s**. The
     same two production ingests recorded `extract` at 305–347 s, so the walk
     reached this step with 393–435 s of its deadline left — comfortably over
     320.4 s, so it started a step that could not reach even its first
     checkpoint, bought most of a ~$2 structure call, and spent one of the two
     windows `REQUEUE_BUDGET` allows. ⟨GPT Sol, reviewing the built stage 3⟩

     **No threshold can promise this step fits**, because 778 s is more than the
     740 s deadline; what a threshold can do is stop it being *started* on a
     remnant. So this is `extract`'s answer to `extract`'s question — as much of
     the window as can be reserved without the step becoming unstartable — and
     the same 700 s, which is not a coincidence: both are "essentially the whole
     window, minus enough for a step to have preceded it".

     What it means in practice is that `hierarchy` almost always begins a claim
     rather than continuing one: the walk runs its **first** runnable step
     ungated (`advanceJobWith`'s loop, below), so a claim that opens on
     `hierarchy` gets the entire 740 s, and a claim that reaches it after
     `fetch → extract → blocks` hands back instead. Once inside, an overrun is a
     cooperative pause that keeps the draft (`pauseForDeadline`,
     src/store/jobs.ts) and the structure answer is checkpointed
     (src/hierarchy.ts), so the next window resumes rather than re-buying it.

     **The cost is one extra request for an ordinary article**, which used to
     finish all five steps in one claim and now hands back before `hierarchy`
     with ~615 s left. That is the cheap direction this table's header names —
     the steps already done are skipped from the draft — and the expensive
     direction is what shipped. A size-sensitive threshold would keep the single
     request for short articles and is the obvious later refinement; it is not
     built, because the simple number is what removes the retry click.

     `tests/jobs-lease-budget.test.ts` pins the relationship rather than the
     number: greater than what the worst measured PDF `extract` leaves behind,
     and less than the claimant's own deadline. */
  hierarchy: 700_000,
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
  /* **MEASURED**, three runs over two articles on 2026-09-03
     (evals/results/illustrated-2026-09-03b/README.md): the brief call took 175s,
     223s and **334s**, and the three plates behind each took 83s at worst. So
     the worst run so far is **417s**, and a fourth plate — `MAX_PLATES` is 4,
     src/illustrated-plate.ts — puts the worst case at about **450s**.
     Sequential by design: bounded parallelism here would multiply against the
     three-job concurrency above.

     **600s, and it is a ceiling rather than a rounding.** Every other row here
     rounds up hard, usually to twice the worst — this one cannot. Twice 450s is
     900s, and the deadline a claimant works to is `LEASE_MS - DEADLINE_MARGIN_MS`
     = 740s, so a budget over that is a step that never fits in a fresh claim and
     therefore never starts at all: the job would sit `queued` for ever with
     nothing failing. 600s is the largest round number that leaves the claimant
     its 140s of unwind, and it is 1.3x the worst measured rather than 2x. The
     honest reading of that is that **this step is the one with the least
     headroom in the table**, and the brief call is 86-89% of it.

     **So `MAX_PLATES` and this number move together, and neither alone.**
     Raising the cap to 5 costs another ~35s of plate and eats the margin;
     raising this past 740s needs `LEASE_MS` raised first, which needs
     `vercel.json`'s `maxDuration` — 800s today — raised before it, and
     tests/jobs-lease-budget.test.ts is what refuses the pair being broken.
     If the brief ever needs to be longer, the lever the plan names is the
     prompt: cap the vignette count and the length of the compositions. */
  illustrated: 600_000,
  /* **A GUESS, and the honest label matters here more than usual**, because
     nothing this step does is bounded by a parameter.
     ⟨Stage 0/0b, 2026-09-05, docs/plans/260905f-debate-mode-stage-0-spike-results.md⟩
     A bare probe — three or four searches, no article, no schema — took 10.0 to
     10.3 s. This step is two of those in sequence, and the second carries the
     whole article, so 120 s is roughly six times the only thing measured.

     **What it does NOT bound is the spend, and it does not bound the runtime
     either** (GPT Sol's F31). This number is consulted only *between* steps, to
     decide whether to hand the claim back — see `advanceJobWith` — and the walk
     runs its first runnable step **unconditionally**. A debate-only job, which
     is how this step is normally asked for, therefore starts whatever is left
     and runs until the claim-wide abort at `LEASE_MS - DEADLINE_MARGIN_MS` =
     **740 s**. So 120 s is a *scheduling* number: it is what a long ingest asks
     for before starting this step at the end of a queue, and nothing else.

     `max_total_results` is enforced to the row and is not a budget either: an
     adversarial probe with the cap at 4 ran **36 searches** for $0.10, because
     nothing in the request caps the number of *searches* and searches are what
     cost money. So what actually bounds a run is a prompt written for restraint
     rather than thoroughness, the 740 s claim-wide abort, and `webSearches` on
     the `ai_calls` ledger row as the alarm afterwards — and only the first of
     those is a ceiling on spend at all.

     Re-measure at the end of the stage rather than leaving this a guess: the
     plan says so, and the first runs against the shelf are what will say
     whether the article-carrying pass is 20 s or 60 s. */
  debate: 120_000,
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

/**
 * **A step list that would leave the article unpublishable — refused here, where
 * it is still free.**
 *
 * `blocks` without `hierarchy` is the one such combination, and it is reachable:
 * `POST /api/jobs` takes any subset of `STEP_ORDER`, so `{ steps: ["blocks"] }`
 * is a request anybody with a session can make. It runs, it succeeds, and then
 * `reasonsNotToPublish` (src/store/pg-revisions.ts) refuses the publication,
 * because the `hierarchy` step-run's `input_hash` no longer equals `hashBlocks`
 * of the blocks it is being published beside. The article is stuck until
 * somebody works out that the fix is to re-run a step they never named.
 * `cascadeForce` cannot rescue it: it only names steps **already in the job**.
 *
 * **Refused rather than repaired**, which was the choice. Quietly adding
 * `hierarchy` would spend a model call — the slowest one in the pipeline, 228
 * seconds measured — on behalf of a caller who did not ask for it and is not
 * being billed for it, and it would make the job that ran different from the job
 * that was requested. A 400 naming the missing step is the whole fix.
 *
 * A separate function rather than four lines inside `enqueue`, so it can be
 * asserted without a store under it. GPT Sol found the trap reviewing stage A of
 * docs/plans/260904e-extraction-repair-evals-and-llm-post-processing.md,
 * 2026-09-05; it is production-reachable but not on any first-party UI path, so
 * nothing had hit it.
 */
export function unrunnableStepPlan(steps: readonly StepName[]): string | undefined {
  if (steps.includes("blocks") && !steps.includes("hierarchy")) {
    return 'A job that runs "blocks" must run "hierarchy" too, or the article cannot be published: the tree is checked against the blocks it was built from, and hierarchy has no freshness check of its own to notice.';
  }
  return undefined;
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
  /** When this claimant stops, on `Date.now()`'s clock. `StepContext.deadlineAt`. */
  deadlineAt: number,
  jlog: Log,
  /* The caller's progress write. It answers with the job row as it now stands —
     which is how the walk notices a Stop pressed on another instance — but that
     is the caller's business and nothing here reads it. */
  note: () => Promise<unknown>,
  session: StoreSession,
  registry: StepRegistry,
  decide: () => JobTransition,
  /* An observer, never a participant — see `AdvanceParts.onStepSpend`, which is
     where the whole argument for its existence lives. `undefined` in production. */
  onStepSpend: AdvanceParts["onStepSpend"],
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
    /* The same instant the abort timer above is set for, passed rather than
       recomputed: a step that can decline to start work it cannot finish needs
       to know *when*, not only *that*. See `StepContext.deadlineAt`. */
    deadlineAt,
    /* Mark the article when any *other* step of this job is in the same cache
       group — in either direction. The list used to be `slice(i + 1)`, later
       steps only, which marked the stage that writes the entry and never the one
       that reads it; the reader is the last member of its group by construction,
       so it sent no breakpoint and read nothing. Both halves of the reasoning are
       on `cacheArticleForStep`, which now owns the argument shape precisely so
       that it is testable without a job. docs/project/prompt-caching.md. */
    cacheArticle: cacheArticleForStep(
      job.steps.map((s) => s.name),
      job.steps.indexOf(step),
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
    /* **Three things the run phase gets, and each is a different lifetime.**
       `ctx` is this attempt, `session.reads` is this draft revision, and
       `session.checkpoints` is the *article* — work a previous attempt already
       paid for, which is the only one of the three that must survive this
       attempt failing. src/store/checkpoints.ts. */
    const run = () => registry[step.name].run(ctx, session.reads, session.checkpoints);
    const { result: product } = await collectSpend(run, {
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
        /* Here rather than after the await, so it fires on the throw path too —
           the same reason `onDone` itself exists. `report.calls` is complete by
           now; `report.writeFailures` is a lower bound, and
           `AdvanceParts.onStepSpend` says why that is fine. */
        onStepSpend?.(step.name, report);
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
    /* **And the mirror of it, which is not a step failure either.** The claim is
       still ours and the draft went away, so the step's artefacts had nowhere to
       land — but there is nobody to hand the job to and the walk has to end it
       rather than record a verdict on a draft that no longer exists.
       `settleJob` cannot write into that revision, so recording it here would
       fail a second time inside the recovery. The walk's outer catch ends the
       job through `endAsStorageFailure`. See `DraftGoneError`. */
    if (err instanceof DraftGoneError) throw err;
    /* A cancel unwinds through here too — the `throw new Error("Cancelled")`
       above, and any step that honours the signal by throwing. The reader
       pressing Stop is not a fault of the step's, and giving it an `error`
       line would make Stop the most common error in the log. The job's own
       `warn` below is the record of it.

       The message string says which step and which article and stops there:
       an error's own text can carry the URL, or whatever a remote server put
       in a body, and rule 3 in src/log.ts is that `redact` cannot reach
       anything inside `msg`. The full error goes in the object, where it can. */
    const stopped = controller.signal.aborted;
    /* **Whose abort was it.** The deadline and Stop share one controller, so
       the *reason* is the only thing that separates them — see
       `DeadlineReached`, which is also where the argument for a type rather
       than a message match lives. */
    const ranOutOfTime = controller.signal.reason instanceof DeadlineReached;
    if (stopped) {
      jlog.debug(
        {
          step: step.name,
          ms: since(stepStarted),
          /* Which of the two aborts this was, because the log line reads the
             same for both and they are not the same event. */
          why: ranOutOfTime ? "deadline" : "stop",
          ...spendFields(spend),
        },
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
    /**
     * **The two sentences this ending has, and which one goes where.**
     *
     * `readerFailureOf` is the whole of the seam docs/project/copy.md §
     * The seam between the two audiences describes: what a step threw is the
     * *diagnostic*, and it stays on the error for `captureFailure` and the log
     * line above; the reader gets whatever the throw site declared, or a
     * generic sentence naming the step when it declared nothing.
     *
     * These were one string until 2026-09-03, and that is how a source-file
     * reference, band arithmetic and — through six stages before them —
     * provider prose reached readers' screens. src/job-failure.ts.
     *
     * **A cancel does not ask that question at all**, and for the first six
     * hours of the seam's life it did. Two things were wrong with the answer:
     * the generic copy can say the problem *"has been recorded"* when the
     * branch above deliberately skipped `captureFailure`, and a refusal racing
     * with Stop left a `blocked` sentence — *asking again will be refused* — on
     * a step of a job that `recordFailureKind` was about to make retryable. The
     * reader is not owed a failure's account of a thing they chose. GPT Sol,
     * stage 2 review.
     *
     * **And "a cancel" is two things, which cost a reader a false accusation
     * for a day.** An abort here is either the reader's Stop or this claimant's
     * own deadline, and until 2026-09-04 both got `STEP_STOPPED` — *"You stopped
     * this before it finished"* — because the branch asked whether the signal
     * had fired and not who fired it. The card said that about a 144-page PDF
     * whose hierarchy step ran out of time at 742.8 s, in a browser run no test
     * had covered. `INTERRUPTED` is what the *job* has always ended with in that
     * case (`interruptedEnding`, below), so this is the shelf card agreeing with
     * the band rather than a new sentence: *"whatever was running it did not come
     * back"* — which is what a claimant handing back at its own deadline is,
     * from the reader's side.
     */
    const stopping = ranOutOfTime ? INTERRUPTED : STEP_STOPPED;
    const reader = stopped ? stopping : readerFailureOf(err, step.label);
    step.status = "error";
    /* **The reader's sentence on both fields, and it has to be both.** The band
       renders `job.error` and the shelf card renders `step.error`
       (src/web/JobProgress.tsx, src/web/AddArticle.tsx), so writing one of them
       safely leaves the leak alive on the other surface — which is why
       tests/step-failure-seam.test.ts asserts the persisted pair rather than
       any rendered HTML. */
    step.error = reader.message;
    step.finishedAt = new Date().toISOString();
    if (stopped) {
      markCancelled(job, reader.message);
      /* Not on a cancel: the reader stopped it, and a stopped job is always
         worth starting again. `STEP_STOPPED` is `retry` and agrees, which is
         the pairing that came apart when this branch shared the failure
         sentence. */
      recordFailureKind(job, undefined);
      return { outcome: "cancelled" };
    }
    job.status = "error";
    job.error = reader.message;
    /* **Still `failureKindOf(err)` and not `reader.kind`**, which are the same
       value whenever the throw site declared one and differ only for a failure
       that declared nothing: `reader.kind` is then `retry` by fallback, and
       `undefined` is the honest record of nobody having said. Both answer *yes*
       to `jobWorthRetrying`, so nothing on screen turns on the difference —
       what turns on it is a later reader of the row being able to tell a
       claimed `retry` from an absent one. */
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
  return jobSpendFields(rows, unreadable);
}

/**
 * The arithmetic half of `jobSpend`, with the ledger read taken out.
 *
 * Exported for [tests/job-spend-fields.test.ts](../tests/job-spend-fields.test.ts),
 * for the same reason `by` in scripts/ai-cost.ts is: every bug this line has had
 * was in **what the number includes**, and none of them showed up in a type.
 */
export function jobSpendFields(
  rows: readonly AiCallRow[],
  unreadable: number,
): Record<string, unknown> {
  if (rows.length === 0) {
    /* An unreadable ledger and a job that spent nothing must not look the same,
       so a damaged ledger says so even when it has no rows to show for this
       job. */
    return unreadable > 0 ? { aiCostStatus: "partial", aiUnreadable: unreadable } : {};
  }
  /* **All three pockets.** `computed` was dropped here until 2026-09-02 — zero
     at the time, because our own arithmetic is only ever used by the declared
     eval bypasses, but a latent under-report on the single line that says what
     an ingest cost. The conditional that makes a total correct lives in
     `totalRows` and nowhere else, which is why this adds its three answers
     rather than summing columns itself:
     docs/project/ai-gateway.md, and the `byok_upstream_nanos` trap — which was
     spelt `upstream_inference_nanos` until 2026-09-02, and the rename is the
     point: the old name did not say that adding it is conditional. */
  const { credits, upstream, computed, unpriced } = totalRows(rows);
  const nanos = credits + upstream + computed;
  return {
    aiCalls: rows.length,
    aiCostNanos: nanos,
    aiCost: formatNanos(nanos),
    /* Only when it is not zero, so an ordinary line stays short and an unusual
       one says why. Each of these is a claim that the number above is wrong.  */
    ...(upstream > 0 ? { aiUpstreamNanos: upstream } : {}),
    /* Our estimate rather than a settled figure, so it is named apart from the
       total it is inside — a price table drifts silently, and the day a rate
       changes every computed figure after it is wrong with nothing failing. */
    ...(computed > 0 ? { aiComputedNanos: computed } : {}),
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
 * The answer a claimant gives once the row says the job is somebody else's.
 *
 * Not a step failure and not ours to record: any write we made would be refused
 * anyway, so it is reported the way a losing claimant is reported and the client
 * asks again. Three places reach it — the session that would not open, the
 * settlement of that failure, and the walk's own outer catch — and they said the
 * same four lines three times until 2026-09-01.
 *
 * **`errorType`, because this line used to say nothing about why.** It wrote a
 * job id and a slug and dropped the exception on the floor, so the four things
 * the fence tests all arrived in the log as one sentence — and an incident whose
 * whole question was *which of them was it* cost an hour of reading code that
 * the log could have answered. The class name only: `StaleAttemptError`'s
 * message is safe, but this is the one line every future refusal on this path
 * will also print, and a message here is a message nothing keeps in bounds.
 * docs/postmortems/260902f-a-lost-claim-that-was-never-lost-and-a-publication-that-was-never-buried.md,
 * and src/store/db-errors.ts for the rule.
 */
async function lostTheClaim(
  job: Job,
  owner: OwnerId,
  jlog: Log,
  where: string,
  err: unknown,
): Promise<Advanced | null> {
  jlog.warn(
    { jobId: job.id, errorType: err instanceof Error ? err.name : typeof err },
    `lost the claim ${where} — ${job.slug}`,
  );
  const now = await store.get(job.id, owner);
  return now ? { job: now, ran: null, busy: true, done: false } : null;
}

/**
 * **One rule for a claim that could not reach the store, wherever it met it.**
 *
 * Three doors lead here and all three are the same event: the claim held a job,
 * the store would not do the thing that was asked of it, and nothing else is
 * going to record an ending. The job is marked failed in memory and then ended
 * through the session — which, under Postgres, is the transaction that fails the
 * draft, clears `jobs.draft_revision_id` and moves the row to `error` together.
 * A plain `store.finish` is **not** enough: it terminalises the job while
 * leaving the pointer, and `sweepAbandonedDrafts` spares a revision any job row
 * names, so the draft would be immortal. GPT Sol, 2026-09-01,
 * docs/plans/260901d-stage3-code-review-sol.md § Shortest path to SHIP 2.
 *
 * The three doors:
 *
 * - **The publication**, when every step skipped — `walkClaim`'s final
 *   `endJob(...done)`, which has no `runStep` around it to record its failure.
 * - **The session itself**, which since the flip is a database call and can fail
 *   before a single step has run. That opening is new: the decorator
 *   `pgStoreSession` replaced wrapped a *filesystem* session and could not fail
 *   during construction.
 * - **The draft going away under a live claim** (`DraftGoneError`), added
 *   2026-09-02. The odd one out only in that the store was reachable throughout
 *   — everything else about it is the same: the artefacts had nowhere to land,
 *   the job is ours to end, and no other code path will end it. Until this door
 *   existed the walk answered `busy` and the row sat `running` behind a live
 *   lease for 760 seconds with the whole article's queue behind it.
 *   docs/postmortems/260902f-a-lost-claim-that-was-never-lost-and-a-publication-that-was-never-buried.md.
 *
 * It was written for the first and reached one transaction earlier by the
 * second, so it is one function rather than three that will drift.
 *
 * ## The message, and the kind
 *
 * **One of ours, on every door — including the refusal.** This used to make an
 * exception for `PublishRefused`, whose message *is* ours, on the reasoning
 * that being ours made it fit to show. Being ours and being fit to show a
 * reader are different things, and it was neither slug nor secret that made the
 * difference: the message reads *"the tree was built from different blocks
 * (hierarchy ran against `<hash>`, these blocks are `<hash>`) — re-run
 * hierarchy"*, which is an instruction to whoever runs this app given to
 * somebody who cannot run anything. It was the last raw diagnostic on a
 * reader-facing field after `runStep`'s seam closed, and GPT Sol found it in
 * the stage 2 review. The reasons now go on the log line instead.
 *
 * Everything else here was already one of ours, and for a stronger reason: a
 * driver error's message can carry the article. src/store/db-errors.ts is the
 * rule this is one end of.
 *
 * **`failureKindOf(err)` is preserved rather than overwritten.** It used to be
 * hard-coded `retry` for everything that was not the refusal, which threw away
 * the distinction the database boundary had already drawn correctly one layer
 * down: a transient failure is scrubbed to `STORAGE_BUSY` (`retry`) and a
 * permanent one to `STORAGE_FAILED` (`bug`, and its own sentence says another go
 * will not help). Persisting the second as `retry` put a Retry button, and a
 * promise that pressing it was safe, on a job that could only fail identically.
 * GPT Sol, docs/plans/260901d-stage3-code-review-sol.md finding 3.
 *
 * **`?? "retry"` for an error that said nothing**, said out loud rather than
 * left to the absent-means-yes rule in src/job-failure.ts — the same choice
 * `settleExpired` makes, and for the same reason: a kind that is merely missing
 * is indistinguishable from a failure nobody classified. Both offer the button;
 * only one of them says why. Note the direction this must not be tightened in —
 * src/job-failure.ts § *Which way to be wrong*.
 */
type StorageFailureDoor = "publish" | "open-session" | "lost-draft";

/**
 * What the log says, per door — a **total** map, so a fourth door cannot be
 * added without a line here. It was a ternary while there were two of them, and
 * a ternary is what silently gives the third door the second one's sentence.
 */
const DOOR_LINES: Record<StorageFailureDoor, string> = {
  publish: "could not publish a claim where every step skipped",
  "open-session": "could not open the draft this claim writes into",
  "lost-draft": "the draft this claim was writing into went away underneath it",
};

/**
 * The same, for the reader's card. A function rather than a second `Record` at
 * module scope because the sentences are declared further down this file, and a
 * `const` object up here would read them before they exist.
 */
function doorSentence(door: StorageFailureDoor): string {
  const sentences: Record<StorageFailureDoor, string> = {
    publish: COULD_NOT_PUBLISH,
    "open-session": COULD_NOT_OPEN,
    "lost-draft": DRAFT_WENT_AWAY,
  };
  return sentences[door];
}

async function endAsStorageFailure(args: {
  readonly job: Job;
  readonly attempt: string;
  readonly err: unknown;
  readonly jlog: Log;
  readonly startedMs: number;
  readonly session: StoreSession;
  /** Which door this came through — the log line, and the opening sentence. */
  readonly door: StorageFailureDoor;
}): Promise<Job> {
  const { job, attempt, err, jlog, startedMs, session, door } = args;
  captureFailure(err, { slug: job.slug, jobId: job.id, phase: door });
  /* **The class, never the message.** A raw driver error carries the failed
     statement's bound parameters — the job's `steps` and the article's title —
     and `errorFields` puts the message straight into the line, where redaction
     cannot reach it. `guardDbStore` has already logged the SQLSTATE, the table
     and the constraint on the way out, and `captureFailure` above has the
     stack. src/store/db-errors.ts, docs/project/logging.md.

     `openOrBeginJobDraft` is a free function rather than a guarded store
     method, so on the `open-session` door there may have been no scrubbing at
     all — which makes the rule stricter here, not looser. */
  jlog.error(
    {
      errorType: err instanceof Error ? err.name : typeof err,
      /* **The refusal's reasons, and only its reasons.** They are ours and they
         are the diagnostic — hashes, run statuses, and tree problems that name
         node ids and block indices (src/tree-invariants.ts), never article
         prose. They arrive here because they stopped going onto `job.error`;
         see below. The `instanceof` is what keeps the rule above intact: a
         driver error's message is still never logged. */
      ...(err instanceof PublishRefused ? { reasons: err.reasons } : {}),
    },
    `${DOOR_LINES[door]} — ${job.slug}`,
  );
  job.status = "error";
  /* Before the sentence, because the sentence's last clause is read back off
     the field this writes. See `RETRY_IS_SAFE`. */
  recordFailureKind(job, failureKindOf(err) ?? "retry");
  /* **The door's own sentence, for every door and every error.** This read
     `err instanceof PublishRefused ? err.message : …` until 2026-09-03, on the
     reasoning that the refusal's message is ours and therefore fit to show. It
     is ours and it is not fit to show: `Refusing to publish "<slug>": the tree
     was built from different blocks (hierarchy ran against <hash>, these blocks
     are <hash>) — re-run hierarchy` is an instruction to whoever runs this app,
     addressed to a reader who cannot run anything. It was the last raw
     diagnostic left on a reader-facing field after `runStep`'s seam was closed,
     found by GPT Sol reviewing stage 2. The reasons are on the log line above;
     `COULD_NOT_PUBLISH` is what the card says. docs/project/copy.md § The seam
     between the two audiences. */
  job.error = endingSentence(job, doorSentence(door));
  job.finishedAt = new Date().toISOString();
  delete job.cancelling;
  return await endJob(job, attempt, endingFrom(job, "error"), jlog, startedMs, session);
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
 * claims about **the coordinator driving that session** — and production picks
 * its session by `STORE` in `claimSession` below, which since the flip (commit
 * `c42c940`) is Postgres wherever that is configured. A test that
 * called a session method directly would be proving something else: the whole
 * point of the first of those is that `stepIsDone` goes through `session.reads`
 * and not through a store the caller happens to have. GPT Sol, 2026-08-29,
 * docs/plans/260827aa-delete-the-importer-d1b-design-sol.md finding 4.
 *
 * ## Narrow means these two, plus one thing that cannot change anything
 *
 * Not an injection framework and not a seam for anything else in this file:
 * `store`, `costStore`, the abort map and the lease are all still module-level
 * and still not replaceable. A session and a step registry are exactly what a
 * different *storage backend* changes, which is why they are the two.
 *
 * `onStepSpend` is the exception and is deliberately of a different kind: an
 * **observer**, which can watch a step's spend and cannot alter it. It exists
 * because nothing outside this file can otherwise find out how many calls a step
 * made — `SpendReport` reaches only a log line here — and a cost measurement
 * that cannot compare what a step bought against what the ledger kept will
 * quietly under-report when a row fails to persist. See `AdvanceParts.onStepSpend`.
 *
 * ## The second legitimate caller
 *
 * This comment used to say the seam was for a different *storage backend* and
 * for tests. `evals/cost/run.ts` is the third: it drives the production registry
 * with `scopeKind: "eval"` overlaid on every step and stage 1 replaced by
 * committed bytes, so that measuring what an article costs does not require a
 * second copy of the pipeline. It replaces the chooser, never the choice —
 * exactly as the paragraph below says.
 *
 * **Production behaviour does not change**, because `PRODUCTION` builds its
 * session through `claimSession` below rather than choosing one here — and that
 * is the line that selects Postgres or the filesystem. This seam replaces the
 * chooser, never the choice.
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
  /**
   * **Told what each step's spend collector saw.** An observer: it is handed the
   * report and its return value is ignored, so it cannot change what it watches.
   *
   * The gap it closes. `costStore.record` failures are counted in
   * `SpendReport.writeFailures` and swallowed (src/ai-spend.ts § `write`), and a
   * Postgres `forJob` read cannot report a row that was never inserted — absence
   * is unknowable from the reading end. So a job where the structure call
   * persisted and every label write failed reads back as a complete, plausible,
   * *smaller* bill. The only thing that can notice is a count taken on this side.
   *
   * **`report.calls` is the field to compare against the ledger.** It is final
   * here: `fn` has returned or thrown and the box is closed, so nothing else will
   * be recorded. `report.writeFailures` is a *lower bound* — `collectSpend` calls
   * `onDone` before it drains `box.writes`, so a write that rejects late is not
   * in it. That is why the reconciliation is "calls made" against "rows kept"
   * rather than a subtraction using this number.
   *
   * Nothing in production passes one: `PRODUCTION` below is `{ session, steps }`.
   * Raised by GPT Sol reviewing evals/cost/run.ts, 2026-09-02.
   */
  readonly onStepSpend?: (step: StepName, report: SpendReport) => void;
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
 * ## There is no filesystem side any more
 *
 * This was `if (STORE !== "postgres") return fsStoreSession(…)` until
 * 2026-09-05, and that branch was what every laptop ran: no draft, no
 * publication, no database. It went with the flag. What is left is the one
 * session, and `tests/claim-session-postgres.test.ts` is the proof that this
 * line opens it.
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
  "Nothing was published and your library is unchanged.";

/**
 * The same failure, met one transaction earlier: the claim could not open the
 * draft it was going to write into, so **no step ran at all**.
 *
 * A separate sentence rather than a reuse of the one above, because that one
 * opens with *"Everything ran"* and here nothing did. One recovery, two true
 * sentences, is better than one recovery and a sentence that is false on one of
 * its doors — the card is the only account of this the reader gets.
 */
const COULD_NOT_OPEN =
  "This app could not open the place it keeps an article while it works on it, so none of " +
  "this run happened. Nothing was published and your library is unchanged.";

/**
 * The third door: the work ran and the place it was going to be written
 * **disappeared while it ran**.
 *
 * Not the same sentence as `COULD_NOT_OPEN` — that one says *none of this run
 * happened*, and here most of it did, at a model's expense. The reader is being
 * told that a completed run has nothing to show for itself, which is a different
 * and more annoying thing than a run that never started, and the card has to say
 * so or the Retry button looks like it is offering to redo nothing.
 *
 * It does not say *why* the draft went away, because we do not know: nothing in
 * `src/` deletes one under a live claim, so the cause is outside this process.
 * docs/postmortems/260902f-a-lost-claim-that-was-never-lost-and-a-publication-that-was-never-buried.md.
 */
const DRAFT_WENT_AWAY =
  "This run finished its work, but the draft it was writing into was removed before it could " +
  "be saved, so none of it was kept. Nothing was published and your library is unchanged.";

/**
 * The last clause of both, and **it is not unconditional.**
 *
 * It was, until 2026-09-01: every non-`PublishRefused` failure on this path was
 * labelled `retry` and shown the first of these two sentences, so a permanent
 * constraint violation — SQLSTATE `23514`, say — reached the reader as *"trying
 * again is safe"* under a Retry button that could only fail the same way. GPT
 * Sol, docs/plans/260901d-stage3-code-review-sol.md finding 3.
 *
 * The kind decides which clause, and `jobWorthRetrying` is the one authority on
 * that (src/job-failure.ts) — asked of the job *after* `recordFailureKind` has
 * written the field, so the sentence and the button can never disagree.
 */
const RETRY_IS_SAFE = " Trying again is safe.";
const RETRY_WILL_NOT_HELP =
  " Trying again will not help until somebody fixes it. It has been recorded.";

/** One of the two openings, with the clause the failure's kind has earned. */
function endingSentence(job: Job, opening: string): string {
  return opening + (jobWorthRetrying(job) ? RETRY_IS_SAFE : RETRY_WILL_NOT_HELP);
}

/**
 * What a sweep did, in a sentence, for the two doors that log one.
 *
 * **Because a sweep no longer only ends things.** Since `REQUEUE_BUDGET`, a
 * lapsed claim with budget left goes back to `queued` on its own row — so the
 * old wording, *settled N job(s) whose claimant stopped answering*, would call a
 * resumption a settlement, in the one line that is the only account there is of
 * a claimant that went away and logged nothing on its way out. The ids and their
 * endings are in the object beside this either way; this is the half a human
 * reads first, so it says which of the two happened.
 */
function sweepLine(swept: readonly ExpirySettlement[]): string {
  const back = swept.filter((one) => one.status === "queued").length;
  const over = swept.length - back;
  const parts: string[] = [];
  if (back > 0) parts.push(`put ${back} back in the queue`);
  if (over > 0) parts.push(`settled ${over}`);
  return `${parts.join(" and ")} — job(s) whose claimant stopped answering`;
}

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
   * **What it does to a lapsed claim depends on the budget**, and this said
   * *"it settles the job rather than taking it over … so the reader sees a job
   * that stopped and a Retry button"* until 2026-09-03, when it stopped being
   * true. With `REQUEUE_BUDGET` windows left the row goes back to `queued` on
   * the same id and the very next claimant may take it — the reader sees a card
   * that carries on, not a failure. It is only once the budget is spent that the
   * job is settled and offered a button. Either way the sweep never *takes over*
   * the work in this request: it moves the row and returns, and something else
   * claims it. GPT Sol, reviewing the built stage 3, finding 6.
   *
   * **And it is deliberately not scoped to `owner`, which is in scope on the
   * line above and would look like a free improvement.** `settleExpired` takes
   * an optional owner and `listJobs` passes one, so the asymmetry reads like an
   * oversight. It is the opposite. The concurrency cap is *global* — "how many
   * jobs may run at once, anywhere", counted inside `claim`'s `queue_state`
   * lock (`CONCURRENCY_ENV` above) — and this is the **only** door that reaches
   * the job of an owner who is not coming back. Scope it, and a reader whose
   * claimant died leaves a `running` row holding one of the three global slots
   * for ever, because the only thing that would settle it is a request that
   * owner will never make again. `listJobs` may scope its call for an unrelated
   * reason: a read-only page load should not end somebody else's job.
   *
   * The cost of the global sweep is real and is not being waved away — it is
   * counted at `listJobs` below, which is also where the two doors are compared.
   * Written down after the 2026-09-03 sweep proposed the scoping fix, and GPT
   * Sol confirmed independently that it is unsafe.
   * docs/plans/260903d-improve-the-codebase-second-sweep.md § T1.3.
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
  const swept = await store.settleExpired(undefined, undefined, REQUEUE_BUDGET);
  if (swept.length > 0) {
    log("jobs").warn(
      /* `where`, because since stage 3 there are two doors into this same
         sentence and the other one is the common route. Without it the two are
         indistinguishable in the log, and the interesting question about a
         settlement is which of them found it. */
      { count: swept.length, settled: swept, where: "advance" },
      sweepLine(swept),
    );
  }

  /* `mintAttempt`, **not** `mintId`. `jobs.attempt_id` is a uuid column, and a
     `spya-` token is rejected by Postgres on the claim — the first statement of
     every advance. See the note on `mintAttempt`. */
  const attempt = mintAttempt();
  /* The cap is read here, at the moment somebody wants a slot, rather than
     frozen at import — see `jobConcurrency`. The store enforces it; deciding it
     is not the store's business, the same division `LEASE_MS` already has. */
  /**
   * **When the lease started, as near as this side can know it.**
   *
   * Read *before* the claim rather than after, and that is the safe direction:
   * the store stamps the lease from the database's clock somewhere inside the
   * call, so anything measured here is at or before the real start, and a
   * deadline computed from it fires at or before the real one. The other way
   * round — the old `Date.now()` at the top of `walkClaim` — put the claimant's
   * deadline *after* the lease's, by however long the claim and everything
   * after it took, and that gap is the window where the process is alive and
   * the row says it is gone. GPT Sol, 2026-09-01.
   */
  const claimedMs = Date.now();
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
  return await runInJob(outcome.job.id, () =>
    walkClaim(outcome.job, attempt, owner, parts, claimedMs),
  );
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
  /** When the claim was asked for — the anchor for this claimant's own deadline. */
  claimedMs: number,
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
   *
   * ## And building it can fail, which is why it is inside a recovery
   *
   * Under Postgres this line is `openOrBeginJobDraft` — two row locks, possibly
   * a minted revision and a block copy. A connection failure or a pool timeout
   * out of it used to **escape the request**: the job stayed `running` holding
   * its attempt and the global slot, every later advance answered `busy`, the
   * local pump stopped, and nothing terminalised it until a much later sweep
   * recorded a generic interruption rather than the real failure. That is the
   * same externally visible hang the all-skipped catch below exists to remove,
   * reached one transaction earlier — and it was **introduced by the flip**,
   * because the decorator this replaced wrapped a filesystem session and could
   * not fail during construction. GPT Sol, 2026-09-01,
   * docs/plans/260901d-stage3-code-review-sol.md finding 2.
   */
  /* A child logger, made here and used locally — never a module-level "current
     job". Rule 4 at the top of src/log.ts, and it matters more here than
     anywhere: several advance requests for *different* jobs really can be in
     flight in one instance at once. Above the session now, because the recovery
     for a session that would not open writes a line through it. */
  const jlog = log("jobs").child({ jobId: job.id, slug: job.slug });
  const startedMs = Date.now();

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
   * **Armed here, before the session opens, and anchored on the claim.** It
   * used to be built after `parts.session(…)` had been awaited, and dated from
   * a `Date.now()` taken after the claim returned. Both halves are the same
   * mistake — the deadline belongs to the *claim*, not to whatever the claimant
   * got round to afterwards — and both push the moment this claimant stops
   * *later* than the lease assumes: for the whole of the session open there was
   * no deadline at all, and under Postgres that open is two row locks and
   * possibly a block copy. A claimant that waited there past its lease came out
   * with nothing having told it to stop, which is how "the process is gone"
   * quietly became "the process might be slow". GPT Sol, 2026-09-01, finding 1.
   *
   * The `AbortController` moves up with it, which is worth having on its own:
   * `cancelJob` reaches for `aborts.get(id)`, and until now a Stop pressed
   * while the session was opening had nothing to pull.
   *
   * **One timer for the whole claim, not one per step**, and it is not reset
   * between them. It cannot be: `noteProgress` deliberately does not renew the
   * lease, so a per-step timer would let the lease expire underneath a claimant
   * that is still working, and renewing the lease instead would turn it into a
   * heartbeat — after which an expired lease means *probably dead* rather than
   * *definitely over its own deadline*, and `settleExpired` stops being safe.
   * GPT Sol, docs/plans/260830k-v1-stages01-review-sol.md § 3. What bounds a *step* is
   * `STEP_BUDGET_MS` — checked between steps, deciding whether the **next** one
   * is worth starting, and never while one runs.
   *
   * **Not before every step**, which this line claimed until 2026-09-04 ⟨Sol⟩:
   * the walk below runs its first runnable step unconditionally, so a claim
   * that begins at `extract` — a mode job, a forced re-run, a resumed ingest —
   * starts it whatever is left. `tests/claim-session-postgres.test.ts` runs one
   * on a two-second deadline and depends on that. So the table is a *hand-back*
   * rule rather than an admission guarantee, and a step still has to survive
   * being started with less than its budget; what makes that survivable for the
   * expensive one is the per-chunk checkpoints, not this.
   */
  const controller = new AbortController();
  aborts.set(job.id, controller);
  /** When this claimant stops, on the clock `Date.now()` reads. */
  const deadlineAt = claimedMs + (parts.leaseMs ?? LEASE_MS) - DEADLINE_MARGIN_MS;
  const deadline = setTimeout(() => {
    controller.abort(new DeadlineReached());
  }, deadlineAt - Date.now());
  /**
   * **Was that our deadline, or was it the reader?** — read off the abort
   * itself, so there is one answer and everybody reads the same one.
   *
   * This was a `let overran = false` set beside the `abort` above, and the
   * second copy is what went wrong: `runStep` cannot see a local of this
   * function, so its `catch` asked the only question it *could* ask —
   * `controller.signal.aborted` — and answered the reader's-Stop branch for a
   * job nobody had touched (see `DeadlineReached`). A boolean that only one of
   * two readers can reach is a fact with two versions.
   */
  const overran = (): boolean => controller.signal.reason instanceof DeadlineReached;
  /**
   * Put the timer and the abort entry down.
   *
   * The walk's own `finally` is one caller. The others are the four exits of
   * the session-opening recovery below, every one of which leaves this
   * function *before* that `try` is entered — so without them a session that
   * would not open leaves a timer running and an entry in `aborts` for a job
   * nobody is inside. Idempotent, because being called twice is cheaper than
   * reasoning about whether it can be.
   */
  const standDown = (): void => {
    clearTimeout(deadline);
    /**
     * **Only if the entry is still ours**, and the identity check is the whole
     * of it — `aborts` is keyed by job id, so a bare `delete` takes whatever is
     * under that key.
     *
     * It used to be bare, on the reasoning that *"the claim is what stops two of
     * us being inside one job"*. That is true of two claimants **running** at
     * once and it is not what this has to survive: a claim can be handed back
     * while its claimant is still unwinding. `transitionAfter`'s `release` has
     * always done that between steps, and `pauseForDeadline` now does it from
     * inside one — the row is `queued` the moment the transition commits, so
     * another advance in this process (a second tab, or the local pump) may
     * claim it and `aborts.set` its own controller before this line runs, in the
     * turn this claimant spends returning.
     *
     * What that costs is not tidiness. Stop is two halves — the flag on the row,
     * and the local abort — and deleting the successor's controller removes the
     * second: `cancelJob` finds nothing to pull, so the new claimant's model
     * call runs to the next step boundary or to its own deadline, up to 740 s
     * after the reader pressed a button that appeared to do nothing. ⟨GPT Sol,
     * reviewing stage 3 of
     * docs/plans/260904b-a-long-pdf-finishes-without-a-retry-click.md⟩
     *
     * **Not covered by a regression, and that is worth saying.** Forcing the
     * interleaving needs a seam between the pause's commit and this line, and
     * there is none — no `await` stands between them — so a test could only race
     * for it and would be flaky in both directions. The rule is small enough to
     * read instead.
     */
    if (aborts.get(job.id) === controller) aborts.delete(job.id);
  };

  let session: StoreSession;
  try {
    session = await parts.session(job, attempt);
  } catch (err) {
    if (err instanceof StaleAttemptError) {
      standDown();
      return await lostTheClaim(job, owner, jlog, "opening", err);
    }
    /**
     * **The recovery needs a session, and asking for one again is how it gets
     * it** — not a second rule, the same one, through a door that has to be
     * opened before it can be walked through.
     *
     * Nothing else can fail the draft. `store.finish` would terminalise the job
     * and leave `jobs.draft_revision_id` pointing at a revision
     * `sweepAbandonedDrafts` spares for ever, which is a worse state than the
     * one being fixed; only the session's own transaction fails the draft,
     * clears the pointer and moves the row together.
     *
     * **A second open is not a retry of the work.** `openOrBeginJobDraft`
     * reopens the draft the job already points at and copies nothing
     * (`blocksCopied: 0`); it mints one only for a job that had none, and that
     * draft is failed by the very next statement.
     *
     * **When it fails too, the original goes out, and that is the honest
     * answer.** Under Postgres the `jobs` row *is* in the database, so a
     * database nothing can reach is one where no ending can be recorded at all
     * — by this code or any other. The lease is what covers that case, and it
     * is the only thing that can. What this closes is every failure where the
     * database is reachable and the open was not: those are the ones that could
     * have been recorded and were not.
     */
    let after: Job;
    try {
      const recovery = await parts.session(job, attempt);
      after = await endAsStorageFailure({
        job,
        attempt,
        err,
        jlog,
        startedMs,
        session: recovery,
        door: "open-session",
      });
    } catch (settling) {
      if (settling instanceof StaleAttemptError) {
        standDown();
        return await lostTheClaim(job, owner, jlog, "while recording an open that failed", settling);
      }
      /* **The original goes out, not this one.** What failed here is a
         consequence of what failed above, and the first is the one somebody
         reading the report needs. Nothing has been recorded, so the job is left
         to the lease — see the note above on why that is the only thing that can
         cover it. */
      standDown();
      throw err;
    }
    standDown();
    return { job: after, ran: null, busy: false, done: true };
  }

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
        const ending = overran()
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
        deadlineAt,
        jlog,
        note,
        session,
        parts.steps,
        transitionAfter,
        parts.onStepSpend,
      );

      if (ran.outcome === "skipped") continue;
      lastRan = step.name;

      if (ran.outcome === "cancelled" || ran.outcome === "failed") {
        /**
         * **We ran out of our own time inside a step: put the job down rather
         * than end it.**
         *
         * The mid-step twin of `transitionAfter`'s `release` branch, and the
         * reason it is a separate transition is that the step did not finish.
         * Every hand-back before this one was preceded by a *completed* step, so
         * progress was structurally guaranteed; this one has no such guarantee,
         * which is why it is capped and the release is not — `REQUEUE_BUDGET`,
         * shared with the lapsed-lease path, so three windows is three in total.
         *
         * A claimant here is alive and has unwound cleanly, so the job goes back
         * to `queued` **on its own row with its draft intact** and the browser
         * re-drives the `{done: false, busy: false}` answer immediately, with no
         * client change (src/web/jobEngine.ts). Until 2026-09-04 it ended
         * terminal `error` with a Retry button the reader had to press —
         * measured on a 142-page PDF whose `hierarchy` step needs 658–778 s
         * against a 740 s deadline, so routine rather than rare.
         *
         * **Three of the four answers fall through to the endings below**, and
         * they must: only the store can tell a spent budget from a Stop, a lease
         * that lapsed during the unwind, or a claim that moved. See
         * `PauseOutcome` in src/store/jobs.ts.
         */
        if (ran.outcome === "cancelled" && overran()) {
          /* **The claimant's own copy of the steps is left carrying the failure
             narrative on purpose**, because the three refusals below fall
             through to an ending that needs it. What the *store* writes on a
             pause is its own business and is derived from the record it holds —
             `settledSteps` on Postgres, `sweepStopped` on the filesystem — so
             the two stories never have to be reconciled here. That only works
             because `noteProgress` copies what it is given; it used to alias it,
             and the alias carried `runStep`'s `error` into the paused record.
             tests/step-failure-seam.test.ts § a run its own deadline stopped. */
          const paused = await store.pauseForDeadline(job.id, attempt, REQUEUE_BUDGET);
          if (paused.kind === "requeued") {
            /* `info` rather than `debug`, as the between-steps hand-back is:
               somebody reading the log of a job that took three requests should
               be able to see that we chose it, and which window this was. */
            jlog.info(
              { step: step.name, ms: since(startedMs), window: paused.job.requeues },
              `handing the claim back mid-${step.name}: out of time, and the draft is kept — ${job.slug}`,
            );
            /* The session is left alone deliberately: it holds no open
               transaction, and the draft it opened is the thing being kept. */
            return { job: paused.job, ran: step.name, busy: false, done: false };
          }
          if (paused.kind === "stale") {
            /* Nothing this claimant writes can land, an ending included — so
               reporting one would be a verdict on a job it no longer owns. */
            return await lostTheClaim(
              job,
              owner,
              jlog,
              "while handing back at its own deadline",
              new StaleAttemptError(job.id),
            );
          }
          if (paused.kind === "cancelled") {
            /* **Cancellation wins.** The reader pressed Stop while the step was
               running and our deadline fired on top of it; both are true and
               only one of them is theirs. Falling through to `interruptedEnding`
               would end their own Stop as an `error` saying nobody came back,
               because `finishIn` clears `cancelling` and keeps the ending it is
               handed. GPT Sol, finding 3 on the plan.

               `runStep` wrote `INTERRUPTED` onto the step, having asked which
               abort fired and got the honest answer for a claimant that had no
               idea a Stop was also in flight. The card renders `step.error`, so
               it is corrected here to the sentence the other two Stop paths
               write — a reader must not be able to tell which side of a step
               boundary they hit. */
            step.error = STEP_STOPPED.message;
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
          /* `budget-spent`: out of windows, so it ends exactly as it always did.
             A new job with a fresh budget is what pressing Retry makes, which is
             the point of the person being the outer loop. */
        }
        /* Read off the outcome rather than off `job.status`: `runStep` records
           the story on the record in memory and this is the one write that
           commits it. An overrun is neither a cancel nor a step's fault — the
           step was interrupted by its own claimant — so it ends as an error
           the reader may retry, with `INTERRUPTED`'s wording rather than
           whatever the abort happened to say. */
        const ending = overran()
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
        if (overran()) {
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
     * So it is recorded **the same way `runStep` records the one that comes out
     * of `commit`** — the job failed, and the second `endJob` is the settlement
     * that fails the draft and clears the pointer. That is `endAsStorageFailure`
     * above, which is one rule and is also what the session-opening failure at
     * the top of this function goes through: two doors onto the same event, and
     * the sentence and the failure kind are decided in one place.
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
      after = await endAsStorageFailure({
        job,
        attempt,
        err,
        jlog,
        startedMs,
        session,
        door: "publish",
      });
    }
    return { job: after, ran: lastRan, busy: false, done: true };
  } catch (err) {
    /* **The claim went somewhere else while we were inside a step.** Not a step
       failure and not ours to record: the row says somebody else owns this job,
       so any write we made would be refused anyway. Report it the way a losing
       claimant is reported, and let the client ask again. */
    if (err instanceof StaleAttemptError) return await lostTheClaim(job, owner, jlog, "mid-step", err);
    /**
     * **The claim went nowhere, and the draft under it did.**
     *
     * The other half of the fence, and until 2026-09-02 it arrived here wearing
     * the name above: `requireLiveJobOwnsDraft` raised one error for *"somebody
     * else owns this job"* and *"my job no longer points at my draft"*, so this
     * line answered `busy` about a row that was still `running`, still leased to
     * this attempt, and reachable by nobody. `claim` only takes `queued`, Stop
     * only sets a flag a claimant reads, and stage 1 of 260902e holds every
     * other job on the article behind the oldest active one — so a wedge here
     * froze the article's whole line for the 760 seconds of `LEASE_MS`.
     * docs/postmortems/260902f-a-lost-claim-that-was-never-lost-and-a-publication-that-was-never-buried.md.
     *
     * So it is ended rather than abandoned, through the same recovery the two
     * other doors onto a store that would not take the work already use: the
     * draft is failed, the pointer cleared, and the row moves to `error` with a
     * retryable kind, in one fenced transaction. The reader gets a card with a
     * Retry button in a second instead of a frozen article for twelve minutes.
     *
     * **`ran` is null**, though a step really did run: nothing it produced was
     * kept, and reporting it as a completed step would put a step on the card
     * whose output nobody can read.
     */
    if (err instanceof DraftGoneError) {
      try {
        const after = await endAsStorageFailure({
          job,
          attempt,
          err,
          jlog,
          startedMs,
          session,
          door: "lost-draft",
        });
        return { job: after, ran: null, busy: false, done: true };
      } catch (settling) {
        /* The recovery is fenced on the same attempt, so the one thing that can
           refuse it is the claim having *since* moved — which is the case the
           line above this one is for, arriving a moment late. Anything else
           goes out: a job whose ending could not be recorded is not a job to
           report as ended, and the lease is what covers it. */
        if (settling instanceof StaleAttemptError) {
          return await lostTheClaim(job, owner, jlog, "while ending a claim whose draft went away", settling);
        }
        throw settling;
      }
    }
    throw err;
  } finally {
    standDown();
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
  /**
   * **The quota slot this ingest is spending**, from `reserveIngest`.
   *
   * Carried through to the `EnqueueTicket` (src/store/jobs.ts) so that the
   * Postgres adapter writes it in the job's **own INSERT** — the job and the
   * slot it spends become true in one statement, which is the whole provenance
   * argument. Not on `Job`, which is serialised to the browser.
   *
   * **Absent means this job spends no quota**, and most jobs do not: a step
   * re-run on an article already on the shelf, CLI work, seeding, an
   * administrator's ingest. It is set only by the three route call sites that go
   * through src/billing/admission.ts, because only a route can tell a new ingest
   * from a re-run.
   */
  ingestEventId?: string;
  /**
   * **The id of the failed attempt this request repeats** — set by `retryJob`
   * and by nothing else.
   *
   * It is here for one reason: it changes what a *mint* is called. See
   * `slugForRetry`, which is the whole of what this field does.
   *
   * **Why the fact has to be on the request rather than inferred.** Allocation
   * cannot tell a retry from a fresh request by looking at one: a retry of an
   * upload and a second upload of the same file arrive with the same shape, and
   * the difference between them is a decision — *two uploads of one file are two
   * documents* (below), and *a retry is the continuation of one named prior
   * attempt*. `retryJob` is the only caller that holds the old job, so it is the
   * only caller that can say which of the two this is.
   *
   * The id rather than a bare boolean, because it is the *name of the attempt*
   * that makes the claim true, and because it is worth having in the log line
   * that says a job was queued.
   */
  retryOf?: string;
  /**
   * **Whether to start driving the job in this process.** Defaults to true,
   * which is what every route wants: a reader who presses Add should not have
   * to keep a tab open for anything to happen.
   *
   * `false` is for a caller that drives the job itself — `scripts/stage.ts` and
   * `evals/cost/run.ts`, both of which run `advanceJob` in a loop and watch what
   * each step does. Without it the pump and the caller's loop race for the
   * single running slot, and the caller's `busy` backoff turns a one-second step
   * into a five-second one, with the step's own report going to the pump.
   *
   * **It replaces a lie.** Both callers used to set `VERCEL=1` around the
   * `enqueue` call, because `pump` returns immediately when it is set — so a
   * process on a laptop claimed to be running on Vercel in order to get one
   * `if` to go the other way. That is fine until something else reads `VERCEL`,
   * and three things already do. Naming the thing we actually want costs one
   * field. GPT Sol / stage E of
   * docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md.
   */
  pump?: boolean;
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
  /* Before the owner check and before anything is reserved, because this is a
     property of the request alone. `unrunnableStepPlan` says why it refuses
     rather than quietly adding the missing step. */
  const unrunnable = unrunnableStepPlan(names);
  if (unrunnable) throw Object.assign(new Error(unrunnable), { status: 400 });
  const owner = currentOwnerId();
  const forced = cascadeForce(names, new Set(request.force ?? []));
  /* **`request.url`, not the URL the loop reads off disk below.** They differ
     for a late step run on an existing article — the request carries none and
     the job gets one from `meta.json` — and the key has to be a property of the
     *request*, or two callers asking for the same thing would hash differently
     depending on what happened to be on disk when each of them asked. */
  const workKey = workKeyFor(names, forced, request.profile, request.upload, request.url);
  /* **Every exit from this function honours it**, including the two that hand
     back somebody else's job — a caller driving its own loop does not want a
     second driver on a job it is about to take over either. See `pump` on
     `EnqueueRequest`. */
  const drive = (id: string): void => {
    if (request.pump !== false) pump(id, owner);
  };

  /**
   * **A slug-named request must target an article this reader owns.**
   *
   * `POST /api/jobs` validates the shape of a slug and nothing else, so without
   * this line owner B can queue `{slug, steps:["ideas"]}` against owner A's
   * article. Under Postgres that job fails closed the moment anything claims it
   * — `lockOrCreateArticle` cannot find or insert A's globally unique slug and
   * throws `PublishRefused` — but **nothing ever claims it**: B has gone, and A
   * cannot drive a job that is not A's. So the row that would remove itself in
   * milliseconds sits at the head of A's line for ever, because the predecessor
   * rule in `claim` is global on the slug while every list and every Stop is
   * owner-scoped.
   *
   * **A URL or an upload is exempt**, because it is *claiming* a name rather
   * than naming one, and `jobs_reserved_slug` is what governs that.
   *
   * **404, not 403**, and that is docs/project/auth.md § *whose data is it*: a
   * 403 would confirm that the article exists. Nothing distinguishes "somebody
   * else has it" from "nobody has it" on the wire.
   *
   * **A slug nobody has at all is refused too, since 2026-09-05, and that
   * reverses a decision made here.** It used to be allowed through on the
   * grounds that it is not a cross-owner blocker — `articles.slug` carries a
   * random short id nobody can guess, so no other reader can ever come to want
   * this name, and the job blocks only itself. True, and beside the point: what
   * a bare-slug request *means* is "run something on my existing article", and
   * letting it name an article that does not exist makes a typo into a purchase.
   * `npm run blocks -- typoo` created an `articles` row, failed the step inside
   * it, and left the row and a failed revision on the reader's shelf — measured
   * 2026-09-03, and the reason this line moved out of
   * [`scripts/stage.ts`](../scripts/stage.ts), where it was first written as a
   * pre-check. The invariant belongs at the choke point every caller passes
   * through, not in one of them.
   *
   * **The answer stays indistinguishable**, because `articleExists` is
   * owner-scoped: "nobody has it" and "somebody else has it" reach this line by
   * the same route and leave it by the same sentence. That is the existing
   * privacy rule, kept rather than weakened —
   * `slugIsTaken`, the one bare global lookup, is no longer consulted here at
   * all, so the two cases are now identical rather than merely alike.
   *
   * **Unconditional since 2026-09-05.** It used to carry `STORE === "postgres"`
   * as well, because the filesystem store had no owner column and so no second
   * reader, and a store with no second reader cannot express "somebody who is
   * not the owner" (docs/project/database.md). There is one store, and it has
   * the column.
   *
   * **It costs one indexed query, and `urlForSlug` in the loop below makes the
   * same one.** Left as two rather than threaded together, because they answer
   * different questions — *is this mine* and *what address is under it* — and
   * `urlForSlug`'s `undefined` means both "no article" and "an article with no
   * URL", which is exactly the conflation this check must not inherit.
   * docs/plans/260902e-a-per-article-job-queue-that-appends-and-modes-that-start-themselves.md § 1f.
   */
  if (!request.url && !request.upload) {
    if (!(await articleExists(request.slug))) {
      /* The same sentence `GET /api/article/:slug` answers with for a slug
         that is not yours (src/routes.ts), so the two cannot be told apart. */
      throw Object.assign(new Error("No such article."), { status: 404 });
    }
  }

  /**
   * **The name, and whether asking for it claims it.**
   *
   * `reservesName` is `allocation.kind === "minted"` and nothing else — see
   * `SlugAllocation` for why it is carried rather than re-derived. A request
   * that arrived with neither a URL nor an upload is *naming* an article, which
   * is an adoption: it reserves nothing, so several such jobs can queue up
   * behind one another on one article, which is the whole of what Greg asked
   * for.
   *
   * It is a `let` because two of `enqueueOrGet`'s four answers move it — see
   * the loop.
   *
   * **A retry allocates through `slugForRetry` instead**, which is the same
   * three branches with one word changed: a mint keeps the failed attempt's own
   * name rather than generating a new one. Nothing else about a retry is
   * special, and in particular whether it *reserves* is unchanged.
   */
  let allocation: SlugAllocation = request.retryOf
    ? await slugForRetry(request)
    : request.url
      ? await freeSlug(request.slug, request.url)
      : request.upload
        ? { kind: "minted", slug: slugWithShortId(request.slug) }
        : { kind: "adopted", slug: request.slug };

  /* **`request.url`, not the URL read off disk below**, for the reason
     `workKey` gives: it has to be a property of the *request*. Uploads have
     none, which is what keeps them out of `jobs_active_source` — and that is
     right, because two uploads of one file are two documents. */
  const source = request.url === undefined ? undefined : urlKey(request.url);

  /* **The loop is the deduplication, and the insert is what decides.**
   *
   * This used to be: look for an active job on this slug, compare it with
   * `sameWork`, and insert if nothing matched — with a long comment explaining
   * why there must be no `await` between the look and the insert. That comment
   * is gone with the code, because the look and the insert are now one
   * statement: `enqueueOrGet` inserts and lets the queue's four unique indexes
   * refuse (src/db/schema.ts § `jobs`), and it re-reads to say *which* of them
   * was in the way — the same work, the same name, or the same address.
   *
   * Which is the difference between narrower and closed. Two instances each
   * scanning their own memory each found nothing and each started paying for
   * the same article, and no amount of care about `await` placement in one
   * process could have stopped it.
   *
   * **20 tries**, and since every minted slug ends in a random short id
   * (src/ingest.ts § `slugWithShortId`) a second pass means one of two things:
   * a genuine race with another request for this same address, which resolves
   * on the next turn because both of its repairs change the question; or a
   * one-in-771-million id collision. Twenty of those in a row is not a
   * collision, it is a fault.
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
  for (let tries = 0; ; tries++) {
    const slug = allocation.slug;
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

    const outcome = await store.enqueueOrGet(wanted, {
      workKey,
      reservesName: allocation.kind === "minted",
      ...(source !== undefined && { urlKey: source }),
      /* Inside the loop, so every attempt carries it: a `nameTaken` retry is the
         same ingest under a different name and spends the same slot. Only one of
         these attempts can create a job — `jobs_ingest_event_unique` is a partial
         unique index on the column — and if none does, the caller releases it
         (src/billing/admission.ts). */
      ...(request.ingestEventId !== undefined && { ingestEventId: request.ingestEventId }),
    });

    /**
     * **Four answers, four repairs, and the compiler counts them.**
     *
     * A second, *different* job for one article is no longer refused: it is
     * `created`, `queued`, and `claim` is what makes it wait its turn. That is
     * the whole of the per-article queue, and it is why `JobConflict` no longer
     * exists — there is nothing left for it to be thrown about.
     * docs/plans/260902e-a-per-article-job-queue-that-appends-and-modes-that-start-themselves.md § 1g.
     */
    if (outcome.kind === "sameWork") {
      /* Already in hand: hand back the job doing it rather than starting a
         second one over the same files. A double-click on Add is all it takes.

         **And give it a pump**, because the job we are handing back may have
         nobody driving it. That is not a rare state: a job left `queued` by a
         dev-server restart is exactly what `sweepStopped` produces, and asking
         for it again is exactly what a reader does next. Without this they get
         a job id back and watch a card that never moves.

         Two pumps for one job is harmless — the second is told `busy`, backs
         off, and takes the next step when the first releases — which is the
         same arrangement as a pump plus an open browser tab, and the whole
         reason the claim exists. */
      drive(outcome.job.id);
      return outcome.job;
    }

    if (outcome.kind === "sourceTaken") {
      /**
       * **Two pastes of one URL at the same instant.** Both callers asked
       * `slugAlreadyHolding`, both saw nothing, and both minted a random name;
       * every other key in the schema contains the slug, so nothing else would
       * have caught it and the reader would have got two articles for one
       * address and paid for both.
       *
       * **Ask `freeSlug` again**, exactly as `nameTaken` below does, rather
       * than writing the answer in by hand. The holder is in the store now, so
       * the lookup sees it — `inFlightSlugForUrlKey` matches on the address —
       * and adopts its slug, which is what allocation would have returned had
       * it been able to see the other request.
       *
       * **The hand-written version was `{ kind: "adopted", slug: outcome.job.slug }`,
       * and the bug in it was the `adopted`, not the slug.** An adoption
       * reserves nothing, so it sits *outside* `jobs_active_source` — and it was
       * being written on the strength of a holder we had only been told about.
       * If that holder failed, or the reader stopped it, between the refusal and
       * this line, a third request would see no article and no active holder,
       * mint and reserve a second slug, and this one would land on the dead
       * holder's. Two active jobs, one owner, one URL, two slugs, and both able
       * to publish. Re-asking is the whole fix: it revalidates before inserting,
       * so a holder that has gone gets a freshly minted **reserved** slug
       * instead. GPT Sol, reviewing the built stage 1, finding 3;
       * tests/one-article-for-one-address.test.ts.
       *
       * The loop still cannot ask the same question twice. If the holder is
       * there, the answer is an adoption and the next insert is outside the
       * source index altogether; if it has gone, the answer is a fresh random
       * mint. Only a request carrying a URL can be told `sourceTaken` — the
       * ticket's `urlKey` comes from `request.url` and nothing else — so the
       * other branch is unreachable, and it adopts rather than throwing because
       * an unreachable branch that stops the reader is worse than one that
       * queues them behind the holder.
       *
       * **A retry inserts nothing at all: it is handed the holder.** See
       * `handBackToARetry` for why a retry cannot take the repair above.
       */
      if (request.retryOf) return handBackToARetry(outcome.job, owner, drive);
      allocation = request.url
        ? await freeSlug(request.slug, request.url)
        : { kind: "adopted", slug: outcome.job.slug };
      continue;
    }

    if (outcome.kind === "nameTaken") {
      /**
       * Another active job is claiming this name. Only a *minted* request can
       * be told this — an adoption reserves nothing — so there is always a URL
       * or an upload here to reallocate with.
       *
       * Asking `freeSlug` again rather than appending a counter is the point:
       * the racing job is in the store now, so the lookup sees it this time and
       * either adopts its slug (same URL, and then this request queues behind
       * it on one article) or mints a fresh one. A counter would have to guess,
       * and could land on a finished article's slug — which is how a request to
       * summarise `paper` once became a summary of `paper-2`, produced
       * perfectly successfully under the wrong article.
       *
       * Every path out of here changes something: a mint is a fresh random id,
       * and an adoption stops reserving. So the loop cannot ask the same
       * question twice, and `tries` is a fault budget rather than a ladder.
       *
       * **A retry inserts nothing at all: it is handed the holder**, for the
       * same reason as `sourceTaken` above and one more of its own. A retry's
       * mint is not a random name it can generate a fresh one of — it is *this
       * article's* name — so re-asking would return the same answer for ever and
       * spend the whole budget on a 409 about there being too many articles
       * called something there is exactly one of. See `handBackToARetry`.
       */
      if (request.retryOf) return handBackToARetry(outcome.job, owner, drive);
      allocation = request.url
        ? await freeSlug(request.slug, request.url)
        : { kind: "minted", slug: slugWithShortId(request.slug) };
      continue;
    }

    const job = outcome.job;

    /* The step list and the forced list, because "why did this job cost two
       model calls" and "why did it finish in a second" are both answered here
       and nowhere else. Not the URL: `slug` already identifies the article, and
       the log is a reading history either way — see the note in src/log.ts. */
    log("jobs").info(
      {
        jobId: job.id,
        slug,
        steps: names,
        forced: [...forced],
        /* Which attempt this repeats, when it repeats one. Two job ids and one
           slug in the log is the only account there is of a reader pressing
           Retry — and it is now the thing to look at when asking whether the
           second attempt really landed on the first one's article. */
        ...(request.retryOf !== undefined && { retryOf: request.retryOf }),
      },
      `job queued: ${slug} — ${names.join(", ")}${forced.size ? ` (forced: ${[...forced].join(", ")})` : ""}`,
    );

    drive(job.id);
    return job;
  }
}

/**
 * **A retry that was refused hands back the job that refused it, and inserts
 * nothing.**
 *
 * ## The invariant this exists to keep
 *
 * *At most one active article per (owner, address), and the thing that
 * guarantees it is an index rather than a lookup.* The index is
 * `jobs_active_source` (src/db/schema.ts), and it is partial on `reserves_name`
 * — deliberately, so that the several jobs merely *naming* an article can queue
 * behind one another. So a row that carries an address without reserving it is
 * outside the guarantee, and is safe only for as long as some *other* active row
 * is reserving that address on its behalf. Liveness is not a guarantee.
 *
 * ## What went wrong when a retry repaired itself by adopting
 *
 * Both repairs used to rewrite the allocation to an adoption and insert anyway,
 * and GPT Sol reproduced two active articles for one address through each of
 * them:
 *
 * ```text
 * sourceTaken: active = ["holder-spya-111111", "blind-spya-222222"]
 * nameTaken:   active = ["old-spya-000000",    "blind-spya-222222"]
 * ```
 *
 * The interleaving is the same both times, and it is the gap between the
 * repair's *lookup* and the insert it then makes: the holder we adopted from
 * goes terminal inside that gap, our non-reserving row lands, nothing is
 * reserving the address any more, and a paste whose own lookup came back empty
 * mints a second article and reserves it. The `sourceTaken` repair at least
 * re-asked; the `nameTaken` one adopted the holder's name with no revalidation
 * at all. `tests/one-article-for-one-address.test.ts` § *and a retry's two*.
 *
 * The defence written down at the time was that a fresh paste would find the
 * queued retry through `inFlightSlugForUrlKey`. **That is a scan, not an index**,
 * and it cannot close its own lookup-to-insert gap.
 *
 * ## Why handing the holder back is the answer rather than a cleverer repair
 *
 * There is no second row, so there is no hole. And it is what the reader asked
 * for: they pressed Retry on an address while another ingest of that same
 * address — or another attempt on that same article — is live, so the live one
 * is the answer. `enqueueOrGet` already has this shape for `sameWork`, down to
 * the pump.
 *
 * It also makes the loop provably terminating for a retry, which the adopting
 * version was not obviously: a retry now inserts on its first pass or returns.
 *
 * **The alternative was to make `slugForRetry` adopt more carefully**, and it
 * cannot work: whatever it learns about a live holder is stale by the time the
 * insert runs, which is the whole bug. The other alternative — widening
 * `jobs_active_source` to cover non-reserving rows — breaks the per-article
 * queue, which is the thing that index is partial *for*.
 *
 * **Not fixed here, and the same class:** `freeSlug` adopts from a live job for
 * a *fresh* paste too, so the same interleaving can orphan that row's address.
 * It predates this work, its window is one round-trip rather than two, and
 * closing it the same way would turn a second URL request for one unpublished
 * article into a dedup rather than a queued job. Written down rather than
 * changed; the durable fix for the class is a table that claims an address.
 *
 * ## The owner check
 *
 * `sourceTaken` is owner-scoped in both adapters, but `jobs_reserved_slug` is
 * global on the slug — *"two owners can build toward one name"* — so a
 * `nameTaken` holder is not necessarily this reader's, and handing back somebody
 * else's job would put their slug, URL and title on the wire. It cannot happen
 * while every slug ends in a random short id, which is exactly why it is a
 * refusal rather than a fallback: an unreachable branch that stops is better
 * than an unreachable branch that leaks.
 */
function handBackToARetry(holder: Job, owner: OwnerId, drive: (id: string) => void): Job {
  if (holder.ownerId !== owner) {
    /* Made of words we chose and a slug, which src/log.ts permits. */
    throw Object.assign(
      new Error(`Another article is already being made under the name "${holder.slug}".`),
      { status: 409 },
    );
  }
  log("jobs").info(
    { jobId: holder.id, slug: holder.slug },
    `retry handed back the active job on ${holder.slug}`,
  );
  /* The same pump `sameWork` gives, and for the same reason: the job we are
     handing back may have nobody driving it — and it is the *caller's* `drive`
     rather than `pump` itself, so a caller that asked for `pump: false` gets no
     second driver on this path either. */
  drive(holder.id);
  return holder;
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
   * identical — and the second one loses the de-duplication conflict
   * (`jobs_active_work` since 2026-09-02, `jobs_active_slug` before it), is
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
 * **A slug, and which of the two things happened to get it.**
 *
 * *Minted* means this request claimed a new name; *adopted* means it named an
 * article that already exists, or one another request of this reader's is
 * already making. `EnqueueTicket.reservesName` (src/store/jobs.ts) is exactly
 * `kind === "minted"`, and two of the queue's four unique indexes turn on it.
 *
 * **A union rather than a bare string plus a boolean beside it**, because the
 * fact is known at the moment of allocation and *nowhere else*. Every attempt
 * to recover it afterwards — from `url`, from `upload`, from the shape of the
 * slug string — is a guess, and a wrong one: `enqueue` fills a late step's
 * `url` from `meta.json`, so `{slug, steps:["ideas"]}` on an article that has
 * sat on the shelf for a month carries a URL exactly as a fresh paste does. The
 * type makes losing the fact a compile error. GPT Sol, 2026-09-02, and
 * docs/plans/260902e-a-per-article-job-queue-that-appends-and-modes-that-start-themselves.md § 1b.
 */
export type SlugAllocation =
  | { kind: "minted"; slug: string }
  | { kind: "adopted"; slug: string };

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
 *
 * ## It says which of the two it did, and that is not decoration
 *
 * See `SlugAllocation`. The two branches below are the *only* place in the
 * codebase that knows whether a name was claimed or adopted, and
 * `jobs_reserved_slug` and `jobs_active_source` both turn on that fact.
 */
export async function freeSlug(
  slug: string,
  url: string,
  alreadyHolding: (urlKey: string) => Promise<string | undefined> = slugAlreadyHolding,
): Promise<SlugAllocation> {
  const held = await alreadyHolding(urlKey(url));
  return held === undefined ? { kind: "minted", slug: slugWithShortId(slug) } : { kind: "adopted", slug: held };
}

/**
 * **The slug a retry should use**, which is `freeSlug`'s three branches with
 * exactly one word changed: where a fresh request *mints* a new random name,
 * a retry mints the name the attempt it repeats already had.
 *
 * ## What it is repairing
 *
 * Chunk checkpoints (landed 2026-09-01) are addressed by the **article** and
 * nothing else — `CheckpointArticleRef`, and `src/store/pg-session.ts` builds
 * every stage's store from the claim's own draft. The article is a pure function
 * of the job's slug (`openOrBeginJobDraft` → `lockOrCreateArticle`). So a retry
 * that lands on a different slug lands on a different article and cannot see a
 * single chunk the failed attempt paid for. On a long PDF that is not a wasted
 * penny but a **liveness cliff**: every attempt starts from zero, so a document
 * that cannot finish inside one lease can never finish at all.
 *
 * Both of `enqueue`'s allocating branches did that. An upload minted
 * unconditionally; a URL went through `freeSlug`, which adopts only from the
 * shelf or from a *live* job, and a failed first ingest is neither.
 *
 * ## This reverses a decision, and says so
 *
 * `tests/pipeline-slug-claim-files.test.ts` records that returning an upload's
 * slug on retry was **deliberately deleted** with the short-id change on
 * 2026-08-31, "so a retry mints a fresh name". Nobody was wrong then: slugs had
 * just stopped being derivable from the address, `freeUploadSlug` and its
 * `-2`…`-99` counter went with that, and there was nothing yet that depended on
 * two attempts sharing an article. What changed is that the checkpoints landed
 * four days later and depend on precisely the opposite, and the second change
 * did not go looking for what the first had decided.
 *
 * ## Why this is not a loosening of `freeSlug`
 *
 * Minting for a fresh upload is deliberate — *"two uploads of one file are two
 * documents"* — and `freeSlug`'s refusal to adopt from a *failed* job protects
 * the invariants the queue's partial unique indexes are built on. Neither
 * changes. This is a different question, and only `retryJob` can ask it, because
 * only `retryJob` has the prior attempt in hand: a retry is by definition the
 * continuation of one named attempt, where a second upload of one file is not.
 *
 * ## The trap, and the answer — which is the shelf, and nothing else
 *
 * An `adopted` allocation *reserves nothing*, so it sits outside
 * `jobs_active_source` — and a fresh paste of the same URL in the same instant
 * would then mint, giving two articles for one address, which is the race that
 * index exists to stop.
 *
 * So a retry adopts **only what the shelf holds**, and mints — and therefore
 * reserves — for everything else. The shelf is a *durable* fact: an article with
 * a published revision for this address is found by every later lookup too, so
 * nothing can come along and mint a second article for it. A **live job** is not
 * a durable fact, and adopting from one was the hole GPT Sol reproduced: the
 * holder goes terminal between the lookup and the insert, and the retry's row
 * lands reserving nothing. So this asks `slugForUrlKey` rather than
 * `slugAlreadyHolding`, and a retry that finds a live holder is told so by the
 * *index* instead — `sourceTaken`, whose repair hands the holder back and
 * inserts nothing at all. See `handBackToARetry` for the whole argument.
 *
 * Which leaves a retry's allocation with three shapes and no fourth: a mint that
 * reserves, an adoption of a durably published address, or an adoption with no
 * address at all. None of them can be the last active row for an address it is
 * not reserving.
 *
 * Nothing on `jobs_reserved_slug` can object to re-taking the name, because all
 * four of the queue's partial indexes are over `queued`/`running` only
 * (src/db/schema.ts § `jobs`) and the attempt being retried is terminal —
 * `retryJob` refuses a job that is not.
 *
 * And one thing falls out for free: `jobs_active_work` now turns a double-press
 * of Retry into a `sameWork` dedup, where before it made two articles and paid
 * for both.
 *
 * ## The stacking this also ends
 *
 * `retryJob` passes `slug: old.slug`, and `slugWithShortId` **appends** an id
 * rather than replacing one — so three retries used to give
 * `…-spya-aaa-spya-bbb-spya-ccc`, three articles, three invoices. It was the
 * bug's own visible fingerprint and nobody read it. No path can stack now: this
 * is the only allocation a retry ever gets, and neither refusal reallocates —
 * both hand back the job that refused.
 *
 * The lookup is an argument for the same reason `freeSlug`'s is:
 * [`tests/jobs.test.ts`](../tests/jobs.test.ts) can then decide every branch
 * without a database.
 */
export async function slugForRetry(
  request: Pick<EnqueueRequest, "slug" | "url" | "upload">,
  onTheShelf: (urlKey: string) => Promise<string | undefined> = slugForUrlKey,
): Promise<SlugAllocation> {
  if (request.url !== undefined) {
    const shelved = await onTheShelf(urlKey(request.url));
    /* A published article already holds this address, so it is by definition the
       article this address is, and the one the checkpoints are under. Durable,
       which is what makes adopting it safe — see the header. */
    if (shelved !== undefined) return { kind: "adopted", slug: shelved };
    return { kind: "minted", slug: request.slug };
  }
  /* An upload has no address, so there is nothing to ask and nothing that could
     have come to hold this name. A fresh upload mints; so does its retry. */
  if (request.upload !== undefined) return { kind: "minted", slug: request.slug };
  /* Neither: a late-stage re-run on an article already on the shelf, which is
     *naming* an article rather than claiming a name. `enqueue` adopts for that
     shape already and always landed on the right article — this branch exists so
     that a retry has one allocation rather than two, not because anything about
     it changes. */
  return { kind: "adopted", slug: request.slug };
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
 * `queued` and `running` are the two statuses a job holds a slug in
 * (`ACTIVE`, src/store/pg-jobs.ts, and every one of the queue's partial unique
 * indexes is over exactly those two); a cancelled or failed job is not holding
 * anything.
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
 * **The two kinds are interleaved**, ranked by when each finished — the rule
 * is src/store/pg-jobs.ts § `trimFinished`. Failures are still favoured where
 * the two compete for one slot: they are the ones worth reading later, and the
 * successes have an article on the shelf to speak for them. What changed on
 * 2026-09-03 is that the preference is no longer absolute, because an owner
 * holding fifty failures had every success deleted by the same `noteEnded` that
 * finished it — and the client learns a job is done by polling for its terminal
 * row, so nothing was ever announced finished.
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
  const owner = currentOwnerId();
  const listed = await store.list(owner);

  /**
   * **The sweep, where the reader already is.**
   *
   * `settleExpired` had exactly one caller — the top of `advanceJobWith`, which
   * runs only when somebody is *already* driving a job. On Vercel that is the
   * whole of the machinery: no cron, no worker, `pump` returns on `VERCEL`, and
   * the browser is the engine. So the one person the sweep could never reach
   * was the one who needed it — the reader whose claimant died, who comes back
   * to a card frozen at `running` that nothing will ever move, because the only
   * thing that would move it is the request that stopped being made.
   *
   * **The gate is "is anything running", not "has any lease lapsed".** The
   * app-level `Job` carries no lease — `leaseExpiresAt` lives on the row and in
   * the filesystem `attempts` map and never reaches `publicJob` — and exporting
   * it to sharpen this test would put an ownership decision where the client
   * can see it, which is the one thing this design does not do. So the cheapest
   * honest question is the one asked here, and it is answered from a list we
   * already have in hand.
   *
   * **What it costs, said rather than waved away.** A zero-row indexed `UPDATE`
   * takes no row locks and writes no WAL, but it is still a round trip, a pool
   * checkout, a parse and a plan. While a job is running the browser polls this
   * once a second (`BUSY_MS` in src/web/jobEngine.ts), so for the length of the
   * import it **doubles the statements a poll issues**, 1 → 2 — counted at the
   * driver, not read off the source. Measured against local Postgres over 300
   * iterations: a poll goes from 1.32–1.68 ms to 2.88–3.14 ms, so about
   * +1.5 ms each, and the sweep alone is ~1.3 ms of that, nearly all of it the
   * round trip rather than the work. A 520 s worst-case import is therefore
   * ~520 extra statements and under a second of extra database time, and an
   * idle shelf is unchanged at one statement and ~0.9 ms because the gate above
   * closes. That is the honest number, and it is not "costs nothing" — GPT Sol
   * refused that phrase for this line, and was right to.
   */
  if (!listed.some((job) => job.status === "running")) return listed;

  const settled = await store.settleExpired(undefined, owner, REQUEUE_BUDGET);
  /* **Not quite "nothing settled means the answer did not change"**, which is
     what this said and is too strong. The advance door sweeps globally, so it
     can settle this very job between the list above and the statement above,
     and this call then loses the update race and answers `[]` — leaving the
     stale `running` snapshot to be returned. Nothing is corrupted or stranded:
     the engine sends one redundant advance and the next one-second poll shows
     the truth. Paying a third statement on every quiet poll to close a window
     that costs one redundant request is the wrong trade, so the race is
     accepted and written down rather than fixed. GPT Sol, 2026-09-01. */
  if (settled.length === 0) return listed;

  /* **The same line the advance path writes, from the door that is now the
     common one.** The claimant is gone and logged nothing on its way out, so
     without this a reader's page load quietly ends somebody's import and leaves
     no server-side account of it at all. Ids and endings, because "settled 1
     job(s)" can be joined to nothing — and because since 2026-09-01 a row
     carrying `cancelling` comes back `cancelled`, so a line saying *failed*
     would be untrue of exactly the jobs a reader chose to stop. */
  log("jobs").warn({ count: settled.length, settled, where: "list" }, sweepLine(settled));
  /* Re-read rather than patched, so the reader sees the settlement on the poll
     they are looking at rather than the next one — and re-read rather than
     mended in place, because the store is the thing that decides what a settled
     job looks like. */
  return store.list(owner);
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
     queued job ends outright — and since 2026-09-01 so does a running one whose
     lease has lapsed, because the claimant aborts itself inside its own lease
     and there is provably nobody left to read a flag. A running job with a live
     claim is asked, and reads the flag at its next step boundary. It was two
     calls — cancel-if-idle, then ask — until GPT Sol pointed out that a claimant
     releasing between them leaves the job `queued` with `cancelling` set, which
     nothing ever moves on.

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
export async function retryJob(
  id: string,
  /**
   * The **fresh** slot this attempt spends, when the attempt it repeats spent
   * one. Empty otherwise, and empty for a re-run.
   *
   * A retry is an ordinary admission: the failed attempt's slot was released
   * when it failed, so a failure costs nothing and the eventual success costs
   * exactly one. There is no lineage and no reactivating a released row. The
   * route decides — src/billing/admission.ts — because deciding here would mean
   * reading the old job's provenance twice, once to admit and once to copy.
   */
  slot: { ingestEventId?: string } = {},
): Promise<Job | null> {
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
    /* **The name, and the fact that it is a retry, travel together.** `slug`
       alone was here and it was not enough: allocation cannot tell this from a
       fresh request, so it minted a *new* name from it and the second attempt
       landed on a second article, out of reach of every chunk the first had paid
       for. `slugForRetry` is where that is repaired and why. */
    slug: old.slug,
    retryOf: old.id,
    ...(old.url ? { url: old.url } : {}),
    ...(old.upload ? { upload: old.upload } : {}),
    steps: old.steps.map((s) => s.name),
    force: forceForRetry(old.steps),
    // Copied, unlike force. The steer is not a thing the first attempt used up
    // — a retry of a summary run that was steered is still that run.
    ...(old.profile ? { profile: old.profile } : {}),
    ...slot,
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
 * rather than hidden — and it is **smaller than it was**, which is the half of
 * this paragraph that had gone stale. A refresh that dies at `hierarchy` re-runs
 * `extract`, but it no longer re-buys the transcription: the per-chunk
 * checkpoints stopped being a job-scoped `/tmp` on 2026-09-01 and became rows
 * keyed on the article (landing D2, `src/store/checkpoints.ts`), and a refresh
 * is of an article already on the shelf, so its retry adopts that article and
 * finds them. Whether a *failed first ingest* could was a separate bug, fixed on
 * 2026-09-03 in `slugForRetry` above. What decision 8 still costs is the
 * deterministic work of the steps that had finished, plus any paid call that is
 * not checkpointed.
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
