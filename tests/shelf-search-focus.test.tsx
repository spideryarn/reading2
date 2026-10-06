// @vitest-environment jsdom
/**
 * **The shelf's search box has the focus when you arrive — on a desk, with
 * nothing typed and nothing else focused, and with the box on screen.**
 *
 * > When I open the logged-in Spideryarn homepage with the shelf, let's put the
 * > focus by default on the search box.
 * >
 * > — Greg, 2026-09-29, SPIDERYARN-READING2-5E
 *
 * Each refusal below is somebody the focus would hurt: a phone reader whose
 * on-screen keyboard would cover the shelf, a reader already looking at
 * results, a control that had the focus first, and a box scrolled out of sight
 * after Back. docs/project/library.md § the search box;
 * docs/plans/260929g-shelf-search-focus-and-metadata-chord.md § Part A.
 *
 * The mocks are the ones tests/shelf-archived-in-the-list.test.tsx uses, cut
 * down: nothing here is about what is on the shelf.
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

class NoResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
Object.assign(globalThis, { ResizeObserver: NoResizeObserver });

/** jsdom has no `matchMedia`; this one answers yes to exactly the queries given. */
function stubMatchMedia(matching: string[] = []): void {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: matching.includes(query),
      media: query,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      onchange: null,
      dispatchEvent: () => false,
    }),
  });
}

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
enableHistorySync();

const { Library } = await import("../src/web/Library.js");

let host: HTMLDivElement;
let root: Root;
let extras: HTMLElement[];

beforeEach(() => {
  stubMatchMedia();
  extras = [];
  (document.activeElement as HTMLElement | null)?.blur?.();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  for (const el of extras) el.remove();
  vi.restoreAllMocks();
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

const box = (): HTMLInputElement => {
  const el = host.querySelector<HTMLInputElement>('input[aria-label="Search the library"]');
  expect(el, "the shelf draws no search box").not.toBeNull();
  return el as HTMLInputElement;
};

describe("the shelf's search box", () => {
  it("has the focus when the shelf mounts", async () => {
    await show("/");
    expect(document.activeElement).toBe(box());
  });

  it("does not, when the page arrived with a query in it", async () => {
    await show("/?q=attention");
    expect(box().value).toBe("attention");
    expect(document.activeElement).not.toBe(box());
  });

  it("does not, where the primary pointer is a finger", async () => {
    stubMatchMedia(["(pointer: coarse)"]);
    await show("/");
    expect(document.activeElement).not.toBe(box());
  });

  it("does not take the focus from a control that already has it", async () => {
    const other = document.createElement("button");
    document.body.append(other);
    extras.push(other);
    other.focus();
    await show("/");
    expect(document.activeElement).toBe(other);
  });

  it("does not, when the box is off screen as the shelf mounts", async () => {
    vi.spyOn(HTMLInputElement.prototype, "getBoundingClientRect").mockReturnValue({
      top: -500,
      bottom: -460,
      left: 0,
      right: 600,
      width: 600,
      height: 40,
      x: 0,
      y: -500,
      toJSON: () => ({}),
    } as DOMRect);
    await show("/");
    expect(document.activeElement).not.toBe(box());
  });

  it("does not, when the box is horizontally off screen as the shelf mounts", async () => {
    vi.spyOn(HTMLInputElement.prototype, "getBoundingClientRect").mockReturnValue({
      top: 100,
      bottom: 140,
      left: -1,
      right: 399,
      width: 400,
      height: 40,
      x: -1,
      y: 100,
      toJSON: () => ({}),
    } as DOMRect);
    await show("/");
    expect(document.activeElement).not.toBe(box());
  });
});
