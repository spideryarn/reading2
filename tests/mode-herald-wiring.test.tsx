// @vitest-environment jsdom
/**
 * **The herald is shown for a press, and only for a press — through the real
 * page.**
 *
 * tests/mode-herald.test.tsx proves the component does the right thing with a
 * press it is handed. This file proves `Reader` hands it one: that a Dock press
 * reaches it, that arriving at `?mode=` does not, and that the two modes with
 * no band get nothing. A unit with its props supplied is green whether or not
 * anything supplies them, which is the composition-root half of
 * docs/reusable/silent-success.md.
 * docs/plans/260915e-the-mode-names-itself-briefly-when-a-reader-opens-it.md.
 *
 * The harness — the whole `App` under `NuqsAdapter`, a stubbed `fetch`, a
 * reactive `useSession` — is lifted from
 * tests/a-broken-mode-leaves-the-article-readable.test.tsx and cut to what this
 * needs.
 */
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MODE_CATALOG } from "../src/mode-catalog.js";
import type { PublicArticle } from "../src/public-types.js";
import { MODE_LABEL } from "../src/title-text.js";
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

const SLUG = "a-herald-piece";
const PARAGRAPH = "The paragraph a herald never covers.";

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
      range: ["spya-aaaaaa", "spya-bbbbbb"],
      title: "A piece",
      gist: "What the piece says.",
    },
    n1: {
      id: "n1",
      depth: 1,
      parent: "n0",
      children: [],
      range: ["spya-bbbbbb", "spya-bbbbbb"],
      title: "The argument it makes",
      gist: "Where the piece gets to.",
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
  blocks: BLOCKS,
  tree: TREE,
  assets: undefined,
  navLabelStatus: "ready",
  meta: { slug: SLUG, title: "A piece", url: "https://example.com/a" },
};

/** Hierarchy is behind the experimental switch, so the case that presses it turns it on. */
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
  who.set({ id: "herald-owner", email: "owner@example.com" });
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

const modeInUrl = (): string => new URLSearchParams(location.search).get("mode") ?? "plain";

async function press(label: string): Promise<void> {
  const before = modeInUrl();
  const button = [...host.querySelectorAll<HTMLButtonElement>('.dock-modes [role="radio"]')].find(
    (b) => b.getAttribute("aria-label") === label,
  );
  expect(button, `the bar must draw ${label}`).toBeDefined();
  await act(async () => button?.click());
  // `?mode=` is written behind nuqs' throttle, so one read is a race.
  for (let i = 0; i < 40 && modeInUrl() === before; i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 10));
    });
  }
  await settle();
}

const herald = (): string => host.querySelector(".mode-herald")?.textContent ?? "";

async function until(ok: () => boolean): Promise<void> {
  for (let i = 0; i < 40 && !ok(); i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 10));
    });
  }
  expect(ok(), "the history step never arrived").toBe(true);
  await settle();
}

describe("Reader hands the herald a press", () => {
  it("a Dock press on Summary names Summary over its band", async () => {
    await open();
    expect(text(), "the article is up").toContain(PARAGRAPH);
    expect(herald(), "nothing before a press").toBe("");
    await press(MODE_LABEL.summary);
    expect(host.querySelector('.mode-band[aria-label="Summary"]'), "the band opened").not.toBeNull();
    expect(herald()).toContain(MODE_LABEL.summary);
    expect(herald()).toContain(MODE_CATALOG.summary.description);
  });

  it("arriving at ?mode=summary opens the band and says nothing — a mount is not a press", async () => {
    await open("?mode=summary");
    expect(host.querySelector('.mode-band[aria-label="Summary"]'), "the band opened").not.toBeNull();
    expect(herald()).toBe("");
  });

  it("Back inside the three seconds ends it, and Forward does not bring it back", async () => {
    await open();
    await press(MODE_LABEL.summary);
    expect(herald()).toContain(MODE_LABEL.summary);
    await act(async () => history.back());
    await until(() => modeInUrl() === "plain");
    expect(herald()).toBe("");
    await act(async () => history.forward());
    await until(() => modeInUrl() === "summary");
    expect(host.querySelector('.mode-band[aria-label="Summary"]'), "the band is back").not.toBeNull();
    expect(herald(), "a Forward step is not a press").toBe("");
  });

  it("Plain and Hierarchy have no band, so a press on either says nothing", async () => {
    experimentalSince = "2026-09-01T00:00:00.000Z";
    await open("?mode=summary");
    await press(MODE_LABEL.plain);
    expect(modeInUrl()).toBe("plain");
    expect(herald()).toBe("");
    await press(MODE_LABEL.hierarchy);
    expect(modeInUrl()).toBe("hierarchy");
    expect(herald()).toBe("");
  });
});

const text = (): string => host.textContent ?? "";
