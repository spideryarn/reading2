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
import { expect, it } from "vitest";

import { INTERRUPTED, MODEL_REFUSED } from "../src/messages.js";
import {
  DRIVER_STALLED_AFTER,
  displayJob,
  driverStalled,
  elapsedLabel,
  STOPPING_AFTER_STEP,
  TAKING_LONGER,
  WAITING_TO_CONTINUE,
} from "../src/job-state.js";
import type { Job, JobStatus, JobStep, StepName } from "../src/types.js";

const OWNER = "00000000-0000-4000-8000-00000000c0de" as Job["ownerId"];

/** Midnight, so every offset below reads as seconds since the step began. */
const START = Date.parse("2026-09-01T00:00:00.000Z");

function step(over: Partial<JobStep> & { name: StepName }): JobStep {
  return { label: "A step", status: "pending", ...over };
}

/** A running step that began at `START`. */
function running(name: StepName): JobStep {
  return step({
    name,
    label: name === "hierarchy" ? "Building the hierarchy" : "Fetching the page",
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

it("says nothing about how long a step usually takes unless it was measured", () => {
  const measured = displayJob(job("running", { steps: [running("hierarchy")] }), START + 1000);
  expect(measured.usually).not.toBeNull();

  const guessed = displayJob(job("running", { steps: [running("fetch")] }), START + 1000);
  expect(guessed.usually, "invented a number for a step nobody has timed").toBeNull();

  /* And it stops saying it once it is no longer true. A reassurance the same
     card has just disproved is worse than no reassurance. */
  const late = displayJob(job("running", { steps: [running("hierarchy")] }), START + 30 * 60_000);
  expect(late.state).toBe("slow");
  expect(late.usually).toBeNull();
});

/**
 * **The threshold is the step's, not the job's**, and this is the case that
 * decides it: six minutes into `hierarchy` is an ordinary run — 34 of them in
 * `data/_ai-calls.jsonl`, median 385s — and six minutes into `fetch` is a
 * fetch that is never coming back. One global number is wrong for one of them
 * whichever number you pick.
 */
it("takes longer than usual per step, not per job", () => {
  const late = START + 6 * 60_000;
  expect(displayJob(job("running", { steps: [running("hierarchy")] }), late).state).toBe("working");
  expect(displayJob(job("running", { steps: [running("fetch")] }), late).state).toBe("slow");
});

it("offers the way out when a step is taking longer than usual", () => {
  const shown = displayJob(job("running", { steps: [running("fetch")] }), START + 6 * 60_000);
  expect(shown.state).toBe("slow");
  expect(shown.sentence).toBe(TAKING_LONGER);
  /* Still a duration, because "longer than usual" without saying how long is
     the same shrug as a spinner. */
  expect(shown.elapsedMs).toBe(6 * 60_000);
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
 * whose engine walked away. The classifier is the canonical `INTERRUPTED`
 * identity and nothing looser.
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

it("asks jobWorthRetrying rather than deciding for itself", () => {
  expect(displayJob(job("error", { failureKind: "retry" }), START).retryable).toBe(true);
  expect(displayJob(job("error", { failureKind: "blocked" }), START).retryable).toBe(false);
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
 * **Transport health is counted, not inferred.** Each failed `/advance` is
 * followed by an eight-second wait (`IDLE_MS`, src/web/jobEngine.ts), so the
 * threshold is about twenty-four seconds of a driver getting nowhere — long
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
