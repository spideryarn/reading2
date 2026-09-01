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
import { afterEach, beforeEach, expect, it } from "vitest";

import {
  STEP_USUALLY_A_COUPLE_OF_MINUTES,
  STOPPING_AFTER_STEP,
  TAKING_LONGER,
  WAITING_TO_CONTINUE,
} from "../src/job-state.js";
import type { Job, JobStep } from "../src/types.js";
import { JobProgress } from "../src/web/JobProgress.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const NOW = Date.now();
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

function render(j: Job | null): void {
  act(() =>
    root.render(
      <JobProgress
        job={j}
        failed={null}
        onRun={async () => undefined}
        onCancel={() => undefined}
        label="Draw the argument"
        step="sketch"
        icon={null}
        runningLabel="Drawing…"
      />,
    ),
  );
}

it("says how long the step has been going", () => {
  render(job());
  expect(host.textContent).toContain("Drawing the argument");
  expect(host.textContent).toContain("1m 14s");
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
