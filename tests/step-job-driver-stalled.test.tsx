// @vitest-environment jsdom
/**
 * **The band's half of "this tab can see the job and cannot move it".**
 *
 * `drive` in src/web/jobEngine.ts catches a failed `POST /advance`, waits eight
 * seconds and retries for ever without a word, so a job whose advance route
 * keeps answering 500 sits confidently at `running` while every status poll
 * looks healthy — docs/reusable/silent-success.md, in the one loop built to
 * prevent a stalled ingest.
 *
 * Stage 5 said that on the shelf card and **not** in the reading view's band,
 * on the argument that threading it would touch eight panels. GPT Sol,
 * 2026-09-01: *"a reader drawing a sketch or generating a glossary may never
 * look at the shelf card; their only surface can therefore spin indefinitely
 * without the warning Stage 5 exists to give."* The seam Sol pointed at is this
 * one — `useStepJob` already holds the queue subscription — so nothing about
 * transport health had to go onto `Job` or through `displayJob`.
 *
 * ## What this file is for, and what it is not
 *
 * Three pieces carry that sentence to a reader, and each is pinned somewhere
 * different. The engine's **count** is tests/job-engine-*.test.ts. The
 * **rendering** is tests/job-progress-band.test.tsx. This is the middle: that
 * `useStepJob` asks the shared `driverStalled` about the right job, and answers
 * `false` when it is somebody else's. The fourth piece — every panel passing
 * the prop — is held by the type: `stalled` is required on `JobProgress`, so
 * omitting it in a panel is a compiler error rather than a silent gap.
 *
 * `useJobs` is mocked whole, which is the established pattern for the hooks
 * over it (tests/step-job-force.test.tsx and four others). What is under test
 * is the derivation, and a real engine here would only add a fake server.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Job } from "../src/types.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** What the posed queue answers with. A test moves these before mounting. */
let jobs: Job[] = [];
let driverFailures: Record<string, number> = {};
/** The job a refused `run` reports as the one in the way. Stage 6's 409. */
let refusedBy: Job | null = null;

vi.mock("../src/web/useJobs.js", () => ({
  useJobs: () => ({
    jobs,
    loaded: true,
    error: null,
    driverFailures,
    lastFailure: () => (refusedBy ? "busy" : null),
    lastBlocker: () => refusedBy,
    run: async () => (refusedBy ? null : { id: "spya-drawing" }),
    cancel: async () => {},
  }),
}));

const { useStepJob } = await import("../src/web/useStepJob.js");

const OWNER = "00000000-0000-4000-8000-00000000c0de" as Job["ownerId"];

/** A sketch run for this article — the job the band is watching. */
function sketching(over: Partial<Job> = {}): Job {
  return {
    id: "spya-drawing",
    ownerId: OWNER,
    slug: "an-article",
    status: "running",
    createdAt: new Date().toISOString(),
    steps: [{ name: "sketch", label: "Drawing the argument", status: "running" }],
    ...over,
  };
}

let host: HTMLDivElement;
let root: Root;
/** What the hook answered on the last render. */
let seen: { stalled: boolean; job: Job | null; blocking: Job | null } | null = null;
/** The last hook value, so a test can press the button. */
let press: (() => Promise<void>) | null = null;

beforeEach(() => {
  jobs = [];
  driverFailures = {};
  refusedBy = null;
  seen = null;
  press = null;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function Probe(): null {
  const step = useStepJob("an-article", "sketch", () => undefined);
  seen = { stalled: step.stalled, job: step.job, blocking: step.blocking };
  press = () => step.start();
  return null;
}

function mount(): void {
  act(() => root.render(createElement(Probe)));
}

it("says nothing about a driver that is getting through", () => {
  jobs = [sketching()];
  mount();
  /* The job is on screen first — a `false` here with no job at all would be the
     right answer for the wrong reason. */
  expect(seen?.job?.id).toBe("spya-drawing");
  expect(seen?.stalled).toBe(false);
});

/**
 * **Two failures are not a stall**, and the threshold is `driverStalled`'s
 * rather than this hook's: one blip and one dev-server restart must say
 * nothing. src/job-state.ts § `DRIVER_STALLED_AFTER`.
 */
it("waits for a run of failures before saying anything", () => {
  jobs = [sketching()];
  driverFailures = { "spya-drawing": 2 };
  mount();
  expect(seen?.job?.id).toBe("spya-drawing");
  expect(seen?.stalled).toBe(false);
});

it("says so once the driver has been getting nowhere", () => {
  jobs = [sketching()];
  driverFailures = { "spya-drawing": 3 };
  mount();
  expect(seen?.stalled).toBe(true);
});

/**
 * **Counted per job, and this band only speaks for its own.** The map is keyed
 * by job id, so an unrelated import failing to advance in another tab's shelf
 * must not put a warning under this sketch.
 */
it("does not borrow another job's bad luck", () => {
  jobs = [sketching()];
  driverFailures = { "spya-somebody-else": 9 };
  mount();
  expect(seen?.job?.id).toBe("spya-drawing");
  expect(seen?.stalled).toBe(false);
});

/**
 * **And it speaks for the blocker too**, which is the case Sol's finding is
 * really about: a reader who pressed this button on an article somebody else's
 * import is holding is watching *that* job, and a driver that cannot advance it
 * leaves them exactly as stuck. `blocking` is the only job on screen there, so
 * it is the one whose driver health matters.
 */
it("speaks for the job that is in the way, when that is the one on screen", async () => {
  /* An ingest holding the article. **Nothing in it writes `sketch`**, which is
     what makes it a blocker rather than this panel's own job. */
  refusedBy = {
    ...sketching(),
    id: "spya-blocker",
    steps: [{ name: "hierarchy", label: "Building the hierarchy", status: "running" }],
  };
  driverFailures = { "spya-blocker": 4 };
  mount();
  /* Nothing of ours is running, and before the press there is nothing to say. */
  expect(seen?.job).toBeNull();
  expect(seen?.stalled).toBe(false);

  await act(async () => {
    await press?.();
  });
  expect(seen?.blocking?.id, "the refusal never produced a blocker").toBe("spya-blocker");
  expect(seen?.stalled).toBe(true);
});

/**
 * With nothing on screen there is nothing to say. The band draws a button, and
 * a warning about a job that is not there would be about nothing at all.
 */
it("says nothing when there is no job on screen", () => {
  driverFailures = { "spya-drawing": 9 };
  mount();
  expect(seen?.job).toBeNull();
  expect(seen?.stalled).toBe(false);
});
