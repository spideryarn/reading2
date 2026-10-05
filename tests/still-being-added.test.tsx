// @vitest-environment jsdom
/**
 * **The owner's own early visit shows the import, not "Not shared"** —
 * src/web/article/StillBeingAdded.tsx, mounted by `ArticlePage`;
 * docs/plans/261005l-permalink-and-share-while-an-article-is-importing.md § 2.
 *
 * The job card hands out `/read/<slug>` while the import runs, and before
 * publication the owned read and the public read are both 404. What is pinned:
 *
 *  - a live **import** job for the slug draws *Still being added* with that
 *    job's card, and the article is read again when the job is done;
 *  - a live **mode** job for the slug does not (GPT Sol's plan review, P2-3);
 *  - *no job* is only said of a list asked for **after** the 404: every case
 *    starts from a tab whose list was read, empty, before the page arrived
 *    (P2-4);
 *  - a list that cannot be read is *Not shared*, not a blank page;
 *  - a signed-out visitor gets the landing page and no job subscription.
 *
 * `useArticleAccess` is replaced: what it answers is the test's input, and
 * the `attempt` it is called with is how a re-read is seen.
 */
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Job } from "../src/types.js";

let calls: string[] = [];
/** What `GET /api/jobs` answers, or the failure it throws. */
let queue: Job[] | Error = [];
/** A case may keep the list from answering until it lets go. */
let hold: Promise<void> | null = null;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

vi.mock("../src/web/lib/api.js", async (importActual) => ({
  ...(await importActual<typeof import("../src/web/lib/api.js")>()),
  apiFetch: (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push(`${method} ${url}`);
    /* `busy: true`: a never-busy fake would drive the job to its end inside the mount flush. */
    if (url.includes("/advance")) {
      return Promise.resolve(json({ job: { id: "x", status: "running" }, ran: "fetch", busy: true, done: false }));
    }
    if (url === "/api/jobs" && method === "GET") {
      return (hold ?? Promise.resolve()).then(() => {
        if (queue instanceof Error) throw queue;
        return json({ jobs: queue });
      });
    }
    return Promise.reject(new Error(`unexpected fetch ${method} ${url}`));
  },
}));

/** Every `attempt` the page asked the access hook with, in order. */
let attempts: number[] = [];
vi.mock("../src/web/article/access.js", () => ({
  useArticleAccess: (_slug: string, _readerId: string | null, attempt: number) => {
    attempts.push(attempt);
    /* Not readable until it is asked again; then a marker in place of the article. */
    return attempt === 0 ? { kind: "not-shared" } : { kind: "error", message: "THE ARTICLE" };
  },
}));
vi.mock("../src/web/LandingPage.js", () => ({ LandingPage: () => "THE LANDING PAGE" }));
vi.mock("../src/web/last-view.js", () => ({ useLastView: () => {} }));

const { ArticlePage } = await import("../src/web/article/ArticlePage.js");
const { LIST_WAIT_MS } = await import("../src/web/article/StillBeingAdded.js");
const { jobEngine } = await import("../src/web/jobEngine.js");
const { NOT_SHARED, STILL_BEING_ADDED_HEADING } = await import("../src/messages.js");

const SLUG = "a-paper";
const READER = "sba-reader";

const job = (steps: string[], status: Job["status"], over: Partial<Job> = {}): Job =>
  ({
    id: "sba-j1",
    ownerId: READER,
    slug: SLUG,
    title: "A paper, importing",
    steps: steps.map((name) => ({ name, label: `The ${name} step`, status: "pending" })),
    status,
    createdAt: "2026-10-05T09:00:00.000Z",
    ...(status === "done" ? { finishedAt: "2026-10-05T09:01:00.000Z" } : {}),
    ...over,
  }) as unknown as Job;

const IMPORT = ["fetch", "extract", "blocks", "structure"];

let root: Root | null = null;
let host: HTMLElement | null = null;

async function show(readerId: string | null, strict = false): Promise<void> {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const page = createElement(ArticlePage, { slug: SLUG, view: "article", readerId });
  await act(async () => {
    root?.render(strict ? createElement(StrictMode, null, page) : page);
  });
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const text = () => host?.textContent ?? "";

beforeEach(async () => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  jobEngine.reset();
  calls = [];
  attempts = [];
  queue = [];
  hold = null;
  vi.useFakeTimers();
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  jobEngine.start(READER);
  /* The session's first list lands, empty, before the page is on screen: a
     `loaded` snapshot that was read before the question was asked. */
  await advance(0);
  expect(jobEngine.getSnapshot().loaded).toBe(true);
  calls = [];
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

describe("signed in, at an address nobody can read yet", () => {
  it("draws the import's own card when a live import job has this slug", async () => {
    queue = [job(IMPORT, "running")];
    await show(READER);
    await advance(0);

    expect(text()).toContain(STILL_BEING_ADDED_HEADING);
    expect(text()).toContain("A paper, importing");
    expect(text()).toContain("The extract step");
    expect(text()).not.toContain(NOT_SHARED);
    expect(attempts.every((a) => a === 0), "nothing is read again while it runs").toBe(true);
  });

  it("does not say Not shared before the fresh list has answered", async () => {
    let release: () => void = () => {};
    hold = new Promise((resolve) => {
      release = resolve;
    });
    queue = [job(IMPORT, "queued")];
    await show(READER);
    await advance(100);
    /* The list the page asked for is still out, and the old one was empty. */
    expect(text()).not.toContain(NOT_SHARED);
    expect(text()).not.toContain(STILL_BEING_ADDED_HEADING);

    release();
    await advance(0);
    expect(text()).toContain(STILL_BEING_ADDED_HEADING);
  });

  it("reads the article again when the import is done", async () => {
    queue = [job(IMPORT, "running")];
    await show(READER);
    await advance(0);
    expect(text()).toContain(STILL_BEING_ADDED_HEADING);

    queue = [job(IMPORT, "done")];
    await advance(1500);
    expect(attempts.at(-1)).toBe(1);
    expect(text()).toContain("THE ARTICLE");
    expect(text()).not.toContain(STILL_BEING_ADDED_HEADING);
  });

  it("keeps a failed import's card, with its reason, and reads nothing again", async () => {
    queue = [job(IMPORT, "running")];
    await show(READER);
    await advance(0);

    queue = [
      job(IMPORT, "error", {
        error: "The page answered 403.",
        steps: [{ name: "fetch", label: "The fetch step", status: "error", error: "The page answered 403." }],
      } as Partial<Job>),
    ];
    await advance(1500);
    expect(text()).toContain("The page answered 403.");
    expect(text()).not.toContain(NOT_SHARED);
    expect(attempts.every((a) => a === 0)).toBe(true);
  });

  it("says Not shared over a live mode job for the slug", async () => {
    queue = [job(["glossary"], "running", { url: "https://example.com/a-paper" })];
    await show(READER);
    await advance(0);

    expect(text()).toContain(NOT_SHARED);
    expect(text()).not.toContain(STILL_BEING_ADDED_HEADING);
  });

  it("says Not shared over a live import of another slug", async () => {
    queue = [job(IMPORT, "running", { slug: "another-paper" })];
    await show(READER);
    await advance(0);
    expect(text()).toContain(NOT_SHARED);
  });

  it("says Not shared when there is no job, having asked for a fresh list", async () => {
    await show(READER);
    await advance(0);

    expect(text()).toContain(NOT_SHARED);
    expect(calls.filter((c) => c === "GET /api/jobs").length).toBeGreaterThan(0);
  });

  it("says Not shared over an import that finished before the page arrived", async () => {
    queue = [job(IMPORT, "done")];
    await show(READER);
    await advance(0);
    expect(text()).toContain(NOT_SHARED);
    expect(attempts.every((a) => a === 0), "a done job is not a reason to read again, or it would loop").toBe(true);
  });

  it("says Not shared when the list cannot be read, rather than nothing", async () => {
    queue = new Error("The server is not answering.");
    await show(READER);
    await advance(0);
    expect(text()).toContain(NOT_SHARED);
  });

  it("says Not shared once the wait is over, when no list ever comes", async () => {
    /* A paused engine makes no request, so the barrier is never called. */
    jobEngine.stop();
    await show(READER);
    await advance(0);
    expect(text()).not.toContain(NOT_SHARED);
    await advance(LIST_WAIT_MS);
    expect(text()).toContain(NOT_SHARED);
  });

  it("finds the import under StrictMode's double mount too", async () => {
    queue = [job(IMPORT, "running")];
    await show(READER, true);
    await advance(0);
    expect(text()).toContain(STILL_BEING_ADDED_HEADING);
  });
});

describe("signed out", () => {
  it("draws the landing page and asks for no job list, whatever is running", async () => {
    queue = [job(IMPORT, "running")];
    await show(null);
    await advance(0);

    expect(text()).toContain("THE LANDING PAGE");
    expect(text()).not.toContain(STILL_BEING_ADDED_HEADING);
    expect(calls).toEqual([]);
  });
});
