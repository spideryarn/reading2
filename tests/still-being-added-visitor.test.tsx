// @vitest-environment jsdom
/**
 * **A shared address opened before its article is published** —
 * src/web/article/StillBeingAddedVisitor.tsx, mounted by `ArticlePage`;
 * docs/plans/261005l-permalink-and-share-while-an-article-is-importing.md
 * § Stage 2, 2c, as amended by F3 of its plan review.
 *
 * The public read answers `still-being-added` (tests/public-still-being-added.test.ts).
 * What is pinned here is who sees what, and how the visitor's page asks again:
 *
 *  - **signed out**: the visitor page at once, and no job list;
 *  - **signed in, and it is their own import**: the import's card, as for a
 *    404 (tests/still-being-added.test.tsx), and no public polling;
 *  - **signed in, not theirs** (or a list that cannot be read): the visitor
 *    page where *Not shared* would have been;
 *  - the page asks every ten seconds **only while the tab is visible**, has
 *    *Check now*, and stops when it is unmounted or its slug or key changes;
 *  - its three ways out: published, no longer shared or failed, still going.
 *
 * `useArticleAccess` is replaced: what it answers is the test's input, and
 * the `attempt` it is called with is how a re-read is seen.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Job } from "../src/types.js";

let calls: string[] = [];
let queue: Job[] | Error = [];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

vi.mock("../src/web/lib/api.js", async (importActual) => ({
  ...(await importActual<typeof import("../src/web/lib/api.js")>()),
  apiFetch: (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push(`${method} ${url}`);
    if (url.includes("/advance")) {
      return Promise.resolve(json({ job: { id: "x", status: "running" }, ran: "fetch", busy: true, done: false }));
    }
    if (url === "/api/jobs" && method === "GET") {
      if (queue instanceof Error) return Promise.reject(queue);
      return Promise.resolve(json({ jobs: queue }));
    }
    return Promise.reject(new Error(`unexpected fetch ${method} ${url}`));
  },
}));

type Access = { kind: "still-being-added" } | { kind: "not-shared" } | { kind: "error"; message: string };
/** What the access hook answers at each attempt. The last one stands for every later attempt. */
let answers: Access[] = [{ kind: "still-being-added" }];
let attempts: number[] = [];
vi.mock("../src/web/article/access.js", () => ({
  useArticleAccess: (_slug: string, _readerId: string | null, attempt: number) => {
    if (attempts.at(-1) !== attempt) attempts.push(attempt);
    return answers[Math.min(attempt, answers.length - 1)];
  },
}));

/** Every public re-ask: `<slug>` or `<slug>?key=<key>`, and whether its signal was aborted since. */
let polls: Array<{ what: string; signal: AbortSignal | undefined }> = [];
type Poll = { kind: "ok"; body: unknown } | { kind: "not-shared" } | { kind: "still-being-added" } | Error;
let pollAnswer: () => Promise<Poll> = async () => ({ kind: "still-being-added" });
vi.mock("../src/web/public-api.js", () => ({
  loadPublicArticle: async (slug: string, signal?: AbortSignal, key: string | null = null) => {
    polls.push({ what: key === null ? slug : `${slug}?key=${key}`, signal });
    const answer = await pollAnswer();
    if (answer instanceof Error) throw answer;
    return answer;
  },
  publicFetch: () => Promise.reject(new Error("not in this test")),
}));

let shareKey: string | null = null;
vi.mock("../src/web/useShareKey.js", () => ({ useShareKey: () => shareKey }));
vi.mock("../src/web/LandingPage.js", () => ({ LandingPage: () => "THE LANDING PAGE" }));
vi.mock("../src/web/last-view.js", () => ({ useLastView: () => {} }));

const { ArticlePage } = await import("../src/web/article/ArticlePage.js");
const { RECHECK_MS } = await import("../src/web/article/StillBeingAddedVisitor.js");
const { LIST_WAIT_MS } = await import("../src/web/article/StillBeingAdded.js");
const { jobEngine } = await import("../src/web/jobEngine.js");
const { NOT_SHARED, STILL_BEING_ADDED, STILL_BEING_ADDED_HEADING, STILL_BEING_ADDED_VISITOR } = await import(
  "../src/messages.js"
);

const SLUG = "a-paper";
const READER = "sbv-reader";
const KEY = "AAAAAAAAAAAAAAAAAAAAAA";
const THE_ARTICLE: Access = { kind: "error", message: "THE ARTICLE" };

const importJob = (status: Job["status"], over: Partial<Job> = {}): Job =>
  ({
    id: "sbv-j1",
    ownerId: READER,
    slug: SLUG,
    title: "A paper, importing",
    steps: ["fetch", "extract"].map((name) => ({ name, label: `The ${name} step`, status: "pending" })),
    status,
    createdAt: "2026-10-06T09:00:00.000Z",
    ...over,
  }) as unknown as Job;

let root: Root | null = null;
let host: HTMLElement | null = null;
let slug = SLUG;
let readerId: string | null = null;

async function show(): Promise<void> {
  if (!root) {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  }
  await act(async () => {
    root?.render(createElement(ArticlePage, { slug, view: "article", readerId }));
  });
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function setVisible(visible: boolean): void {
  Object.defineProperty(document, "visibilityState", { value: visible ? "visible" : "hidden", configurable: true });
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

const text = () => host?.textContent ?? "";
const asked = () => polls.map((p) => p.what);
const checkNow = () => [...(host?.querySelectorAll("button") ?? [])].find((b) => b.textContent?.trim() === "Check now");

beforeEach(async () => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  jobEngine.reset();
  calls = [];
  attempts = [];
  answers = [{ kind: "still-being-added" }];
  polls = [];
  pollAnswer = async () => ({ kind: "still-being-added" });
  queue = [];
  slug = SLUG;
  readerId = null;
  shareKey = null;
  vi.useFakeTimers();
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
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

describe("signed out", () => {
  it("draws the visitor's page at once, and asks for no job list", async () => {
    await show();
    expect(text()).toContain(STILL_BEING_ADDED_HEADING);
    expect(text()).toContain(STILL_BEING_ADDED_VISITOR);
    expect(text()).not.toContain("THE LANDING PAGE");
    expect(checkNow()).toBeDefined();
    expect(calls).toEqual([]);
    expect(asked(), "it asked before ten seconds were up").toEqual([]);
  });

  it("asks again every ten seconds while the tab is visible", async () => {
    await show();
    await advance(RECHECK_MS - 1);
    expect(asked()).toEqual([]);
    await advance(1);
    expect(asked()).toEqual([SLUG]);
    await advance(RECHECK_MS * 2);
    expect(asked()).toEqual([SLUG, SLUG, SLUG]);
    expect(attempts, "still going is not a reason to read the article again").toEqual([0]);
  });

  it("sends the private link's key with every re-ask", async () => {
    shareKey = KEY;
    await show();
    await advance(RECHECK_MS);
    expect(asked()).toEqual([`${SLUG}?key=${KEY}`]);
  });

  it("stops asking while the tab is hidden, and asks at once when it is back", async () => {
    await show();
    setVisible(false);
    await advance(RECHECK_MS * 6);
    expect(asked()).toEqual([]);
    setVisible(true);
    await advance(0);
    expect(asked()).toEqual([SLUG]);
    await advance(RECHECK_MS);
    expect(asked()).toEqual([SLUG, SLUG]);
  });

  it("*Check now* asks at once, and not twice while one is out", async () => {
    let release: (answer: Poll) => void = () => {};
    pollAnswer = () => new Promise<Poll>((resolve) => { release = resolve; });
    await show();
    act(() => checkNow()?.click());
    expect(asked()).toEqual([SLUG]);
    expect(checkNow()?.disabled).toBe(true);
    act(() => checkNow()?.click());
    await advance(RECHECK_MS * 2);
    expect(asked(), "a second request while the first was out").toEqual([SLUG]);
    release({ kind: "still-being-added" });
    await advance(0);
    expect(checkNow()?.disabled).toBe(false);
  });

  it("stops asking once it is unmounted, and abandons the request that was out", async () => {
    pollAnswer = () => new Promise<Poll>(() => {});
    await show();
    await advance(RECHECK_MS);
    expect(asked()).toEqual([SLUG]);
    await act(async () => root?.unmount());
    root = null;
    expect(polls[0]?.signal?.aborted).toBe(true);
    await advance(RECHECK_MS * 6);
    expect(asked()).toEqual([SLUG]);
  });

  it("stops asking about a slug the page has moved on from", async () => {
    pollAnswer = () => new Promise<Poll>(() => {});
    await show();
    await advance(RECHECK_MS);
    slug = "another";
    await show();
    expect(polls[0]?.signal?.aborted).toBe(true);
    pollAnswer = async () => ({ kind: "still-being-added" });
    await advance(RECHECK_MS);
    expect(asked()).toEqual([SLUG, "another"]);
    await advance(RECHECK_MS);
    expect(asked()).toEqual([SLUG, "another", "another"]);
  });

  it("stops asking with a key the address no longer has", async () => {
    shareKey = KEY;
    pollAnswer = () => new Promise<Poll>(() => {});
    await show();
    await advance(RECHECK_MS);
    shareKey = null;
    await show();
    expect(polls[0]?.signal?.aborted).toBe(true);
    pollAnswer = async () => ({ kind: "still-being-added" });
    await advance(RECHECK_MS * 2);
    expect(asked()).toEqual([`${SLUG}?key=${KEY}`, SLUG, SLUG]);
  });

  it("a late answer for the slug it left changes nothing", async () => {
    let release: (answer: Poll) => void = () => {};
    pollAnswer = () => new Promise<Poll>((resolve) => { release = resolve; });
    await show();
    await advance(RECHECK_MS);
    slug = "another";
    await show();
    release({ kind: "ok", body: {} });
    await advance(0);
    expect(attempts, "the old slug's answer re-read the new one").toEqual([0]);
    expect(text()).toContain(STILL_BEING_ADDED_VISITOR);
  });

  it("opens the article when the re-ask says it is published", async () => {
    answers = [{ kind: "still-being-added" }, THE_ARTICLE];
    await show();
    pollAnswer = async () => ({ kind: "ok", body: {} });
    await advance(RECHECK_MS);
    expect(attempts).toEqual([0, 1]);
    expect(text()).toContain("THE ARTICLE");
    await advance(RECHECK_MS * 3);
    expect(asked(), "it went on asking after the article opened").toEqual([SLUG]);
  });

  it("is the landing page when the re-ask says it is not shared: turned off, or the import failed", async () => {
    answers = [{ kind: "still-being-added" }, { kind: "not-shared" }];
    await show();
    pollAnswer = async () => ({ kind: "not-shared" });
    await advance(RECHECK_MS);
    expect(text()).toContain("THE LANDING PAGE");
    expect(text()).not.toContain(STILL_BEING_ADDED_VISITOR);
    await advance(RECHECK_MS * 3);
    expect(asked()).toEqual([SLUG]);
  });

  it("stays, and asks again, when a re-ask fails", async () => {
    await show();
    pollAnswer = async () => new Error("offline");
    await advance(RECHECK_MS);
    expect(text()).toContain(STILL_BEING_ADDED_VISITOR);
    expect(attempts).toEqual([0]);
    await advance(RECHECK_MS);
    expect(asked()).toEqual([SLUG, SLUG]);
  });
});

describe("signed in", () => {
  beforeEach(async () => {
    readerId = READER;
    jobEngine.start(READER);
    await advance(0);
    calls = [];
  });

  it("their own import: the import's card, as for a 404, and no public re-asking", async () => {
    queue = [importJob("running")];
    await show();
    await advance(0);
    expect(text()).toContain(STILL_BEING_ADDED);
    expect(text()).toContain("A paper, importing");
    expect(text()).not.toContain(STILL_BEING_ADDED_VISITOR);
    expect(text()).not.toContain(NOT_SHARED);
    await advance(RECHECK_MS * 3);
    expect(asked()).toEqual([]);
  });

  it("their own import, done: the article is read again", async () => {
    answers = [{ kind: "still-being-added" }, THE_ARTICLE];
    queue = [importJob("running")];
    await show();
    await advance(0);
    queue = [importJob("done", { finishedAt: "2026-10-06T09:01:00.000Z" })];
    await advance(1000);
    expect(text()).toContain("THE ARTICLE");
  });

  it("not theirs: the visitor's page where *Not shared* would have been, after a fresh list", async () => {
    await show();
    await advance(0);
    expect(calls, "the reader's own job list was not asked first").toContain("GET /api/jobs");
    expect(text()).toContain(STILL_BEING_ADDED_VISITOR);
    expect(text()).not.toContain(NOT_SHARED);
    await advance(RECHECK_MS);
    expect(asked()).toEqual([SLUG]);
  });

  it("not theirs, and it publishes: the article", async () => {
    answers = [{ kind: "still-being-added" }, THE_ARTICLE];
    await show();
    await advance(0);
    pollAnswer = async () => ({ kind: "ok", body: {} });
    await advance(RECHECK_MS);
    expect(text()).toContain("THE ARTICLE");
  });

  it("not theirs, and sharing is turned off while they wait: *Not shared*", async () => {
    answers = [{ kind: "still-being-added" }, { kind: "not-shared" }];
    await show();
    await advance(0);
    pollAnswer = async () => ({ kind: "not-shared" });
    await advance(RECHECK_MS);
    await advance(LIST_WAIT_MS);
    expect(text()).toContain(NOT_SHARED);
    expect(text()).not.toContain(STILL_BEING_ADDED_VISITOR);
  });

  it("a job list that cannot be read: the visitor's page, not a blank one", async () => {
    queue = new Error("offline");
    await show();
    await advance(0);
    expect(text()).toContain(STILL_BEING_ADDED_VISITOR);
  });

  it("a plain 404 still says *Not shared* with no job, and never the visitor's page", async () => {
    answers = [{ kind: "not-shared" }];
    await show();
    await advance(0);
    expect(text()).toContain(NOT_SHARED);
    expect(text()).not.toContain(STILL_BEING_ADDED_VISITOR);
    await advance(RECHECK_MS * 2);
    expect(asked()).toEqual([]);
  });
});
