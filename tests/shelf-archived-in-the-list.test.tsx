// @vitest-environment jsdom
/**
 * **Archived, at the top, and in the one list** — Greg's report 4V, plan
 * 260929a § Stage 2 and its review decisions R2–R4.
 *
 * > I think it would be better if it was a (default-hide-archived) toggle at
 * > the top (like for "Unread"), so that it's easy to show some/all (so we can
 * > use the faceted-search-topic-pills and/or sort to look through the Archived
 * > articles easily too).
 * >
 * > — Greg, 2026-09-29
 *
 * Mounted whole, with the **real** `useShelf` over a mocked network, because
 * what has to hold is the page and the hook agreeing: the chip loads the
 * archive, the archived rows are sorted *with* the active ones, each is marked,
 * Put back leaves it where it is, and an all-archived reader can still reach
 * the chip.
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
const ARCHIVED_AT = "2026-09-20T00:00:00.000Z";
const archivedEntry = (slug: string, title: string) => entry(slug, title, { archivedAt: ARCHIVED_AT });

/** The server's two lists, which the PATCH below moves entries between. */
let active: LibraryEntry[];
let archived: LibraryEntry[];
/** Every request, as `METHOD url`. */
let asked: string[];
/** Hold the archived listing back, when a test wants to see the wait. */
let archiveGate: Promise<void> | null;
/** Make the archived listing fail. */
let archiveFails: boolean;
/** Hold the active listing back, after taking its server-side snapshot. */
let activeGate: Promise<void> | null;
/** Make a later active-list refresh fail. */
let activeFails: boolean;
/** Hold the active-only passage search back, for the stale-response race. */
let searchGate: Promise<void> | null;
/** Make the held active-only passage search fail after it is released. */
let searchFails: boolean;
/** The stale-while-revalidate first paint, when a test needs one. */
let cached: LibraryEntry[] | null;

const NO_TERMS: LibraryTermsResponse = { terms: [], scope: { articles: 0, works: 0, skipped: 0 }, pending: 0, chosenBy: "program", refreshing: false };

async function activeResponse(json: (body: unknown, status?: number) => Response) {
  const answer = [...active];
  if (activeGate) await activeGate;
  if (activeFails) return json({ error: "nope" }, 500);
  return json({ articles: answer });
}

vi.mock("../src/web/lib/api.js", () => ({
  apiFetch: async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    asked.push(`${method} ${url}`);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (url.startsWith("/api/library/terms")) return json(NO_TERMS);
    if (url === "/api/library") return activeResponse(json);
    if (url === "/api/library?archived=1") {
      const answer = [...archived];
      if (archiveGate) await archiveGate;
      if (archiveFails) return json({ error: "nope" }, 500);
      return json({ articles: answer });
    }
    if (method === "PATCH" && url.startsWith("/api/library/")) {
      const slug = decodeURIComponent(url.slice("/api/library/".length));
      const body = JSON.parse(String(init?.body)) as { archived?: boolean; title?: string | null };
      const found = [...active, ...archived].find((e) => e.slug === slug);
      if (!found) return json({ error: "gone" }, 404);
      let next: LibraryEntry = { ...found };
      if (body.archived === true) {
        next = { ...next, archivedAt: ARCHIVED_AT };
        active = active.filter((e) => e.slug !== slug);
        archived = [next, ...archived.filter((e) => e.slug !== slug)];
      } else if (body.archived === false) {
        const { archivedAt: _gone, ...rest } = next;
        next = rest as LibraryEntry;
        archived = archived.filter((e) => e.slug !== slug);
        active = [next, ...active.filter((e) => e.slug !== slug)];
      }
      if ("title" in body && typeof body.title === "string") {
        next = { ...next, title: body.title, titleOverridden: true };
        active = active.map((e) => (e.slug === slug ? next : e));
        archived = archived.map((e) => (e.slug === slug ? next : e));
      }
      return json({ entry: next });
    }
    if (url.startsWith("/api/library/search?")) {
      /* The passage search. One archived article, Delta, has a passage
         matching "zibble" — found only when the chip asks for the archive,
         the way the server answers (plan 260930d). */
      const params = new URLSearchParams(url.slice(url.indexOf("?") + 1));
      const query = params.get("q") ?? "";
      const withArchive = params.get("archived") === "1";
      if (!withArchive && searchGate) await searchGate;
      if (!withArchive && searchFails) return json({ error: "old search failed" }, 500);
      const hits =
        withArchive && query === "zibble"
          ? [{ slug: "delta", title: "Delta", blockId: "spya-k3m9qt", text: "a zibble in Delta", rank: 1, archived: true }]
          : [];
      /* With the archive left out, the server also counts the archived
         articles that would have matched (plan 261002b § Part D). */
      const count = withArchive ? {} : { archivedArticles: query === "zibble" ? 1 : 0 };
      return json({ query, archived: withArchive, hits, articles: hits.length, capped: false, ...count });
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
vi.mock("../src/web/lib/cached-shelf.js", () => ({ readCachedShelf: async () => cached }));
vi.mock("../src/web/useJobs.js", () => ({ useJobs: () => ({}) }));
vi.mock("../src/web/AddArticle.js", () => ({ AddArticle: () => null }));
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

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
enableHistorySync();

const { Library } = await import("../src/web/Library.js");

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  asked = [];
  archiveGate = null;
  archiveFails = false;
  activeGate = null;
  activeFails = false;
  cached = null;
  searchGate = null;
  searchFails = false;
  /* Titles that interleave, so "sorted with everything else" is visible:
     by title, A (active) B (archived) C (active) D (archived). */
  active = [entry("alpha", "Alpha"), entry("charlie", "Charlie")];
  archived = [archivedEntry("bravo", "Bravo"), archivedEntry("delta", "Delta")];
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

async function waitFor(check: () => boolean, what: string, ms = 2000) {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await settle(20);
  }
}

const params = () => new URLSearchParams(location.search);

/** The Archived chip in the controls row — its name begins with its visible text. */
function archivedChip(): HTMLButtonElement | undefined {
  return [...host.querySelectorAll<HTMLButtonElement>("button[aria-pressed]")].find((b) =>
    (b.getAttribute("aria-label") ?? "").startsWith("Include archived"),
  );
}

/** Each card drawn, in order: its title, and whether it wears the Archived mark. */
function cards(): { title: string; archived: boolean }[] {
  return [...host.querySelectorAll("main > ul:not([aria-label]) > li")].map((li) => ({
    title: li.querySelector("h2")?.textContent?.trim() ?? "?",
    archived: !!li.querySelector("[data-archived-mark]"),
  }));
}
function tableRows(): { title: string; archived: boolean }[] {
  return [...host.querySelectorAll("tbody tr")].map((tr) => ({
    title: tr.querySelector("a")?.textContent?.trim() ?? "?",
    archived: !!tr.querySelector("[data-archived-mark]"),
  }));
}

function click(el: HTMLElement) {
  act(() => el.click());
}

describe("the Archived chip", () => {
  it("sits beside Unread, off by default, and the old foot-of-shelf toggle is gone", async () => {
    await show("/");
    const chip = archivedChip();
    expect(chip, "an Archived chip in the controls").toBeTruthy();
    expect(chip?.getAttribute("aria-pressed")).toBe("false");
    expect(chip?.textContent?.trim()).toBe("Include archived");
    const unread = [...host.querySelectorAll("button[aria-pressed]")].find((b) =>
      (b.getAttribute("aria-label") ?? "").startsWith("Unread"),
    );
    expect(chip?.parentElement, "in the same group as Unread").toBe(unread?.parentElement);
    const labels = [...host.querySelectorAll("button")].map((b) => b.textContent?.trim());
    expect(labels).not.toContain("Show archived");
    expect(labels).not.toContain("Hide archived");
    expect(host.querySelector('ul[aria-label="Archived articles"]')).toBeNull();
    // Off means not fetched.
    expect(asked).not.toContain("GET /api/library?archived=1");
  });

  it("toggles ?archived=1 and merges the archive into the one list, in sort order, marked", async () => {
    await show("/?by=title");
    expect(cards().map((c) => c.title)).toEqual(["Alpha", "Charlie"]);

    click(archivedChip()!);
    await settle();
    expect(params().get("archived")).toBe("1");
    expect(archivedChip()?.getAttribute("aria-pressed")).toBe("true");
    await waitFor(() => cards().length === 4, "the archived rows");
    expect(cards()).toEqual([
      { title: "Alpha", archived: false },
      { title: "Bravo", archived: true },
      { title: "Charlie", archived: false },
      { title: "Delta", archived: true },
    ]);

    click(archivedChip()!);
    await settle();
    expect(params().get("archived")).toBeNull();
    expect(cards().map((c) => c.title)).toEqual(["Alpha", "Charlie"]);
  });

  it("loads the archive on a direct ?archived=1 visit", async () => {
    await show("/?archived=1&by=title");
    await waitFor(() => cards().length === 4, "the archived rows");
    expect(asked).toContain("GET /api/library?archived=1");
  });

  it("keeps the active rows painted while the archive loads, and says so", async () => {
    let release: () => void = () => {};
    archiveGate = new Promise((r) => (release = r));
    await show("/?archived=1&by=title");
    expect(cards().map((c) => c.title)).toEqual(["Alpha", "Charlie"]);
    expect(host.textContent).toContain("Loading archived…");
    await act(async () => release());
    await waitFor(() => cards().length === 4, "the archived rows");
    expect(host.textContent).not.toContain("Loading archived…");
  });

  it("reconciles an archive made while an older archived-list snapshot is in flight", async () => {
    let release: () => void = () => {};
    archiveGate = new Promise((r) => (release = r));
    await show("/?archived=1&by=title");
    const alpha = [...host.querySelectorAll("main > ul:not([aria-label]) > li")].find((li) =>
      li.textContent?.includes("Alpha"),
    )!;

    click(alpha.querySelector<HTMLButtonElement>('[data-action="archive"]')!);
    await settle();
    expect(cards().filter((row) => row.title === "Alpha")).toEqual([
      { title: "Alpha", archived: true },
    ]);

    await act(async () => release());
    await waitFor(() => !host.textContent?.includes("Loading archived…"), "the archived snapshot");
    expect(cards().filter((row) => row.title === "Alpha")).toEqual([
      { title: "Alpha", archived: true },
    ]);
  });

  it("keeps the active rows when the archive fails, and says that instead", async () => {
    archiveFails = true;
    await show("/?archived=1&by=title");
    await waitFor(() => !host.textContent?.includes("Loading archived…"), "the failure");
    expect(cards().map((c) => c.title)).toEqual(["Alpha", "Charlie"]);
    expect(host.textContent).toContain("Couldn't load the archived articles");
  });

  it("clears an archived-list failure after turning Archived off and a retry succeeds", async () => {
    archiveFails = true;
    await show("/?archived=1&by=title");
    await waitFor(() => !host.textContent?.includes("Loading archived…"), "the failure");
    expect(host.querySelector('[class*="bg-destructive"]')).toBeTruthy();

    click(archivedChip()!);
    archiveFails = false;
    click(archivedChip()!);
    await waitFor(() => cards().length === 4, "the successful retry");
    expect(host.querySelector('[class*="bg-destructive"]')).toBeNull();
    expect(host.textContent).not.toContain("Couldn't load the archived articles");
  });

  it("keeps a newly archived row usable when the older archive could not be loaded", async () => {
    archiveFails = true;
    await show("/?archived=1&by=title");
    await waitFor(() => !host.textContent?.includes("Loading archived…"), "the failure");

    const alpha = () =>
      [...host.querySelectorAll("main > ul:not([aria-label]) > li")].find((li) =>
        li.textContent?.includes("Alpha"),
      );
    click(alpha()!.querySelector<HTMLButtonElement>('[data-action="archive"]')!);
    await settle();
    expect(cards()).toContainEqual({ title: "Alpha", archived: true });

    click(alpha()!.querySelector<HTMLButtonElement>('[data-action="edit"]')!);
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Title"]')!;
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    act(() => {
      set?.call(input, "Aardvark");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => input.form?.requestSubmit());
    await settle();
    expect(cards()).toContainEqual({ title: "Aardvark", archived: true });

    const aardvark = [...host.querySelectorAll("main > ul:not([aria-label]) > li")].find((li) =>
      li.textContent?.includes("Aardvark"),
    )!;
    click(aardvark.querySelector<HTMLButtonElement>('[data-action="restore"]')!);
    await settle();
    expect(cards()).toContainEqual({ title: "Aardvark", archived: false });
    expect(cards().filter((row) => row.title === "Aardvark")).toHaveLength(1);
  });

  it("offers Put back on an archived card, and the card stays, un-marked", async () => {
    await show("/?archived=1&by=title");
    await waitFor(() => cards().length === 4, "the archived rows");
    const bravo = [...host.querySelectorAll("main > ul:not([aria-label]) > li")].find((li) =>
      li.textContent?.includes("Bravo"),
    )!;
    expect(bravo.querySelector('[data-action="archive"]'), "no Archive on an archived card").toBeNull();
    const restore = bravo.querySelector<HTMLButtonElement>('[data-action="restore"]');
    expect(restore?.getAttribute("aria-label")).toBe("Put back");
    click(restore!);
    await settle();
    expect(asked).toContain("PATCH /api/library/bravo");
    expect(cards()).toEqual([
      { title: "Alpha", archived: false },
      { title: "Bravo", archived: false },
      { title: "Charlie", archived: false },
      { title: "Delta", archived: true },
    ]);
  });

  it("keeps a card archived while Archived is on in place, marked, with Put back", async () => {
    await show("/?archived=1&by=title");
    await waitFor(() => cards().length === 4, "the archived rows");
    const alpha = [...host.querySelectorAll("main > ul:not([aria-label]) > li")].find((li) =>
      li.textContent?.includes("Alpha"),
    )!;
    click(alpha.querySelector<HTMLButtonElement>('[data-action="archive"]')!);
    await settle();
    expect(cards()).toEqual([
      { title: "Alpha", archived: true },
      { title: "Bravo", archived: true },
      { title: "Charlie", archived: false },
      { title: "Delta", archived: true },
    ]);
    expect(host.textContent).not.toContain("Loading archived…");
  });

  it("does not let the cached shelf's late live answer resurrect an archived row", async () => {
    cached = [...active];
    let release: () => void = () => {};
    activeGate = new Promise((r) => (release = r));
    await show("/?archived=1&by=title");
    await waitFor(() => cards().length === 4, "the cached and archived rows");

    const alpha = [...host.querySelectorAll("main > ul:not([aria-label]) > li")].find((li) =>
      li.textContent?.includes("Alpha"),
    )!;
    click(alpha.querySelector<HTMLButtonElement>('[data-action="archive"]')!);
    await settle();
    await act(async () => release());
    await settle();

    expect(cards().filter((row) => row.title === "Alpha")).toEqual([
      { title: "Alpha", archived: true },
    ]);
  });

  it("Undo reconciles both lists from the PATCH without depending on a second active-list read", async () => {
    await show("/?archived=1&by=title");
    await waitFor(() => cards().length === 4, "the archived rows");
    const alpha = [...host.querySelectorAll("main > ul:not([aria-label]) > li")].find((li) =>
      li.textContent?.includes("Alpha"),
    )!;
    click(alpha.querySelector<HTMLButtonElement>('[data-action="archive"]')!);
    await settle();

    const readsBeforeUndo = asked.filter((request) => request === "GET /api/library").length;
    activeFails = true;
    const undo = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Undo",
    )!;
    click(undo);
    await settle();

    expect(cards().filter((row) => row.title === "Alpha")).toEqual([
      { title: "Alpha", archived: false },
    ]);
    expect(asked.filter((request) => request === "GET /api/library")).toHaveLength(readsBeforeUndo);
    expect(host.textContent).not.toContain('Archived “Alpha”');
  });

  it("renames an archived card in place, and it stays archived", async () => {
    await show("/?archived=1&by=title");
    await waitFor(() => cards().length === 4, "the archived rows");
    const delta = () =>
      [...host.querySelectorAll("main > ul:not([aria-label]) > li")].find((li) =>
        li.querySelector('[data-action="restore"]') && li.textContent?.includes("Delta"),
      );
    click(delta()!.querySelector<HTMLButtonElement>('[data-action="edit"]')!);
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Title"]')!;
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    act(() => {
      set?.call(input, "Aardvark");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => input.form?.requestSubmit());
    await settle();
    expect(asked).toContain("PATCH /api/library/delta");
    expect(cards()).toEqual([
      { title: "Aardvark", archived: true },
      { title: "Alpha", archived: false },
      { title: "Bravo", archived: true },
      { title: "Charlie", archived: false },
    ]);
  });

  it("is reachable by a reader whose every article is archived", async () => {
    active = [];
    await show("/?by=title");
    const chip = archivedChip();
    expect(chip, "the chip over an empty active shelf").toBeTruthy();
    click(chip!);
    await settle();
    await waitFor(() => cards().length === 2, "the archived rows");
    expect(cards().map((c) => c.title)).toEqual(["Bravo", "Delta"]);
    expect(host.textContent).not.toContain("Nothing on the shelf yet");
  });

  it("draws the same merged, marked rows in the table view", async () => {
    await show("/?view=table&archived=1&by=title");
    await waitFor(() => tableRows().length === 4, "the archived rows");
    expect(tableRows()).toEqual([
      { title: "Alpha", archived: false },
      { title: "Bravo", archived: true },
      { title: "Charlie", archived: false },
      { title: "Delta", archived: true },
    ]);
    const bravo = [...host.querySelectorAll("tbody tr")].find((tr) => tr.textContent?.includes("Bravo"))!;
    expect(bravo.querySelector('[data-action="restore"]')).toBeTruthy();
    expect(bravo.querySelector('[data-action="archive"]')).toBeNull();
  });

  it("narrows the archived rows by search, and counts both halves", async () => {
    await show("/?archived=1&by=title&q=delta");
    await waitFor(() => !host.textContent?.includes("Loading archived…"), "the archive");
    expect(cards()).toEqual([{ title: "Delta", archived: true }]);
    expect(host.textContent).toMatch(/1 of 4 articles \(0 active \+ 1 archived\)/);
  });

  /* SPIDERYARN-READING2-72, plan 260930d: an archived article whose card
     words do not contain the query could be found by neither half of the
     search box — the passage search never asked for the archive. */
  it("searches the archived articles' text too when on, and marks the passage", async () => {
    await show("/?archived=1&q=zibble");
    const passage = () => [...host.querySelectorAll("section li a")].find((a) => a.textContent?.includes("zibble"));
    await waitFor(() => !!passage(), "the archived passage");
    expect(asked).toContain("GET /api/library/search?q=zibble&archived=1");
    expect(passage()?.querySelector("[data-archived-mark]"), "marked Archived").toBeTruthy();
  });

  it("says, beside the empty answer, how many archived articles mention it, with a button that includes them", async () => {
    /* Greg, spya-s9fhmw: *"add an extra button right there next to that
       empty-results-message for including archived … include a sense of how
       many archived … results would have matched"*. Plan 261002b § Part D. */
    await show("/?q=zibble");
    const line = () => host.querySelector<HTMLElement>("[data-search-also]");
    await waitFor(() => !!line()?.textContent?.includes("1 archived article mentions it"), "the count");
    expect(asked).toContain("GET /api/library/search?q=zibble");
    const button = [...(line()?.querySelectorAll("button") ?? [])].find((b) => b.textContent === "Include archived");
    expect(button, "the button beside it").toBeTruthy();
    if (!button) return;
    click(button);
    await waitFor(() => params().get("archived") === "1", "the chip on, in the URL");
    const passage = () => [...host.querySelectorAll("section li a")].find((a) => a.textContent?.includes("zibble"));
    await waitFor(() => !!passage(), "the archived passage after pressing it");
  });

  it("keeps the button at zero, and says zero", async () => {
    await show("/?q=nothing");
    const line = () => host.querySelector<HTMLElement>("[data-search-also]");
    await waitFor(() => !!line()?.textContent?.includes("No archived article mentions it"), "the zero");
    expect([...(line()?.querySelectorAll("button") ?? [])].map((b) => b.textContent)).toContain("Include archived");
  });

  it("asks again when the chip is pressed with the words unchanged", async () => {
    await show("/?q=zibble");
    const passage = () => [...host.querySelectorAll("section li a")].find((a) => a.textContent?.includes("zibble"));
    await waitFor(() => asked.includes("GET /api/library/search?q=zibble"), "the first search");
    expect(passage()).toBeUndefined();
    const chip = archivedChip();
    if (!chip) throw new Error("no chip");
    click(chip);
    await waitFor(() => !!passage(), "the archived passage after pressing the chip");
  });

  it("drops a late active-only answer that lands after the chip was pressed", async () => {
    /* The words are the same both times, so the echoed query alone cannot
       tell the two answers apart; the echoed `archived` does (Sol, plan
       review). The abort would normally stop the first request, and this
       mock ignores aborts — which is exactly the response that escapes one. */
    let release!: () => void;
    searchGate = new Promise((r) => {
      release = r;
    });
    await show("/?q=zibble");
    await waitFor(() => asked.includes("GET /api/library/search?q=zibble"), "the first, held search");
    const chip = archivedChip();
    if (!chip) throw new Error("no chip");
    click(chip);
    const passage = () => [...host.querySelectorAll("section li a")].find((a) => a.textContent?.includes("zibble"));
    await waitFor(() => !!passage(), "the archived passage");
    release();
    await settle(150);
    expect(passage(), "the late empty answer did not repaint the list").toBeTruthy();
  });

  it("drops a late active-only failure that lands after the chip was pressed", async () => {
    let release!: () => void;
    searchGate = new Promise((r) => {
      release = r;
    });
    searchFails = true;
    await show("/?q=zibble");
    await waitFor(() => asked.includes("GET /api/library/search?q=zibble"), "the first, held search");
    const chip = archivedChip();
    if (!chip) throw new Error("no chip");
    click(chip);
    const passage = () => [...host.querySelectorAll("section li a")].find((a) => a.textContent?.includes("zibble"));
    await waitFor(() => !!passage(), "the archived passage");
    release();
    await settle(150);
    expect(passage(), "the late failure did not replace the newer results").toBeTruthy();
    expect(host.textContent).not.toContain("Couldn't search the text");
  });
});
