// @vitest-environment jsdom
/**
 * **Pressing Tweets writes the thread. Arriving at the page does not.**
 *
 * > The Tweets mode should automatically start generating (if it hasn't already
 * > generated) when opened (without having to click a button to kick it off)
 * >
 * > — Greg, 2026-09-12 (SPIDERYARN-READING2-3J)
 *
 * From 2026-09-06 the page wrote only on a **press** — a token the bar's link
 * minted (docs/plans/260906b-opening-a-mode-starts-it-generating.md § Stage 2)
 * — so a reload, a pasted link or Back got a page with a button on it, which is
 * what Greg met. Since 2026-09-15 it writes on **arrival**, however the owner
 * got there (src/web/useAutoRun.ts § `useAutoRunOnArrival`). 260906b had
 * promised a mount-vs-press test for this page; it never landed, and this file
 * is it, turned round.
 *
 * So everything between the bar and the page is real here: the `Dock` the
 * reading view draws, `Link`, `navigate()`, `useRoute`, and the `Tweets` page
 * itself. Only the network and the job queue are posed, for the reason
 * tests/modes-that-start-themselves.test.tsx gives: what is counted is
 * *whether a job was asked for*.
 *
 * Under a real `<StrictMode>`, so *exactly one* request is the double-effect
 * assertion as well as the ordinary one. And every negative case lets the GET
 * settle first — a "no request" asserted before the page knows whether there is
 * a thread passes on broken code too.
 *
 * docs/plans/260915e-tweets-page-starts-writing-when-opened.md.
 */
import { act, createElement, StrictMode, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Article, Job, TweetThread } from "../src/types.js";
import { EXPERIMENTAL_ON } from "./helpers/experimental-fixtures.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class NoResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
Object.assign(globalThis, { ResizeObserver: NoResizeObserver });
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  }),
});
window.scrollTo = () => {};

const SLUG = "writes";

/* ------------------------------------------------------------ the network -- */

/** Every thread GET, in order. */
const threadGets: string[] = [];
/** Every job request the queue was asked for, in order. */
const posts: { slug: string; steps: string[]; force?: string[] }[] = [];
/** What `GET /api/tweets/:slug` answers: 404 is "nobody has written one yet". */
let threadStatus = 404;
/** How many thread GETs, from now, reject outright — a dead network, not a 404. */
let threadFailsNext = 0;

const THREAD: TweetThread = {
  version: "tweets/1",
  generator: "claude-opus-5",
  slug: SLUG,
  sourceHash: "1ee2ebde490b347e",
  limit: 280,
  tweets: [{ text: "one", chars: 3 }],
  generatedAt: "2026-08-25T12:12:58.535Z",
  elapsedMs: 6136,
};

vi.mock("../src/web/lib/api.js", () => ({
  apiFetch: async (url: string) => {
    if (url.startsWith("/api/tweets/")) {
      threadGets.push(url);
      if (threadFailsNext > 0) {
        threadFailsNext -= 1;
        throw new TypeError("Failed to fetch");
      }
      return threadStatus === 404
        ? new Response(null, { status: 404 })
        : new Response(JSON.stringify({ thread: THREAD, stale: false, profileChanged: false }), {
            status: 200,
          });
    }
    return new Response(null, { status: 404 });
  },
  readJson: async (res: Response) => res.json(),
  fetchOk: async () => new Response(null, { status: 204 }),
  failure: async (res: Response) => new Error(String(res.status)),
}));

let nextJobId = 0;
const jobs: Job[] = [];
/** Whether the queue refuses, so the automatic attempt can be made to fail. */
let postRefuses = false;

vi.mock("../src/web/useJobs.js", async () => {
  const actual =
    await vi.importActual<typeof import("../src/web/useJobs.js")>("../src/web/useJobs.js");
  return {
    ...actual,
    useJobs: () => ({
      jobs,
      loaded: true,
      error: null,
      driverFailures: {},
      lastFailure: () => "The queue said no.",
      run: async (request: { slug: string; steps: string[]; force?: string[] }) => {
        posts.push(request);
        if (postRefuses) return null;
        nextJobId += 1;
        return { id: `job${nextJobId}` };
      },
      cancel: async () => {},
      add: async () => null,
      addUpload: async () => null,
      retry: async () => {},
      forget: async () => {},
    }),
  };
});

const { Dock } = await import("../src/web/Dock.js");
const { Tweets } = await import("../src/web/Tweets.js");
const { useRoute } = await import("../src/web/router.js");
const { resetActivations } = await import("../src/web/activation.js");
const { jobEngine } = await import("../src/web/jobEngine.js");

const ARTICLE: Article = {
  meta: { slug: SLUG, title: "Writes and Write-Nots", url: "https://paulgraham.com/writes.html" },
  blocks: [],
  assets: undefined,
  navLabelStatus: "ready",
  tree: { rootId: "spya-root", nodes: {} } as unknown as Article["tree"],
};

/**
 * `OwnedArticle`, as far as this file is concerned: the real route decides
 * whether the reading view's bar or the thread page is on screen, exactly as
 * ArticlePage.tsx does with `view`.
 */
function Page(): ReactElement {
  const route = useRoute();
  const view = route.kind === "read" ? route.view : "article";
  if (view === "tweets") return createElement(Tweets, { slug: SLUG, article: ARTICLE });
  return createElement(Dock, {
    slug: SLUG,
    view: "article" as const,
    mode: "plain",
    onMode: () => {},
    experimental: EXPERIMENTAL_ON,
  });
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

async function openAt(path: string): Promise<void> {
  window.history.replaceState(null, "", path);
  await act(async () => {
    root.render(createElement(StrictMode, null, createElement(Page)));
  });
  await settle();
}

async function pressTweets(): Promise<void> {
  const link = host.querySelector<HTMLAnchorElement>('a[aria-label="Tweets"]');
  if (!link) throw new Error("no Tweets link in the bar");
  await act(async () => {
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
  });
  await settle();
}

const tweetsPosts = () => posts.filter((p) => p.steps.includes("tweets"));

beforeEach(() => {
  threadGets.length = 0;
  posts.length = 0;
  jobs.length = 0;
  nextJobId = 0;
  threadStatus = 404;
  postRefuses = false;
  threadFailsNext = 0;
  resetActivations();
  jobEngine.reset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("the Tweets page, reached from the reading view's bar", () => {
  it("writes the thread when there is none — one unforced request", async () => {
    await openAt(`/read/${SLUG}`);
    await pressTweets();

    expect(window.location.pathname).toBe(`/read/${SLUG}/tweets`);
    expect(threadGets.length).toBeGreaterThan(0);
    expect(tweetsPosts()).toHaveLength(1);
    expect(tweetsPosts()[0]).toEqual({ slug: SLUG, steps: ["tweets"] });
  });

  it("spends nothing when there is a thread already", async () => {
    threadStatus = 200;
    await openAt(`/read/${SLUG}`);
    await pressTweets();

    expect(threadGets.length).toBeGreaterThan(0);
    expect(host.textContent).toContain("A thread, 1 post");
    expect(posts).toHaveLength(0);
  });
});

describe("the Tweets page, arrived at without a press", () => {
  it("writes the thread on a pasted link too — one unforced request", async () => {
    await openAt(`/read/${SLUG}/tweets`);

    expect(threadGets.length).toBeGreaterThan(0);
    expect(tweetsPosts()).toHaveLength(1);
    expect(tweetsPosts()[0]).toEqual({ slug: SLUG, steps: ["tweets"] });
  });

  it("spends nothing on a pasted link when there is a thread already", async () => {
    threadStatus = 200;
    await openAt(`/read/${SLUG}/tweets`);

    expect(threadGets.length).toBeGreaterThan(0);
    expect(host.textContent).toContain("A thread, 1 post");
    expect(posts).toHaveLength(0);
  });

  it("reads again once after a failed read, and writes if that says there is none", async () => {
    threadFailsNext = 1;
    await openAt(`/read/${SLUG}/tweets`);

    expect(threadGets).toHaveLength(2);
    expect(tweetsPosts()).toHaveLength(1);
  });

  it("does not loop when the read keeps failing, and spends nothing", async () => {
    threadFailsNext = 99;
    await openAt(`/read/${SLUG}/tweets`);

    expect(threadGets).toHaveLength(2);
    expect(posts).toHaveLength(0);
  });

  it("tries once per tab: a second arrival after a refused run leaves the button", async () => {
    postRefuses = true;
    await openAt(`/read/${SLUG}/tweets`);
    expect(tweetsPosts()).toHaveLength(1);

    /* Away and back — Back, Forward, or the link again. The one automatic
       attempt is spent, so this is a person's button now and not a loop. */
    await act(async () => {
      window.history.pushState(null, "", `/read/${SLUG}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await settle();
    await act(async () => {
      window.history.pushState(null, "", `/read/${SLUG}/tweets`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await settle();

    expect(tweetsPosts()).toHaveLength(1);
    expect(host.textContent).toContain("Nobody has written a thread for this one yet.");

    /* The positive control: the harness can see a second request at all. */
    postRefuses = false;
    const button = [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Write the thread"),
    );
    if (!button) throw new Error("no Write the thread button");
    await act(async () => button.click());
    await settle();
    expect(tweetsPosts()).toHaveLength(2);
  });
});
