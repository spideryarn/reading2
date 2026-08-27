// @vitest-environment jsdom
/**
 * **What the page does when nobody is looking at it.**
 *
 * The complaint that started this was CPU: the reading view was busy while
 * sitting still, and busiest of all in a background tab, where by definition
 * nothing is being read. The cause is `useJobs` — it polls `/api/jobs` every
 * eight seconds, reschedules from each response, and had no idea whether
 * anybody was there. A tab left open overnight made about nine thousand
 * requests and re-rendered a React tree nine thousand times to be told, each
 * time, that nothing had changed.
 *
 * ## Why a test rather than a measurement
 *
 * A profiler run says "0.4% of a core", which is a number about this laptop on
 * this afternoon, and nothing enforces it tomorrow. What can be enforced is the
 * *behaviour*: **a hidden tab issues no requests.** That is exact, it is
 * deterministic under fake timers, and it fails loudly the moment somebody adds
 * a second poller that does not check.
 *
 * The live measurement is still worth having and is not here — it is
 * `src/web/perf.ts` in the page and `scripts/chrome-cpu.ts` outside it, both
 * driven by hand. See docs/project/performance.md.
 *
 * ## The first test is the one that matters
 *
 * `polls while the tab is visible` looks redundant — of course it polls, that
 * is its job. It is here because without it the hidden-tab assertion is
 * worthless: a harness that has quietly broken (a mock that never resolves, a
 * hook that threw on mount, fake timers that are not driving the loop) also
 * reports zero requests, and reads as a pass. So the visible case establishes
 * that this test can *see* polling before the hidden case claims there is none.
 * Both numbers get reported when either fails.
 */
import { act } from "react";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Every request the hook made, in order. The tests only ever count them, but
 *  keeping the URLs makes a failure say *what* was polled rather than only how
 *  often. */
let requests: string[] = [];

/** What `GET /api/jobs` answers. Empty for the idle tests; a running job for
 *  the one that checks an ingest keeps moving. */
let queue: unknown[] = [];

/** How many `/advance` calls should fail before the fake server behaves.
 *  Zero for every test but the one about a transient failure. */
let advanceFailures = 0;

/** The id of the job in `queue`, unique per test.
 *
 * `driving` in useJobs.ts is module scope — deliberately, so that two mounted
 * copies of the hook do not both drive the same job — and this module is
 * imported once for the whole file. A shared id would let one test's driver
 * still hold the lock when the next test starts, and that test would then see
 * no advances for a reason that has nothing to do with what it is asserting. */
let jobId = "j0";
let jobCounter = 0;

vi.mock("../src/web/lib/api.js", () => ({
  apiFetch: (url: string) => {
    requests.push(url);
    if (url.includes("/advance") && advanceFailures > 0) {
      advanceFailures -= 1;
      // A 500, which is what a dev server restarting under the tab looks like.
      return Promise.resolve(
        new Response(JSON.stringify({ error: "boom" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    /* `busy: true`, which is what this laptop's server actually answers while
       its own in-process queue owns the job — and what makes the driver back
       off on a real timer instead of looping through microtasks. A never-busy
       fake would run every step to completion inside the mount flush, and the
       test would then measure a job that had already finished. */
    const body = url.includes("/advance")
      ? { job: { id: jobId, status: "running" }, ran: "fetch", busy: true, done: false }
      : { jobs: queue };
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  },
  /* **Throws on a non-2xx, exactly as the real one does**
     (`src/web/lib/api.ts:159`). A lenient stand-in here is not a small
     inaccuracy — it is the difference between a test that exercises the error
     path and one that never reaches it. The transient-failure test below
     passed against the un-fixed code until this line was written properly,
     which is the whole reason it is spelled out rather than delegated to
     `r.json()`. */
  readJson: async (r: Response) => {
    const text = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return text === "" ? {} : JSON.parse(text);
  },
}));

const { useJobs } = await import("../src/web/useJobs.js");

let root: Root | null = null;
let host: HTMLElement | null = null;

/** Mount a component that does nothing but run the hook. `act` flushes the
 *  mount effect, which is where the poll loop starts. */
async function mount(): Promise<void> {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const Probe = () => {
    useJobs();
    return null;
  };
  await act(async () => {
    root?.render(createElement(Probe));
  });
}

/**
 * Push the clock forward and let every promise the timers woke settle.
 *
 * `advanceTimersByTimeAsync` rather than the synchronous version, because the
 * poll loop is `setTimeout` → `await fetch` → `setTimeout`: a synchronous
 * advance fires the first timer, and then the *next* one is only scheduled
 * after a microtask that never gets to run. The loop stops after one hop and
 * the test reports a number far too low, for a reason that has nothing to do
 * with the code under test.
 */
async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** jsdom's `visibilityState` is a getter on the prototype with no setter, so
 *  it is redefined rather than assigned — and redefined on `document` itself so
 *  the original is still there underneath when the test is over. */
function setVisibility(state: "visible" | "hidden"): void {
  Object.defineProperty(document, "visibilityState", {
    value: state,
    configurable: true,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

const A_MINUTE = 60_000;

beforeEach(() => {
  requests = [];
  queue = [];
  advanceFailures = 0;
  jobId = `j${++jobCounter}`;
  vi.useFakeTimers();
  setVisibility("visible");
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  host?.remove();
  root = null;
  host = null;
  vi.useRealTimers();
});

describe("idle work", () => {
  it("polls while the tab is visible", async () => {
    await mount();
    requests = []; // the mount poll is not idle work; the ones after it are
    await advance(A_MINUTE);

    // The idle interval is 8s, so a minute is about seven. Asserted as a range
    // rather than an exact count: pinning it would make this test an alarm that
    // goes off whenever somebody tunes the interval, which is not what it is
    // for. What it is for is proving the harness can see a poll at all.
    expect(requests.length).toBeGreaterThan(3);
    expect(requests.every((u) => u.startsWith("/api/jobs"))).toBe(true);
  });

  it("makes no requests at all while the tab is hidden", async () => {
    await mount();
    await advance(A_MINUTE);
    const whileVisible = requests.length;

    setVisibility("hidden");
    requests = [];
    await advance(A_MINUTE * 5);

    // Both numbers, because "0 requests" is also what a broken harness says.
    expect({ whileVisible, whileHidden: requests.length }).toEqual({
      whileVisible,
      whileHidden: 0,
    });
    expect(whileVisible).toBeGreaterThan(3);
  });

  /**
   * **The thing the fix must not break.**
   *
   * On a serverless host there is no worker process: the browser walks a job
   * through its steps, one request per step (docs/project/ingest-queue.md). So
   * "stop making requests while hidden" taken literally would stall an ingest
   * the moment the reader switched tabs — the queue would appear to work
   * perfectly for anyone watching it and never finish for anyone who wasn't.
   *
   * Only the recurring *status* GET pauses. Driving is work the reader asked
   * for, and it carries on. GPT Sol's review, 2026-08-27, flagged this before
   * it was written; without that it would have shipped, and it would have
   * looked like flakiness rather than a rule.
   */
  it("keeps advancing a running job while the tab is hidden", async () => {
    queue = [{ id: jobId, status: "running", steps: [] }];
    await mount();
    setVisibility("hidden");
    requests = [];
    await advance(A_MINUTE);

    const advances = requests.filter((u) => u.includes("/advance"));
    const statusPolls = requests.filter((u) => u === "/api/jobs");
    expect({ advanced: advances.length > 0, statusPolls: statusPolls.length }).toEqual({
      advanced: true,
      statusPolls: 0,
    });
  });

  /**
   * **The hole the first version of the fix left**, found by a GPT Sol review
   * of the built code rather than by the test above — which could not see it,
   * because its fake `/advance` never failed.
   *
   * `drive` used to swallow an advance failure, wait, and *exit*, releasing the
   * job. That was safe only because a status poll came along every eight
   * seconds and started a fresh driver. Pausing those polls while hidden
   * removed the thing that restarted it, so a single transient rejection — a
   * dev server restarting, a dropped connection — left the ingest stopped until
   * the reader happened to come back. An ingest that stalls only when nobody is
   * watching, and resumes when they look, is about the worst bug shape there
   * is: it would read as flakiness for months.
   *
   * The fake fails one advance and then behaves. What must happen is that the
   * driver tries again by itself.
   */
  it("keeps driving after a failed advance, with nobody watching", async () => {
    queue = [{ id: jobId, status: "running", steps: [] }];
    advanceFailures = 1;
    await mount();
    setVisibility("hidden");
    await advance(A_MINUTE);
    requests = [];

    // A fresh minute, well after the failure: the driver should still be going.
    await advance(A_MINUTE);
    const advances = requests.filter((u) => u.includes("/advance"));
    expect({
      stillAdvancing: advances.length > 0,
      statusPolls: requests.filter((u) => u === "/api/jobs").length,
    }).toEqual({ stillAdvancing: true, statusPolls: 0 });
  });

  it("polls again as soon as the reader comes back", async () => {
    await mount();
    setVisibility("hidden");
    await advance(A_MINUTE * 5);
    requests = [];

    setVisibility("visible");
    // Immediately, not on the next tick of an eight-second clock: coming back
    // to a stale panel and watching it stay stale is the whole cost of pausing,
    // and it is paid at the one moment the reader is looking.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(requests.length).toBe(1);
  });
});
