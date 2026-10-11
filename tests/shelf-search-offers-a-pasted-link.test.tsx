// @vitest-environment jsdom
/**
 * **A link pasted into the shelf's search box is offered to the add box.**
 *
 * > In the logged in homepage, we have two text input boxes near the top, one
 * > for adding a URL and one for searching the shelf. Users keep confusing them
 * >
 * > — Greg, 2026-10-11, SPIDERYARN-READING2-HD (spya-zh5f23)
 *
 * The search box takes the cursor on arrival (plan 260929g), so a reader who
 * arrives and pastes a link pastes it into the search. A complete address is a
 * strong signal that they meant the add box; now the shelf offers to add it —
 * on a press, through the same `/add/<url>` the Add button uses, never by itself.
 * docs/plans/261011l-shelf-add-box-and-search-box-look-like-different-things.md.
 *
 * The mocks are tests/shelf-search-clear.test.tsx's, plus `navigate` spied on.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryTermsResponse } from "../src/types.js";

const NO_TERMS: LibraryTermsResponse = {
  terms: [],
  scope: { articles: 0, works: 0, skipped: 0 },
  pending: 0,
  chosenBy: "program",
  refreshing: false,
};

vi.mock("../src/web/lib/api.js", () => ({
  apiFetch: async (url: string) => {
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (url.startsWith("/api/library/terms")) return json(NO_TERMS);
    if (url.startsWith("/api/library")) return json({ articles: [] });
    return json({ query: "", hits: [], articles: 0, capped: false });
  },
  fetchOk: async () => new Response(null, { status: 200 }),
  readJson: async (r: Response) => {
    if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
    return r.json();
  },
  statusOf: (e: unknown) => {
    const status = (e as { status?: unknown } | null)?.status;
    return typeof status === "number" ? status : null;
  },
}));
vi.mock("../src/web/lib/cached-shelf.js", () => ({ readCachedShelf: async () => null }));
vi.mock("../src/web/useJobs.js", () => ({ useJobs: () => ({}) }));
vi.mock("../src/web/AddArticle.js", () => ({ AddArticle: () => null }));
vi.mock("../src/web/FeedbackButton.js", () => ({ FeedbackTrigger: () => null }));
vi.mock("../src/web/useSession.js", () => ({
  useSession: () => ({ session: null, user: null, loading: false, known: true }),
}));

/** Where the page was sent, in order. */
const went: string[] = [];
vi.mock("../src/web/router.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/web/router.js")>();
  return { ...real, navigate: (href: string) => went.push(href) };
});

class NoResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
Object.assign(globalThis, { ResizeObserver: NoResizeObserver });

/** jsdom has no `matchMedia`; this one answers no to every query. */
Object.defineProperty(window, "matchMedia", {
  writable: true,
  configurable: true,
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

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
enableHistorySync();

const { Library, linkToAdd } = await import("../src/web/Library.js");

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  went.length = 0;
  (document.activeElement as HTMLElement | null)?.blur?.();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function show(path: string): Promise<void> {
  history.replaceState(null, "", path);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root.render(createElement(NuqsAdapter, null, createElement(Library, { readerId: "reader" })));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
}

/** Longer than the 200ms `?q=` is debounced by (params.ts), so the address has caught up. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 350));
  });
}

const box = (): HTMLInputElement => {
  const el = host.querySelector<HTMLInputElement>('input[aria-label="Search the library"]');
  expect(el, "the shelf draws no search box").not.toBeNull();
  return el as HTMLInputElement;
};

const offer = (): HTMLButtonElement | null =>
  [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent?.trim() === "Add it",
  ) ?? null;

/** Types into the box the way React hears it: the native setter, then `input`. */
async function type(value: string): Promise<void> {
  const el = box();
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  await act(async () => {
    set?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("a link in the shelf's search box", () => {
  it("is offered to the add box, and a press adds it the way Add does", async () => {
    await show("/");
    await type("https://example.com/an-essay");
    expect(host.textContent).toContain("That's a link.");
    expect(offer()?.classList.contains("tap-target")).toBe(true);
    await act(async () => {
      offer()?.click();
    });
    expect(went).toEqual([`/add/${encodeURIComponent("https://example.com/an-essay")}`]);
  });

  it("is offered when the address arrives in the page's own ?q=", async () => {
    await show(`/?q=${encodeURIComponent("http://example.com/x")}`);
    expect(offer()).not.toBeNull();
  });

  it("adds nothing until it is pressed", async () => {
    await show("/");
    await type("https://example.com/an-essay");
    expect(went).toEqual([]);
  });

  it("is not offered for words, a bare site name, or words around an address", async () => {
    await show("/");
    await type("attention");
    expect(offer()).toBeNull();
    /* The site name is on the cards, so it is a fair search. */
    await type("example.com");
    expect(offer()).toBeNull();
    await type("see https://example.com/an-essay");
    expect(offer()).toBeNull();
  });

  it("leaves Enter as it was — the keyboard goes away and nothing is added", async () => {
    await show("/");
    await type("https://example.com/an-essay");
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    await act(async () => {
      box().dispatchEvent(enter);
    });
    await settle();
    expect(went).toEqual([]);
  });

  it("goes with the query when Escape clears it", async () => {
    await show("/");
    await type("https://example.com/an-essay");
    const escapeKey = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    await act(async () => {
      box().dispatchEvent(escapeKey);
    });
    await settle();
    expect(offer()).toBeNull();
    expect(new URLSearchParams(location.search).has("q")).toBe(false);
  });
});

describe("linkToAdd — what counts as a link meant for the add box", () => {
  it("takes what Add takes, with a scheme or a path", () => {
    expect(linkToAdd("https://example.com/an-essay")).toBe("https://example.com/an-essay");
    expect(linkToAdd("  example.com/an-essay ")).toBe("example.com/an-essay");
    expect(linkToAdd("arxiv.org/abs/2608.13566")).toBe("arxiv.org/abs/2608.13566");
  });

  it("refuses what Add refuses", () => {
    expect(linkToAdd("javascript:alert(1)")).toBeNull();
    /* Credentials and local addresses: the add flow refuses these too. */
    expect(linkToAdd("https://user:pass@example.com/x")).toBeNull();
    expect(linkToAdd("http://127.0.0.1/x")).toBeNull();
    expect(linkToAdd("http://localhost/x")).toBeNull();
  });

  it("leaves words and bare site names to the search", () => {
    expect(linkToAdd("")).toBeNull();
    expect(linkToAdd("attention is all you need")).toBeNull();
    expect(linkToAdd("nature.com")).toBeNull();
    expect(linkToAdd("and/or")).toBeNull();
  });
});
