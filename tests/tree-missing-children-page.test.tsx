// @vitest-environment jsdom
/**
 * **The reading view paints from a tree with a missing `children` list —
 * through the real page.**
 *
 * tests/tree-missing-children.test.ts shows that each walker returns once the
 * tree has been through the door. That is not the same claim as *the view
 * paints*: a walker nobody listed, called on the way to first paint, would pass
 * every case there and still leave the reader on the error page. So this file
 * mounts the whole app, as `main.tsx` does, over a transport that answers with
 * such a tree, with the Experimental switch on so the breadcrumb's walk runs
 * too, and asks only whether the prose is on the page.
 *
 * jsdom has no layout, so this says nothing about where anything is drawn.
 *
 * The harness is tests/headings-crumbs-wiring.test.tsx's, cut to what this
 * needs. docs/plans/261005h-three-robustness-bugs-… § Stage B.
 */
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PublicArticle } from "../src/public-types.js";
import type { Article, Tree, TreeNode } from "../src/types.js";

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

const SLUG = "a-short-tree-page";
const FIRST = "The paragraph that opens the first part.";
const SECOND = "The evidence the first part rests on.";
const THIRD = "The paragraph that is the whole second part.";

const p = (id: string, text: string): PublicArticle["blocks"][number] => ({
  id,
  tag: "p",
  kind: "text",
  text,
  words: text.split(" ").length,
  html: `<p>${text}</p>`,
  gistable: true,
});

const BLOCKS: PublicArticle["blocks"] = [
  p("spya-aaaaaa", FIRST),
  p("spya-bbbbbb", SECOND),
  p("spya-cccccc", THIRD),
];

const node = (
  id: string,
  depth: number,
  parent: string | null,
  children: string[],
  range: [string, string],
): TreeNode => ({ id, depth, parent, children, range, title: `Title of ${id}`, navLabel: `Label of ${id}` }) as TreeNode;

const whole = (): Tree => ({
  version: "test",
  generator: "test",
  slug: SLUG,
  rootId: "n0",
  nodes: {
    n0: node("n0", 0, null, ["n1", "n5"], ["spya-aaaaaa", "spya-cccccc"]),
    n1: node("n1", 1, "n0", ["n2"], ["spya-aaaaaa", "spya-bbbbbb"]),
    n2: node("n2", 2, "n1", ["n3", "n4"], ["spya-aaaaaa", "spya-bbbbbb"]),
    n3: node("n3", 3, "n2", [], ["spya-aaaaaa", "spya-aaaaaa"]),
    n4: node("n4", 3, "n2", [], ["spya-bbbbbb", "spya-bbbbbb"]),
    n5: node("n5", 1, "n0", [], ["spya-cccccc", "spya-cccccc"]),
  },
});

/** The same tree with one node's `children` key gone, as stored JSON could have it. */
function without(id: string): Tree {
  const tree = whole();
  delete (tree.nodes[id] as Partial<TreeNode>).children;
  return tree;
}

/** The tree the transport answers with; each case sets it. */
let tree: Tree = whole();
/** Whether the signed-in reader owns the article; a case may say not. */
let owns = true;

const owned = (): Article => ({
  highPowerSince: null,
  titleOverridden: false,
  blocks: BLOCKS,
  tree,
  assets: undefined,
  navLabelStatus: "ready",
  sourceGuess: undefined,
  meta: { slug: SLUG, title: "A short tree", url: "https://example.com/a" },
});

const shared = (): PublicArticle => ({
  meta: { slug: SLUG, title: "A short tree", byline: "Somebody" },
  blocks: BLOCKS,
  tree,
  comments: [],
  searches: [],
  assets: undefined,
  navLabelStatus: "ready",
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function reply(url: string, method: string): Response {
  if (url === `/api/public/article/${SLUG}`) return json(shared());
  if (url === `/api/article/${SLUG}`) return owns ? json(owned()) : json({ error: "not found" }, 404);
  if (url === "/api/reader") return json({ experimentalSince: "2026-10-02T00:00:00.000Z" });
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
  who.set({ id: "short-tree-owner", email: "owner@example.com" });
  owns = true;
  tree = whole();
  resetExperimental();
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(reply(String(input), init?.method ?? "GET")),
  );
  /* A render that throws is caught by the boundary and logged by React; the
     assertion below is what reports it, so keep the stack out of the output. */
  vi.spyOn(console, "error").mockImplementation(() => {});
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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

const paints = () => {
  for (const text of [FIRST, SECOND, THIRD]) expect(host.textContent, "every paragraph is on the page").toContain(text);
  expect(host.querySelectorAll("tr[data-block]").length, "one row per block").toBe(BLOCKS.length);
};

describe("the reading view, from a tree with a missing children list", () => {
  /* The control first: the harness draws a well-formed article, so a red case
     below is the tree and not the harness. */
  it("paints a well-formed tree, breadcrumb and all", async () => {
    await open();
    paints();
    expect(host.querySelector("nav.crumbs"), "the breadcrumb's walk ran").not.toBeNull();
  });

  it("paints when the root has no list", async () => {
    tree = without("n0");
    await open();
    paints();
  });

  it("paints when an inner node has no list", async () => {
    tree = without("n1");
    await open();
    paints();
  });

  it("paints for a visitor too, who comes in by the other route", async () => {
    owns = false;
    tree = without("n0");
    await open();
    paints();
  });

  it("paints in Structure, which walks the whole tree", async () => {
    tree = without("n1");
    await open("?mode=structure");
    paints();
  });
});
