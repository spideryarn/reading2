// @vitest-environment jsdom
/**
 * **The command bar's *Find more* is judged on a job list asked for after the
 * press** — GPT Sol's F11 on the code of plan 261004k
 * (docs/plans/261004k-command-bar-find-more-code-review-sol.md).
 *
 * `loaded` is true for ever after the first job list, so "no job" in the
 * band's snapshot may be minutes old: a run for this step can be going that
 * this tab has not heard of — started in another tab, or by Metadata's *Run
 * again* in a different profile, which the server does not collapse into the
 * band's (the profile is part of the work key). A press made on that snapshot
 * is a second paid run beside the first.
 *
 * So this file is the one that runs **the real engine and the real `useJobs`**
 * under the band — tests/find-more-from-the-command-bar.test.tsx poses the
 * queue, and a posed queue has no poll to be stale. `fetch` is the server:
 * every `GET /api/jobs` is held until the test answers it, so "which list"
 * is something the test decides rather than something the clock does.
 */
import { act, createElement, StrictMode, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BlockId, Glossary, GlossaryResponse, Job } from "../src/types.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SLUG = "a-piece";
const BLOCK = "spya-adq4zt" as BlockId;

vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "t" } } }),
      refreshSession: async () => ({ data: { session: { access_token: "t" } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({ error: null }),
    },
  },
  googleSignInAvailable: false,
}));

const { jobEngine } = await import("../src/web/jobEngine.js");
const { useGlossaryRead } = await import("../src/web/useGlossary.js");
const { GlossaryBand } = await import("../src/web/modes/glossary/GlossaryMode.js");
const { readingExecutor } = await import("../src/web/command-runners.js");
const { pendingFindMore, resetFindMoreForTests } = await import("../src/web/find-more-handoff.js");

enableHistorySync();

const GLOSSARY = {
  version: "glossary/5",
  generator: "test",
  slug: SLUG,
  sourceHash: "hash",
  profileHash: null,
  entries: [
    { id: "spya-adq5wr", name: "Win-shift", kind: "concept", aliases: [], senseHere: "What it means here.", blocks: [BLOCK] },
  ],
  passes: 1,
  generatedAt: "2026-10-01T09:00:00.000Z",
  elapsedMs: 1,
} as unknown as Glossary;

const ANSWER = {
  glossary: GLOSSARY,
  stale: false,
  outdated: false,
  profileChanged: false,
  panelRun: "append",
} as unknown as GlossaryResponse;

/** A run of this step that this tab did not start — another tab's, or Metadata's. */
const ELSEWHERE = {
  id: "job-elsewhere",
  slug: SLUG,
  url: "https://example.com/a-piece",
  status: "running",
  steps: [{ name: "glossary", status: "running" }],
  createdAt: "2026-10-04T10:00:00.000Z",
} as unknown as Job;

/** One `GET /api/jobs` the engine is waiting on, and the two ways to end it. */
interface Held {
  answer(jobs: Job[]): void;
  fail(status: number): void;
}

/** Lists asked for and not yet answered, oldest first. */
let lists: Held[] = [];
/** How many lists have been asked for. */
let asked = 0;
/** Every body posted to `POST /api/jobs` — a run somebody will be charged for. */
let runs: unknown[] = [];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function server(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  const method = init?.method ?? "GET";
  if (url === "/api/jobs" && method === "GET") {
    asked += 1;
    return new Promise((resolve) => {
      lists.push({
        answer: (jobs) => resolve(json({ jobs })),
        fail: (status) => resolve(json({ error: "No." }, status)),
      });
    });
  }
  if (url === "/api/jobs" && method === "POST") {
    runs.push(JSON.parse(String(init?.body)));
    return Promise.resolve(json({ ...ELSEWHERE, id: "job-pressed", status: "queued" }));
  }
  if (url.endsWith("/advance")) {
    return Promise.resolve(json({ job: ELSEWHERE, ran: null, busy: true, done: false }));
  }
  return Promise.resolve(json(ANSWER));
}

const noop = () => {};
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-04T10:00:00.000Z"));
  lists = [];
  asked = 0;
  runs = [];
  vi.stubGlobal("fetch", server);
  resetFindMoreForTests();
  jobEngine.reset();
  history.replaceState(null, "", `/read/${SLUG}?mode=glossary&sort=document`);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  jobEngine.reset();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** Let promises and zero-delay timers run, without reaching the engine's one-second tick. */
async function settle(turns = 12): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
  }
}

/** Answer the oldest held list. */
async function answer(jobs: Job[]): Promise<void> {
  const held = lists.shift();
  if (!held) throw new Error("no job list is being waited on");
  held.answer(jobs);
  await settle();
}

async function fail(status: number): Promise<void> {
  const held = lists.shift();
  if (!held) throw new Error("no job list is being waited on");
  held.fail(status);
  await settle();
}

function Reading(): ReactElement {
  const read = useGlossaryRead(SLUG);
  return createElement(GlossaryBand, { slug: SLUG, read, onJump: noop, onSelected: noop, onAskChat: noop });
}

async function openBand(): Promise<void> {
  await act(async () => {
    root.render(createElement(StrictMode, null, createElement(NuqsAdapter, null, createElement(Reading))));
  });
  await settle();
}

/** The bar's press, as the reading view builds it. */
function press(): void {
  readingExecutor({ slug: SLUG, blocks: [], jump: noop, findMore: { glossary: noop } }).findMore?.glossary?.();
}

/** A signed-in tab on the band, its job list read and empty, nothing on the wire. */
async function aBandAtRest(): Promise<void> {
  jobEngine.start("reader");
  await openBand();
  await answer([]);
  expect(lists).toHaveLength(0);
  expect(host.textContent).toContain("Find more");
  expect(runs).toEqual([]);
}

describe("a Find more from the bar, on a band whose job list was read a while ago", () => {
  it("asks for the list again, and posts nothing when that list shows a run this tab had not heard of", async () => {
    await aBandAtRest();
    const before = asked;

    await act(async () => press());
    await settle();
    expect(asked, "the press asks for a list now, not in eight seconds").toBe(before + 1);
    expect(runs, "not on the snapshot it already had").toEqual([]);

    await answer([ELSEWHERE]);
    expect(runs).toEqual([]);
    expect(pendingFindMore(SLUG, "glossary"), "taken, not left to fire when that run ends").toBeNull();

    /* And when that run is over, inside the ten seconds: still nothing. */
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_100);
    });
    await answer([{ ...ELSEWHERE, status: "done" } as Job]);
    expect(runs).toEqual([]);
  });

  it("is not released by a list that was already on the wire at the press — the next one releases it", async () => {
    await aBandAtRest();
    jobEngine.poke();
    await settle();
    expect(lists).toHaveLength(1);

    await act(async () => press());
    await settle();
    expect(runs).toEqual([]);

    /* Asked before the press: its silence says nothing about now. */
    await answer([]);
    expect(runs, "the earlier list does not count").toEqual([]);
    expect(pendingFindMore(SLUG, "glossary")).not.toBeNull();
    expect(lists, "and a list asked after the press is on its way").toHaveLength(1);

    await answer([]);
    expect(runs).toEqual([{ slug: SLUG, steps: ["glossary"], force: ["glossary"], useProfile: false }]);
    expect(pendingFindMore(SLUG, "glossary")).toBeNull();
  });

  it("is not released by an earlier list that shows nothing, when the later one shows a run", async () => {
    await aBandAtRest();
    jobEngine.poke();
    await settle();
    await act(async () => press());
    await settle();

    await answer([]);
    await answer([ELSEWHERE]);
    expect(runs).toEqual([]);
    expect(pendingFindMore(SLUG, "glossary")).toBeNull();
  });

  it("presses once, in the list's own setting, when the band opens after the press and the list says idle", async () => {
    jobEngine.start("reader");
    await settle();
    await answer([]);

    press();
    await openBand();
    expect(runs, "the list asked at the press has not answered").toEqual([]);

    await answer([]);
    expect(runs).toEqual([{ slug: SLUG, steps: ["glossary"], force: ["glossary"], useProfile: false }]);
    expect(pendingFindMore(SLUG, "glossary")).toBeNull();

    /* The run it made is found and shown; nothing presses again. */
    await answer([{ ...ELSEWHERE, id: "job-pressed" } as Job]);
    expect(runs).toHaveLength(1);
  });

  it("posts nothing, then or later, when no list comes back inside the ten seconds", async () => {
    await aBandAtRest();
    await act(async () => press());
    await settle();
    await fail(500);
    expect(runs).toEqual([]);

    /* The engine asks again eight seconds on; that one fails too. */
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000);
    });
    await fail(500);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000);
    });
    /* Sixteen seconds after the press, the server is back and says idle. */
    await answer([]);
    expect(host.textContent).toContain("Find more");
    expect(pendingFindMore(SLUG, "glossary")).toBeNull();
    expect(runs).toEqual([]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000);
    });
    await answer([]);
    expect(runs).toEqual([]);
  });

  it("posts nothing, then or later, when the engine is paused and cannot ask", async () => {
    await aBandAtRest();
    /* A settled 401 pauses the engine: a poke asks for nothing. */
    jobEngine.poke();
    await settle();
    await fail(401);
    const before = asked;

    await act(async () => press());
    await settle();
    expect(asked).toBe(before);
    expect(runs).toEqual([]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(11_000);
    });
    await act(async () => jobEngine.resume());
    await settle();
    await answer([]);
    expect(host.textContent).toContain("Find more");
    expect(runs).toEqual([]);
  });
});
