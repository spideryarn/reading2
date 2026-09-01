// @vitest-environment jsdom
/**
 * **The reader can see the job that refused them, and stop it from where they
 * are.**
 *
 * Pressing a band's button on an article that is still importing answers 409.
 * Until 2026-09-01 the whole of that was one sentence — *"That article already
 * has a job running. Wait for it, or stop it first."* — and three separate
 * things stood between the reader and the job it was talking about:
 *
 *  - the generic error handler in src/routes.ts emitted `{ error }` and nothing
 *    else, so no structured field could leave the server;
 *  - `readJson` kept the sentence and dropped the rest of the body;
 *  - `useStepJob` filters the job list down to jobs writing **this** step, and
 *    the blocker is by definition one that does not — so it could not appear in
 *    `JobProgress` however hard the panel tried.
 *
 * A green unit test of the response body would prove none of that. This file
 * runs the real `useJobs`, the real `apiFetch` and the real `readJson` against a
 * stubbed global `fetch`, and mounts a whole page — the pattern
 * tests/refused-job-reason-survives.test.tsx established, and for the same
 * reason: what is under test is how those pieces interact, and a stand-in for
 * any one of them decides the answer.
 *
 * The thread page rather than a hand-built harness, because a harness that
 * calls the hook and renders `JobProgress` itself is a copy of the panel and
 * would stay green while the panel drifted.
 *
 * docs/plans/260831ao-a-stuck-ingest-job-the-reader-can-see-and-clear.md § Stage 6.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ARTICLE_IS_BUSY } from "../src/job-state.js";
import type { Article, Job } from "../src/types.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The auth client, and nothing else from `lib/`. Copied from the file above. */
vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      refreshSession: () => Promise.resolve({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
}));

vi.mock("../src/web/useProfile.js", () => ({ useHasProfile: () => false }));
/* The bottom bar reaches Supabase and the whole visitor layer, and none of it
   is what this file is about. */
vi.mock("../src/web/Dock.js", () => ({ Dock: () => null }));

const { Tweets } = await import("../src/web/Tweets.js");
const { jobEngine } = await import("../src/web/jobEngine.js");
const { blockingJob } = await import("../src/web/useJobs.js");

const ARTICLE = {
  meta: { slug: "constitution", title: "A Constitution", url: "https://example.com/c" },
  blocks: [{ id: "spya-a", kind: "p", text: "some words here" }],
  tree: { rootId: "spya-root", nodes: {} },
} as unknown as Article;

/**
 * The ingest that holds the article. **Nothing in it writes `tweets`**, which
 * is the whole point: this is the job `useStepJob`'s own filter throws away.
 */
function blocker(over: Partial<Job> = {}): Job {
  return {
    id: "spya-blocker",
    ownerId: "00000000-0000-4000-8000-00000000c0de" as Job["ownerId"],
    slug: "constitution",
    status: "running",
    createdAt: new Date(Date.now() - 300_000).toISOString(),
    steps: [
      {
        name: "hierarchy",
        label: "Building the hierarchy",
        status: "running",
        startedAt: new Date(Date.now() - 134_000).toISOString(),
      },
    ],
    ...over,
  };
}

/**
 * What the 409's `blocking` field is allowed to be, and what it is not.
 *
 * The body is our own server's, so the shape is not really in doubt — but an
 * old tab meets a new server, and a cast that is wrong once puts
 * `undefined.steps` inside a render. Checked rather than cast, and the check is
 * what this pins.
 */
it("takes a job out of a refusal only when it really is one", () => {
  const real = blocker();
  expect(blockingJob({ status: 409, details: { blocking: real } })?.id).toBe("spya-blocker");
  /* Everything a stale or hostile body could put there instead. None of them
     may reach a render. */
  expect(blockingJob({ status: 409, details: { blocking: null } })).toBeNull();
  expect(blockingJob({ status: 409, details: { blocking: "spya-blocker" } })).toBeNull();
  expect(blockingJob({ status: 409, details: { blocking: { id: "spya-blocker" } } })).toBeNull();
  expect(blockingJob({ status: 409, details: {} })).toBeNull();
  expect(blockingJob(new Error("no details at all"))).toBeNull();
  expect(blockingJob(null)).toBeNull();
});

/** What `GET /api/jobs` answers with. A test moves it on. */
let listed: Job[] = [];
/** Every request the stub was asked to make. */
let sent: { method: string; url: string }[] = [];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  /* The poller is a tab-level singleton, so it outlives a test the way it
     outlives a route — src/web/jobEngine.ts. */
  jobEngine.reset();
  sent = [];
  listed = [blocker()];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      sent.push({ method, url });
      if (method === "POST" && url === "/api/jobs") {
        /* The refusal, exactly as src/routes.ts writes it: the sentence, and
           the blocking job narrowed by `publicJob`. */
        return json({ error: ARTICLE_IS_BUSY, blocking: blocker() }, 409);
      }
      if (url === "/api/jobs") return json({ jobs: listed });
      if (method === "POST" && url === "/api/jobs/spya-blocker/cancel") {
        return json({ ...blocker(), status: "cancelled" });
      }
      /* No thread for this article yet — the state the button is pressed from. */
      return new Response(null, { status: 404 });
    }),
  );
  jobEngine.start("reader-1");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  jobEngine.reset();
  vi.unstubAllGlobals();
});

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function open(): Promise<void> {
  await act(async () => {
    root.render(createElement(Tweets, { slug: "constitution", article: ARTICLE }));
  });
  await settle();
}

async function pressWrite(): Promise<void> {
  const button = [...host.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === "Write the thread",
  );
  if (!button) throw new Error("the thread page did not render its write button");
  await act(async () => {
    button.click();
    await Promise.resolve();
  });
  await settle();
}

function stopButton(): HTMLButtonElement | undefined {
  return [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Stop"));
}

it("shows the job in the way and lets the reader stop it", async () => {
  await open();
  await pressWrite();

  /* The sentence first — assert the refusal is on screen before asserting
     anything about what is under it. */
  expect(host.textContent).toContain(ARTICLE_IS_BUSY);
  /* And the job itself, in `displayJob`'s words rather than this panel's: the
     blocker is building a hierarchy, it is not "Writing…". */
  expect(host.textContent).toContain("Building the hierarchy");
  expect(host.textContent).not.toContain("Writing…");

  const stop = stopButton();
  expect(stop, "nothing on screen could stop the job that refused the run").toBeDefined();
  await act(async () => {
    stop?.click();
    await Promise.resolve();
  });
  await settle();

  /* Stopped **that** job — the one the 409 named — rather than anything of
     this panel's. */
  expect(sent.some((r) => r.method === "POST" && r.url === "/api/jobs/spya-blocker/cancel")).toBe(
    true,
  );
});

it("lets go of the refusal once the blocker is over", async () => {
  await open();
  await pressWrite();
  expect(host.textContent).toContain(ARTICLE_IS_BUSY);

  /* The blocker settles. Nothing is in the way any more, so a refusal about it
     is no longer true of anything — and the reader is left looking at a
     sentence telling them to wait for something that has finished. */
  listed = [blocker({ status: "cancelled" })];
  await act(async () => {
    jobEngine.poke();
    await Promise.resolve();
  });
  await settle();

  expect(host.textContent).not.toContain(ARTICLE_IS_BUSY);
  expect(host.textContent).not.toContain("Building the hierarchy");
  /* And the button the reader came for is back, which is the whole point of
     letting go. */
  expect(
    [...host.querySelectorAll("button")].some((b) => b.textContent?.trim() === "Write the thread"),
  ).toBe(true);
});
