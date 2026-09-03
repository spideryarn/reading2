// @vitest-environment jsdom
/**
 * **A job that finishes before the queue has ever looked is still news to the
 * panel that started it.**
 *
 * The engine treats its **first** job list as a baseline rather than as news —
 * `recordCompletions` in src/web/jobEngine.ts — and it is right to: opening the
 * app does not make every job that ever succeeded finish again, and without that
 * rule a fresh load fires `onFinished` once per historical record and the shelf
 * refetches once for each.
 *
 * But the engine polls whether or not anything is mounted, so this sequence is
 * real and happens on any fast step:
 *
 *  1. the panel's GET 404s — `status: "none"`;
 *  2. the panel posts, and the job finishes;
 *  3. the engine's **first** list of the session carries it as `done`;
 *  4. nothing is announced, `load` is never called again, and the panel goes on
 *     saying *nobody has done this yet* over an artefact that exists.
 *
 * The reader's only move from there is to ask for it again — which, now that a
 * mode starts itself, is the loop this whole feature exists to close. GPT Sol,
 * 2026-09-02, and it is invisible unless the poller's seeding rule is read
 * against the panel's state machine.
 *
 * ## The shape, and why every part of it is load-bearing
 *
 * Sol's correction to the first version of this test: start from an **unseeded
 * real engine**, take the id the **POST actually returned**, make **that** job
 * `done` in the **first** list, and assert **exactly one** artefact reload.
 * A version that seeded the engine first, or that posed the job id, or that
 * counted "at least one" reload, would go green over the broken code and over
 * the over-corrected code alike.
 *
 * The over-correction is the second test here. Announcing every `done` job seen
 * on the first list would fix this bug and reintroduce the one the baseline rule
 * exists to prevent, and nothing else in the suite would notice.
 */
import { act, createElement, StrictMode, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "../src/types.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SLUG = "constitution";

/** Every request the client made, in order, as `METHOD url`. */
const trace: string[] = [];

/** Whether the ideas artefact exists yet. Flipped when the job "finishes". */
let ideasExist = false;
/** What `GET /api/jobs` answers with. */
let jobs: Job[] = [];
/** The id the next `POST /api/jobs` hands back. */
let nextId = "job-a";

function job(over: Partial<Job> & { id: string; status: Job["status"] }): Job {
  return {
    slug: SLUG,
    steps: [{ name: "ideas", status: over.status === "done" ? "done" : "pending" }],
    createdAt: 1,
    updatedAt: 1,
    ...over,
  } as unknown as Job;
}

/**
 * The whole network, at `apiFetch`.
 *
 * The **real** `useJobs`, `useStepJob` and `jobEngine` sit on top of this — the
 * bug is inside the engine's seeding rule, so a posed queue could not contain
 * it. `apiFetch` is the seam because it is what both the engine and the artefact
 * read go through.
 */
vi.mock("../src/web/lib/api.js", () => ({
  apiFetch: async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    trace.push(`${method} ${url}`);
    if (url === "/api/jobs" && method === "POST") {
      return new Response(JSON.stringify(job({ id: nextId, status: "queued" })), { status: 200 });
    }
    if (url === "/api/jobs") {
      return new Response(JSON.stringify({ jobs }), { status: 200 });
    }
    if (url.startsWith("/api/ideas/")) {
      if (!ideasExist) return new Response(null, { status: 404 });
      return new Response(
        JSON.stringify({
          ideas: { ideas: [], profileHash: null },
          stale: false,
          outdated: false,
          profileChanged: false,
        }),
        { status: 200 },
      );
    }
    return new Response(null, { status: 404 });
  },
  readJson: async (res: Response) => res.json(),
  fetchOk: async () => new Response(null, { status: 204 }),
  failure: async (res: Response) => new Error(String(res.status)),
  statusOf: () => null,
}));

vi.mock("../src/web/useProfile.js", () => ({ useHasProfile: () => false }));

const { useIdeas } = await import("../src/web/useIdeas.js");
const { jobEngine } = await import("../src/web/jobEngine.js");

let view: ReturnType<typeof useIdeas> | null = null;

function Band(): ReactElement {
  view = useIdeas(SLUG);
  return createElement("div", null, view.status);
}

let host: HTMLDivElement;
let root: Root;

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

/** Artefact reads only — the count this whole file is about. */
function ideaReads(): number {
  return trace.filter((line) => line.startsWith(`GET /api/ideas/`)).length;
}

beforeEach(async () => {
  trace.length = 0;
  ideasExist = false;
  jobs = [];
  nextId = "job-a";
  view = null;
  /* **Unseeded**, which is the precondition the bug needs: the engine has never
     had a job list, so the next one it gets is the baseline. */
  jobEngine.reset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(createElement(StrictMode, null, createElement(Band)));
  });
  await settle();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  jobEngine.reset();
});

describe("a job already finished on the first poll", () => {
  it("still reloads the artefact, exactly once", async () => {
    expect(view?.status).toBe("none");
    const before = ideaReads();
    expect(before).toBeGreaterThan(0);

    await act(async () => {
      await view?.ensure();
    });
    await settle();
    /* The id the POST actually returned, rather than one this test made up. */
    const started = trace.filter((l) => l === "POST /api/jobs");
    expect(started).toHaveLength(1);

    /* It finished between the POST and the engine's first look. */
    ideasExist = true;
    jobs = [job({ id: nextId, status: "done" })];

    /* And *now* the engine binds and polls for the first time — so this list is
       its baseline, and `recordCompletions` will announce nothing from it. */
    await act(async () => {
      jobEngine.start("reader-1");
    });
    await settle();

    expect(view?.status).toBe("ready");
    expect(ideaReads(), "one reload, not none and not two").toBe(before + 1);
  });

  it("does not treat somebody else's finished job as news", async () => {
    /* The over-correction, which would fix the test above and reintroduce the
       bug the baseline rule exists for: a first list full of history must
       reload nothing. */
    expect(view?.status).toBe("none");
    const before = ideaReads();

    ideasExist = true;
    jobs = [
      job({ id: "an-old-one", status: "done" }),
      job({ id: "an-older-one", status: "done" }),
    ];
    await act(async () => {
      jobEngine.start("reader-1");
    });
    await settle();

    expect(ideaReads(), "history is not news").toBe(before);
    expect(view?.status).toBe("none");
  });
});
