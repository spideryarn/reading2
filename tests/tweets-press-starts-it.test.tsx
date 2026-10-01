// @vitest-environment jsdom
/**
 * **Opening Tweets writes the thread, whether by a press or a direct arrival.**
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
 * **Since 2026-09-29 it is a mode, not a page** (`?mode=tweets`,
 * docs/plans/260929f-tweets-become-a-mode-with-a-wide-band-and-block-links.md),
 * and the arrival rule came with it — the one mode that breaks *a press spends,
 * arriving does not*, on Greg's word. So this file now asks the three things
 * that rule has to keep true as a mode: it writes on arrival **once per page
 * load**, a failed read **reads again before it spends**, and the one arrival
 * nobody chose — the shelf restoring the last view — **does not carry
 * `?mode=tweets`** (last-view.ts § `NEEDS_AN_EXPLICIT_PRESS`).
 *
 * So everything between the bar and the band is real here: the `Dock` the
 * reading view draws, its mode buttons, and the real `TweetsBand` with its
 * `useTweets`. The harness stands in for `Reader`'s mode state the way
 * tests/modes-that-start-themselves.test.tsx does — a `useState` the Dock's
 * `onMode` sets, read at mount from the address as nuqs would. Only the network
 * and the job queue are posed, for the reason that file gives: what is counted
 * is *whether a job was asked for*.
 *
 * Under a real `<StrictMode>`, so *exactly one* request is the double-effect
 * assertion as well as the ordinary one. And every negative case lets the GET
 * settle first — a "no request" asserted before the band knows whether there is
 * a thread passes on broken code too.
 *
 * docs/plans/260915e-tweets-page-starts-writing-when-opened.md.
 */
import { act, createElement, StrictMode, useState, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type BandMode, isBandMode } from "../src/modes.js";
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
let jobs: Job[] = [];
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
const { TweetsBand } = await import("../src/web/modes/tweets/TweetsMode.js");
const { restoredHref } = await import("../src/web/last-view.js");
const { resetActivations } = await import("../src/web/activation.js");
const { jobEngine } = await import("../src/web/jobEngine.js");

const ARTICLE: Article = {
  highPowerSince: null,
  meta: { slug: SLUG, title: "Writes and Write-Nots", url: "https://paulgraham.com/writes.html" },
  blocks: [],
  assets: undefined,
  navLabelStatus: "ready",
  sourceGuess: undefined,
  tree: { rootId: "spya-root", nodes: {} } as unknown as Article["tree"],
};

/**
 * Moves the reader between modes without a press — Back, Forward, a link from
 * another page. Set by `Reading` on every render.
 */
let arrive: (next: BandMode) => void = () => {};

/** The mode the address names, read once at mount as `Reader`'s query state is. */
function modeInAddress(): BandMode {
  return new URLSearchParams(window.location.search).get("mode") === "tweets" ? "tweets" : "plain";
}

/**
 * `Reader`, as far as this file is concerned: the band is on screen while the
 * mode is `tweets`, beside the real bar whose `onMode` sets it.
 */
function Reading(): ReactElement {
  const [mode, setMode] = useState<BandMode>(modeInAddress);
  arrive = setMode;
  return createElement(
    "div",
    null,
    mode === "tweets"
      ? createElement(TweetsBand, { slug: SLUG, article: ARTICLE, onJump: () => {} })
      : null,
    createElement(Dock, {
      slug: SLUG,
      view: "article" as const,
      mode,
      onMode: (next) => {
        if (isBandMode(next)) setMode(next);
      },
      experimental: EXPERIMENTAL_ON,
    }),
  );
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
    root.render(createElement(StrictMode, null, createElement(Reading)));
  });
  await settle();
}

async function pressTweets(): Promise<void> {
  const button = host.querySelector<HTMLButtonElement>('button[aria-label="Tweets"]');
  if (!button) throw new Error("no Tweets button in the bar");
  await act(async () => {
    button.click();
  });
  await settle();
}

async function arriveIn(mode: BandMode): Promise<void> {
  await act(async () => {
    arrive(mode);
  });
  await settle();
}

const tweetsPosts = () => posts.filter((p) => p.steps.includes("tweets"));

beforeEach(() => {
  threadGets.length = 0;
  posts.length = 0;
  jobs = [];
  nextJobId = 0;
  threadStatus = 404;
  postRefuses = false;
  threadFailsNext = 0;
  resetActivations();
  /* Clears the page load's automatic attempts too, so each case is a fresh
     page load. jobEngine.ts § beginAutoAttempt. */
  jobEngine.reset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("the Tweets band, pressed in the reading view's bar", () => {
  it("writes the thread when there is none — one unforced request", async () => {
    await openAt(`/read/${SLUG}`);
    expect(threadGets).toHaveLength(0);
    await pressTweets();

    expect(host.textContent).toContain("Nobody has written a thread for this one yet.");
    expect(threadGets.length).toBeGreaterThan(0);
    expect(tweetsPosts()).toHaveLength(1);
    expect(tweetsPosts()[0]).toEqual({ slug: SLUG, steps: ["tweets"] });
  });

  it("spends nothing when there is a thread already", async () => {
    threadStatus = 200;
    await openAt(`/read/${SLUG}`);
    await pressTweets();

    expect(threadGets.length).toBeGreaterThan(0);
    /* *Copy the thread*, drawn only once the thread is on screen. (The counts
       line this read until 2026-10-01 is in the band's (i) now, plan 261001m.) */
    expect(host.querySelector('[aria-label="Copy the thread"]')).not.toBeNull();
    expect(posts).toHaveLength(0);
  });

  it("keeps a populated thread scrollable inside the fixed-height band", async () => {
    threadStatus = 200;
    await openAt(`/read/${SLUG}?mode=tweets`);

    const list = host.querySelector(".mode-band.tweets ol");
    const scroll = list?.parentElement;
    expect(scroll).toBeTruthy();
    expect(scroll?.classList.contains("tw:flex-1")).toBe(true);
    expect(scroll?.classList.contains("tw:min-h-0")).toBe(true);
    expect(scroll?.classList.contains("tw:overflow-y-auto")).toBe(true);
  });
});

describe("the Tweets band, arrived in without a press", () => {
  it("writes the thread on a pasted ?mode=tweets too — one unforced request", async () => {
    await openAt(`/read/${SLUG}?mode=tweets`);

    expect(threadGets.length).toBeGreaterThan(0);
    expect(tweetsPosts()).toHaveLength(1);
    expect(tweetsPosts()[0]).toEqual({ slug: SLUG, steps: ["tweets"] });
  });

  it("spends nothing on a pasted link when there is a thread already", async () => {
    threadStatus = 200;
    await openAt(`/read/${SLUG}?mode=tweets`);

    expect(threadGets.length).toBeGreaterThan(0);
    /* *Copy the thread*, drawn only once the thread is on screen. (The counts
       line this read until 2026-10-01 is in the band's (i) now, plan 261001m.) */
    expect(host.querySelector('[aria-label="Copy the thread"]')).not.toBeNull();
    expect(posts).toHaveLength(0);
  });

  it("reads again once after a failed read, and writes if that says there is none", async () => {
    /* A failed read is not an answer to *is there a thread*: spending on it
       would buy a second thread for an article that may already have one. */
    threadFailsNext = 1;
    await openAt(`/read/${SLUG}?mode=tweets`);

    expect(threadGets).toHaveLength(2);
    expect(tweetsPosts()).toHaveLength(1);
  });

  it("does not loop when the read keeps failing, and spends nothing", async () => {
    threadFailsNext = 99;
    await openAt(`/read/${SLUG}?mode=tweets`);

    expect(threadGets).toHaveLength(2);
    expect(posts).toHaveLength(0);
  });

  it("does not post again when an accepted job later fails", async () => {
    await openAt(`/read/${SLUG}?mode=tweets`);
    expect(tweetsPosts()).toHaveLength(1);

    jobs = [
      {
        id: "job1",
        ownerId: "owner" as Job["ownerId"],
        slug: SLUG,
        steps: [
          {
            name: "tweets",
            label: "Writing the thread",
            status: "error",
            error: "The accepted job failed.",
          },
        ],
        status: "error",
        error: "The accepted job failed.",
        createdAt: "2026-09-16T00:00:00.000Z",
        finishedAt: "2026-09-16T00:00:01.000Z",
      },
    ];
    await act(async () => {
      root.render(createElement(StrictMode, null, createElement(Reading)));
    });
    await settle();

    expect(host.textContent).toContain("The accepted job failed.");
    expect(tweetsPosts()).toHaveLength(1);
  });

  it("tries once per page load: a second arrival after a refused run leaves the button", async () => {
    postRefuses = true;
    await openAt(`/read/${SLUG}?mode=tweets`);
    expect(tweetsPosts()).toHaveLength(1);

    /* Away and back without a press — Back, Forward, a link from Metadata. The
       band unmounts and mounts again, and the one automatic attempt is spent,
       so this is a person's button now and not a loop. */
    await arriveIn("plain");
    expect(host.textContent).not.toContain("Nobody has written a thread for this one yet.");
    await arriveIn("tweets");

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

describe("the shelf restoring the last view", () => {
  /* The one arrival that is not intent. A reader who last left the article in
     Tweets and comes back to it from the shelf is restored to where they were
     reading — not handed a model call. */
  it("drops ?mode=tweets from the restored address, and so spends nothing", async () => {
    const restored = restoredHref(`/read/${SLUG}`, "", "?at=spya-a&mode=tweets");
    expect(restored).toBe(`/read/${SLUG}?at=spya-a`);
    if (restored === null) throw new Error("nothing restored");

    await openAt(restored);
    expect(threadGets).toHaveLength(0);
    expect(posts).toHaveLength(0);
  });

  it("the positive control: the same address with the mode left in writes the thread", async () => {
    /* Without this the case above would pass on a harness that never mounted
       the band from the address at all. */
    await openAt(`/read/${SLUG}?at=spya-a&mode=tweets`);
    expect(tweetsPosts()).toHaveLength(1);
  });
});
