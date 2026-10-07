// @vitest-environment jsdom
/**
 * **The shelf's search box has one cross to clear it, and it is one you can
 * see and hit.**
 *
 * > Little cross button to clear the search on the logged in homepage shelf.
 * >
 * > — Greg, 2026-10-04, SPIDERYARN-READING2-C7 (spya-wzmvva)
 *
 * The button had been there since 2026-08-26: a 14px grey glyph, with the
 * browser's own bold cross beside it whenever the box had the focus. So what is
 * pinned here is what made it findable — the house cross's size
 * (styles/close.css § .close-x), the browser's one hidden, the cursor back in
 * the box afterwards, and Escape.
 * docs/plans/261004f-shelf-search-clear-cross-that-can-be-seen.md.
 *
 * The mocks are tests/shelf-search-focus.test.tsx's.
 */
import { readerCss } from "./helpers/stylesheets.js";
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

const cross = (): HTMLButtonElement | null =>
  host.querySelector<HTMLButtonElement>('button[aria-label="Clear the search"]');

/** Longer than the 200ms `?q=` is debounced by (params.ts), so the address has caught up. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 350));
  });
}

/**
 * A press, as the browser sends it: a `pointerdown` that says what pressed,
 * then the click. `null` is the keyboard, which sends no pointerdown at all.
 */
async function press(
  el: HTMLElement,
  pointerType: "mouse" | "touch" | "pen" | "" | null,
): Promise<void> {
  await act(async () => {
    if (pointerType !== null) {
      const down = new MouseEvent("pointerdown", { bubbles: true, cancelable: true });
      Object.defineProperty(down, "pointerType", { value: pointerType });
      el.dispatchEvent(down);
    }
    /* iOS 18.2 can label a finger's click `mouse`, so only pointerdown carries
       the truthful device here. `detail` still distinguishes a pointer's click
       from keyboard, voice and script activation. */
    const click = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      detail: pointerType === null ? 0 : 1,
    });
    Object.defineProperty(click, "pointerType", { value: pointerType === null ? "" : "mouse" });
    el.dispatchEvent(click);
  });
  await settle();
}

/** Escape, sent to the box; answers whether the box claimed the key. */
async function pressEscape(): Promise<boolean> {
  const key = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  await act(async () => {
    box().dispatchEvent(key);
  });
  await settle();
  return key.defaultPrevented;
}

describe("the shelf search's clear cross", () => {
  it("is not drawn while the box is empty", async () => {
    await show("/");
    expect(cross()).toBeNull();
  });

  it("is the house cross when there is a query", async () => {
    await show("/?q=attention");
    const classes = [...(cross()?.classList ?? [])];
    expect(classes).toContain("close-x");
    /* A Tailwind size would win on layer order and put the small box back. */
    expect(classes.filter((c) => /^tw:(?:[^:]+:)*(?:size|w|h)-/.test(c))).toEqual([]);
    /* Fixed px, like .close-x: rem spacing shrinks at the supported 12px root.
       44px leaves the 40px finger target and its 4px right inset out of text. */
    expect(box().classList.contains("tw:pr-[44px]")).toBe(true);
    expect(classes).toContain("tw:right-[6px]");
    expect(box().classList.contains("tw:text-sm")).toBe(true);
  });

  it("empties the box and the address, keeps the other filters, and hands the cursor back", async () => {
    await show("/?q=attention&archived=1");
    expect(document.activeElement).not.toBe(box());
    await press(cross() as HTMLButtonElement, "mouse");
    expect(box().value).toBe("");
    const params = new URLSearchParams(location.search);
    expect(params.has("q")).toBe(false);
    expect(params.get("archived")).toBe("1");
    expect(document.activeElement).toBe(box());
    expect(cross()).toBeNull();
  });

  it("hands the cursor back after a keyboard press, which sends no pointerdown", async () => {
    await show("/?q=attention");
    await press(cross() as HTMLButtonElement, null);
    expect(box().value).toBe("");
    expect(document.activeElement).toBe(box());
  });

  it("does not let an abandoned finger press poison the next keyboard activation", async () => {
    await show("/?q=attention");
    const abandoned = new MouseEvent("pointerdown", { bubbles: true, cancelable: true });
    Object.defineProperty(abandoned, "pointerType", { value: "touch" });
    cross()?.dispatchEvent(abandoned);
    await press(cross() as HTMLButtonElement, null);
    expect(box().value).toBe("");
    expect(document.activeElement).toBe(box());
  });

  it("treats an unclassified pointer as not a finger", async () => {
    await show("/?q=attention");
    await press(cross() as HTMLButtonElement, "");
    expect(box().value).toBe("");
    expect(document.activeElement).toBe(box());
  });

  /* The press decides, not the device: an iPad with a keyboard attached says
     its primary pointer is fine while its reader taps the glass. */
  it.each(["touch", "pen"] as const)("does not raise the on-screen keyboard after a %s press", async (kind) => {
    await show("/?q=attention");
    await press(cross() as HTMLButtonElement, kind);
    expect(box().value).toBe("");
    expect(document.activeElement).not.toBe(box());
  });

  it("is what Escape does, when there is something to clear", async () => {
    await show("/?q=attention");
    expect(await pressEscape()).toBe(true);
    expect(box().value).toBe("");
    expect(new URLSearchParams(location.search).has("q")).toBe(false);
  });

  it("leaves Escape alone in an empty box", async () => {
    await show("/");
    expect(await pressEscape()).toBe(false);
  });

  /* An input method's Enter accepts a candidate and its Escape dismisses the
     list. The box keeps its words and the caret. Plan 261007a-ui-sweep-k2. */
  it.each([
    ["isComposing", { isComposing: true }],
    ["keyCode 229", { keyCode: 229 } as KeyboardEventInit],
  ])("leaves both keys to an input method that is composing (%s)", async (_how, init) => {
    await show("/?q=attention");
    box().focus();
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...init });
    const escapeKey = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true, ...init });
    const heard: string[] = [];
    const watch = (e: Event) => heard.push((e as KeyboardEvent).key);
    document.addEventListener("keydown", watch);
    try {
      await act(async () => {
        box().dispatchEvent(enter);
        box().dispatchEvent(escapeKey);
      });
    } finally {
      document.removeEventListener("keydown", watch);
    }
    expect(heard).toEqual(["Enter"]);
    await settle();
    expect(box().value).toBe("attention");
    expect(document.activeElement).toBe(box());
    expect(enter.defaultPrevented).toBe(false);
    /* Cancelled, because a `type="search"` box is emptied by the browser itself
       on Escape; jsdom has no such default, so this flag is all it can show. */
    expect(escapeKey.defaultPrevented).toBe(true);
  });

  it("is the only cross: the browser's own is hidden on this box", async () => {
    await show("/?q=attention");
    expect(box().classList.contains("own-clear")).toBe(true);
    const css = readerCss().replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).toMatch(/\.own-clear::-webkit-search-cancel-button\s*\{\s*display:\s*none;?\s*\}/);
  });
});
