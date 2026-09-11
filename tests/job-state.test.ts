/**
 * **One place that says what state a job is in**, and the arithmetic it does.
 *
 * `displayJob` (src/job-state.ts) is the mapper the cards read, and this file
 * is the half of its evidence that does not need a browser. The other half is
 * tests/job-card-progress.test.tsx, which mounts the card — a green test here
 * says the answer is right, and says nothing at all about whether a reader can
 * see it. Both, or neither is worth much.
 *
 * ## What is deliberately not an input
 *
 * **The lease.** `Job` on the wire carries none: `leaseExpiresAt` lives on the
 * Postgres row and the filesystem `attempts` map and never reaches `publicJob`.
 * So "running, but its claimant is dead" is invisible here until the server
 * reconciles it (stage 3), and that is the design rather than a gap — deriving
 * ownership in the browser is what this plan's own rule forbids.
 * docs/plans/260831ao-a-stuck-ingest-job-the-reader-can-see-and-clear.md § Stage 4.
 *
 * **The clock.** `now` is a parameter. A mapper that reads `Date.now()` is a
 * mapper nothing can test, and "slow" is the one answer here that is not a
 * function of the record alone.
 *
 * **The driver's health.** Consecutive `/advance` failures are per-tab client
 * state that is not on `Job` at all, so they are a separate question with a
 * separate answer — `driverStalled` below. See src/job-state.ts § Transport
 * health is not a job state.
 */
import { beforeEach, expect, it, vi } from "vitest";

/**
 * **Wrapped rather than replaced**, so every other test in this file still gets
 * the real answer and this one can still prove the call happened. Sol's point
 * about the old version stands: *"cannot prove delegation"* — a `displayJob`
 * that inlined `job.failureKind === undefined || canRetry(...)` would have
 * passed every assertion. `jobWorthRetrying` is also the server's spend gate in
 * `retryJob` (src/job-failure.ts), so a second copy of the rule in the browser
 * is a second thing to keep in step, and the test has to be able to see it.
 */
vi.mock("../src/job-failure.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/job-failure.js")>();
  return { ...real, jobWorthRetrying: vi.fn(real.jobWorthRetrying) };
});

import { jobWorthRetrying } from "../src/job-failure.js";
import { INTERRUPTED, INTERRUPTED_CODE, MODEL_REFUSED } from "../src/messages.js";
import {
  DRIVER_STALLED_AFTER,
  displayJob,
  driverStalled,
  elapsedLabel,
  RUNNING_A_WHILE,
  STEP_USUALLY_A_COUPLE_OF_MINUTES,
  STOPPING_AFTER_STEP,
  TAKING_LONGER,
  WAITING_TO_CONTINUE,
} from "../src/job-state.js";
/* The leaf, not src/pipeline.ts: this file is the browser-side mapper's test and
   `STEP_ORDER` is the whole of what it needs to ask whether the table below is
   over every step. src/step-order.ts § why the array lives there. */
import { STEP_ORDER } from "../src/step-order.js";
import type { Job, JobStatus, JobStep, StepName } from "../src/types.js";

beforeEach(() => {
  vi.mocked(jobWorthRetrying).mockClear();
});

const OWNER = "00000000-0000-4000-8000-00000000c0de" as Job["ownerId"];

/** Midnight, so every offset below reads as seconds since the step began. */
const START = Date.parse("2026-09-01T00:00:00.000Z");

function step(over: Partial<JobStep> & { name: StepName }): JobStep {
  return { label: "A step", status: "pending", ...over };
}

/** Just enough labels to tell the rows apart when a test reads text. */
const LABELS: Partial<Record<StepName, string>> = {
  hierarchy: "Building the hierarchy",
  sketch: "Drawing the argument",
  fetch: "Fetching the page",
};

/** A running step that began at `START`. */
function running(name: StepName): JobStep {
  return step({
    name,
    label: LABELS[name] ?? "A step",
    status: "running",
    startedAt: new Date(START).toISOString(),
  });
}

function job(status: JobStatus, over: Partial<Job> = {}): Job {
  return {
    id: "spya-statea",
    ownerId: OWNER,
    slug: "an-import",
    status,
    createdAt: new Date(START).toISOString(),
    steps: [],
    ...over,
  };
}

it("a queued job is waiting, and says so", () => {
  const shown = displayJob(job("queued"), START);
  expect(shown.state).toBe("waiting");
  expect(shown.sentence).toBe(WAITING_TO_CONTINUE);
  expect(shown.step).toBeNull();
  expect(shown.elapsedMs).toBeNull();
});

it("a running step is working, and carries how long it has been going", () => {
  const shown = displayJob(job("running", { steps: [running("fetch")] }), START + 12_000);
  expect(shown.state).toBe("working");
  expect(shown.elapsedMs).toBe(12_000);
  expect(shown.step?.name).toBe("fetch");
  /* Nothing to say: the step's own row is already saying the true thing, and a
     second sentence under it would be the app talking over itself. */
  expect(shown.sentence).toBeNull();
});

/**
 * **`sketch` is the only step with a sentence, and `hierarchy` lost its on
 * 2026-09-01.** The number under it — six ingest runs, median 409s — was a
 * median of five *failures*, taken off the model-call log rather than off the
 * two fields the card subtracts. One successful attempt is not "usually".
 * src/job-state.ts § `STEP_TIMING`.
 */
it("says nothing about how long a step usually takes unless it was measured", () => {
  const measured = displayJob(job("running", { steps: [running("sketch")] }), START + 1000);
  expect(measured.usually).toBe(STEP_USUALLY_A_COUPLE_OF_MINUTES);

  const guessed = displayJob(job("running", { steps: [running("fetch")] }), START + 1000);
  expect(guessed.usually, "invented a number for a step nobody has timed").toBeNull();

  /* A threshold is not a measurement. `hierarchy` keeps its own ten minutes —
     the default would fire under the only successful run there has ever been —
     and still says nothing about how long it takes. */
  const thresholded = displayJob(job("running", { steps: [running("hierarchy")] }), START + 1000);
  expect(thresholded.usually, "promised a duration off one successful run").toBeNull();

  /* And it stops saying it once it is no longer true. A reassurance the same
     card has just disproved is worse than no reassurance. */
  const late = displayJob(job("running", { steps: [running("sketch")] }), START + 30 * 60_000);
  expect(late.state).toBe("slow");
  expect(late.usually).toBeNull();
});

/**
 * **The threshold is the step's, not the job's.** Six minutes into `hierarchy`
 * is well inside what that step has been seen doing — the longest recorded
 * attempt was still making successful model calls at eight — and six minutes
 * into `fetch` is a fetch that is never coming back. One global number is wrong
 * for one of them whichever number you pick.
 */
it("takes longer than usual per step, not per job", () => {
  const late = START + 6 * 60_000;
  expect(displayJob(job("running", { steps: [running("hierarchy")] }), late).state).toBe("working");
  expect(displayJob(job("running", { steps: [running("fetch")] }), late).state).toBe("slow");
});

/**
 * **Every threshold, pinned either side — and exhaustively, so the next step
 * cannot be left out.**
 *
 * The test above only proves `hierarchy` and `fetch` differ at six minutes, so
 * every threshold in `STEP_TIMING` could move by minutes and stay green — which
 * is the whole of what those numbers are, and each of them is argued for from
 * evidence in that table's comment. If one changes, this is what should say so.
 *
 * **It used to claim that and check three of them.** `STEP_TIMING` had four
 * rows by 2026-09-06 and this list named two, plus the fallback: `labels` and
 * `illustrated` could move by any amount and stay green under a heading saying
 * they could not. GPT Sol's F3 on stage 2a, and the fix is the shape rather
 * than two more lines — `Record<StepName, number>` is total, so `npm run
 * typecheck` asks for the row when a step is added and this asks for the
 * evidence.
 *
 * The number here is what `displayJob` should still call *working* at; one
 * millisecond later is *slow*. A step with no `STEP_TIMING` row of its own gets
 * `SLOW_AFTER_MS`, and writing that out per step rather than defaulting it is
 * the point: an unmeasured step is a decision too.
 */
const EXPECTED_THRESHOLD_MS: Record<StepName, number> = {
  /* The guess everything unmeasured falls back to: three minutes, past every
     successful step in the ledger that is not `hierarchy` or `sketch`. */
  fetch: 180_000,
  extract: 180_000,
  blocks: 180_000,
  /* Ten minutes: past every hierarchy attempt on record (the longest ran 498s)
     and ~140s short of the claimant's own 740s self-abort. */
  hierarchy: 600_000,
  /* The same ten minutes, and the same argument: the worst recorded label pass
     is 682s, against a 180s fallback that would raise a false alarm on every
     long article. docs/plans/260906a-labels-leave-the-blocking-hierarchy-step.md. */
  labels: 600_000,
  assets: 180_000,
  arc: 180_000,
  tweets: 180_000,
  glossary: 180_000,
  ideas: 180_000,
  quotes: 180_000,
  timeline: 180_000,
  quiz: 180_000,
  /* Seven minutes: past twice the worst of the thirteen sketch runs (199s). */
  sketch: 420_000,
  illustrated: 600_000,
  debate: 180_000,
  citations: 180_000,
};

const stateAt = (name: StepName, ms: number) =>
  displayJob(job("running", { steps: [running(name)] }), START + ms).state;

it("puts each threshold exactly where the evidence put it", () => {
  /* The premise: the table is over every step there is, so a step added to the
     pipeline and forgotten here cannot pass by not being asked about. */
  expect(Object.keys(EXPECTED_THRESHOLD_MS).sort()).toEqual([...STEP_ORDER].sort());
  for (const [name, ms] of Object.entries(EXPECTED_THRESHOLD_MS) as [StepName, number][]) {
    expect(stateAt(name, ms), `${name} should still be working at ${ms}ms`).toBe("working");
    expect(stateAt(name, ms + 1), `${name} should be slow at ${ms + 1}ms`).toBe("slow");
  }
});

/**
 * **"Longer than usual" is only for a step whose usual we have written down.**
 *
 * Every unmeasured step still gets a threshold and still gets the way out
 * named — a reader whose fetch has run four minutes is right to be told. What
 * it must not do is call that unusual, because nothing here has ever said what
 * usual is for it. GPT Sol, 2026-09-01: *"Reserve 'usual' for measured steps."*
 * src/job-state.ts § `slowSentence`.
 */
it("offers the way out when a step is taking longer than usual", () => {
  const shown = displayJob(job("running", { steps: [running("sketch")] }), START + 8 * 60_000);
  expect(shown.state).toBe("slow");
  expect(shown.sentence).toBe(TAKING_LONGER);
  /* Still a duration, because "longer than usual" without saying how long is
     the same shrug as a spinner. */
  expect(shown.elapsedMs).toBe(8 * 60_000);
});

it("offers the same way out without claiming to know what usual is", () => {
  const guessed = displayJob(job("running", { steps: [running("fetch")] }), START + 6 * 60_000);
  expect(guessed.state).toBe("slow");
  expect(guessed.sentence).toBe(RUNNING_A_WHILE);
  expect(guessed.sentence, "told a reader an unmeasured step was unusual").not.toBe(TAKING_LONGER);

  /* `hierarchy` is the interesting one: a threshold argued from evidence, and
     still no distribution to compare against. It gets the warning and not the
     claim. */
  const thresholded = displayJob(job("running", { steps: [running("hierarchy")] }), START + 11 * 60_000);
  expect(thresholded.state).toBe("slow");
  expect(thresholded.sentence).toBe(RUNNING_A_WHILE);
});

it("stopping beats taking longer than usual", () => {
  const shown = displayJob(
    job("running", { cancelling: true, steps: [running("fetch")] }),
    START + 6 * 60_000,
  );
  expect(shown.state).toBe("stopping");
  /* The button is already disabled and says "Stopping…", which on its own is
     an indefinite promise. This is the half that says what it is waiting for. */
  expect(shown.sentence).toBe(STOPPING_AFTER_STEP);
});

it("a queued job the reader has stopped is stopping too", () => {
  expect(displayJob(job("queued", { cancelling: true }), START).state).toBe("stopping");
});

/**
 * **Not derivable from `failureKind: "retry"`.** Most transient failures are
 * retryable — a busy model service, a 502 — and none of them is an import
 * whose engine walked away.
 */
it("tells an interruption apart from an ordinary retryable failure", () => {
  const gone = displayJob(
    job("error", { error: INTERRUPTED.message, failureKind: INTERRUPTED.kind }),
    START,
  );
  expect(gone.state).toBe("interrupted");

  const busy = displayJob(job("error", { error: "The AI service is busy. [ai-busy]", failureKind: "retry" }), START);
  expect(busy.state, "every retryable failure read as an interruption").toBe("failed");
});

/**
 * **The code classifies it, and the sentence does not.**
 *
 * This was `job.error === INTERRUPTED.message` until 2026-09-01, and the old
 * test could not tell the two implementations apart — it only ever passed the
 * exact canonical sentence, which both accept. GPT Sol: *"the 'a job is a
 * struct' argument supports adding an explicit cause such as
 * `endingKind: 'interrupted'`; it does not support comparing a struct's prose
 * field."*
 *
 * The cost of getting it wrong is invisible and retroactive: every interrupted
 * job **already in the database** carries the wording of the day it was
 * settled, so one reword of the copy silently turns all of them into ordinary
 * failures with nothing failing. That is what the four-character code is for —
 * docs/project/copy.md, "match on the code, not the prose".
 */
it("classifies an interruption by its code, not by the sentence around it", () => {
  /* The same ending, written by a kinder hand. Full-message equality reads this
     as an ordinary failure; that is the whole of the difference. */
  const reworded = displayJob(
    job("error", { error: `Something interrupted this import. [${INTERRUPTED_CODE}]` }),
    START,
  );
  expect(reworded.state, "the copy was load-bearing").toBe("interrupted");

  /* And it is the code that did it, not the words: the canonical sentence with
     the code taken off is not an interruption. */
  const codeless = displayJob(
    job("error", { error: INTERRUPTED.message.replace(` [${INTERRUPTED_CODE}]`, "") }),
    START,
  );
  expect(codeless.state).toBe("failed");

  /* Somebody else's code, in a sentence that reads similar. Nothing looser than
     the exact code, anchored at the end. */
  const other = displayJob(job("error", { error: "The model went away. [ai-interrupted]" }), START);
  expect(other.state).toBe("failed");

  /* A job with no error at all is not an interruption either — `undefined` must
     not reach the matcher as an empty string. */
  expect(displayJob(job("error"), START).state).toBe("failed");
});

/**
 * **Asked, not re-derived**, and the old version of this test could not tell
 * those apart: it checked two kinds and would have passed an implementation
 * that inlined `failureKind !== "blocked"`. So this one does three things the
 * old one did not — it covers all four kinds, it watches the call happen, and
 * it takes the answer from the function rather than from a literal.
 *
 * It matters because `jobWorthRetrying` is also the **server's** spend gate in
 * `retryJob` (src/job-failure.ts). A browser copy of the rule that drifts hands
 * a reader a button the server will refuse.
 */
it("asks jobWorthRetrying rather than deciding for itself", () => {
  const asked = vi.mocked(jobWorthRetrying);

  /* All four kinds, and only `retry` may come back true. `ours` and `bug` were
     missing before, which is exactly the gap that let a `!== "blocked"`
     implementation through. */
  expect(displayJob(job("error", { failureKind: "retry" }), START).retryable).toBe(true);
  expect(displayJob(job("error", { failureKind: "blocked" }), START).retryable).toBe(false);
  expect(displayJob(job("error", { failureKind: "ours" }), START).retryable).toBe(false);
  expect(displayJob(job("error", { failureKind: "bug" }), START).retryable).toBe(false);

  /* The **field**, and not a kind parsed back out of the sentence. A job is a
     struct with room for one (src/job-failure.ts § Why a field and not a
     bracketed code), so a message carrying `[ai-model-refused]` with no
     `failureKind` beside it still gets the button — exactly as the card did
     before this module existed. Stage 4 moves where the question is asked, and
     must not change the answer. */
  expect(displayJob(job("error", { error: MODEL_REFUSED.message }), START).retryable).toBe(true);
  /* Nobody said, so the button is offered — src/job-failure.ts § Which way to
     be wrong. Every job recorded before the field existed is in this state. */
  expect(displayJob(job("error"), START).retryable).toBe(true);

  /* **The delegation itself.** Six calls, each handed the whole job, and every
     answer on screen is the one that came back — not a matching value computed
     twice. */
  expect(asked).toHaveBeenCalledTimes(6);
  const blocked = job("error", { failureKind: "blocked" });
  expect(asked).toHaveBeenCalledWith(blocked);
  expect(displayJob(blocked, START).retryable).toBe(asked.mock.results.at(-1)?.value);
});

/**
 * Every state asks, not only the failed ones — a running job needs the answer
 * too, because the card decides between Stop and Retry off one record.
 */
it("asks about a job that has not failed as well", () => {
  displayJob(job("running", { steps: [running("fetch")] }), START);
  expect(vi.mocked(jobWorthRetrying)).toHaveBeenCalledTimes(1);
});

it("a stopped job is stopped, and still worth another go", () => {
  const shown = displayJob(job("cancelled"), START);
  expect(shown.state).toBe("stopped");
  expect(shown.retryable).toBe(true);
  expect(shown.sentence, "told the reader what they already did").toBeNull();
});

it("a finished job is done", () => {
  expect(displayJob(job("done"), START).state).toBe("done");
});

/**
 * The two clocks that lie, and they lie in opposite directions. A `startedAt`
 * that will not parse is `NaN`, and every comparison against `NaN` is false;
 * one in the future is a client whose clock is behind the server's. Neither is
 * a duration we can vouch for, so neither gets shown, and neither may make a
 * job look slow. `earlier` in AddArticle.tsx writes the same guard out for the
 * same reason.
 */
it("says nothing about a duration it cannot work out", () => {
  const broken = displayJob(
    job("running", { steps: [step({ name: "fetch", status: "running", startedAt: "soon" })] }),
    START + 60 * 60_000,
  );
  expect(broken.state).toBe("working");
  expect(broken.elapsedMs).toBeNull();

  const ahead = displayJob(job("running", { steps: [running("fetch")] }), START - 5000);
  expect(ahead.state).toBe("working");
  expect(ahead.elapsedMs).toBeNull();
});

/**
 * **The step's clock, never the job's**, and this is the case that makes the
 * difference visible. `job.startedAt` is `coalesce(startedAt, now())` in
 * src/store/pg-jobs.ts — it survives a retry, so it measures how old the job
 * is and not how long the attempt in front of the reader has been going. A
 * card reading "1h 0m" over a step that restarted twelve seconds ago is
 * telling somebody something untrue. `step.startedAt` is re-stamped every time
 * a step starts (src/jobs.ts § `step.startedAt = new Date()`), so it is the
 * current attempt's and the only honest one. GPT Sol, 2026-09-01, reviewing
 * stage 3.
 */
it("times the attempt in front of the reader, not the age of the job", () => {
  const shown = displayJob(
    job("running", {
      startedAt: new Date(START - 60 * 60_000).toISOString(),
      steps: [step({ name: "fetch", status: "done" }), running("hierarchy")],
    }),
    START + 12_000,
  );
  expect(shown.elapsedMs).toBe(12_000);
  expect(shown.state).toBe("working");
});

it("a running job between steps is working, not slow", () => {
  const shown = displayJob(job("running", { steps: [step({ name: "fetch", status: "done" })] }), START + 60 * 60_000);
  expect(shown.state).toBe("working");
  expect(shown.step).toBeNull();
  expect(shown.elapsedMs).toBeNull();
});

it("says a duration the way a person says it", () => {
  expect(elapsedLabel(0)).toBe("0s");
  expect(elapsedLabel(12_400)).toBe("12s");
  expect(elapsedLabel(134_000)).toBe("2m 14s");
  expect(elapsedLabel(60_000)).toBe("1m 0s");
  expect(elapsedLabel(3_930_000)).toBe("1h 5m");
});

/**
 * **Transport health is counted, not inferred.** `drive` calls `/advance`
 * immediately and waits eight seconds (`IDLE_MS`, src/web/jobEngine.ts) *after*
 * each failure, so three failures land at roughly 0s, 8s and 16s and the count
 * reaches three before the third wait: **about sixteen seconds**, not the
 * twenty-four this comment claimed until 2026-09-01. Two gaps, not three. Long
 * enough that one blip says nothing, short enough that the reader is told
 * before they have decided the app is broken.
 */
it("calls the driver stalled only after a run of failures", () => {
  expect(DRIVER_STALLED_AFTER).toBe(3);
  expect(driverStalled({}, "spya-statea")).toBe(false);
  expect(driverStalled({ "spya-statea": 2 }, "spya-statea")).toBe(false);
  expect(driverStalled({ "spya-statea": 3 }, "spya-statea")).toBe(true);
  expect(driverStalled({ "spya-other": 9 }, "spya-statea")).toBe(false);
});
