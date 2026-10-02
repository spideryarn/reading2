// @vitest-environment jsdom
/**
 * **Include public, and an empty shelf that says where to go.**
 *
 * Greg, 2026-10-01 (spya-yy5x66): *"Perhaps let's also have a button for
 * include public. And if the user has no articles in their shelf … a link that
 * points them to the top. … be able to include public for everybody they want,
 * including in searching"*.
 *
 * What is pinned here: the chip is off by default and off means **no public
 * read at all**; on, the other readers' articles appear in their own section,
 * your own shared ones are not listed twice, and the shelf's search box narrows
 * them; an empty shelf links to the add box and offers the public shelf.
 *
 * Mocks follow tests/shelf-archived-in-the-list.test.tsx, which mounts the same
 * page. docs/plans/261002b-include-public-chip-on-the-shelf-empty-shelf-help-and-a-phone-banner-on-the-shelf.md.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicLibraryEntry } from "../src/public-library-types.js";
import type { LibraryEntry, LibraryTermsResponse } from "../src/types.js";

function entry(slug: string, title: string): LibraryEntry {
  return {
    slug,
    title,
    addedAt: "2026-09-01T00:00:00.000Z",
    words: 1000,
    minutes: 5,
    blocks: 10,
    parts: 1,
    sections: 1,
    comments: 0,
    opens: 1,
    has: { arc: false, tweets: false, glossary: false },
  } as LibraryEntry;
}

function pub(slug: string, title: string, byline: string | null = null): PublicLibraryEntry {
  return { slug, title, byline, gist: null, siteName: null, words: 900, publicAt: "2026-09-02T00:00:00.000Z" };
}

let active: LibraryEntry[];
let shared: PublicLibraryEntry[];
let truncated: boolean;
let publicReads: number;
let publicFails: boolean;
let cached: LibraryEntry[] | null;
let activeGate: Promise<void> | null;
let activeIsOfflineCopy: boolean;

const NO_TERMS: LibraryTermsResponse = { terms: [], scope: { articles: 0, works: 0, skipped: 0 }, pending: 0, chosenBy: "program", refreshing: false };

vi.mock("../src/web/lib/api.js", () => ({
  apiFetch: async (url: string) => {
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (url.startsWith("/api/library/terms")) return json(NO_TERMS);
    if (url === "/api/library") {
      const answer = [...active];
      if (activeGate) await activeGate;
      return new Response(JSON.stringify({ articles: answer }), {
        status: 200,
        ...(activeIsOfflineCopy ? { headers: { "x-spideryarn-offline": "copy" } } : {}),
      });
    }
    if (url.startsWith("/api/library/search?")) {
      const params = new URLSearchParams(url.slice(url.indexOf("?") + 1));
      return json({ query: params.get("q") ?? "", archived: false, hits: [], articles: 0, capped: false });
    }
    return json({ error: "unmocked" }, 404);
  },
  fetchOk: async () => new Response(null, { status: 200 }),
  readJson: async (r: Response) => {
    if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
    return r.json();
  },
  statusOf: () => null,
}));
/* The public listing is the anonymous read `/read/public` makes; counted, so
   "off means not fetched" is an observation rather than an assumption. */
vi.mock("../src/web/public-api.js", async (orig) => ({
  ...(await orig<typeof import("../src/web/public-api.js")>()),
  loadPublicLibrary: async () => {
    publicReads++;
    if (publicFails) throw new Error("network");
    return { kind: "ok", body: { entries: [...shared], truncated } };
  },
}));
vi.mock("../src/web/lib/cached-shelf.js", () => ({ readCachedShelf: async () => cached }));
vi.mock("../src/web/useJobs.js", () => ({ useJobs: () => ({}) }));
/* The real add box pulls in the whole ingest machinery; this stands in for its
   one fact the empty shelf depends on — an input with id `add-url`. */
vi.mock("../src/web/AddArticle.js", () => ({
  AddArticle: () => createElement("input", { id: "add-url" }),
}));
vi.mock("../src/web/FeedbackButton.js", () => ({ FeedbackTrigger: () => null }));
vi.mock("../src/web/useSession.js", () => ({
  useSession: () => ({ session: null, user: null, loading: false }),
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
Element.prototype.scrollIntoView = function scrollIntoView() {};

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
enableHistorySync();

const { Library } = await import("../src/web/Library.js");

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  active = [entry("alpha", "Alpha"), entry("mine-shared", "Mine, shared")];
  shared = [pub("mine-shared", "Mine, shared"), pub("zebra", "Zebra crossings", "Ann Other"), pub("yak", "Yak shaving")];
  truncated = false;
  publicReads = 0;
  publicFails = false;
  cached = null;
  activeGate = null;
  activeIsOfflineCopy = false;
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function show(path: string) {
  history.replaceState(null, "", path);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root.render(createElement(NuqsAdapter, null, createElement(Library, { readerId: "reader" })));
  });
  await settle();
}

async function settle(ms = 80) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

async function traverse(go: () => void) {
  const landed = new Promise<void>((resolve) =>
    window.addEventListener("popstate", () => resolve(), { once: true }),
  );
  await act(async () => {
    go();
    await landed;
  });
  await settle();
}

function typeIn(el: HTMLInputElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    set?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const publicChip = () =>
  [...host.querySelectorAll<HTMLButtonElement>("button[aria-pressed]")].find((b) =>
    (b.getAttribute("aria-label") ?? "").startsWith("Include public"),
  );
const section = () => host.querySelector('section[aria-labelledby="shelf-public-heading"]');
const publicTitles = () => [...(section()?.querySelectorAll("li h2") ?? [])].map((h) => h.textContent?.trim());

describe("the Include public chip", () => {
  it("is off by default, and off reads nothing public", async () => {
    await show("/");
    expect(publicChip()?.getAttribute("aria-pressed")).toBe("false");
    expect(section()).toBeNull();
    expect(publicReads).toBe(0);
  });

  it("on, lists what others shared — not your own a second time — and goes in the URL", async () => {
    await show("/");
    act(() => publicChip()?.click());
    await settle();
    expect(new URLSearchParams(location.search).get("public")).toBe("1");
    expect(publicReads).toBe(1);
    expect(publicTitles()).toEqual(["Zebra crossings", "Yak shaving"]);
  });

  it("waits for the live owner shelf before calling one of its articles somebody else's", async () => {
    cached = [entry("alpha", "Alpha")];
    let release = () => {};
    activeGate = new Promise<void>((resolve) => (release = resolve));
    await show("/?public=1");

    expect(section(), "the saved copy cannot establish who owns a public article").toBeNull();
    expect(publicReads).toBe(0);
    expect(host.querySelector("[role=status]")?.textContent).toContain("once your shelf is up to date");

    await act(async () => release());
    await settle();
    expect(publicReads).toBe(1);
    expect(publicTitles()).toEqual(["Zebra crossings", "Yak shaving"]);
  });

  it("does not mistake apiFetch's offline copy for a live owner shelf", async () => {
    active = [entry("alpha", "Alpha")];
    cached = [...active];
    activeIsOfflineCopy = true;
    await show("/?public=1");

    expect(section()).toBeNull();
    expect(publicReads).toBe(0);
    expect(host.querySelector("[role=status]")?.textContent).toContain("once your shelf is up to date");
  });

  it("is narrowed by the shelf's search box, on the card's words", async () => {
    await show("/?public=1&q=ann");
    expect(publicTitles()).toEqual(["Zebra crossings"]);
    expect(section()?.textContent).toContain("isn't searched");
  });

  it("carries a half-typed search into the public history entry", async () => {
    await show("/");
    typeIn(host.querySelector<HTMLInputElement>('[aria-label="Search the library"]')!, "ann");
    act(() => publicChip()?.click());
    await settle(300);

    expect(new URLSearchParams(location.search).get("q")).toBe("ann");
    expect(new URLSearchParams(location.search).get("public")).toBe("1");
    expect(publicTitles()).toEqual(["Zebra crossings"]);
  });

  it("restores Include public through Back and Forward", async () => {
    await show("/");
    act(() => publicChip()?.click());
    await settle();
    expect(section()).toBeTruthy();

    await traverse(() => history.back());
    expect(publicChip()?.getAttribute("aria-pressed")).toBe("false");
    expect(section()).toBeNull();

    await traverse(() => history.forward());
    expect(publicChip()?.getAttribute("aria-pressed")).toBe("true");
    expect(publicTitles()).toEqual(["Zebra crossings", "Yak shaving"]);
    expect(publicReads).toBe(2);
  });

  it("says when a search leaves none, and says the cap", async () => {
    truncated = true;
    await show("/?public=1&q=nothing-like-this");
    expect(publicTitles()).toEqual([]);
    expect(section()?.textContent).toContain("No public article matches");
    expect(section()?.textContent).toContain("Only the most recently shared are shown and searched");
  });

  it("does not say nobody else has shared when the only rows it was sent are yours and there are more", async () => {
    shared = [pub("mine-shared", "Mine, shared")];
    truncated = true;
    await show("/?public=1");
    expect(section()?.textContent).not.toContain("Nobody else");
    shared = [pub("mine-shared", "Mine, shared")];
  });

  it("is not narrowed by Unread, and says so", async () => {
    await show("/?public=1&show=unread");
    expect(publicTitles()).toEqual(["Zebra crossings", "Yak shaving"]);
    expect(section()?.textContent).toContain("apply to your own articles only");
  });

  it("says a failed read is a failure, not an empty shelf, and Try again reads again", async () => {
    publicFails = true;
    await show("/?public=1");
    expect(section()?.querySelector("[role=alert]")).toBeTruthy();
    expect(section()?.textContent).not.toContain("Nobody else");
    publicFails = false;
    const retry = [...(section()?.querySelectorAll("button") ?? [])].find((b) => b.textContent === "Try again");
    act(() => retry?.click());
    await settle();
    expect(publicReads).toBe(2);
    expect(publicTitles()).toEqual(["Zebra crossings", "Yak shaving"]);
  });
});

describe("an empty shelf", () => {
  beforeEach(() => {
    active = [];
  });

  it("links to the add box and puts the cursor in it", async () => {
    await show("/");
    const link = host.querySelector<HTMLAnchorElement>('a[href="#add-url"]');
    const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
    expect(link, "a link to the add box").toBeTruthy();
    act(() => link?.click());
    expect(document.activeElement?.id).toBe("add-url");
    expect(scroll).toHaveBeenCalledWith({ block: "center" });
    scroll.mockRestore();
  });

  it("offers the public shelf, which turns the chip on, and the chip is there too", async () => {
    await show("/");
    expect(publicChip(), "the chip is drawn over an empty shelf").toBeTruthy();
    const offer = [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("browse what other readers have shared"),
    );
    expect(offer).toBeTruthy();
    act(() => offer?.click());
    await settle();
    expect(publicTitles()).toEqual(["Mine, shared", "Zebra crossings", "Yak shaving"]);
    expect(host.textContent).not.toContain("browse what other readers have shared");
  });
});
