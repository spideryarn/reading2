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
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    onchange: null,
    dispatchEvent: () => false,
  }),
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
};

const OWNED: Article = {
  highPowerSince: null,
  blocks: BLOCKS,
  tree: TREE,
  assets: undefined,
  navLabelStatus: "ready",
  sourceGuess: undefined,
  meta: { slug: SLUG, title: "A piece", url: "https://example.com/a" },
};

/** The experimental switch, off unless a case turns it on. */
let experimentalSince: string | null = null;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function reply(url: string, method: string): Response {
  if (url === `/api/public/article/${SLUG}`) return json(ARTICLE);
  if (url === `/api/article/${SLUG}`) return json(OWNED);
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
});
