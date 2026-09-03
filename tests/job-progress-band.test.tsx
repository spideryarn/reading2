// @vitest-environment jsdom
/**
 * **The same states, on the other surface.**
 *
 * `JobProgress` is the run button the glossary, the ideas, the sketch, the
 * quiz, the timeline, the quotes and the thread all share, and it is the
 * **mirror image of `JobCard`**: it shows the job's own sentence and never a
 * step's `error`. Which one you are writing for is the thing to check first —
 * getting it backwards is what shipped an interrupted import with no
 * explanation at all (tests/interrupted-job-card.test.tsx).
 *
 * So the states come from the same `displayJob`, and the words are the same
 * words, but the layout is not: this is a band about twenty characters wide,
 * so everything that is not the label and the Stop button goes on its own
 * wrapped line. See src/web/JobProgress.tsx § The running row wraps.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DRIVER_STALLED,
  RUNNING_A_WHILE,
  STEP_USUALLY_A_COUPLE_OF_MINUTES,
  STOPPING_AFTER_STEP,
  TAKING_LONGER,
  WAITING_TO_CONTINUE,
} from "../src/job-state.js";
import type { Job, JobStep } from "../src/types.js";
import { JobProgress } from "../src/web/JobProgress.js";
import type { StepFailure } from "../src/web/useStepJob.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  /* **Frozen, and then advanced on purpose.** `Date.now()` at module scope does
     not freeze anything, so the exact `1m 14s` below can flake by a second if
     the worker pauses — and nothing here used to move time forward *after* a
     mount, so a `useNow` that ticked once and died passed every test in the
     file. GPT Sol, 2026-09-01. */
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

const NOW = Date.parse("2026-09-01T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

function job(over: Partial<Job> = {}, step: Partial<JobStep> = {}): Job {
  return {
    id: "spya-bandaa",
    ownerId: "00000000-0000-4000-8000-00000000c0de" as Job["ownerId"],
    slug: "an-article",
    status: "running",
    createdAt: ago(200_000),
    steps: [
      {
        name: "sketch",
        label: "Drawing the argument",
        status: "running",
        startedAt: ago(74_000),
        ...step,
      },
    ],
    ...over,
  };
}

/** Every id `onCancel` was called with, so Stop is a fact rather than a shape. */
let stopped: string[] = [];

/** Every press of the ordinary run button, for the same reason as `stopped`. */
let ran = 0;
/** Every press of Retry. */
let retried = 0;

function render(
  j: Job | null,
  extra: { failed?: StepFailure; stalled?: boolean } = {},
): void {
  stopped = [];
  ran = 0;
  retried = 0;
  act(() =>
    root.render(
      <JobProgress
        job={j}
        failed={extra.failed ?? null}
        stalled={extra.stalled ?? false}
        onRun={async () => {
          ran += 1;
        }}
        onCancel={(id) => stopped.push(id)}
        label="Draw the argument"
        step="sketch"
        icon={null}
        runningLabel="Drawing…"
      />,
    ),
  );
}

/** A failed run of the shape `useStepJob` hands over. */
function failure(over: Partial<StepFailure> = {}): StepFailure {
  return {
    message: "The AI service is busy right now. [ai-busy]",
    retryable: true,
    retry: () => {
      retried += 1;
    },
    ...over,
  };
}

const button = (text: string): HTMLButtonElement | undefined =>
  [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(text));

it("says how long the step has been going", () => {
  render(job());
  expect(host.textContent).toContain("Drawing the argument");
  expect(host.textContent).toContain("1m 14s");
});

/**
 * **And keeps counting.** A step's `detail` is written in memory and never
 * persisted (src/jobs.ts § `report`), so a job halfway through a long step
 * sends an identical record on every poll and `sameJobs` correctly suppresses
 * the re-render. Without `useNow`'s own interval the band freezes at whatever
 * it read when the step began — which is the lie this whole stage exists to
 * stop, and it would have gone unnoticed here.
 */
it("keeps counting after the first paint", () => {
  render(job());
  expect(host.textContent).toContain("1m 14s");
  act(() => void vi.advanceTimersByTime(46_000));
  expect(host.textContent, "the clock stopped at the first render").toContain("2m 0s");
});

it("puts its timer down when it unmounts", () => {
  render(job());
  expect(vi.getTimerCount(), "the band never started a clock").toBeGreaterThan(0);
  act(() => root.unmount());
  expect(vi.getTimerCount(), "left an interval running after unmount").toBe(0);
  /* `afterEach` unmounts too — harmless, but it needs a root to do it with. */
  root = createRoot(host);
});

it("says a queued run is waiting to continue", () => {
  render({ ...job(), status: "queued", steps: [{ name: "sketch", label: "Drawing the argument", status: "pending" }] });
  expect(host.textContent).toContain(WAITING_TO_CONTINUE);
});

it("says when a run has gone past what it usually takes", () => {
  render(job({}, { startedAt: ago(20 * 60_000) }));
  expect(host.textContent).toContain(TAKING_LONGER);
  expect(button("Stop")?.disabled, "the Stop button was disabled on a slow run").toBe(false);
});

it("says what Stop is waiting for", () => {
  render(job({ cancelling: true }));
  expect(host.textContent).toContain(STOPPING_AFTER_STEP);
});

it("says a sketch usually takes minutes, because that one was measured", () => {
  render(job());
  expect(host.textContent).toContain(STEP_USUALLY_A_COUPLE_OF_MINUTES);
});

/**
 * **The tab can see the job and cannot move it, said where the reader is.**
 *
 * Stage 5 put this on the shelf card only, on the argument that threading it
 * would touch eight panels. GPT Sol: *"a reader drawing a sketch or generating
 * a glossary may never look at the shelf card; their only surface can therefore
 * spin indefinitely without the warning Stage 5 exists to give."* It arrives
 * through `useStepJob`, which already holds the queue subscription — nothing
 * about transport health went onto `Job` or `displayJob`.
 */
it("says when the tab can see the run but cannot move it", () => {
  render(job(), { stalled: true });
  /* Both facts at once, which is the reason this is not a ninth display state:
     the job is working *and* the connection is unwell. */
  expect(host.textContent).toContain("Drawing the argument");
  expect(host.textContent).toContain(DRIVER_STALLED);
});

it("says nothing about the driver when the driver is fine", () => {
  render(job());
  /* On screen first — a `not.toContain` under a band that never rendered is
     green for the wrong reason. */
  expect(host.textContent).toContain("Drawing the argument");
  expect(host.textContent).not.toContain(DRIVER_STALLED);
});

/**
 * **The way out without the statistical claim.** `hierarchy` has a threshold of
 * its own, argued from evidence, and no `usually` sentence — one successful
 * attempt is not a distribution. So it gets the warning and not the comparison.
 * src/job-state.ts § `slowSentence`.
 */
it("does not call a run unusual when nothing measured what usual is", () => {
  render(
    job({
      steps: [
        {
          name: "hierarchy",
          label: "Building the hierarchy",
          status: "running",
          startedAt: ago(20 * 60_000),
        },
      ],
    }),
  );
  expect(host.textContent).toContain(RUNNING_A_WHILE);
  expect(host.textContent, "claimed to know what an unmeasured step usually takes").not.toContain(
    TAKING_LONGER,
  );
});

/**
 * **What the band offers after a failure**, which until 2026-09-03 was the
 * ordinary run button and nothing else — under every failure, including the
 * ones another go cannot change. The shelf card next door had been asking
 * `jobWorthRetrying` since August, so one job could offer a button on one
 * surface and withhold it on the other, and the band is the surface a reader
 * inside a mode actually has.
 *
 * The three cases below are the whole rule. They assert **which** button, not
 * only that a button exists — a test that counted buttons would have passed on
 * the old behaviour throughout.
 * docs/plans/260903c-fix-quiz-build-band-spread-failure-and-lost-quiz-answers.md § Stage 2.
 */
describe("after a run that failed", () => {
  it("offers Retry, and retries the job rather than starting a new one", () => {
    render(null, { failed: failure() });
    expect(host.textContent, "the reason has to be on screen too").toContain("[ai-busy]");
    expect(button("Draw the argument"), "the ordinary run button is a second way in").toBeUndefined();

    const retry = button("Retry");
    expect(retry, "no Retry under a failure worth another go").toBeDefined();
    act(() => retry?.click());
    /* `POST /api/jobs/:id/retry` skips the steps that finished; `onRun` would
       queue a fresh job and pay for them again. The shelf's action, not a
       second pattern. */
    expect(retried).toBe(1);
    expect(ran, "pressing Retry started a new job instead").toBe(0);
  });

  it("offers no button at all when another go cannot come out differently", () => {
    /* The mistake docs/postmortems/260826a-toc-max-tokens.md is about, on the
       other surface. Nothing takes the button's place — the sentence already
       says why, and a second widget repeating it is the app talking over
       itself (docs/project/ingest-queue.md § The failures Retry is not offered
       under). */
    render(null, {
      failed: failure({
        message: "This article is longer than this step can handle in one go. [ai-too-long]",
        retryable: false,
      }),
    });
    expect(host.textContent, "the explanation goes when the button does").toContain("[ai-too-long]");
    expect(button("Retry")).toBeUndefined();
    expect(button("Draw the argument")).toBeUndefined();
  });

  it("keeps the run button when the request never became a job", () => {
    /* A POST the server refused. There is no id to retry, so the ordinary run
       button *is* the retry — and withholding it would leave the reader with a
       message and no way to act on it. */
    render(null, {
      failed: failure({ message: "Couldn't start the job.", retry: null }),
    });
    expect(button("Retry")).toBeUndefined();
    const run = button("Draw the argument");
    expect(run).toBeDefined();
    act(() => run?.click());
    expect(ran).toBe(1);
  });
});

/*
 * **The job that refused this run** had a whole `describe` here — five cases
 * over a second band drawn beside the button, `WORKING_ON_THIS_ARTICLE` and
 * all. Deleted on 2026-09-02 with the refusal: `POST /api/jobs {slug, steps}`
 * no longer answers 409 when an article already has different work in flight,
 * it queues the second job, and that job appears in this band's *own* rows as
 * `WAITING_TO_CONTINUE` — which the cases above already cover.
 * docs/plans/260902e-a-per-article-job-queue-that-appends-and-modes-that-start-themselves.md § 1g.
 */
