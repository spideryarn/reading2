// @vitest-environment jsdom
/**
 * **The thread's old addresses land on the thread, by every road an address
 * can arrive.**
 *
 * `?mode=tweets` was the Tweets mode from 2026-09-29 to 2026-10-03, and
 * `/read/<slug>/tweets` the page before it. Both are in bookmarks, in sent
 * threads and in open tabs' history. The thread is Summary's Thread view now
 * (docs/plans/261003l-fewer-top-level-modes-tweets-become-summary-s-thread.md),
 * so each must become `?mode=summary&summary=thread`.
 *
 * `RETIRED_MODES` alone is not enough, and that is GPT Sol's F4: it turns
 * `?mode=tweets` into Summary — at **Brief**. On the article this file uses, a
 * public one with a thread and **no** plain-words summary, a visitor would be
 * told *nobody has made a plain-words version* while the thread they were sent
 * sat one press away.
 *
 * Three roads, because the rewrite has three homes (src/web/router.ts §
 * `liftedTweetsHref`): `settleAddress` on a cold load, `navigate()` for a link
 * inside the app, and `useRoute` for Back and Forward — which until 2026-10-03
 * re-ran only when the *pathname* changed, so Back between two entries on one
 * article never reached it. The pure half of the rewrite is tests/router.test.ts;
 * this file is the rendered half: real `useRoute`, real nuqs, the real visitor
 * band.
 */
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useQueryState } from "nuqs";
import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PublicTweets } from "../src/public-types.js";
import type { Article } from "../src/types.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class NoResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
Object.assign(globalThis, { ResizeObserver: NoResizeObserver });
window.scrollTo = () => {};

enableHistorySync();

const { VisitorSummaryBand } = await import("../src/web/modes/summary/SummaryMode.js");
const { modeParam } = await import("../src/web/params.js");
const { navigate, settleAddress, useRoute } = await import("../src/web/router.js");
const { SIMPLE_NONE_VISITOR } = await import("../src/web/SimplePanel.js");

const SLUG = "shared-piece";
const POST = "The one post of the stored thread.";

/** What the public payload carries: a thread, and no `simpleSummary` at all. */
const THREAD: PublicTweets = {
  limit: 280,
  tweets: [{ text: POST, chars: [...POST].length }],
} as PublicTweets;

const ARTICLE: Article = {
  highPowerSince: null,
  titleOverridden: false,
  meta: { slug: SLUG, title: "A shared piece", url: "https://example.com/piece" },
  blocks: [],
  assets: undefined,
  navLabelStatus: "ready",
  sourceGuess: undefined,
  tree: { rootId: "spya-root", nodes: {} } as unknown as Article["tree"],
};

/** A visitor's reading view, as far as the address is concerned. */
function Page(): ReactElement {
  const route = useRoute();
  const [mode] = useQueryState("mode", modeParam);
  if (route.kind !== "read") return createElement("p", null, "not found");
  if (mode !== "summary") return createElement("p", null, `band: ${mode}`);
  return createElement(VisitorSummaryBand, {
    slug: SLUG,
    simple: undefined,
    thread: THREAD,
    article: ARTICLE,
    onJump: () => {},
  });
}

let host: HTMLDivElement;
let root: Root;

/** main.tsx's boot: settle the address, then render. */
function boot(): void {
  const settled = settleAddress(location.pathname, location.search, location.hash);
  if (settled !== null) history.replaceState(null, "", settled);
  act(() => {
    root.render(createElement(NuqsAdapter, null, createElement(Page)));
  });
}

async function until(check: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 100 && !check(); i += 1) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 10));
    });
  }
  expect(check(), what).toBe(true);
}

const showsTheThread = (): boolean => host.textContent?.includes(POST) === true;

function expectTheThread(rest: Record<string, string> = {}): void {
  expect(showsTheThread(), `the thread is not on screen: ${host.textContent}`).toBe(true);
  expect(host.textContent).not.toContain(SIMPLE_NONE_VISITOR);
  expect(location.pathname).toBe(`/read/${SLUG}`);
  const params = new URLSearchParams(location.search);
  expect(params.getAll("mode")).toEqual(["summary"]);
  expect(params.getAll("summary")).toEqual(["thread"]);
  for (const [key, value] of Object.entries(rest)) expect(params.getAll(key), key).toEqual([value]);
  /* The control is there, on Thread, and it is the visitor's: nothing to arm. */
  const checked = [...host.querySelectorAll('.summ-views [role="radio"]')].filter(
    (b) => b.getAttribute("aria-checked") === "true",
  );
  expect(checked.map((b) => b.textContent)).toEqual(["Thread"]);
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("a public article with a thread and no summary, reached by an old Tweets address", () => {
  it("the positive control: Summary at Brief says nobody has made a plain-words version", () => {
    /* Where `RETIRED_MODES` alone would leave an old link. */
    history.replaceState(null, "", `/read/${SLUG}?mode=summary`);
    boot();
    expect(host.textContent).toContain(SIMPLE_NONE_VISITOR);
    expect(showsTheThread()).toBe(false);
  });

  it("cold load of ?mode=tweets", () => {
    history.replaceState(null, "", `/read/${SLUG}?mode=tweets`);
    boot();
    expectTheThread();
  });

  it("cold load of the old page", () => {
    history.replaceState(null, "", `/read/${SLUG}/tweets`);
    boot();
    expectTheThread();
  });

  it("cold load: the old word beats a carried length, with one pair each and the rest kept", () => {
    history.replaceState(null, "", `/read/${SLUG}?summary=fuller&at=spya-k3m9qt&mode=tweets&summary=brief&margin=1`);
    boot();
    expectTheThread({ at: "spya-k3m9qt", margin: "1" });
  });

  it("a client navigation to ?mode=tweets", async () => {
    history.replaceState(null, "", `/read/${SLUG}?mode=glossary`);
    boot();
    expect(host.textContent).toContain("band: glossary");
    act(() => navigate(`/read/${SLUG}?mode=tweets&at=spya-k3m9qt`));
    await until(showsTheThread, "navigate() never reached the thread");
    expectTheThread({ at: "spya-k3m9qt" });
  });

  it("Back onto a ?mode=tweets entry on the same article", async () => {
    /* A tab open across the deploy: the old code wrote the first entry, the
       reader moved on, and the page was reloaded on the second. No pathname
       changes on the way back. */
    history.replaceState(null, "", `/read/${SLUG}?mode=tweets&summary=fuller&at=spya-k3m9qt`);
    history.pushState(null, "", `/read/${SLUG}?mode=glossary`);
    boot();
    expect(host.textContent).toContain("band: glossary");

    act(() => history.back());
    await until(showsTheThread, "Back onto ?mode=tweets never reached the thread");
    expectTheThread({ at: "spya-k3m9qt" });
  });

  it("and Forward onto one", async () => {
    history.replaceState(null, "", `/read/${SLUG}?mode=glossary`);
    history.pushState(null, "", `/read/${SLUG}?mode=tweets`);
    history.pushState(null, "", `/read/${SLUG}?mode=glossary&at=spya-k3m9qt`);
    boot();
    act(() => history.go(-2));
    await until(() => new URLSearchParams(location.search).get("at") === null, "never went back two");
    act(() => history.forward());
    await until(showsTheThread, "Forward onto ?mode=tweets never reached the thread");
    expectTheThread();
  });

  it("Back onto the old page's path", async () => {
    history.replaceState(null, "", `/read/${SLUG}/tweets`);
    history.pushState(null, "", `/read/${SLUG}/metadata`);
    boot();
    act(() => history.back());
    await until(showsTheThread, "Back onto the old page never reached the thread");
    expectTheThread();
  });
});

describe("the same visitor, with no thread stored either", () => {
  it("is told so in a line under the control, which still offers the lengths", () => {
    function Bare(): ReactElement {
      return createElement(VisitorSummaryBand, {
        slug: SLUG,
        simple: undefined,
        thread: undefined,
        article: ARTICLE,
        onJump: () => {},
      });
    }
    history.replaceState(null, "", `/read/${SLUG}?mode=summary&summary=thread`);
    act(() => {
      root.render(createElement(NuqsAdapter, null, createElement(Bare)));
    });
    expect(host.textContent).toContain("Nobody has built a tweet thread for this piece yet.");
    expect(host.querySelector(".mode-band.tweets")).toBeNull();
    expect(host.querySelectorAll('.summ-views [role="radio"]')).toHaveLength(3);
  });
});
