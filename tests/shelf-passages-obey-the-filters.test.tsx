// @vitest-environment jsdom
/**
 * **The passages under the cards obey every filter the cards obey**: plan
 * 261007a § K3.
 *
 * A topic or a tag chosen on the shelf narrowed the cards and not the passage
 * matches under them: only the Unread chip's slugs were handed to `Passages`.
 * So with a topic chosen, a search listed passages from articles outside it,
 * under a row of cards that said those articles were not there.
 *
 * And the fix has a wrong version, which the second half of each case is for:
 * taking the allowed articles from the cards on screen would also apply the
 * search box's match on a card's title, author and blurb, and hide the passage
 * of an article **inside** the topic whose body matches and whose card does
 * not. The passages are the answer to the search, so the search is not applied
 * to them twice.
 *
 * Mounted whole, with the real `useShelf` and `useLibrarySearch` over a mocked
 * network, as tests/shelf-archived-in-the-list.test.tsx is: what has to hold is
 * the page handing the right set down.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LibraryEntry, LibraryTermsResponse } from "../src/types.js";

function entry(slug: string, title: string, over: Partial<LibraryEntry> = {}): LibraryEntry {
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
    ...over,
  } as LibraryEntry;
}

/* Three articles, and "zibble" is in the BODY of each and on the card of none.
   Inside is in the topic "bees" and carries the tag "ai"; Outside has neither.
   Unopened is outside both and has never been opened. */
const SHELF = [
  entry("inside", "Inside", { tags: ["ai"] }),
  entry("outside", "Outside"),
  entry("unopened", "Unopened", { opens: 0 }),
];
const TERMS: LibraryTermsResponse = {
  terms: [{ key: "bees", label: "Bees", articles: [{ slug: "inside", count: 3 }] }],
  scope: { articles: 3, works: 3, skipped: 0 },
  pending: 0,
  chosenBy: "program",
  refreshing: false,
};
const HITS = SHELF.map((e, i) => ({
  slug: e.slug,
  title: e.title,
  blockId: `spya-k3m9q${"tuv"[i]}`,
  text: `a zibble in ${e.title}`,
  rank: 1,
}));

vi.mock("../src/web/lib/api.js", () => ({
  apiFetch: async (url: string) => {
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (url.startsWith("/api/library/terms")) return json(TERMS);
    if (url === "/api/library") return json({ articles: SHELF });
    if (url.startsWith("/api/library/search?")) {
      const query = new URLSearchParams(url.slice(url.indexOf("?") + 1)).get("q") ?? "";
      const hits = query === "zibble" ? HITS : [];
      return json({ query, archived: false, hits, articles: hits.length, capped: false, archivedArticles: 0 });
    }
    return json({ error: "unmocked" }, 404);
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

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
enableHistorySync();

const { Library } = await import("../src/web/Library.js");

let host: HTMLDivElement;
let root: Root;

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function settle(ms = 80) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

/** Mount the shelf at `path` and wait for the passage search's answer. */
async function show(path: string) {
  history.replaceState(null, "", path);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root.render(createElement(NuqsAdapter, null, createElement(Library, { readerId: "reader" })));
  });
  const until = Date.now() + 3000;
  while (!host.textContent?.includes("zibble in") && !host.textContent?.includes("passages found")) {
    if (Date.now() > until) throw new Error(`timed out waiting for the passages at ${path}`);
    await settle(20);
  }
}

/** The titles of the articles the passage list names, in order. */
const passageTitles = () =>
  [...host.querySelectorAll("section li a")]
    .filter((a) => a.textContent?.includes("zibble"))
    .map((a) => a.querySelector("span")?.textContent?.trim());
const cardTitles = () =>
  [...host.querySelectorAll("main > ul:not([aria-label]) > li h2")].map((h) => h.textContent?.trim());

describe("the passages under the cards", () => {
  it("lists every article's passages when nothing is chosen", async () => {
    await show("/?q=zibble");
    expect(passageTitles()).toEqual(["Inside", "Outside", "Unopened"]);
    expect(host.textContent).not.toContain("more passage");
  });

  it.each([
    ["a topic", "/?topics=bees&q=zibble"],
    ["a tag", "/?tags=ai&q=zibble"],
  ])("with %s chosen, lists only that one's articles, and still the one whose card does not match", async (_what, path) => {
    await show(path);
    /* No card matches "zibble": the search box reads the title, author and
       blurb. The passage of the article inside the topic is listed all the
       same; the two outside it are not. */
    expect(cardTitles()).toEqual([]);
    expect(passageTitles()).toEqual(["Inside"]);
    /* The two left out are counted, and not called "already opened": one of
       them never has been. */
    expect(host.textContent).toContain("2 more passages are in articles that do not match everything chosen above.");
    expect(host.textContent).not.toContain("already opened");
  });

  it("with Unread alone, still says the rest are in articles already opened", async () => {
    await show("/?show=unread&q=zibble");
    expect(passageTitles()).toEqual(["Unopened"]);
    expect(host.textContent).toContain("2 more passages are in articles you have already opened.");
  });

  it("with a topic and Unread that leave nothing, says so without claiming nothing matches", async () => {
    await show("/?topics=bees&show=unread&q=zibble");
    expect(passageTitles()).toEqual([]);
    expect(host.textContent).toContain("None of the passages found for “zibble” is in an article that matches everything chosen above.");
    expect(host.textContent).toContain("3 more passages are in articles that do not match everything chosen above.");
  });
});
