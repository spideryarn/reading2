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
 * the step's own clock; **whether that is normal**, but only for the steps that
 * have actually been timed on that same clock (src/job-state.ts § `STEP_TIMING`
 * has the method); and **whether the tab can still reach the server at all**,
 * which is client state the job knows nothing about
 * (docs/reusable/silent-success.md — the driver can fail while the poll
 * succeeds).
 *
 * ## Two rules this file learned the hard way
 *
 * **Assert the thing is on screen before asserting what is not on it.** Five
 * negative assertions here have passed because nothing rendered at all — one
 * caught while stage 5 was being built, four more by GPT Sol reviewing it. A
 * `not.toContain` under an empty `host` is green and proves nothing, which is
 * docs/reusable/silent-success.md wearing the shape of a test.
 *
 * **The clock is frozen and then advanced on purpose.** `Date.now()` read at
 * module scope does not freeze anything: a worker that pauses for a second
 * between the fixture and the render turns `2m 14s` into `2m 15s`. And nothing
 * used to move time forward *after* a mount, so a `useNow` that ticked once and
 * died would have passed every test in here.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  DRIVER_STALLED,
  KEEP_A_TAB_OPEN,
  RUNNING_A_WHILE,
  STEP_USUALLY_A_COUPLE_OF_MINUTES,
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
    /* Stage 6's blocking job. Null, because nothing here presses a button on
       an article somebody else's job is holding — src/web/useStepJob.ts. */
    lastBlocker: () => null,
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
  /* Frozen, not merely read. `useNow` calls `Date.now()` on a timer, so without
     this the elapsed time on screen depends on how long the render took — and
     `2m 14s` is an exact assertion. `toFake` is left at its default so that
     `setInterval` is faked too, which is what lets the clock be *advanced*
     below. */
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

/**
 * **A fixed instant, a minute after this file was imported.**
 *
 * Fixed, because `Date.now()` at module scope freezes nothing — Sol's point,
 * and the exact `2m 14s` assertions below can flake by a second without it.
 * A minute *after* import, because `AddArticle` stamps `TAB_OPENED_AT` at
 * module scope and a job that finished before it is folded behind the "earlier
 * imports" chevron — which is how one of these tests came to assert the absence
 * of an empty list.
 */
const NOW = Date.now() + 60_000;
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

/** The `<li>` for one step, so an assertion cannot wander onto another row. */
function row(label: string): HTMLLIElement | undefined {
  return [...host.querySelectorAll("li")].find((li) => li.textContent?.includes(label));
}

/**
 * **One row, in one order, with nothing between the parts.**
 *
 * This was three independent `toContain` calls over the whole card, which — as
 * Sol put it — pinned *"neither order, nor adjacency, nor even the same row"*:
 * it would have stayed green with the duration printed under the wrong step, or
 * before the label, or in the job sentence at the bottom. The plan asked for
 * `Building the hierarchy · 2m 14s · 18k characters of tree so far`, so that is
 * what is asserted.
 */
it("says how long the running step has been going, beside what it is doing", () => {
  card(job());
  expect(row("Building the hierarchy")?.textContent).toMatch(
    /^Building the hierarchy\s*·\s*2m 14s\s*·\s*18k characters of tree so far$/,
  );
});

/**
 * **The card has to keep its own time**, and nothing in this file used to check
 * that past the first paint. `report` writes a step's `detail` in memory and
 * never persists it (src/jobs.ts), so a job halfway through a long step sends
 * back a byte-identical record on every poll and `sameJobs` correctly
 * suppresses the re-render. Without `useNow`'s interval the duration would
 * freeze at whatever it read when the step began — which is the exact lie this
 * whole stage exists to stop, and a `useNow` that ticked once and stopped would
 * have passed every other test here.
 */
it("keeps counting after the first paint", () => {
  card(job());
  expect(row("Building the hierarchy")?.textContent).toContain("2m 14s");

  act(() => void vi.advanceTimersByTime(31_000));
  expect(row("Building the hierarchy")?.textContent, "the clock stopped at the first render").toContain(
    "2m 45s",
  );
});

/**
 * And it stops when the card goes. An interval left behind re-renders an
 * unmounted tree once a second for the life of the tab — see `useNow`'s own
 * cleanup, which nothing was watching.
 */
it("puts its timer down when it unmounts", () => {
  card(job());
  expect(vi.getTimerCount(), "the card never started a clock").toBeGreaterThan(0);
  act(() => root.unmount());
  expect(vi.getTimerCount(), "left an interval running after unmount").toBe(0);
  /* `afterEach` unmounts too, and doing it twice is a no-op — but the root has
     to exist for it, so put a fresh one back. */
  root = createRoot(host);
});

/**
 * **And starts no clock at all for a card with nothing to count.**
 *
 * This used to be `useNow(86_400_000)`, described in the code as "one timer
 * that never fires". It fired: once a day, per finished card, for the life of
 * the tab. `useNow` takes `null` now, and this is what says so — GPT Sol,
 * 2026-09-01, *"supporting a disabled interval would be cleaner"*.
 */
it("starts no clock for a card that has nothing to count", () => {
  card(job({ status: "done", steps: [], finishedAt: ago(1000) }));
  expect(host.textContent, "no card rendered, so the count below proves nothing").toContain(
    "An import in progress",
  );
  expect(vi.getTimerCount(), "an idle card is holding a timer").toBe(0);
});

it("only counts the step the reader is waiting on", () => {
  card(job({ steps: [{ name: "fetch", label: "Fetching the page", status: "done" }] }));
  /* **On screen first.** A done step still draws its row, and if it ever stops
     drawing one, the absence below stops meaning anything — Sol's finding, and
     the same shape as the tab test's, which really had gone hollow. */
  expect(row("Fetching the page"), "no step row rendered, so the assertion below proves nothing")
    .toBeDefined();
  /* Nothing is running, so there is no duration to print — and in particular
     not the job's own age, which survives a retry and would be a number about
     a previous attempt. */
  expect(host.textContent).not.toMatch(/\d+m \d+s/);
});

/**
 * **Only for a step that has been timed on the clock this card shows.**
 *
 * `sketch` has been: thirteen successful runs, 121–199s, and the one real
 * ingest step and its one model call are the same 159s. `fetch` has not, and
 * neither — since 2026-09-01 — has `hierarchy`, whose "six runs, median 409s"
 * turned out to be five failures measured off the model-call log. Inventing a
 * reassurance is docs/reusable/silent-success.md with a number on it.
 * src/job-state.ts § `STEP_TIMING`.
 */
it("says a step usually takes minutes only where that was measured", () => {
  card(
    job({
      steps: [
        { name: "sketch", label: "Drawing the argument", status: "running", startedAt: ago(74_000) },
      ],
    }),
  );
  expect(row("Drawing the argument")?.textContent).toContain(STEP_USUALLY_A_COUPLE_OF_MINUTES);

  card(
    job({
      steps: [{ name: "fetch", label: "Fetching the page", status: "running", startedAt: ago(4000) }],
    }),
  );
  /* On screen first: the row this is meant to be silent *about*. Without it the
     assertion passes just as well when nothing rendered. */
  expect(row("Fetching the page"), "no step row rendered, so the assertion below proves nothing")
    .toBeDefined();
  expect(host.textContent, "invented a duration for an unmeasured step").not.toContain(
    STEP_USUALLY_A_COUPLE_OF_MINUTES,
  );

  /* `hierarchy` is the one that lost its sentence, and it is the case worth
     naming: it still has a threshold of its own, argued from evidence, and
     still says nothing about how long it takes. */
  card(job());
  expect(row("Building the hierarchy")).toBeDefined();
  expect(host.textContent, "promised a duration off one successful run").not.toContain(
    STEP_USUALLY_A_COUPLE_OF_MINUTES,
  );
});

it("says a queued import is waiting rather than showing nothing", () => {
  card(job({ status: "queued", steps: [{ name: "fetch", label: "Fetching the page", status: "pending" }] }));
  expect(host.textContent).toContain(WAITING_TO_CONTINUE);
});

it("offers the way out when a step has gone past what it usually takes", () => {
  card(
    job({
      steps: [
        {
          name: "sketch",
          label: "Drawing the argument",
          status: "running",
          startedAt: ago(20 * 60_000),
        },
      ],
    }),
  );
  expect(host.textContent).toContain(TAKING_LONGER);
  /* And the way out is still a way out. A Stop that has gone grey at the exact
     moment the reader wants it is the whole complaint this stage answers. */
  const stop = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Stop"));
  expect(stop?.disabled, "the Stop button was disabled on a slow job").toBe(false);
});

/**
 * **The same way out, without the statistical claim.** A step nobody has timed
 * still gets a threshold and still gets the offer to stop — what it does not
 * get is *"longer than usual"*, because nothing here has ever said what usual
 * is for it. GPT Sol, 2026-09-01.
 */
it("does not call a step unusual when nothing measured what usual is", () => {
  card(job({ steps: [running({ startedAt: ago(20 * 60_000) })] })); // `hierarchy`
  expect(host.textContent).toContain(RUNNING_A_WHILE);
  expect(host.textContent, "claimed to know what an unmeasured step usually takes").not.toContain(
    TAKING_LONGER,
  );
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
  /* The card is on screen, so the silence below is the card being quiet rather
     than the card being absent. */
  expect(host.textContent).toContain("An import in progress");
  expect(host.textContent).not.toContain(DRIVER_STALLED);
});

it("keeps quiet about the driver once the job is over", () => {
  card(job({ status: "done", steps: [], finishedAt: ago(1000) }), posed({ driverFailures: { [BASE.id]: 9 } }));
  /* `steps: []` draws an empty list, so without this the card could vanish
     entirely and the assertion would still be green — Sol's finding. */
  expect(host.textContent).toContain("An import in progress");
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
