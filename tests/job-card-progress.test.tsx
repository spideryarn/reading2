// @vitest-environment jsdom
/**
 * **What the reader sees while an import is going, and while it is not.**
 *
 * The companion to tests/job-state.test.ts, and the half that matters: a green
 * unit test of `displayJob` says the answer is right and says nothing about
 * whether it reaches a screen. tests/interrupted-job-card.test.tsx is the
 * pattern and the reason — stage 2 shipped an interrupted job with no
 * explanation anywhere on the card while every store test stayed green.
 *
 * ## Which surface this is
 *
 * `JobCard` renders `step.error` and never `job.error`. `JobProgress` is the
 * mirror image, and it has its own file. Getting that backwards is what
 * produced the bug the file above exists for, so every assertion here is on
 * text the **card** is responsible for.
 *
 * ## The three things a stalled import needs to say
 *
 * A spinner beside "Building the hierarchy" is the same picture at four
 * seconds and at forty minutes. So: **how long it has been going**, taken from
 * the step's own clock; **whether that is normal**, but only for the steps
 * `data/_ai-calls.jsonl` has actually timed; and **whether the tab can still
 * reach the server at all**, which is client state the job knows nothing about
 * (docs/reusable/silent-success.md — the driver can fail while the poll
 * succeeds).
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";

import {
  DRIVER_STALLED,
  KEEP_A_TAB_OPEN,
  STEP_USUALLY_A_FEW_MINUTES,
  STOPPING_AFTER_STEP,
  TAKING_LONGER,
  WAITING_TO_CONTINUE,
} from "../src/job-state.js";
import type { Job, JobStep } from "../src/types.js";
import { AddArticle, JobCard } from "../src/web/AddArticle.js";
import type { UseJobs } from "../src/web/useJobs.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A queue that does nothing. This file is about what is drawn. */
function posed(over: Partial<UseJobs> = {}): UseJobs {
  return {
    jobs: [],
    loaded: true,
    error: null,
    driverFailures: {},
    lastFailure: () => null,
    add: async () => null,
    addUpload: async () => null,
    run: async () => null,
    cancel: async () => undefined,
    retry: async () => undefined,
    forget: async () => undefined,
    ...over,
  };
}

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

/**
 * **The clock is frozen by fixing the job's dates against `Date.now()`**,
 * rather than by faking timers. The component reads the wall clock once per
 * render, so the fixture is written backwards from now — which is also how the
 * real thing arrives, since the server stamps the step and the browser
 * subtracts.
 */
const NOW = Date.now();
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const BASE = {
  id: "spya-cardbb",
  ownerId: "00000000-0000-4000-8000-00000000c0de" as Job["ownerId"],
  slug: "an-import-in-progress",
  title: "An import in progress",
  createdAt: ago(200_000),
};

function running(over: Partial<JobStep> = {}): JobStep {
  return {
    name: "hierarchy",
    label: "Building the hierarchy",
    status: "running",
    startedAt: ago(134_000),
    detail: "18k characters of tree so far",
    ...over,
  };
}

function job(over: Partial<Job> = {}): Job {
  return {
    ...BASE,
    status: "running",
    steps: [
      { name: "fetch", label: "Fetching the page", status: "done", detail: "42 KB" },
      running(),
    ],
    ...over,
  };
}

function render(node: React.ReactElement): void {
  act(() => root.render(node));
}

const card = (j: Job, queue: UseJobs = posed()) =>
  render(<JobCard job={j} queue={queue} onHide={() => undefined} />);

it("says how long the running step has been going, beside what it is doing", () => {
  card(job());
  const text = host.textContent ?? "";
  expect(text).toContain("Building the hierarchy");
  /* The plan's line, in the order it asked for: the name of the thing, then
     how long, then whatever the step is reporting about itself. The last of
     those already existed and is what this is built beside. */
  expect(text).toContain("2m 14s");
  expect(text).toContain("18k characters of tree so far");
});

it("only counts the step the reader is waiting on", () => {
  card(job({ steps: [{ name: "fetch", label: "Fetching the page", status: "done" }] }));
  /* Nothing is running, so there is no duration to print — and in particular
     not the job's own age, which survives a retry and would be a number about
     a previous attempt. */
  expect(host.textContent).not.toMatch(/\d+m \d+s/);
});

/**
 * Only for the steps that have been timed. `hierarchy` has 34 runs in
 * `data/_ai-calls.jsonl` at a median of 385 seconds; `fetch` has never been
 * measured at all, and inventing a reassurance for it is
 * docs/reusable/silent-success.md with a number on it.
 */
it("says a step usually takes minutes only where that was measured", () => {
  card(job()); // `hierarchy`: six real ingest runs, median 409s
  expect(host.textContent).toContain(STEP_USUALLY_A_FEW_MINUTES);

  card(
    job({
      steps: [{ name: "fetch", label: "Fetching the page", status: "running", startedAt: ago(4000) }],
    }),
  );
  expect(host.textContent, "invented a duration for an unmeasured step").not.toContain(
    STEP_USUALLY_A_FEW_MINUTES,
  );
});

it("says a queued import is waiting rather than showing nothing", () => {
  card(job({ status: "queued", steps: [{ name: "fetch", label: "Fetching the page", status: "pending" }] }));
  expect(host.textContent).toContain(WAITING_TO_CONTINUE);
});

it("offers the way out when a step has gone past what it usually takes", () => {
  card(job({ steps: [running({ startedAt: ago(20 * 60_000) })] }));
  expect(host.textContent).toContain(TAKING_LONGER);
  /* And the way out is still a way out. A Stop that has gone grey at the exact
     moment the reader wants it is the whole complaint this stage answers. */
  const stop = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Stop"));
  expect(stop?.disabled, "the Stop button was disabled on a slow job").toBe(false);
});

it("says what Stop is waiting for, rather than an indefinite Stopping…", () => {
  card(job({ cancelling: true }));
  expect(host.textContent).toContain(STOPPING_AFTER_STEP);
});

/**
 * **The driver can fail while the poll succeeds.** `drive` catches an
 * `/advance` rejection, waits, and retries for ever without a word, so a job
 * whose advance route 500s sits confidently at `running` while every status
 * poll looks healthy. The count is the engine's; the sentence is the card's.
 */
it("says when the tab can see the import but cannot move it", () => {
  card(job(), posed({ driverFailures: { [BASE.id]: 4 } }));
  expect(host.textContent).toContain(DRIVER_STALLED);
});

it("says nothing about the driver over one unlucky request", () => {
  card(job(), posed({ driverFailures: { [BASE.id]: 1 } }));
  expect(host.textContent).not.toContain(DRIVER_STALLED);
});

it("keeps quiet about the driver once the job is over", () => {
  card(job({ status: "done", steps: [], finishedAt: ago(1000) }), posed({ driverFailures: { [BASE.id]: 9 } }));
  expect(host.textContent).not.toContain(DRIVER_STALLED);
});

/**
 * **The browser is the worker, and until there is a background runner that has
 * to be said out loud.** `pump` in src/jobs.ts opens with
 * `if (process.env.VERCEL) return`; the only thing that calls `/advance` in
 * production is a tab. Calling this a queue without saying so promises
 * something the app does not do.
 *
 * Once, not once per card: three imports at once are still one fact about the
 * browser.
 */
it("says the import needs a tab open, once, while anything is importing", () => {
  render(<AddArticle queue={posed({ jobs: [job(), job({ id: "spya-cardcc" })] })} />);
  const shown = (host.textContent ?? "").split(KEEP_A_TAB_OPEN).length - 1;
  expect(shown, "the tab dependency is stated once per card").toBe(1);
});

/**
 * **And the first version of this test proved nothing**, which is worth
 * leaving written down. It gave the failed job a `finishedAt` a second ago —
 * earlier than `TAB_OPENED_AT`, which is stamped when this file imports the
 * module — so `earlier` folded it behind the "1 earlier import" chevron and no
 * card was rendered at all. The assertion held because the list was empty.
 * Caught by breaking `importing` to `true` and watching it stay green.
 *
 * So: no `finishedAt`, which keeps it in the current list (`earlier` shows
 * anything it cannot establish the end of), and an assertion that the card is
 * actually on screen before saying what is not.
 */
it("does not mention tabs when nothing is importing", () => {
  render(<AddArticle queue={posed({ jobs: [job({ status: "error", error: "Nope.", steps: [] })] })} />);
  expect(host.textContent, "no card was rendered, so this proved nothing").toContain(
    "An import in progress",
  );
  expect(host.textContent).not.toContain(KEEP_A_TAB_OPEN);
});
