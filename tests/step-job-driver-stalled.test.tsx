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
/** Whether the posed queue refuses the press. `null` from `run` is any failure. */
let refuses = false;

vi.mock("../src/web/useJobs.js", () => ({
  useJobs: () => ({
    jobs,
    loaded: true,
    error: null,
    driverFailures,
    lastFailure: () => (refuses ? "The request did not reach the server." : null),
    run: async () => (refuses ? null : { id: "spya-drawing" }),
    cancel: async () => {},
  }),
}));

const { useStepJob } = await import("../src/web/useStepJob.js");
type StepFailure = NonNullable<ReturnType<typeof useStepJob>["failed"]>;

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
let seen: { stalled: boolean; job: Job | null; failed: StepFailure | null } | null = null;
/** The last hook value, so a test can press the button. */
let press: (() => Promise<void>) | null = null;

beforeEach(() => {
  jobs = [];
  driverFailures = {};
  refuses = false;
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
  const step = useStepJob("an-article", "sketch", () => undefined, "watches-queue");
  seen = { stalled: step.stalled, job: step.job, failed: step.failed };
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
 * **A refusal is not a stall**, and there is no longer a blocker to borrow one
 * from.
 *
 * This case used to be *"it speaks for the job that is in the way"*: a 409
 * carried the blocking job, `useStepJob` held it, and the band drew it — so its
 * driver's health was the health that mattered. The refusal went on 2026-09-02
 * with the per-article queue (docs/plans/260902e-a-per-article-job-queue-that-appends-and-modes-that-start-themselves.md
 * § 1g), and what is left is the invariant underneath it: `stalled` is about a
 * job **on screen**, so a failed press with nothing running says the reason and
 * nothing about transport.
 */
it("says nothing about transport when the press failed and nothing is running", async () => {
  refuses = true;
  driverFailures = { "spya-blocker": 4, "spya-drawing": 9 };
  mount();
  expect(seen?.job).toBeNull();
  expect(seen?.stalled).toBe(false);

  await act(async () => {
    await press?.();
  });
  expect(seen?.failed?.message, "the refusal's own words are what the reader gets").toBe(
    "The request did not reach the server.",
  );
  expect(seen?.stalled).toBe(false);
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

/* --------------------------------------------------------------------------
   **Which of several jobs this panel is about.**

   An article holds a *line* of jobs since 2026-09-02
   (docs/plans/260902e-a-per-article-job-queue-that-appends-and-modes-that-start-themselves.md),
   so "the job for this slug and this step" stopped having one answer. Two
   matching jobs is not exotic: a forced and an unforced glossary both write
   `glossary` and their work keys differ, so `enqueueOrGet` does not collapse
   them into one.

   `queue.jobs` is **newest first** (`listJobs`, src/jobs.ts), and the hook took
   the first active match out of it — so the panel bound to whichever job was
   newer and silently dropped the other one's progress and its failure.

   Watched red on 2026-09-02 with the old one-liner put back: the first two
   cases fail, reading *"the panel bound to a queued job while one was running:
   expected 'spya-newer' to be 'spya-running'"* and *"expected 'spya-newer' to
   be 'spya-older'"*.
   -------------------------------------------------------------------------- */

/** A sketch job for this article, at a given moment. */
function at(id: string, createdAt: string, over: Partial<Job> = {}): Job {
  return { ...sketching(), id, createdAt, status: "queued", ...over };
}

it("takes the running job when there is one, whatever the list order", () => {
  /* Newest first, as the engine hands them over: the queued one is the newer. */
  jobs = [
    at("spya-newer", "2026-09-02T12:00:02.000Z"),
    at("spya-running", "2026-09-02T12:00:01.000Z", { status: "running" }),
  ];
  mount();
  expect(seen?.job?.id, "the panel bound to a queued job while one was running").toBe(
    "spya-running",
  );
});

it("takes the oldest queued job when none is running, which is the one that runs next", () => {
  jobs = [
    at("spya-newer", "2026-09-02T12:00:02.000Z"),
    at("spya-older", "2026-09-02T12:00:01.000Z"),
  ];
  mount();
  /* The same order the claim uses — `(createdAt, id)`, src/store/pg-jobs.ts §
     `blockedByAnother` — so the panel is about the run that is about to happen
     rather than about whichever row sorted first. */
  expect(seen?.job?.id).toBe("spya-older");
});

it("breaks a tie on the id, the same way the store does", () => {
  /* Two rows written inside one millisecond. The panel and the claim must
     agree, or the band watches one job while the server runs the other. */
  jobs = [
    at("spya-zzzzzz", "2026-09-02T12:00:01.000Z"),
    at("spya-aaaaaa", "2026-09-02T12:00:01.000Z"),
  ];
  mount();
  expect(seen?.job?.id).toBe("spya-aaaaaa");
});
