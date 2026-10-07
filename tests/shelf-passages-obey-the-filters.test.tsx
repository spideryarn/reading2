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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  entry("outside", "Outside", { tags: ["other"] }),
  entry("unopened", "Unopened", { opens: 0 }),
];
const TERMS: LibraryTermsResponse = {
  terms: [
    { key: "bees", label: "Bees", articles: [{ slug: "inside", count: 3 }] },
    { key: "hives", label: "Hives", articles: [{ slug: "unopened", count: 1 }] },
  ],
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

const ARCHIVED = entry("archived", "Archived", { opens: 0, tags: ["ai"], archivedAt: "2026-10-01T00:00:00Z" });
let archiveState: "loaded" | "loading" | "failed";
let topicState: "loaded" | "loading" | "failed";
beforeEach(() => {
  archiveState = "loaded";
  topicState = "loaded";
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function listingResponse(state: "loaded" | "loading" | "failed", body: unknown): Response | Promise<Response> {
  if (state === "loading") return new Promise<Response>(() => {});
  if (state === "failed") return json({ error: "listing unavailable" }, 503);
  return json(body);
}

vi.mock("../src/web/lib/api.js", () => ({
  apiFetch: async (url: string) => {
    if (url.startsWith("/api/library/terms")) return listingResponse(topicState, TERMS);
    if (url === "/api/library") return json({ articles: SHELF });
    if (url === "/api/library?archived=1") return listingResponse(archiveState, { articles: [ARCHIVED] });
    if (url.startsWith("/api/library/search?")) {
      const params = new URLSearchParams(url.slice(url.indexOf("?") + 1));
      const query = params.get("q") ?? "";
      const archived = params.get("archived") === "1";
      const hits = query === "zibble" ? [...HITS, ...(archived ? [{ slug: ARCHIVED.slug, title: ARCHIVED.title, blockId: "spya-k3m9qx", text: "a zibble in Archived", rank: 1, archived: true }] : [])] : [];
      return json({ query, archived, hits, articles: hits.length, capped: false, archivedArticles: 0 });
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
  while (!host.textContent?.includes("zibble in") && !host.textContent?.includes("passages found") &&
         !host.textContent?.includes("Nothing in the articles' text matches")) {
    if (Date.now() > until) throw new Error(`timed out waiting for the passages at ${path}`);
    await settle(20);
  }
}

/** The titles of the articles the passage list names, in order. */
const passageTitles = () =>
  [...host.querySelectorAll("section li a")]
    .filter((a) => a.textContent?.includes("zibble"))
    .map((a) => a.querySelector("span > span")?.textContent?.trim());
const cardTitles = () =>
  [...host.querySelectorAll("main > ul:not([aria-label]) > li h2")].map((h) => h.textContent?.trim());

describe("the passages under the cards", () => {
  it("can observe a matching card, so the body-only cases' empty card assertions have a positive control", async () => {
    await show("/?q=inside");
    expect(cardTitles()).toEqual(["Inside"]);
    expect(passageTitles()).toEqual([]);
  });
  const combinations = [false, true].flatMap((archived) =>
    [false, true].flatMap((unread) =>
      [false, true].flatMap((topic) =>
        [false, true].map((tag) => ({ archived, unread, topic, tag })),
      ),
    ),
  );
  it.each(combinations)("combines archived=$archived, unread=$unread, topic=$topic and tag=$tag", async ({ archived, unread, topic, tag }) => {
    const params = new URLSearchParams({ q: "zibble" });
    if (archived) params.set("archived", "1");
    if (unread) params.set("show", "unread");
    if (topic) params.set("topics", "bees");
    if (tag) params.set("tags", "ai");
    await show(`/?${params}`);
    const expected = [
      ...(!unread ? ["Inside"] : []),
      ...(!unread && !topic && !tag ? ["Outside"] : []),
      ...(!topic && !tag ? ["Unopened"] : []),
      ...(archived && !topic ? ["Archived"] : []),
    ];
    expect(passageTitles()).toEqual(expected);
  });

  it.each(["loading", "failed"] as const)("while topics are %s, applies tags and Unread but ignores the unknown topic", async (state) => {
    topicState = state;
    await show("/?topics=bees&tags=ai&show=unread&q=zibble");
    expect(passageTitles()).toEqual([]);
    expect(host.textContent).toContain("None of the passages found");
    expect(host.textContent).toContain("do not match everything chosen above");
  });

  it.each(["loading", "failed"] as const)("while topics are %s, leaves passages unfiltered just as the cards are", async (state) => {
    topicState = state;
    await show("/?topics=bees&q=zibble");
    expect(passageTitles()).toEqual(["Inside", "Outside", "Unopened"]);
  });

  it.each(["topics=bees,hives", "tags=ai,other", "topics=bees&tags=other"])("requires every selected set: %s", async (filters) => {
    await show(`/?${filters}&q=zibble`);
    expect(passageTitles()).toEqual([]);
  });

  it.each(["loading", "failed"] as const)("does not call an unread archived hit already opened when the archive is %s", async (state) => {
    archiveState = state;
    await show("/?archived=1&show=unread&q=zibble");
    expect(passageTitles()).toEqual(["Unopened"]);
    expect(host.textContent).not.toContain("already opened");
    expect(host.textContent).toContain("3 more passages found are not shown.");
  });

  it.each(["loading", "failed"] as const)("does not call an archived hit outside its chosen tag when the archive is %s", async (state) => {
    archiveState = state;
    await show("/?archived=1&tags=ai&q=zibble");
    expect(passageTitles()).toEqual(["Inside"]);
    expect(host.textContent).not.toContain("do not match everything chosen above");
    expect(host.textContent).toContain("3 more passages found are not shown.");
  });

  it.each(["loading", "failed"] as const)("when every hit is hidden and the archive is %s, reports only what is shown", async (state) => {
    archiveState = state;
    await show("/?archived=1&tags=ai&show=unread&q=zibble");
    expect(passageTitles()).toEqual([]);
    expect(host.textContent).toContain("None of the passages found for “zibble” is shown.");
    expect(host.textContent).toContain("4 more passages found are not shown.");
    expect(host.textContent).not.toContain("an article that matches everything chosen above");
  });

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
