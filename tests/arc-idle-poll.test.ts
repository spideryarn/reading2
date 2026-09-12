// @vitest-environment jsdom
/**
 * **The arc must not keep the job engine awake.**
 *
 * `useArc` is mounted by `OwnedReader` on every article an owner opens, and it
 * reaches `useJobs` through `useStepJob`. A `useJobs` subscriber is what puts
 * the tab-level engine on its eight-second idle cadence (src/web/jobEngine.ts
 * § When it polls), so from 2026-08-29 an owner's reading view asked
 * `GET /api/jobs` every eight seconds for as long as it was open, with nothing
 * running — about 450 requests an hour per tab, each one the device still has
 * to answer. What that costs an iPad was not measured; see
 * docs/plans/260912a-ipad-battery-drain-the-reading-view-polls-the-job-queue-every-eight-seconds-at-rest.md.
 *
 * This is the hook-level half. The class guard — the whole reading view,
 * through `App` — is `an owner's reading view, left alone` in
 * tests/public-network-trace.test.tsx.
 *
 * ## Four cases, and why the other three are here
 *
 * - **the arc at rest** is the claim: after the mount poll, a minute of silence;
 * - **a plain `useJobs`** in the same harness is the positive control. Zero
 *   requests is also what a mock that never resolves, or fake timers that are
 *   not driving the loop, would report — so this proves the harness can see an
 *   idle poll before the first case claims there is none;
 * - **the arc's own job, start to finish** is what the fix must not take away:
 *   the job it starts is found, driven and announced, even past a failed poll;
 * - **another tab's job** is the trade, written down: not noticed at rest,
 *   watched every second once something pokes.
 *
 * Harness copied from tests/idle-work.test.ts, which says why each piece of it
 * is the way it is.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Arc } from "../src/types.js";

/** Every request made, in order. Kept as URLs so a failure says what was asked. */
let requests: string[] = [];

/** What `GET /api/jobs` answers. Empty unless a case puts a job in it. */
let queue: unknown[] = [];

/** Fresh per test: the engine's `driving` map is a singleton for the file. */
let jobId = "arcidle-j0";
let jobCounter = 0;

/** The same requests with their methods, for the case that has to count POSTs. */
let calls: string[] = [];

/** A case may answer some requests itself; null falls through to the defaults. */
let override: ((url: string, method: string) => Response | null) | null = null;

vi.mock("../src/web/lib/api.js", () => ({
  apiFetch: (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    requests.push(url);
    calls.push(`${method} ${url}`);
    const answered = override?.(url, method);
    if (answered) return Promise.resolve(answered);
    /* `busy: true`, as in idle-work.test.ts: a never-busy fake would drive the
       running job to completion inside the mount flush. */
    const body = url.includes("/advance")
      ? { job: { id: jobId, status: "running" }, ran: "arc", busy: true, done: false }
      : { jobs: queue };
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  },
  /* Throws on a non-2xx, as the real one does (src/web/lib/api.ts). */
  readJson: async (r: Response) => {
    const text = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return text === "" ? {} : JSON.parse(text);
  },
  statusOf: () => null,
}));

const { useArc } = await import("../src/web/useArc.js");
const { useJobs } = await import("../src/web/useJobs.js");
const { jobEngine } = await import("../src/web/jobEngine.js");

const SLUG = "an-arc-at-rest";

/**
 * An arc **in the payload**, which is the ordinary path: `useArc` makes no read
 * and starts no job, so the only thing it can be doing to the network is
 * holding a subscription. With no arc it would fetch `/api/arc/` and could
 * start a job, and the case would be about something else.
 */
const ARC: Arc = {
  version: "test",
  generator: "test",
  slug: SLUG,
  sourceHash: "arc-idle-poll-fixture",
  entries: [{ range: ["spya-arid01", "spya-arid02"], text: "Where the piece goes." }],
};

/** What the arc probe last saw, so the busy case can check it bound the job. */
let lastWorking: boolean | null = null;
let everWorking = false;
let lastArc: Arc | null = null;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** The arc's job, as the server would list it. */
const arcJob = (status: "queued" | "running" | "done") => ({
  id: jobId,
  ownerId: "arc-reader-1",
  slug: SLUG,
  steps: [{ name: "arc", label: "Arc", status }],
  status,
  createdAt: "2026-09-12T09:00:00.000Z",
});

let root: Root | null = null;
let host: HTMLElement | null = null;

async function mount(Probe: () => null): Promise<void> {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(createElement(Probe));
  });
}

const ArcProbe = () => {
  lastWorking = useArc(SLUG, ARC).working;
  return null;
};

/** An article with no arc yet, so `useArc` reads, 404s and starts the job itself. */
const ArcFromNothingProbe = () => {
  const arc = useArc(SLUG, undefined);
  lastWorking = arc.working;
  lastArc = arc.arc;
  if (arc.working) everWorking = true;
  return null;
};

const JobsProbe = () => {
  useJobs("watches-queue");
  return null;
};

/** `advanceTimersByTimeAsync`, so each `setTimeout → await fetch → setTimeout`
 *  hop gets its microtasks — see `advance` in idle-work.test.ts. */
async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const A_MINUTE = 60_000;
const statusPolls = () => requests.filter((u) => u === "/api/jobs");

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  jobEngine.reset();
  requests = [];
  calls = [];
  override = null;
  queue = [];
  lastWorking = null;
  everWorking = false;
  lastArc = null;
  jobId = `arcidle-j${++jobCounter}`;
  vi.useFakeTimers();
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  /* A signed-in reader: a subscriber alone never wakes the engine, it only
     chooses the cadence. See the same line in idle-work.test.ts. */
  jobEngine.start("arc-reader-1");
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  host?.remove();
  root = null;
  host = null;
  jobEngine.reset();
  vi.useRealTimers();
});

describe("the arc's job subscription", () => {
  /** The claim. Red before the fix: the arc's subscriber holds the idle cadence. */
  it("asks nothing for a minute on a reading view with nothing running", async () => {
    await mount(ArcProbe);
    const atMount = statusPolls().length;
    requests = []; // the session-start poll is not idle work; the ones after it are
    await advance(A_MINUTE);

    expect(atMount, "the session's first poll must have happened").toBeGreaterThan(0);
    expect(requests, "requests in a minute at rest").toEqual([]);
  });

  /** The positive control: the same harness, a subscriber that does ask for the
   *  idle courtesy, and it is seen. */
  it("does see an ordinary subscriber's idle polls, so the silence above is real", async () => {
    await mount(JobsProbe);
    requests = [];
    await advance(A_MINUTE);

    expect(statusPolls().length).toBeGreaterThan(3);
  });

  /**
   * **The arc's own job, start to finish** — what the quiet subscription must
   * not take away. It reads, finds no arc, starts one, and the poll its POST
   * pokes **fails**: with nothing busy and nobody on the idle cadence, that
   * failure used to leave nothing armed, so the job the server had just made
   * was never found or driven (GPT Sol, 2026-09-12, F1). The engine now owes
   * the action a successful poll. Red without `reconciliationOwed`.
   */
  it("starts its own arc, survives a failed poll after the POST, and shows the arc it wrote", async () => {
    let arcWritten = false;
    let failNextPoll = false;
    override = (url, method) => {
      if (url === `/api/arc/${SLUG}`) {
        return arcWritten
          ? json({ arc: ARC, stale: false, outdated: false })
          : new Response(null, { status: 404 });
      }
      if (method === "POST" && url === "/api/jobs") {
        queue = [arcJob("queued")];
        failNextPoll = true;
        return json(arcJob("queued"));
      }
      if (method === "GET" && url === "/api/jobs" && failNextPoll) {
        failNextPoll = false;
        return json({ error: "a transient fault" }, 500);
      }
      if (url === `/api/jobs/${jobId}/advance`) {
        arcWritten = true;
        queue = [arcJob("done")];
        return json({ job: arcJob("done"), ran: "arc", busy: false, done: true });
      }
      return null;
    };

    await mount(ArcFromNothingProbe);
    await advance(30_000);

    expect(calls.filter((c) => c === "POST /api/jobs"), "one job asked for").toHaveLength(1);
    expect(failNextPoll, "the poll after the POST was the one that failed").toBe(false);
    expect(calls.some((c) => c.endsWith("/advance")), "and the job was still driven").toBe(true);
    expect(everWorking, "the arc showed its job running").toBe(true);
    expect(lastArc, "the arc the job wrote, read after it finished").toEqual(ARC);
    expect(lastWorking, "and nothing is running now").toBe(false);
  });

  /**
   * **The trade, stated as a case, and then the busy cadence.** A job the
   * engine has not seen — `beforeEach`'s session-start poll answered before
   * this case filled the queue, so it stands for another tab's — is not
   * noticed while the reading view rests: a quiet subscriber does not poll on
   * arrival or afterwards. Anything that pokes (focus, an action) finds it, and
   * from then on it is watched every second and driven, because the busy
   * cadence needs no subscriber at all.
   */
  it("does not notice another tab's job at rest, and watches it every second once poked", async () => {
    queue = [arcJob("running")];
    await mount(ArcProbe);
    requests = [];
    await advance(A_MINUTE);

    expect(statusPolls(), "nothing polls at rest, so a job started elsewhere waits").toEqual([]);
    expect(lastWorking).toBe(false);

    await act(async () => {
      jobEngine.poke();
    });
    requests = [];
    await advance(A_MINUTE);

    // About sixty at one a second; well over the idle cadence's seven.
    expect(statusPolls().length).toBeGreaterThan(20);
    expect(requests.some((u) => u.includes("/advance")), "and it is still driven").toBe(true);
    expect(lastWorking, "and the arc knows its job is running").toBe(true);
  });
});
