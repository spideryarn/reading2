// @vitest-environment jsdom
/**
 * **The headings breadcrumb is drawn for the switch's readers, and only for
 * them — through the real page.**
 *
 * crumbs.ts's path is tested without a DOM in tests/headings-crumbs.test.ts.
 * This file is the composition-root half (docs/reusable/silent-success.md): that
 * `Reader` puts the bar up when the switch is on and leaves an owner with no
 * bar at all when it is off, and that a press on a crumb is wired to a jump.
 *
 * jsdom has no layout, so the focus sampler sees no rows and answers row zero;
 * which section is current as the page scrolls is a browser question.
 *
 * The harness is tests/mode-herald-wiring.test.tsx's, cut to what this needs.
 * docs/plans/261002h-headings-breadcrumb-at-the-top-of-the-reading-view.md
 */
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PublicArticle } from "../src/public-types.js";
import type { Article } from "../src/types.js";

/** Who `useSession` says is here. Hoisted, because `vi.mock` is. */
const who = vi.hoisted(() => {
  let user: { id: string; email: string } | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => user,
    set(next: { id: string; email: string } | null) {
      user = next;
      for (const fn of [...listeners]) fn();
    },
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
});

vi.mock("../src/web/useSession.js", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useSession: () => ({
      session: null,
      user: useSyncExternalStore(who.subscribe, who.get, who.get),
      loading: false,
    }),
  };
});

const authListeners: ((event: string, session: unknown) => void)[] = [];

vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "t" } } }),
      refreshSession: async () => ({ data: { session: { access_token: "t" } } }),
      onAuthStateChange: (fn: (event: string, session: unknown) => void) => {
        authListeners.push(fn);
        return { data: { subscription: { unsubscribe() {} } } };
      },
      signOut: async () => ({ error: null }),
    },
  },
  googleSignInAvailable: false,
}));

/**
 * Every `layoutKey` the reading view hands its position tracker, in order.
 * The real hook still runs; this only overhears the third argument, which is
 * the one thing that tells the trackers the page's geometry moved.
 */
const layoutKeys = vi.hoisted(() => [] as string[]);

vi.mock("../src/web/reader/useReadingPosition.js", async (original) => {
  const real = await original<typeof import("../src/web/reader/useReadingPosition.js")>();
  const useReadingPosition: typeof real.useReadingPosition = (sections, blocks, layoutKey) => {
    layoutKeys.push(layoutKey);
    return real.useReadingPosition(sections, blocks, layoutKey);
  };
  return { ...real, useReadingPosition };
});

class NoResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
Object.assign(globalThis, { ResizeObserver: NoResizeObserver });
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => {
    const maxWidth = query.match(/^\(max-width:\s*(\d+)px\)$/);
    return {
      matches: maxWidth ? window.innerWidth <= Number(maxWidth[1]) : false,
      media: query,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      onchange: null,
      dispatchEvent: () => false,
    };
  },
});
Object.defineProperty(window, "scrollTo", { writable: true, value: () => {} });
if (!(globalThis as { CSS?: unknown }).CSS) {
  (globalThis as { CSS?: unknown }).CSS = { escape: (s: string) => s };
}

const SLUG = "a-crumbs-piece";
const PARAGRAPH = "The paragraph a herald never covers.";
const SECOND_PARAGRAPH = "The evidence the section contains.";

const BLOCKS: PublicArticle["blocks"] = [
  {
    id: "spya-aaaaaa",
    tag: "h1",
    kind: "heading",
    level: 1,
    text: "A piece",
    words: 2,
    html: "<h1>A piece</h1>",
    gistable: false,
  },
  {
    id: "spya-bbbbbb",
    tag: "p",
    kind: "text",
    text: PARAGRAPH,
    words: 6,
    html: `<p>${PARAGRAPH}</p>`,
    gistable: true,
  },
  {
    id: "spya-cccccc",
    tag: "p",
    kind: "text",
    text: SECOND_PARAGRAPH,
    words: 5,
    html: `<p>${SECOND_PARAGRAPH}</p>`,
    gistable: true,
  },
];

const TREE: PublicArticle["tree"] = {
  version: "test",
  generator: "test",
  slug: SLUG,
  rootId: "n0",
  nodes: {
    n0: {
      id: "n0",
      depth: 0,
      parent: null,
      children: ["n1"],
      range: ["spya-aaaaaa", "spya-cccccc"],
      title: "A piece",
      gist: "What the piece says.",
    },
    n1: {
      id: "n1",
      depth: 1,
      parent: "n0",
      children: ["n2"],
      range: ["spya-bbbbbb", "spya-cccccc"],
      title: "The argument it makes",
      gist: "Where the piece gets to.",
    },
    n2: {
      id: "n2",
      depth: 2,
      parent: "n1",
      children: ["n3"],
      range: ["spya-cccccc", "spya-cccccc"],
      title: "What the evidence shows",
      gist: "The section's answer.",
    },
    n3: {
      id: "n3",
      depth: 3,
      parent: "n2",
      children: [],
      range: ["spya-cccccc", "spya-cccccc"],
      title: "The evidence the section contains",
      navLabel: "The evidence the section contains",
    },
  },
};

const ARTICLE: PublicArticle = {
  meta: { slug: SLUG, title: "A piece", byline: "Somebody" },
  blocks: BLOCKS,
  tree: TREE,
  comments: [],
  searches: [],
  assets: undefined,
  navLabelStatus: "ready",
  sharedBy: "public",
};

const OWNED: Article = {
  highPowerSince: null,
  titleOverridden: false,
  blocks: BLOCKS,
  tree: TREE,
  assets: undefined,
  navLabelStatus: "ready",
  sourceGuess: undefined,
  meta: { slug: SLUG, title: "A piece", url: "https://example.com/a" },
};

/** The experimental switch, off unless a case turns it on. */
let experimentalSince: string | null = null;
/** Whether the signed-in reader owns the article; a case may say not. */
let owns = true;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function reply(url: string, method: string): Response {
  if (url === `/api/public/article/${SLUG}`) return json(ARTICLE);
  if (url === `/api/article/${SLUG}`) return owns ? json(OWNED) : json({ error: "not found" }, 404);
  if (url === "/api/reader") return json({ experimentalSince });
  if (method === "POST") return new Response(null, { status: 204 });
  if (url.startsWith("/api/comments/")) return json({ comments: [] });
  if (url.startsWith("/api/chat/")) return json({ threads: [] });
  if (url === "/api/jobs") return json({ jobs: [] });
  return json({});
}

const { App } = await import("../src/web/App.js");
const { AppBoundary } = await import("../src/web/AppBoundary.js");
const { resetForTests: resetExperimental } = await import("../src/web/experimental-store.js");

let host: HTMLDivElement;
let root: Root;

enableHistorySync();

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  who.set({ id: "crumbs-owner", email: "owner@example.com" });
  experimentalSince = null;
  owns = true;
  layoutKeys.length = 0;
  resetExperimental();
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(reply(String(input), init?.method ?? "GET")),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function settle(turns = 6): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 0));
    });
  }
}

/** The whole app, exactly as `main.tsx` mounts it. */
async function open(search = ""): Promise<void> {
  history.replaceState(null, "", `/read/${SLUG}${search}`);
  await act(async () => {
    root.render(
      createElement(
        StrictMode,
        null,
        createElement(NuqsAdapter, null, createElement(AppBoundary, null, createElement(App, null))),
      ),
    );
  });
  await act(async () => {
    const user = who.get();
    for (const fn of [...authListeners]) fn(user === null ? "SIGNED_OUT" : "SIGNED_IN", user && { user });
  });
  await settle();
}

const crumbs = () => host.querySelector<HTMLElement>(".reader > .controls > nav.crumbs");

describe("the headings breadcrumb", () => {
  it("an owner with the switch off has no controls bar at all", async () => {
    await open();
    expect(host.textContent, "the article is up").toContain(PARAGRAPH);
    expect(host.querySelector(".reader > .controls")).toBeNull();
    expect(host.querySelector("nav.crumbs")).toBeNull();
  });

  it("does not give a signed-out visitor breadcrumbs, while preserving their existing bar", async () => {
    who.set(null);
    /* Even a lying endpoint cannot turn this on: signed-out is deliberately off
       and the experimental store must not ask it at all. */
    experimentalSince = "2026-10-02T00:00:00.000Z";
    await open();
    expect(host.querySelector(".reader > .controls"), "the read-only chip still has its bar").not.toBeNull();
    expect(host.querySelector("nav.crumbs")).toBeNull();
  });

  it("a tree containing only labelled block leaves has no empty controls bar", async () => {
    experimentalSince = "2026-10-02T00:00:00.000Z";
    const original = OWNED.tree;
    OWNED.tree = {
      ...TREE,
      nodes: {
        n0: { ...TREE.nodes.n0!, children: ["n3"] },
        n3: { ...TREE.nodes.n3!, parent: "n0", depth: 1 },
      },
    };
    try {
      await open();
      expect(host.textContent, "the article is up").toContain(PARAGRAPH);
      expect(host.querySelector("nav.crumbs")).toBeNull();
      expect(host.querySelector(".reader > .controls")).toBeNull();
      expect(host.querySelector(".bar-sentinel")).toBeNull();
    } finally {
      OWNED.tree = original;
    }
  });

  it("with the switch on, the bar holds the path and the last crumb is current", async () => {
    experimentalSince = "2026-10-02T00:00:00.000Z";
    await open();
    const nav = crumbs();
    expect(nav, "the breadcrumb is in the controls bar").not.toBeNull();
    expect(nav?.getAttribute("aria-label")).toBe("Where you are");
    const buttons = [...(nav?.querySelectorAll("button") ?? [])];
    expect(buttons.map((b) => b.textContent)).toEqual([
      "1The argument it makes",
      "1.1What the evidence shows",
    ]);
    expect(buttons[0]?.hasAttribute("aria-current"), "only the leaf is current").toBe(false);
    expect(buttons.at(-1)?.getAttribute("aria-current")).toBe("location");
    expect(nav?.closest("[aria-live]"), "never announced on scroll").toBeNull();
  });

  /**
   * **The stuck-bar watcher is wired, and only for a bar with the breadcrumb.**
   * tests/bar-stuck.test.ts covers the watcher alone; an exported helper
   * nobody calls would pass it. Here: the sentinel is the element directly
   * before the bar, it is what is observed, the observer's answer reaches the
   * root, and all of it goes when the breadcrumb does. GPT Sol, plan review
   * of 261004a.
   */
  it("watches a sentinel directly before the bar, while the bar holds the breadcrumb", async () => {
    type Entry = { isIntersecting: boolean; boundingClientRect: { top: number } };
    const seen: { callback: (e: Entry[]) => void; observed: Element[]; live: boolean }[] = [];
    class FakeObserver {
      private readonly record: (typeof seen)[number];
      constructor(callback: (e: Entry[]) => void) {
        this.record = { callback, observed: [], live: true };
        seen.push(this.record);
      }
      observe(el: Element) {
        this.record.observed.push(el);
      }
      disconnect() {
        this.record.live = false;
      }
    }
    vi.stubGlobal("IntersectionObserver", FakeObserver);

    experimentalSince = "2026-10-02T00:00:00.000Z";
    await open();
    const bar = host.querySelector(".reader > .controls");
    const sentinel = bar?.previousElementSibling;
    expect(sentinel?.className).toBe("bar-sentinel");
    const live = seen.filter((o) => o.live);
    expect(live.length, "one live watcher (StrictMode's first is torn down)").toBe(1);
    expect(live[0]?.observed).toEqual([sentinel]);

    await act(async () => live[0]?.callback([{ isIntersecting: false, boundingClientRect: { top: -1 } }]));
    expect(document.documentElement.dataset.barStuck).toBe("");

    await act(async () => root.unmount());
    expect(document.documentElement.dataset.barStuck, "cleared with the bar").toBeUndefined();
    expect(seen.some((o) => o.live)).toBe(false);
    root = createRoot(host);

    /* A chip-only bar: nothing reads the answer, so nothing asks. */
    const before = seen.length;
    owns = false;
    resetExperimental();
    experimentalSince = null;
    await open();
    expect(host.querySelector(".reader > .controls"), "the View-only chip's bar").not.toBeNull();
    expect(host.querySelector(".bar-sentinel")).toBeNull();
    expect(seen.length).toBe(before);
  });

  it("a press on a crumb is wired to the reader's jump", async () => {
    experimentalSince = "2026-10-02T00:00:00.000Z";
    await open();
    const button = crumbs()?.querySelector("button");
    expect(button).not.toBeNull();
    const cell = host.querySelector<HTMLElement>('tr[data-block="spya-bbbbbb"] td.text');
    expect(cell, "the target row is drawn").not.toBeNull();
    const before = cell?.className;
    await act(async () => button?.click());
    await settle();
    /* jsdom has no layout, so every row measures at 0 and `beginJump` may decide
       the reader is already there — which flashes the target instead of
       pushing `?at=` (keynav.ts § beginJump). Either is the jump arriving. */
    const at = new URLSearchParams(location.search).get("at");
    expect(at === "spya-bbbbbb" || cell?.className !== before, "the press reached jumpTo").toBe(true);
  });

  /**
   * **The bar's height follows the breadcrumb, so `layoutKey` has to.** On a
   * narrow window the bar is taller while it holds the breadcrumb (crumbs.css).
   * A signed-in reader of somebody else's article has the View-only chip, so
   * their bar stays drawn while the breadcrumb comes and goes — a mode opening
   * over the prose hides it — and every row moves with nothing resizing. The
   * key carried only "is there a bar", which does not change here. GPT Sol F1,
   * plan review of 261003n.
   *
   * A phone's width, posed: jsdom lays nothing out, so `pageWidth` falls back
   * to `innerWidth`, and at 390 a mode's band covers the prose.
   */
  it("a signed-in visitor's breadcrumb coming and going changes layoutKey, the chip's bar staying", async () => {
    vi.stubGlobal("innerWidth", 390);
    owns = false;
    experimentalSince = "2026-10-02T00:00:00.000Z";
    await open();
    expect(host.querySelector(".reader > .controls > .mode.on"), "the View-only chip").not.toBeNull();
    expect(crumbs(), "Plain: the breadcrumb beside the chip").not.toBeNull();
    const withCrumbs = layoutKeys.at(-1);
    expect(withCrumbs).toBeDefined();

    await act(async () => root.unmount());
    root = createRoot(host);
    await open("?mode=summary");
    expect(host.querySelector(".reader > .controls > .mode.on"), "the chip keeps the bar").not.toBeNull();
    expect(crumbs(), "a band over the prose: no breadcrumb").toBeNull();
    const without = layoutKeys.at(-1);

    expect(without, "the bar changed height, so the key must change").not.toBe(withCrumbs);
  });

  /**
   * The key above is about geometry, not breadcrumb visibility by itself. On a
   * wide window the View-only bar is already present and remains 44px whether
   * or not Experimental adds the one-line breadcrumb. Treating that as a
   * reflow makes `useReadingPosition` restore `?at=` and moves a reader who was
   * part-way through the section back to its start (261003h postmortem).
   */
  it("a wide signed-in visitor's one-line breadcrumb does not change layoutKey", async () => {
    vi.stubGlobal("innerWidth", 768);
    owns = false;
    experimentalSince = null;
    await open();
    expect(host.querySelector(".reader > .controls > .mode.on"), "the View-only chip").not.toBeNull();
    expect(crumbs(), "Experimental off: no breadcrumb").toBeNull();
    const without = layoutKeys.at(-1);
    expect(without).toBeDefined();

    await act(async () => root.unmount());
    resetExperimental();
    experimentalSince = "2026-10-02T00:00:00.000Z";
    root = createRoot(host);
    await open();
    expect(host.querySelector(".reader > .controls > .mode.on"), "the chip keeps the bar").not.toBeNull();
    expect(crumbs(), "Experimental on: the one-line breadcrumb").not.toBeNull();

    expect(layoutKeys.at(-1), "the 44px bar and article geometry did not change").toBe(without);
  });

  /**
   * **Not while Structure or Marginalia's head is on screen.** Greg,
   * 2026-10-04 (spya-rx43ku): *"We don't need to show that horizontal rail when
   * either structure or annotations mode are on, because they both provide
   * that information too."* Annotations is Marginalia. The Summary case is the
   * control: without it the others pass on a breadcrumb that is merely broken.
   * docs/plans/261004k-hide-the-headings-rail-while-structure-or-marginalia-is-on.md
   */
  describe("steps aside for Structure and for Marginalia's head", () => {
    beforeEach(() => {
      vi.stubGlobal("innerWidth", 1400);
      experimentalSince = "2026-10-02T00:00:00.000Z";
    });

    it("beside another mode's band it is drawn", async () => {
      await open("?mode=summary");
      expect(crumbs()).not.toBeNull();
    });

    it("with Structure open there is no breadcrumb, and an owner has no bar", async () => {
      await open("?mode=structure");
      expect(host.textContent, "the article is up").toContain(PARAGRAPH);
      expect(host.querySelector("nav.crumbs")).toBeNull();
      expect(host.querySelector(".reader > .controls")).toBeNull();
      expect(host.querySelector(".bar-sentinel"), "nothing watches a bar that is not there").toBeNull();
    });

    it("with Structure open a visitor keeps the chip's bar, without the breadcrumb", async () => {
      owns = false;
      await open("?mode=structure");
      expect(host.querySelector(".reader > .controls > .mode.on"), "the View-only chip").not.toBeNull();
      expect(host.querySelector("nav.crumbs")).toBeNull();
    });

    it("with Marginalia's column drawn its head says it instead", async () => {
      /* The first part reaches up to the first block for this case. jsdom has
         no layout, so the reader is at the very top, and there the fixture's
         first block is above every part: the head would have no path to draw
         and the test would pass on an empty column (GPT Sol, plan review of
         261004k, TEST-HEAD). */
      const part = TREE.nodes.n1;
      if (!part) throw new Error("the fixture lost its first part");
      const range = part.range;
      part.range = ["spya-aaaaaa", range[1]];
      try {
        await open("?margin=1");
      } finally {
        part.range = range;
      }
      expect(host.querySelector(".marg-narrow"), "there is room for the column").toBeNull();
      expect(host.querySelector(".marg-head .marg-path")?.textContent, "the head names the part").toContain(
        "The argument it makes",
      );
      expect(host.querySelector("nav.crumbs")).toBeNull();
    });

    /**
     * **At the very top, above the first part, the head names the first part.**
     * The fixture as it is: its first block (the title) lies outside its first
     * part, and jsdom's reader is at the top with no `?at=`. The breadcrumb is
     * hidden while the column is drawn, so until 261004l nothing on the page
     * said where the reader was (qi-2ymfq3ek). notes.ts § `headBlock`.
     * docs/plans/261004l-four-small-queued-fixes-fetch-failure-sentences-composer-focus-stale-remember-param-marginalia-head-at-the-top.md § D
     */
    it("at the very top, above the first part, Marginalia's head names the first part", async () => {
      await open("?margin=1");
      expect(new URLSearchParams(location.search).get("at"), "no position in the address").toBeNull();
      expect(host.querySelector(".marg-narrow"), "there is room for the column").toBeNull();
      expect(host.querySelector(".marg-head .marg-path")?.textContent, "the head names the first part").toContain(
        "The argument it makes",
      );
      expect(host.querySelector("nav.crumbs")).toBeNull();
    });

    it("with Marginalia on but no room for its column, the breadcrumb stays", async () => {
      vi.stubGlobal("innerWidth", 600);
      await open("?margin=1");
      expect(host.querySelector(".marg-narrow"), "the column is not drawn, and says so").not.toBeNull();
      expect(crumbs()).not.toBeNull();
    });
  });
});
