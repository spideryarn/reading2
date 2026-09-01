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
  ARTICLE_IS_BUSY,
  DRIVER_STALLED,
  RUNNING_A_WHILE,
  STEP_USUALLY_A_COUPLE_OF_MINUTES,
  STOPPING_AFTER_STEP,
  TAKING_LONGER,
  WAITING_TO_CONTINUE,
  WORKING_ON_THIS_ARTICLE,
} from "../src/job-state.js";
import type { Job, JobStep } from "../src/types.js";
import { JobProgress } from "../src/web/JobProgress.js";

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

function render(
  j: Job | null,
  extra: { failed?: string; blocking?: Job; stalled?: boolean } = {},
): void {
  stopped = [];
  act(() =>
    root.render(
      <JobProgress
        job={j}
        failed={extra.failed ?? null}
        blocking={extra.blocking ?? null}
        stalled={extra.stalled ?? false}
        onRun={async () => undefined}
        onCancel={(id) => stopped.push(id)}
        label="Draw the argument"
        step="sketch"
        icon={null}
        runningLabel="Drawing…"
      />,
    ),
  );
}

/** The Stop button, wherever on the band it is. */
function stopButton(): HTMLButtonElement | undefined {
  return [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Stop"));
}

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
  const stop = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Stop"));
  expect(stop?.disabled, "the Stop button was disabled on a slow run").toBe(false);
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
 * **The job that refused this run, on the surface that asked for it.**
 *
 * `POST /api/jobs {slug, steps}` answers 409 when the article already has an
 * active job doing different work, and the blocker is by definition a job whose
 * steps do **not** include the one this panel watches — so `useStepJob`'s own
 * filter (`writesStep`) can never surface it, and before 2026-09-01 the reader
 * was told to stop something with nothing on screen to stop.
 *
 * The words are `displayJob`'s, not a second vocabulary: whether the blocker is
 * *Building the hierarchy · 2m 14s* or *Waiting to continue.* is exactly the
 * question the card and the band already answer, and answering it a third way
 * here is how two surfaces come to disagree about one job.
 *
 * docs/plans/260831ao-a-stuck-ingest-job-the-reader-can-see-and-clear.md § Stage 6.
 */
describe("the job that is in the way", () => {
  /** An ingest holding the article. Nothing in it writes `sketch`. */
  const blocker = (over: Partial<Job> = {}, step?: JobStep): Job => ({
    ...job(),
    id: "spya-blocker",
    steps: [
      step ?? {
        name: "hierarchy",
        label: "Building the hierarchy",
        status: "running",
        startedAt: ago(134_000),
      },
    ],
    ...over,
  });

  it("shows it, and says what it is doing rather than what this panel does", () => {
    render(null, { failed: ARTICLE_IS_BUSY, blocking: blocker() });

    /* On screen first, and then what is on it — a negative assertion under a
       card that never rendered passes for the wrong reason, which is how stage
       5 shipped one. */
    expect(host.textContent).toContain(ARTICLE_IS_BUSY);
    expect(host.textContent).toContain("Building the hierarchy");
    expect(host.textContent).toContain("2m 14s");
    /* This panel's own running word, which would be a lie about somebody
       else's job — the blocker is not drawing anything. */
    expect(host.textContent).not.toContain("Drawing…");
  });

  it("offers Stop, and stops that job rather than this panel's", () => {
    render(null, { failed: ARTICLE_IS_BUSY, blocking: blocker() });
    const stop = stopButton();
    expect(stop, "no Stop button on the blocking job").toBeDefined();
    act(() => stop?.click());
    expect(stopped).toEqual(["spya-blocker"]);
  });

  it("does not call a queued blocker running", () => {
    render(null, {
      failed: ARTICLE_IS_BUSY,
      blocking: blocker(
        { status: "queued" },
        { name: "hierarchy", label: "Building the hierarchy", status: "pending" },
      ),
    });
    /* The band is on screen — assert that before asserting what is not on it. */
    expect(host.textContent).toContain(ARTICLE_IS_BUSY);
    expect(host.textContent).toContain(WAITING_TO_CONTINUE);
    expect(host.textContent).not.toContain("Building the hierarchy");
  });

  it("still offers the button the reader pressed, because it works once the blocker ends", () => {
    render(null, { failed: ARTICLE_IS_BUSY, blocking: blocker() });
    const run = [...host.querySelectorAll("button")].find(
      (b) => b.textContent?.includes("Draw the argument"),
    );
    expect(run, "the run button disappeared behind the refusal").toBeDefined();
  });

  it("names the article rather than a step when the blocker is between steps", () => {
    /* Running with no running step — a fraction of a second in practice, and
       the one gap where there is no label to borrow. It must not fall through
       to this panel's `runningLabel`. */
    render(null, {
      failed: ARTICLE_IS_BUSY,
      blocking: blocker({}, {
        name: "hierarchy",
        label: "Building the hierarchy",
        status: "done",
      }),
    });
    expect(host.textContent).toContain(WORKING_ON_THIS_ARTICLE);
    expect(host.textContent).not.toContain("Drawing…");
  });
});
