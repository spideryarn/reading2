// @vitest-environment jsdom
/**
 * **Summary's Thread view: what opens it, what that spends, and what it must
 * never leave behind.**
 *
 * The thread was the Tweets mode until 2026-10-03, when Greg asked for it as
 * one of three choices inside Summary — Brief | Fuller | Thread — with *"all of
 * the tweet thread. Functionality and UI"* kept (spya-thpsnd,
 * docs/plans/261003l-fewer-top-level-modes-tweets-become-summary-s-thread.md).
 * This file was tests/tweets-press-starts-it.test.tsx, and it still holds what
 * that one held:
 *
 * > The Tweets mode should automatically start generating (if it hasn't already
 * > generated) when opened (without having to click a button to kick it off)
 * >
 * > — Greg, 2026-09-12 (SPIDERYARN-READING2-3J)
 *
 * So the thread writes on **arrival**, however its owner got there
 * (src/web/useAutoRun.ts § `useAutoRunOnArrival`), **once per page load**, a
 * failed read **reads again before it spends**, and the one arrival nobody
 * chose — the shelf restoring the last view — **does not open it**
 * (last-view.ts § `opensTheThread`).
 *
 * And it holds what moving under Summary added, each a finding of GPT Sol's
 * plan review:
 *
 *  - a press that lands on the thread arms **nothing** — the plain-words
 *    lengths' `simple` token would have no `useSimple` to claim it, and Back
 *    onto Brief would spend it (decision 6);
 *  - that stays true in the ~50ms after a press when React says Thread and the
 *    address still says Brief (**F1**, the P0);
 *  - pressing the Summary bar button while Summary is showing **closes** the
 *    band and arms nothing, on either view (**F6**).
 *
 * Everything between the bar and the bands is real: the `Dock` the reading
 * view draws, its command bar, the real `SummaryBand` with its segmented
 * control, `useSimple` and `useTweets`, and real nuqs with its late address
 * flush. The harness stands in for `Reader` only — the query state it holds,
 * the `summary` it hands the bar, and its `onMode`. Only the network and the
 * job queue are posed: what is counted is *whether a job was asked for*.
 *
 * Under a real `<StrictMode>`, so *exactly one* request is the double-effect
 * assertion as well as the ordinary one. And every negative case lets the GET
 * settle first — a "no request" asserted before the band knows whether there is
 * anything stored passes on broken code too.
 *
 * docs/plans/260915e-tweets-page-starts-writing-when-opened.md.
 */
import { act, createElement, StrictMode, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useQueryStates } from "nuqs";
import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isBandMode } from "../src/modes.js";
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

enableHistorySync();

const SLUG = "writes";

/* ------------------------------------------------------------ the network -- */

/** Every thread GET, in order. */
const threadGets: string[] = [];
/** Every plain-words GET, in order. */
const simpleGets: string[] = [];
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
    /* Nobody has written the plain-words lengths: every case here is about
       whether a press, or a navigation, asks for them. */
    if (url.startsWith("/api/simple/")) simpleGets.push(url);
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
const { SummaryBand } = await import("../src/web/modes/summary/SummaryMode.js");
const { restoredHref } = await import("../src/web/last-view.js");
const { pendingActivation, resetActivations } = await import("../src/web/activation.js");
const { jobEngine } = await import("../src/web/jobEngine.js");
const { modeParam, summaryParam } = await import("../src/web/params.js");
const { subModeParams } = await import("../src/web/sub-modes.js");

const ARTICLE: Article = {
  highPowerSince: null,
  titleOverridden: false,
  meta: { slug: SLUG, title: "Writes and Write-Nots", url: "https://paulgraham.com/writes.html" },
  blocks: [],
  assets: undefined,
  navLabelStatus: "ready",
  sourceGuess: undefined,
  tree: { rootId: "spya-root", nodes: {} } as unknown as Article["tree"],
};

/**
 * **Whether the harness hands the bar the parsed view**, as `Reader` does
 * (`<Dock summary>`). Turned off by one case only, as the control that shows
 * the F1 test can fail: without it the bar reads the address, which lags.
 */
let handsTheBarItsView = true;

/**
 * `Reader`, as far as this file is concerned: the two parameters as nuqs state,
 * Summary's band while the mode is `summary`, and the real bar, whose `onMode`
 * writes them the way `Reader`'s does — a sub-mode row in one push, a second
 * press on the bar's own button closing the band.
 */
function Reading(): ReactElement {
  const [nav, setNav] = useQueryStates({ mode: modeParam, summary: summaryParam });
  return createElement(
    "div",
    null,
    nav.mode === "summary"
      ? createElement(SummaryBand, { slug: SLUG, article: ARTICLE, onJump: () => {} })
      : null,
    createElement(Dock, {
      slug: SLUG,
      view: "article" as const,
      mode: nav.mode,
      ...(handsTheBarItsView ? { summary: nav.summary } : {}),
      onMode: (next, sub, toggle = false) => {
        if (sub !== undefined) {
          const { mode, summary } = subModeParams(sub);
          if (isBandMode(mode)) void setNav({ mode, summary: summary ?? null }, { history: "push" });
          return;
        }
        if (!isBandMode(next)) return;
        if (next === nav.mode) {
          if (toggle) void setNav({ mode: null }, { history: "push" });
          return;
        }
        void setNav({ mode: next }, { history: "push" });
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

/** Real time, for nuqs's delayed address write and jsdom's asynchronous Back. */
async function until(check: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 100 && !check(); i += 1) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 10));
    });
  }
  expect(check(), what).toBe(true);
  await settle();
}

const inAddress = (name: string): string | null => new URLSearchParams(location.search).get(name);

async function openAt(path: string): Promise<void> {
  window.history.replaceState(null, "", path);
  await act(async () => {
    root.render(createElement(StrictMode, null, createElement(NuqsAdapter, null, createElement(Reading))));
  });
  await settle();
}

function click(button: HTMLElement | null | undefined, what: string): void {
  if (!button) throw new Error(`no ${what}`);
  act(() => button.click());
}

const barButton = (): HTMLButtonElement | null =>
  host.querySelector<HTMLButtonElement>('.dock button[aria-label="Summary"], button[aria-label="Summary"]');
const segment = (label: string): HTMLButtonElement | undefined =>
  [...host.querySelectorAll<HTMLButtonElement>('.summ-views [role="radio"]')].find(
    (b) => b.textContent === label,
  );

async function pressSummary(): Promise<void> {
  click(barButton(), "Summary button in the bar");
  await settle();
}

async function pressSegment(label: string): Promise<void> {
  click(segment(label), `${label} segment`);
  await settle();
}

/** The command bar's Summary *mode* row, taken with Enter. Synchronous: no flush in between. */
function takeSummaryInTheCommandBar(): void {
  click(host.querySelector<HTMLButtonElement>(".dock-commands"), "command-bar button");
  const input = host.querySelector<HTMLInputElement>("dialog.cmdbar input.cmdbar-input");
  if (!input) throw new Error("no command bar input");
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(input, "summary");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const first = host.querySelector<HTMLElement>('dialog.cmdbar [role="option"]');
  expect(first?.dataset.kind, "the first row for `summary` is the mode's own").toBe("mode");
  act(() => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  });
}

const stepPosts = (step: string) => posts.filter((p) => p.steps.includes(step));
const tweetsPosts = () => stepPosts("tweets");
const simplePosts = () => stepPosts("simple");
const NO_THREAD = "Nobody has written a thread for this one yet.";

beforeEach(() => {
  /* jsdom dialogs do nothing by themselves; the command bar needs them to open. */
  const proto = window.HTMLDialogElement?.prototype;
  if (proto) {
    proto.showModal = function showModal(this: HTMLDialogElement) {
      this.open = true;
    };
    proto.close = function close(this: HTMLDialogElement) {
      this.open = false;
      this.dispatchEvent(new Event("close"));
    };
  }
  threadGets.length = 0;
  simpleGets.length = 0;
  posts.length = 0;
  jobs = [];
  nextJobId = 0;
  threadStatus = 404;
  postRefuses = false;
  threadFailsNext = 0;
  handsTheBarItsView = true;
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

describe("the Thread segment, pressed inside Summary", () => {
  it("writes the thread when there is none — one unforced request, and no plain-words token", async () => {
    /* Arrived in Summary at Brief by a link: nothing armed, nothing posted. */
    await openAt(`/read/${SLUG}?mode=summary`);
    expect(simpleGets.length).toBeGreaterThan(0);
    expect(posts).toHaveLength(0);

    await pressSegment("Thread");

    expect(host.textContent).toContain(NO_THREAD);
    expect(threadGets.length).toBeGreaterThan(0);
    expect(posts).toEqual([{ slug: SLUG, steps: ["tweets"] }]);
    expect(pendingActivation(SLUG, "simple")).toBeNull();
    expect(pendingActivation(SLUG, "tweets")).toBeNull();
  });

  it("spends nothing when there is a thread already", async () => {
    threadStatus = 200;
    await openAt(`/read/${SLUG}?mode=summary`);
    await pressSegment("Thread");

    expect(threadGets.length).toBeGreaterThan(0);
    /* *Copy the thread*, drawn only once the thread is on screen. */
    expect(host.querySelector('[aria-label="Copy the thread"]')).not.toBeNull();
    expect(posts).toHaveLength(0);
  });

  it("keeps the control in the band's first row in both views, with the chosen one checked", async () => {
    threadStatus = 200;
    await openAt(`/read/${SLUG}?mode=summary`);
    const checked = () =>
      [...host.querySelectorAll('.summ-views [role="radio"]')]
        .filter((b) => b.getAttribute("aria-checked") === "true")
        .map((b) => b.textContent);
    /* The row after the band's corner (i), in either view. */
    const firstRow = () =>
      [...(host.querySelector(".mode-band")?.children ?? [])].find((el) => !el.classList.contains("band-about"));
    expect(firstRow()?.className).toBe("summ-controls");
    expect(checked()).toEqual(["Brief"]);

    await pressSegment("Thread");
    expect(host.querySelector(".mode-band.tweets")).not.toBeNull();
    expect(firstRow()?.className).toBe("summ-controls");
    expect(firstRow()?.querySelector('[role="radiogroup"]')).not.toBeNull();
    expect(checked()).toEqual(["Thread"]);
    /* *Copy the thread* is the row under it, not above. */
    expect(firstRow()?.nextElementSibling?.querySelector('[aria-label="Copy the thread"]')).not.toBeNull();
  });

  it("keeps a populated thread scrollable inside the fixed-height band", async () => {
    threadStatus = 200;
    await openAt(`/read/${SLUG}?mode=summary&summary=thread`);

    const list = host.querySelector(".mode-band.tweets ol");
    const scroll = list?.parentElement;
    expect(scroll).toBeTruthy();
    expect(scroll?.classList.contains("tw:flex-1")).toBe(true);
    expect(scroll?.classList.contains("tw:min-h-0")).toBe(true);
    expect(scroll?.classList.contains("tw:overflow-y-auto")).toBe(true);
  });
});

describe("a second press before the address has caught up (F1)", () => {
  /**
   * Choose Thread; React shows the thread while the address still says Brief.
   * At once take the command bar's Summary row. Armed from the old address,
   * that press mints a `simple` token while the thread's band is what is
   * mounted — nothing claims it, and **Back** to Brief then spends it.
   */
  async function threadThenSummaryRowBeforeTheFlush(): Promise<void> {
    await openAt(`/read/${SLUG}?mode=summary`);
    click(segment("Thread"), "Thread segment");
    /* The precondition this whole case is about: React has moved, the address
       has not. If nuqs ever flushes synchronously this fails loudly rather
       than passing for the wrong reason. */
    expect(host.querySelector(".mode-band.tweets"), "React is not on the thread yet").not.toBeNull();
    expect(inAddress("summary"), "the address had already caught up").toBeNull();
    takeSummaryInTheCommandBar();
    await settle();
  }

  it("leaves no plain-words token armed, and Back to Brief posts nothing", async () => {
    await threadThenSummaryRowBeforeTheFlush();

    expect(pendingActivation(SLUG, "simple")).toBeNull();
    expect(pendingActivation(SLUG, "tweets")).toBeNull();
    /* The thread's own arrival run, and nothing else. */
    expect(posts).toEqual([{ slug: SLUG, steps: ["tweets"] }]);

    await until(() => inAddress("summary") === "thread", "the thread never reached the address");
    const gets = simpleGets.length;
    act(() => history.back());
    await until(() => inAddress("summary") === null && segment("Brief")?.getAttribute("aria-checked") === "true",
      "Back never returned to Brief");
    /* Brief's band is mounted and has read: it knows there is nothing stored. */
    await until(() => simpleGets.length > gets, "Brief's band never read");

    expect(simplePosts()).toHaveLength(0);
    expect(posts).toEqual([{ slug: SLUG, steps: ["tweets"] }]);

    /* The positive control: a real press on Brief, on this same band, is seen. */
    await pressSegment("Brief");
    expect(simplePosts()).toEqual([{ slug: SLUG, steps: ["simple"] }]);
  });

  it("the control: a bar reading the address instead arms a token that Back then spends", async () => {
    handsTheBarItsView = false;
    await threadThenSummaryRowBeforeTheFlush();
    expect(pendingActivation(SLUG, "simple")).not.toBeNull();

    await until(() => inAddress("summary") === "thread", "the thread never reached the address");
    act(() => history.back());
    await until(() => simplePosts().length > 0, "the stale token was never spent — the control cannot fail");
    expect(simplePosts()).toEqual([{ slug: SLUG, steps: ["simple"] }]);
  });
});

describe("Summary's button in the bar", () => {
  it("opens on the thread when that is the view the address names, arming nothing for the lengths", async () => {
    /* `?summary=thread` outlives the mode, as `?diagram=` does. */
    await openAt(`/read/${SLUG}?summary=thread`);
    expect(threadGets).toHaveLength(0);
    await pressSummary();

    expect(host.textContent).toContain(NO_THREAD);
    expect(posts).toEqual([{ slug: SLUG, steps: ["tweets"] }]);
    expect(pendingActivation(SLUG, "simple")).toBeNull();
    expect(simpleGets).toHaveLength(0);
  });

  it("the positive control: on Brief it writes the plain-words lengths, and no thread", async () => {
    await openAt(`/read/${SLUG}`);
    await pressSummary();
    expect(posts).toEqual([{ slug: SLUG, steps: ["simple"] }]);
    expect(threadGets).toHaveLength(0);
  });

  it("pressed while the thread is showing, closes the band and arms nothing (F6)", async () => {
    threadStatus = 200;
    await openAt(`/read/${SLUG}?mode=summary&summary=thread`);
    expect(host.querySelector(".mode-band.tweets")).not.toBeNull();

    await pressSummary();
    await until(() => inAddress("mode") === null, "the band never closed");

    expect(host.querySelector(".mode-band")).toBeNull();
    expect(pendingActivation(SLUG, "simple")).toBeNull();
    expect(pendingActivation(SLUG, "tweets")).toBeNull();
    expect(posts).toHaveLength(0);
  });

  it("pressed while Brief is showing with nothing stored, closes the band and arms nothing (F6)", async () => {
    await openAt(`/read/${SLUG}?mode=summary`);
    expect(simpleGets.length).toBeGreaterThan(0);

    await pressSummary();
    await until(() => inAddress("mode") === null, "the band never closed");

    expect(host.querySelector(".mode-band")).toBeNull();
    expect(pendingActivation(SLUG, "simple")).toBeNull();
    expect(posts).toHaveLength(0);

    /* And reopening is a fresh press on a fresh mount, which does write. */
    await pressSummary();
    expect(posts).toEqual([{ slug: SLUG, steps: ["simple"] }]);
  });
});

describe("the thread, arrived at without a press", () => {
  const THREAD_AT = `/read/${SLUG}?mode=summary&summary=thread`;

  it("writes the thread on a pasted link too — one unforced request", async () => {
    await openAt(THREAD_AT);

    expect(threadGets.length).toBeGreaterThan(0);
    expect(posts).toEqual([{ slug: SLUG, steps: ["tweets"] }]);
  });

  it("spends nothing on a pasted link when there is a thread already", async () => {
    threadStatus = 200;
    await openAt(THREAD_AT);

    expect(threadGets.length).toBeGreaterThan(0);
    expect(host.querySelector('[aria-label="Copy the thread"]')).not.toBeNull();
    expect(posts).toHaveLength(0);
  });

  it("reads again once after a failed read, and writes if that says there is none", async () => {
    /* A failed read is not an answer to *is there a thread*: spending on it
       would buy a second thread for an article that may already have one. */
    threadFailsNext = 1;
    await openAt(THREAD_AT);

    expect(threadGets).toHaveLength(2);
    expect(tweetsPosts()).toHaveLength(1);
  });

  it("does not loop when the read keeps failing, and spends nothing", async () => {
    threadFailsNext = 99;
    await openAt(THREAD_AT);

    expect(threadGets).toHaveLength(2);
    expect(posts).toHaveLength(0);
  });

  it("does not post again when an accepted job later fails", async () => {
    await openAt(THREAD_AT);
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
      root.render(createElement(StrictMode, null, createElement(NuqsAdapter, null, createElement(Reading))));
    });
    await settle();

    expect(host.textContent).toContain("The accepted job failed.");
    expect(tweetsPosts()).toHaveLength(1);
  });

  it("tries once per page load: a second arrival after a refused run leaves the button", async () => {
    postRefuses = true;
    await openAt(THREAD_AT);
    expect(tweetsPosts()).toHaveLength(1);

    /* Away and back without a press — Back and Forward. The band unmounts and
       mounts again, and the one automatic attempt is spent, so this is a
       person's button now and not a loop. */
    await pressSegment("Fuller");
    await until(() => inAddress("summary") === "fuller", "Fuller never reached the address");
    expect(host.textContent).not.toContain(NO_THREAD);
    const before = posts.length;
    act(() => history.back());
    await until(() => host.textContent?.includes(NO_THREAD) === true, "Back never returned to the thread");

    expect(tweetsPosts()).toHaveLength(1);
    /* Pressing Fuller armed the lengths and posted for them; Back posted nothing. */
    expect(posts).toHaveLength(before);

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
  /* The one arrival that is not intent. A reader who last left the article on
     the thread and comes back to it from the shelf is restored to where they
     were reading — not handed a model call. */
  it("drops the mode from a restore that would open the thread, and so spends nothing", async () => {
    const restored = restoredHref(`/read/${SLUG}`, "", "?at=spya-a&mode=summary&summary=thread");
    expect(restored).toBe(`/read/${SLUG}?at=spya-a&summary=thread`);
    if (restored === null) throw new Error("nothing restored");

    await openAt(restored);
    expect(host.querySelector(".mode-band")).toBeNull();
    expect(threadGets).toHaveLength(0);
    expect(posts).toHaveLength(0);
  });

  it("the positive control: the same address with the mode left in writes the thread", async () => {
    /* Without this the case above would pass on a harness that never mounted
       the band from the address at all. */
    await openAt(`/read/${SLUG}?at=spya-a&mode=summary&summary=thread`);
    expect(tweetsPosts()).toHaveLength(1);
  });
});
