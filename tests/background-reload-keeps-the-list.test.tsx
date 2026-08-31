// @vitest-environment jsdom
/**
 * **A failed background reload must not take the artefact off the screen.**
 *
 * `useGlossary` learned this on 2026-08-28 (commit 43a8285, after a GPT Sol
 * review of the built code): the panel renders its entries only when `status`
 * is `ready`, so an unconditional `setStatus("error")` in the catch meant a
 * reader on a flaky connection watched a perfectly good list vanish and be
 * replaced by a message. The guard it grew is
 * `setStatus((was) => (was === "loading" ? "error" : was))` — only the opening
 * read has nothing to fall back on.
 *
 * Three hooks were copied from that one **before** the guard landed, and none
 * of them had it: `useSummaries` (26 Aug, deleted 2026-08-31 with the summary
 * ladder), `useIdeas` (27 Aug) and the thread page's own loader in
 * `Tweets.tsx`. Two of the three were live bugs, because `load()` is not only
 * the opening read — every one of them calls it again from `onFinished`
 * whenever a job that writes their artefact completes.
 *
 * ## Why the tests are shaped the way they are
 *
 * **The replies are held**, exactly as `tests/glossary-one-fetch.test.tsx`
 * holds them. A mock that resolves the moment it is called cannot tell "did not
 * blank the list" from "blanked it and refilled it inside the same `act`" —
 * docs/reusable/silent-success.md.
 *
 * **The reload is driven through `onFinished`, not by calling `load()`.** A
 * GPT Sol review asked for the real sequence: a list arrives, a matching job
 * finishes, the background GET fails, and the list is still there. Calling the
 * loader directly would pass with the job-completion callback unwired, which is
 * the only thing that makes this reachable by a reader at all.
 *
 * **Each surface keeps a sibling test for the opening read**, so the first
 * cannot pass by simply never reporting a failure.
 *
 * The other half of the file is `useIdeas.failed`, which told the reader
 * something false: any throw out of `queue.run` — including a 4xx or 5xx that
 * the server sent back with a reason — was reported as *"The request did not
 * reach the server."*, and the server's own message was dropped. Its three
 * siblings all say `queue.error ?? "Couldn't start the job."`.
 *
 * Written against the hooks rather than the reading view, for the reason
 * `tests/glossary-one-fetch.test.tsx` gives: mounting `Reader` drags in nuqs,
 * Supabase and the layout. `Tweets` is a page and is mounted whole, with only
 * the Dock stubbed.
 */
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Article, Ideas, TweetThread } from "../src/types.js";

/* React only permits `act` when the environment says it is a test one. Without
   this every render below still runs, and warns, and the effects it is meant to
   flush may not have — a green test over work that never happened. */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Every `/api/` request the renders below made, in order. */
const asked: string[] = [];
/** Whether the next reply is a dead network rather than an answer. */
let fails = false;
/** Replies, held until a test lets them go. See the header. */
const held: Array<() => void> = [];

/** What each artefact endpoint would return **right now**. Tests mutate these. */
let ideaNames = ["ideas are cheap"];
let tweetTexts = ["the first post"];

function ideasArtefact(slug: string): Ideas {
  return {
    version: "ideas/1",
    generator: "test",
    slug,
    sourceHash: "abc",
    profileHash: null,
    ideas: ideaNames.map((name, i) => ({
      id: `spya-idea${i}`,
      name,
      provenance: "assumed",
      statement: name,
      blocks: [],
    })),
    generatedAt: "2026-08-28T00:00:00.000Z",
    elapsedMs: 1,
  } as unknown as Ideas;
}


function threadArtefact(slug: string): TweetThread {
  return {
    version: "tweets/1",
    generator: "test",
    slug,
    sourceHash: "abc",
    profileHash: null,
    limit: 280,
    tweets: tweetTexts.map((text) => ({ text, chars: [...text].length })),
    generatedAt: "2026-08-28T00:00:00.000Z",
    elapsedMs: 1,
  } as unknown as TweetThread;
}

/**
 * The body is decided when the request **arrives**, not when it is answered —
 * which is what a server does, and what makes a held reply describe the world
 * as it was at the moment of asking rather than the world after the test moved
 * it. Copied from `tests/glossary-one-fetch.test.tsx`, where getting it the
 * other way round made two tests tautologies.
 */
function bodyFor(url: string): string {
  const slug = url.split("/").pop() ?? "";
  if (url.startsWith("/api/ideas/")) {
    return JSON.stringify({
      ideas: ideasArtefact(slug),
      stale: false,
      outdated: false,
      profileChanged: false,
    });
  }

  if (url.startsWith("/api/tweets/")) {
    return JSON.stringify({ thread: threadArtefact(slug), stale: false, profileChanged: false });
  }
  throw new Error(`the test made an unexpected request: ${url}`);
}

vi.mock("../src/web/lib/api.js", () => ({
  apiFetch: async (input: string) => {
    asked.push(input);
    const body = bodyFor(input);
    const dead = fails;
    await new Promise<void>((go) => held.push(go));
    if (dead) throw new TypeError("Failed to fetch");
    return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
  },
  leavingFetch: async () => undefined,
  readJson: async (res: Response) => res.json(),
  failure: async (res: Response) => new Error(String(res.status)),
}));

/**
 * The job poller, posed by the test rather than polling.
 *
 * `finishJob` below is what a completed run looks like arriving — the seam the
 * background reload hangs off, and the one a test that called `load()` directly
 * would leave unexercised.
 */
let onFinished: ((job: { slug: string; status: string; steps: { name: string }[] }) => void) | null =
  null;
/** What `queue.run` hands back, and what `queue.error` says. Set by the tests that care. */
let runResult: { id: string } | null = { id: "job1" };
let queueError: string | null = null;
vi.mock("../src/web/useJobs.js", () => ({
  useJobs: (cb?: (job: never) => void) => {
    onFinished = (cb ?? null) as typeof onFinished;
    return {
      jobs: [],
      loaded: true,
      error: queueError,
      /* The durable half of the same fact — the real hook keeps it in a ref
         that no poll can clear, and the surfaces read *this* rather than
         `error` (src/web/useJobs.ts § `lastFailure`). A posed queue does not
         poll, so the two are indistinguishable here; that is exactly what
         `tests/refused-job-reason-survives.test.tsx` exists to say, and it is
         why this mock has to carry both rather than only the one it is asked
         for. */
      lastFailure: () => queueError,
      run: async () => runResult,
      cancel: async () => {},
    };
  },
}));

/* Needs a session and a slug; the answer changes nothing under test here. */
vi.mock("../src/web/useProfile.js", () => ({ useHasProfile: () => false }));

/* The thread page's bottom bar reaches Supabase and the whole visitor layer,
   and none of it is what this file is about. */
vi.mock("../src/web/Dock.js", () => ({ Dock: () => null }));

const { useIdeas } = await import("../src/web/useIdeas.js");
const { Tweets } = await import("../src/web/Tweets.js");

/** A job for this article, landing in the hook's poll as finished. */
function finishJob(step: string, slug = "constitution"): void {
  onFinished?.({ slug, status: "done", steps: [{ name: step }] });
}

let ideasHook: ReturnType<typeof useIdeas> | null = null;

/**
 * What `IdeasPanel` does: the list is on screen **only** in the ready branch
 * (src/web/IdeasPanel.tsx § `status === "ready" && ideas`). That gate is what
 * turns an unconditional `error` into a list disappearing.
 */
function IdeasHarness({ slug }: { slug: string }): ReactElement {
  const all = useIdeas(slug);
  ideasHook = all;
  const names = all.ideas?.ideas.map((i) => i.name).join(",") ?? "";
  return createElement("aside", null, all.status === "ready" && all.ideas ? names : all.status);
}



const ARTICLE = {
  meta: { slug: "constitution", title: "A Constitution", url: "https://example.com/c" },
  blocks: [{ id: "spya-a", kind: "p", text: "some words here" }],
  tree: { rootId: "spya-root", nodes: {} },
} as unknown as Article;

let host: HTMLDivElement;
let root: Root;

function asks(prefix: string): number {
  return asked.filter((u) => u.startsWith(prefix)).length;
}

beforeEach(() => {
  asked.length = 0;
  held.length = 0;
  onFinished = null;
  ideasHook = null;
  fails = false;
  runResult = { id: "job1" };
  queueError = null;
  ideaNames = ["ideas are cheap"];
  tweetTexts = ["the first post"];
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** Render, and let the effects run — but do not answer anything yet. */
async function render(el: ReactElement): Promise<void> {
  await act(async () => {
    root.render(el);
  });
}

/** Answer every request now in flight, and let the renders it causes finish. */
async function settle(): Promise<void> {
  await act(async () => {
    for (const go of held.splice(0).reverse()) go();
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

describe("the ideas panel", () => {
  it("keeps the list when the reload after a job fails", async () => {
    await render(createElement(IdeasHarness, { slug: "constitution" }));
    await settle();
    expect(host.querySelector("aside")?.textContent).toBe("ideas are cheap");

    /* The real sequence: a job that writes ideas finishes, `onFinished` fires,
       and the GET it starts dies on the way out. The list on screen is still
       the truth about the article — it just may no longer be the newest truth. */
    fails = true;
    await act(async () => {
      finishJob("ideas");
    });
    /* The reload really happened; without this the test would pass on a hook
       whose `onFinished` was never wired to anything. */
    expect(asks("/api/ideas/")).toBe(2);
    await settle();

    expect(ideasHook?.status).toBe("ready");
    expect(ideasHook?.error).toContain("Failed to fetch");
    expect(host.querySelector("aside")?.textContent).toBe("ideas are cheap");
  });

  it("still reports a failure that leaves us with nothing", async () => {
    /* The other half, so the test above cannot pass by never reporting an error
       at all: the opening read has no list to fall back on. */
    fails = true;
    await render(createElement(IdeasHarness, { slug: "constitution" }));
    await settle();
    expect(ideasHook?.status).toBe("error");
  });
});

describe("the thread page", () => {
  it("keeps the thread when the reload after a job fails", async () => {
    await render(createElement(Tweets, { slug: "constitution", article: ARTICLE }));
    await settle();
    expect(host.textContent).toContain("the first post");

    fails = true;
    await act(async () => {
      finishJob("tweets");
    });
    expect(asks("/api/tweets/")).toBe(2);
    await settle();

    /* The thread renders only in the `ready` branch of a discriminated union,
       so replacing the whole union with `{status:"error"}` took the posts off
       the page — and the reader was left with a message where the thread was. */
    expect(host.textContent).toContain("the first post");
    /* ...and the failure is still said out loud. It has to be said somewhere:
       the job finished, so `JobProgress` has gone quiet, and a reader who saw a
       run complete and the page not change would have nothing to go on.

       **Matched on the code, not the sentence, and not on the raw error.** This
       used to assert "Failed to fetch" — which is what the page was showing the
       reader, and the thing docs/project/copy.md § the four rules exists to
       stop. The browser's own exception now goes to the console; the code is
       what a rewritten sentence has to keep. */
    expect(host.textContent).toMatch(/\[rd-recheck\]/);
    expect(host.textContent).not.toContain("Failed to fetch");
  });

  it("still reports a failure that leaves us with nothing", async () => {
    fails = true;
    await render(createElement(Tweets, { slug: "constitution", article: ARTICLE }));
    await settle();
    expect(host.textContent).toContain("Failed to fetch");
    expect(host.textContent).not.toContain("the first post");
    /* **Once, not twice.** The opening read sets both the `error` branch and
       the recheck line, and only the first may render — a reader whose very
       first read failed is not also being told we could not check for a newer
       version of a thread they have never seen. */
    expect(host.textContent).not.toContain("[rd-recheck]");
  });
});

describe("a job the server received and refused", () => {
  /* `queue.run` returns null for **any** throw out of the POST, including
     `readJson` throwing on a 4xx or 5xx (src/web/useJobs.ts § `act`). So
     `postFailed` does not mean "the request never landed" — it means "we have
     no job", and the two have different sentences. The other three surfaces
     read `queue.error`, which carries what the server actually said. */
  it("says what the server said, not that the request never landed", async () => {
    await render(createElement(IdeasHarness, { slug: "constitution" }));
    await settle();

    runResult = null;
    queueError = "You are out of credit for today.";
    await act(async () => {
      await ideasHook?.find();
    });

    expect(ideasHook?.failed).toBe("You are out of credit for today.");
  });

  it("falls back to a sentence of its own when the queue has no message", async () => {
    await render(createElement(IdeasHarness, { slug: "constitution" }));
    await settle();

    runResult = null;
    queueError = null;
    await act(async () => {
      await ideasHook?.find();
    });

    expect(ideasHook?.failed).toBe("Couldn't start the job.");
  });
});
