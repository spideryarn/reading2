// @vitest-environment jsdom
/**
 * **The Topics row on the real shelf page**, mounted whole, with the URL real.
 *
 * Plan 260928a § The UI and § Stage 3. What has to hold, and cannot be seen by
 * testing `ShelfTerms` alone, is that the chips, the "n of m" line, the cards,
 * the table and the archived list are **one list narrowed once** — so every
 * assertion here reads what the page drew, not what a function returned:
 *
 *  - the chips' counts follow the one formula (shelf-narrow.ts) as the view
 *    narrows, and two chosen topics AND;
 *  - an unchosen chip at zero is not drawn at all, a chosen one at zero is,
 *    and the first twelve are the first twelve that have something to show
 *    (plan 260929a, Greg's report 4Y);
 *  - the "n of m" line equals the cards drawn, and the table obeys the filter;
 *  - `?archived=1` widens the topics' scope and merges the archived articles
 *    into the one list, narrowed by the same search and topics (report 4V);
 *  - a stale `?topics=` key is never applied before the topics load, and is
 *    dropped from the URL after;
 *  - "More detail" lists each topic's top articles, as links;
 *  - `pending > 0` says so, and asks again.
 *
 * The network is `apiFetch`, mocked by URL; the shelf is `useShelf`, mocked
 * with a real `useState` for the archived half so that opening it loads it.
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

const ACTIVE: LibraryEntry[] = [
  entry("mem-brain", "Memory and the brain", { opens: 0 }),
  entry("neurons", "Neurons firing"),
  entry("palaces", "Memory palaces", { opens: 0 }),
  entry("startups", "Startups and founders"),
];
/* `archivedAt`, as the server sets on every entry of the archived listing —
   it is what marks a merged row (shelf-narrow.ts § isArchived). */
const GONE = { archivedAt: "2026-09-20T00:00:00.000Z" };
const ARCHIVED: LibraryEntry[] = [
  entry("old-memory", "An old piece on memory", GONE),
  entry("old-other", "Something else archived", GONE),
];
let activeArticles = ACTIVE;
let archivedArticles = ARCHIVED;

const term = (key: string, ...members: [string, number][]) => ({
  key,
  label: key,
  articles: members.map(([slug, count]) => ({ slug, count })),
});

const ACTIVE_TERMS: LibraryTermsResponse = {
  terms: [
    term("memory", ["palaces", 9], ["mem-brain", 7], ["neurons", 2]),
    term("neuron", ["neurons", 8], ["mem-brain", 3]),
    term("startup", ["startups", 6]),
  ],
  scope: { articles: 4, works: 4, skipped: 0 },
  pending: 0,
  chosenBy: "program",
  refreshing: false,
};
const ALL_TERMS: LibraryTermsResponse = {
  terms: [
    term("memory", ["palaces", 9], ["mem-brain", 7], ["old-memory", 4], ["neurons", 2]),
    term("neuron", ["neurons", 8], ["mem-brain", 3]),
    term("startup", ["startups", 6]),
  ],
  scope: { articles: 6, works: 6, skipped: 0 },
  pending: 0,
  chosenBy: "program",
  refreshing: false,
};

/** Every URL `apiFetch` was asked for, in order. */
let asked: string[];
/** What `/api/library/terms` answers; a function so a test can hold it back. */
let answer: (url: string) => Promise<LibraryTermsResponse>;

vi.mock("../src/web/lib/api.js", () => ({
  apiFetch: async (url: string) => {
    asked.push(url);
    if (url.startsWith("/api/library/terms")) {
      const body = await answer(url);
      return new Response(JSON.stringify(body), { status: 200 });
    }
    return new Response(JSON.stringify({ query: "", hits: [], articles: 0, capped: false }), { status: 200 });
  },
  fetchOk: async () => new Response(null, { status: 200 }),
  readJson: (r: Response) => r.json(),
  statusOf: () => null,
}));

vi.mock("../src/web/useShelf.js", async () => {
  const React = await import("react");
  return {
    useShelf: () => {
      const [archived, setArchived] = React.useState<LibraryEntry[] | null>(null);
      const loadArchived = React.useCallback(async () => setArchived(archivedArticles), []);
      return React.useMemo(
        () => ({
          articles: activeArticles,
          error: null,
          reload: async () => {},
          undoable: null,
          archive: async () => {},
          undo: async () => {},
          rename: async () => {},
          editTags: async () => [],
          actionError: null,
          report: () => {},
          archived,
          archivedVisible: archived ?? [],
          archivedFailed: false,
          loadArchived,
          restore: async () => {},
          renaming: null,
          beginRename: () => {},
          cancelRename: () => {},
        }),
        [archived, loadArchived],
      );
    },
  };
});

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
const { REFRESHING_RETRIES, REFRESHING_RETRY_MS, shelfKeyOf } = await import("../src/web/useShelfTerms.js");
const { COLLAPSED_CHIPS, MIN_WORKS } = await import("../src/web/ShelfTerms.js");

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  asked = [];
  activeArticles = ACTIVE;
  archivedArticles = ARCHIVED;
  answer = async (url) => (url.includes("archived=1") ? ALL_TERMS : ACTIVE_TERMS);
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

/** Let fetches resolve and nuqs flush its queued URL write. */
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

/** The topic chips in the row (not the rows of the "More detail" view). */
function chips(): HTMLButtonElement[] {
  return [...host.querySelectorAll<HTMLButtonElement>("button[aria-pressed]")].filter(
    (b) => !b.closest('[aria-label="Topics in detail"]') && /^\S+ \d+ — /.test(b.getAttribute("aria-label") ?? ""),
  );
}
function chip(key: string): HTMLButtonElement {
  const found = chips().find((b) => (b.getAttribute("aria-label") ?? "").startsWith(`${key} `));
  if (!found) throw new Error(`no chip for ${key}; have ${chips().map((b) => b.getAttribute("aria-label")).join(" | ")}`);
  return found;
}
const chipCount = (key: string) => Number(chip(key).getAttribute("aria-label")?.split(" ")[1]);

/** The cards drawn — the cards `<ul>` is the page's one unlabelled list at top level. */
function cardItems(): HTMLLIElement[] {
  return [...host.querySelectorAll<HTMLLIElement>("main > ul:not([aria-label]) > li")];
}
/** The titles of the active cards drawn. */
function cards(): string[] {
  return cardItems()
    .filter((li) => !li.querySelector("[data-archived-mark]"))
    .map((li) => li.querySelector("h2")?.textContent?.trim() ?? "?");
}
/** The archived cards, which since plan 260929a are in the same list, marked. */
function archivedRows(): string[] {
  return cardItems()
    .filter((li) => li.querySelector("[data-archived-mark]"))
    .map((li) => li.querySelector("h2")?.textContent?.trim() ?? "?");
}
/** The Archived chip beside Unread. */
function archivedChip(): HTMLButtonElement {
  const found = [...host.querySelectorAll<HTMLButtonElement>("button[aria-pressed]")].find((b) =>
    (b.getAttribute("aria-label") ?? "").startsWith("Include archived"),
  );
  if (!found) throw new Error("no Archived chip");
  return found;
}
/** The placeholder row drawn while the topics are being asked for. */
function topicsLoading(): HTMLElement | null {
  return host.querySelector<HTMLElement>('[role="status"][aria-label="Loading topics"]');
}
function reservedControl(status: HTMLElement | null, label: string): HTMLElement | undefined {
  return [...(status?.querySelectorAll<HTMLElement>("span") ?? [])].find((el) =>
    el.textContent?.trim().startsWith(label),
  );
}
function countLine(): string | null {
  const p = [...host.querySelectorAll("p")].find((el) => /\bof \d+ articles?\b/.test(el.textContent ?? ""));
  return p?.textContent ?? null;
}

function click(el: HTMLElement) {
  act(() => el.click());
}

function typeIn(el: HTMLInputElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    set?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
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

describe("the Topics row", () => {
  it("draws a chip per topic with counts that follow the view", async () => {
    await show("/");
    expect(chipCount("memory")).toBe(3);
    expect(chipCount("neuron")).toBe(2);
    expect(chipCount("startup")).toBe(1);

    click(chip("memory"));
    await settle();
    expect(params().get("topics")).toBe("memory");
    expect(cards().sort()).toEqual(["Memory and the brain", "Memory palaces", "Neurons firing"]);
    expect(chipCount("memory")).toBe(3);
    expect(chipCount("neuron")).toBe(2);
    expect(chips().map((b) => b.getAttribute("aria-label")?.split(" ")[0])).not.toContain("startup");
    expect(chip("memory").getAttribute("aria-pressed")).toBe("true");
  });

  it("ANDs two topics", async () => {
    await show("/?topics=memory,neuron");
    expect(cards().sort()).toEqual(["Memory and the brain", "Neurons firing"]);
    expect(chipCount("memory")).toBe(2);
    expect(chipCount("neuron")).toBe(2);
  });

  it("hides an unchosen chip at zero, and keeps a chosen one at zero removable", async () => {
    /* Greg, 2026-09-29 (4Y): *"it should hide (or shunt to the right) any
       topic-pills that match 0 of the filtered articles"*. Hidden, not greyed. */
    await show("/?topics=memory");
    expect(chips().map((b) => b.getAttribute("aria-label")?.split(" ")[0])).toEqual(["memory", "neuron"]);
    expect(chips().some((b) => b.hasAttribute("aria-disabled"))).toBe(false);

    await act(async () => root.unmount());
    host.remove();
    await show("/?topics=startup&show=unread");
    expect(chipCount("startup")).toBe(0);
    expect(chip("startup").getAttribute("aria-pressed")).toBe("true");
    click(chip("startup"));
    await settle();
    expect(params().get("topics")).toBeNull();
  });

  it("says 'n of m' exactly as many cards as it draws", async () => {
    await show("/?topics=neuron");
    const line = countLine();
    expect(line).toMatch(/^2 of 4 articles/);
    expect(cards()).toHaveLength(2);
  });

  it("narrows the table view by the same filter", async () => {
    await show("/?view=table&topics=neuron");
    const rows = [...host.querySelectorAll("tbody tr")];
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.textContent).join(" ")).not.toContain("Startups");
  });

  it("never applies a stale key before the topics load, and drops it after", async () => {
    let release: (b: LibraryTermsResponse) => void = () => {};
    answer = () => new Promise((resolve) => (release = resolve));
    await show("/?topics=gone,memory");
    // Held back: nothing applied, nothing dropped, the whole shelf on screen.
    expect(cards()).toHaveLength(4);
    expect(params().get("topics")).toBe("gone,memory");

    await act(async () => release(ACTIVE_TERMS));
    await waitFor(() => params().get("topics") === "memory", "the stale key to be dropped");
    expect(cards()).toHaveLength(3);
  });

  it("carries a half-typed search into a topic history entry", async () => {
    await show("/");
    typeIn(host.querySelector<HTMLInputElement>('[aria-label="Search the library"]')!, "memory");
    click(chip("memory"));
    await settle(300);
    expect(params().get("q")).toBe("memory");
    expect(params().get("topics")).toBe("memory");
    expect(cards().sort()).toEqual(["Memory and the brain", "Memory palaces"]);
  });

  it("restores topic presses and the archive switch through Back and Forward", async () => {
    await show("/");
    click(chip("memory"));
    await settle();
    click(chip("neuron"));
    await settle();
    expect(params().get("topics")).toBe("memory,neuron");
    expect(cards()).toHaveLength(2);

    await traverse(() => history.back());
    expect(params().get("topics")).toBe("memory");
    expect(cards()).toHaveLength(3);
    await traverse(() => history.forward());
    expect(params().get("topics")).toBe("memory,neuron");
    expect(cards()).toHaveLength(2);

    click(archivedChip());
    await settle();
    expect(params().get("archived")).toBe("1");
    await traverse(() => history.back());
    expect(params().get("archived")).toBeNull();
    expect(params().get("topics")).toBe("memory,neuron");
  });

  it("lists every topic with the articles that use it most, as links, in More detail", async () => {
    await show("/");
    const toggle = [...host.querySelectorAll("button")].find((b) => b.textContent?.startsWith("More detail"));
    expect(toggle).toBeTruthy();
    click(toggle as HTMLButtonElement);
    await settle();
    expect(params().get("topicsView")).toBe("detail");
    const rows = [...host.querySelectorAll('[aria-label="Topics in detail"] > li')];
    expect(rows).toHaveLength(3);
    const memory = rows.find((r) => r.querySelector("button[aria-pressed]")?.getAttribute("aria-label")?.startsWith("memory "));
    expect(memory?.textContent).toContain("Memory palaces · Memory and the brain · Neurons firing");
    expect([...(memory?.querySelectorAll("a") ?? [])].map((a) => a.getAttribute("href"))).toEqual([
      "/read/palaces",
      "/read/mem-brain",
      "/read/neurons",
    ]);
  });

  it("gives each chip a card with both counts and the articles that use it most", async () => {
    await show("/?topics=neuron");
    const target = chip("memory");
    await act(async () => {
      target.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
      target.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true, pointerType: "mouse" }));
      target.focus();
    });
    await waitFor(() => document.body.textContent?.includes("match this view") ?? false, "the tooltip");
    const text = document.body.textContent ?? "";
    expect(text).toContain("2 match this view · 3 of 4 on the shelf");
    expect(text).toContain("Memory palaces — used 9 times");
    expect(text).toContain("nobody wrote this list");
  });

  it("hides zero pills in the detail view too, keeping a chosen one", async () => {
    await show("/?topics=memory&topicsView=detail");
    const rowKeys = () =>
      [...host.querySelectorAll('[aria-label="Topics in detail"] > li')].map(
        (r) => r.querySelector("button[aria-pressed]")?.getAttribute("aria-label")?.split(" ")[0],
      );
    expect(rowKeys()).toEqual(["memory", "neuron"]);

    await act(async () => root.unmount());
    host.remove();
    await show("/?topics=startup&show=unread&topicsView=detail");
    expect(rowKeys()).toEqual(["startup"]);
  });

  it("explains an all-zero detail view instead of drawing an unexplained empty list", async () => {
    await show("/?q=matches-nothing&topicsView=detail");
    expect(host.textContent).toContain("None of the topics is in this view.");
    expect(host.querySelector('[aria-label="Topics in detail"]')).toBeNull();
  });

  it("hides zero pills when a search narrows the shelf, with no topic chosen", async () => {
    await show("/?q=startups");
    expect(chips().map((b) => b.getAttribute("aria-label")?.split(" ")[0])).toEqual(["startup"]);
  });

  it("says it is still reading, and asks again until nothing is pending", async () => {
    let calls = 0;
    answer = async () => {
      calls++;
      return calls === 1 ? { ...ACTIVE_TERMS, pending: 2 } : ACTIVE_TERMS;
    };
    await show("/");
    expect(host.textContent).toContain("Reading 2 more articles…");
    await waitFor(() => calls >= 2, "a second request");
    await settle();
    expect(host.textContent).not.toContain("Reading 2 more articles…");
  });

  it("asks again while the model is choosing — and shows its pick — but only a bounded number of times", async () => {
    let calls = 0;
    answer = async () => {
      calls++;
      /* The model's pick arrives on the second answer, and that answer still
         says a refresh is under way, so the bound is what stops the asking. */
      return calls === 1
        ? { ...ACTIVE_TERMS, refreshing: true }
        : { ...ACTIVE_TERMS, terms: [term("neuron", ["neurons", 8], ["mem-brain", 3])], chosenBy: "model", refreshing: true };
    };
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["setTimeout", "clearTimeout"] });
    try {
      await show("/");
      expect(calls).toBe(1);
      expect(chips()).toHaveLength(3);
      for (let i = 0; i < REFRESHING_RETRIES + 2; i++) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(REFRESHING_RETRY_MS + 10);
        });
        await settle();
      }
      expect(calls).toBe(1 + REFRESHING_RETRIES);
      expect(chips().map((b) => b.getAttribute("aria-label")?.split(" ")[0])).toEqual(["neuron"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("says why there are no topics on a small shelf", async () => {
    answer = async () => ({ terms: [], scope: { articles: 4, works: 3, skipped: 0 }, pending: 0, chosenBy: "program", refreshing: false });
    await show("/");
    expect(host.textContent).toContain("Topics appear once there are about eight different articles");
  });

  it("draws no row, and does not crash, when the request fails", async () => {
    answer = async () => {
      throw new Error("boom");
    };
    await show("/?topics=memory");
    expect(chips()).toHaveLength(0);
    expect(cards()).toHaveLength(4);
    // A failure is not a wait: no spinner that spins for ever.
    expect(topicsLoading()).toBeNull();
  });

  it("shows a spinner in the row's place while the topics load, and the pills once they land (report a4xsg3)", async () => {
    let release: (body: LibraryTermsResponse) => void = () => {};
    answer = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    await show("/");
    const status = topicsLoading();
    expect(status).not.toBeNull();
    expect(status?.querySelector(".cmt-spinner")).not.toBeNull();
    // Words beside the spinner, never a bare one (icons.md § The loading spinner).
    expect(status?.textContent).toContain("Loading topics…");
    expect(chips()).toHaveLength(0);

    // Four articles: too few for topics, so one line and no outline pills.
    expect(status?.querySelectorAll("[data-ghost-pill]")).toHaveLength(0);

    await act(async () => release(ACTIVE_TERMS));
    await settle();
    expect(topicsLoading()).toBeNull();
    expect(chips()).toHaveLength(3);
  });

  it("holds the collapsed row's shape in outlines when enough article rows make topics possible", async () => {
    activeArticles = Array.from({ length: MIN_WORKS }, (_, i) => ({ ...ACTIVE[i % ACTIVE.length]!, slug: `many-${i}` }));
    answer = () => new Promise(() => {});
    await show("/");
    const status = topicsLoading();
    const ghosts = status?.querySelectorAll("[data-ghost-pill]") ?? [];
    // The spinner and its words take the first pill's place.
    expect(ghosts).toHaveLength(COLLAPSED_CHIPS - 1);
    for (const g of ghosts) expect(g.getAttribute("aria-hidden")).toBe("true");
    // Eight article rows can produce at most eight topics, so the real
    // collapsed row cannot have its conditional "All N topics" control.
    expect(reservedControl(status, "All")).toBeUndefined();
    expect(reservedControl(status, "More detail")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("reserves the conditional All-topics control only when more than twelve topics are possible", async () => {
    activeArticles = Array.from({ length: COLLAPSED_CHIPS + 1 }, (_, i) => ({
      ...ACTIVE[i % ACTIVE.length]!,
      slug: `many-${i}`,
    }));
    answer = () => new Promise(() => {});
    await show("/");
    const all = reservedControl(topicsLoading(), "All");
    expect(all?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("the archive in scope", () => {
  it("stops applying the old scope's topics while the widened scope loads", async () => {
    let releaseArchive: (body: LibraryTermsResponse) => void = () => {};
    answer = (url) =>
      url.includes("archived=1")
        ? new Promise((resolve) => {
            releaseArchive = resolve;
          })
        : Promise.resolve(ACTIVE_TERMS);
    await show("/?topics=memory");
    expect(cards()).toHaveLength(3);

    click(archivedChip());
    await settle();

    expect(asked).toContain("/api/library/terms?archived=1");
    expect(chips()).toHaveLength(0);
    expect(topicsLoading()).not.toBeNull();
    expect(cards()).toHaveLength(4);
    expect(archivedRows()).toHaveLength(2);

    await act(async () => releaseArchive(ALL_TERMS));
  });

  it("widens the topics to active + archived and narrows the archived list with them", async () => {
    await show("/?archived=1&topics=memory");
    expect(asked.some((u) => u === "/api/library/terms?archived=1")).toBe(true);
    await waitFor(() => archivedRows().length > 0, "the archived list");
    expect(chipCount("memory")).toBe(4);
    expect(archivedRows()).toHaveLength(1);
    expect(archivedRows()[0]).toContain("An old piece on memory");
    expect(cardItems()).toHaveLength(4);
    expect(countLine()).toMatch(/^4 of 6 articles \(3 active \+ 1 archived\)/);
  });

  it("keeps the combined count equal to the table rows, archived ones included", async () => {
    await show("/?view=table&archived=1&topics=memory");
    await waitFor(() => host.querySelectorAll("tbody tr [data-archived-mark]").length > 0, "the archived rows");
    expect(host.querySelectorAll("tbody tr")).toHaveLength(4);
    expect(host.querySelectorAll("tbody tr [data-archived-mark]")).toHaveLength(1);
    expect(countLine()).toMatch(/^4 of 6 articles \(3 active \+ 1 archived\)/);
  });

  it("stays visible, and narrowed, during a search", async () => {
    await show("/?archived=1&q=something");
    await waitFor(() => archivedRows().length > 0, "the archived list");
    expect(archivedRows()).toHaveLength(1);
    expect(archivedRows()[0]).toContain("Something else archived");
    expect(cards()).toHaveLength(0);
  });

  it("is switched by the Archived chip beside Unread, through the URL", async () => {
    await show("/");
    click(archivedChip());
    await settle();
    expect(params().get("archived")).toBe("1");
    await waitFor(() => archivedRows().length === 2, "the archived list");
  });

  it("draws chips in the server's rank order, not by count, and pressing one reorders nothing (plans 260928d, 260929a)", async () => {
    /* rank order startup (1 article), neuron (2), memory (3) — the reverse of count order */
    answer = async () => ({ ...ACTIVE_TERMS, terms: [...ACTIVE_TERMS.terms].reverse() });
    await show("/");
    const order = () => chips().map((b) => (b.getAttribute("aria-label") ?? "").split(" ")[0]);
    expect(order()).toEqual(["startup", "neuron", "memory"]);
    click(chip("memory"));
    await settle();
    /* "startup" has nothing left to show once "memory" is chosen, so it goes
       (plan 260929a, 4Y); the others keep their order. */
    expect(order()).toEqual(["neuron", "memory"]);
  });

  it("draws the first twelve by rank, plus a chosen one further down in its own place", async () => {
    const keys = Array.from({ length: 14 }, (_, i) => `topic${String(i).padStart(2, "0")}`);
    answer = async () => ({
      ...ACTIVE_TERMS,
      terms: keys.map((k) => term(k, ["palaces", 3], ["neurons", 2])),
    });
    await show("/?topics=topic13");
    const order = () =>
      [...host.querySelectorAll<HTMLButtonElement>("button[aria-pressed]")]
        .filter((b) => !b.closest('[aria-label="Topics in detail"]'))
        .map((b) => (b.getAttribute("aria-label") ?? "").split(" ")[0])
        .filter((k) => /^topic\d\d$/.test(k ?? ""));
    await waitFor(() => order().length > 0, "the chips");
    expect(order()).toEqual([...keys.slice(0, 12), "topic13"]);
  });

  it("takes the first twelve from the pills that have something to show — no holes (Sol R5)", async () => {
    /* Sixteen topics; the odd-numbered ones use only "startups", so choosing
       topic00 (palaces + neurons) zeroes them. The row must then be the first
       twelve *available* — ten even ones by rank would leave holes. */
    const keys = Array.from({ length: 16 }, (_, i) => `topic${String(i).padStart(2, "0")}`);
    answer = async () => ({
      ...ACTIVE_TERMS,
      terms: keys.map((k, i) => (i % 2 ? term(k, ["startups", 3]) : term(k, ["palaces", 3], ["neurons", 2]))),
    });
    await show("/?topics=topic00");
    const order = () =>
      [...host.querySelectorAll<HTMLButtonElement>("button[aria-pressed]")]
        .filter((b) => !b.closest('[aria-label="Topics in detail"]'))
        .map((b) => (b.getAttribute("aria-label") ?? "").split(" ")[0])
        .filter((k) => /^topic\d\d$/.test(k ?? ""));
    await waitFor(() => order().length > 0, "the chips");
    const even = keys.filter((_, i) => i % 2 === 0);
    expect(order()).toEqual(even);
    // Eight available, so no "All N topics" to offer.
    expect([...host.querySelectorAll("button")].some((b) => /^All \d+ topics/.test(b.textContent ?? ""))).toBe(false);
  });

  it("counts only the pills it would show in \"All N topics\"", async () => {
    const keys = Array.from({ length: 20 }, (_, i) => `topic${String(i).padStart(2, "0")}`);
    answer = async () => ({
      ...ACTIVE_TERMS,
      /* 0–14 on palaces, 15–19 only on startups: 20 topics, 15 once a
         palaces topic is chosen. */
      terms: keys.map((k, i) => (i < 15 ? term(k, ["palaces", 3]) : term(k, ["startups", 3]))),
    });
    await show("/");
    const all = () => [...host.querySelectorAll("button")].find((b) => /^All \d+ topics/.test(b.textContent ?? ""));
    await waitFor(() => !!all(), "the All button");
    expect(all()?.textContent).toMatch(/^All 20 topics/);

    click(chip("topic00"));
    await settle();
    expect(all()?.textContent).toMatch(/^All 15 topics/);
    click(all()!);
    await settle();
    const drawn = [...host.querySelectorAll<HTMLButtonElement>("button[aria-pressed]")]
      .map((b) => (b.getAttribute("aria-label") ?? "").split(" ")[0])
      .filter((k) => /^topic\d\d$/.test(k ?? ""));
    expect(drawn).toEqual(keys.slice(0, 15));
  });

  it("shows topics when every article is archived and the active shelf is empty", async () => {
    activeArticles = [];
    archivedArticles = [
      entry("old-memory", "An old piece on memory", GONE),
      ...Array.from({ length: 7 }, (_, i) => entry(`old-${i}`, `Old article ${i}`, GONE)),
    ];
    answer = async () => ({
      terms: [term("memory", ["old-memory", 4])],
      scope: { articles: 8, works: 8, skipped: 0 },
      pending: 0,
      chosenBy: "program",
      refreshing: false,
    });
    await show("/?archived=1");
    await waitFor(() => archivedRows().length === 8, "the archived list");
    expect(chipCount("memory")).toBe(1);
  });
});

describe("Tags and Topics on the real shelf", () => {
  it("ANDs both URL filters and gives both chosen chips the same visible count", async () => {
    activeArticles = [
      entry("mem-brain", "Memory and the brain", { tags: ["research", "read"], opens: 0 }),
      entry("neurons", "Neurons firing", { tags: ["research"] }),
      entry("palaces", "Memory palaces", { tags: ["read"], opens: 0 }),
      entry("startups", "Startups and founders", { tags: ["research", "read"] }),
    ];
    archivedArticles = [
      entry("old-memory", "An old piece on memory", { ...GONE, tags: ["research", "read"] }),
      entry("old-other", "Something else archived", { ...GONE, tags: ["read"] }),
    ];

    await show("/?archived=1&tags=research&topics=memory");
    await waitFor(() => archivedRows().length > 0, "the tagged archived row");

    expect(cards().sort()).toEqual(["Memory and the brain", "Neurons firing"]);
    expect(archivedRows()).toEqual(["An old piece on memory"]);
    expect(chipCount("research")).toBe(3);
    expect(chipCount("memory")).toBe(3);
    expect(chip("research").getAttribute("aria-pressed")).toBe("true");
    expect(chip("memory").getAttribute("aria-pressed")).toBe("true");
    expect(countLine()).toMatch(/^3 of 6 articles \(2 active \+ 1 archived\)/);
  });
});

/* Topics a model named as a broad-to-fine tree (plan 261003f): no phrase
   counts, a marker on the finer pills, the broader topic named in the card,
   and the finer topics inside a chosen one moved up beside it. */
describe("topics a model named", () => {
  const named = (label: string, granularity: number, within: string | undefined, ...slugs: string[]) => ({
    key: label.toLowerCase(),
    label,
    articles: slugs.map((slug) => ({ slug })),
    granularity,
    ...(within === undefined ? {} : { within }),
  });
  /* Broad first, as the server sends them. *Business* shares mem-brain with
     *Neuroscience*, so it survives that choice and the ordering has work to do. */
  const NAMED_TERMS: LibraryTermsResponse = {
    terms: [
      named("Neuroscience", 0, undefined, "mem-brain", "neurons", "palaces"),
      named("Business", 0, undefined, "startups", "mem-brain"),
      named("Memory", 0.5, "neuroscience", "palaces", "mem-brain"),
      named("Mnemonics", 0.75, "memory", "palaces"),
    ],
    scope: { articles: 4, works: 4, skipped: 0 },
    pending: 0,
    chosenBy: "model",
    refreshing: false,
  };
  const labels = () => chips().map((b) => b.getAttribute("aria-label")?.split(" ")[0]);
  const marked = () => chips().filter((b) => b.querySelector("[data-topic-finer]")).map((b) => b.getAttribute("aria-label")?.split(" ")[0]);
  async function hover(target: HTMLElement) {
    await act(async () => {
      target.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
      target.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true, pointerType: "mouse" }));
      target.focus();
    });
  }

  beforeEach(() => {
    answer = async () => NAMED_TERMS;
  });

  it("draws them broad first, marks only the finer ones, and puts the labels in the model's face", async () => {
    await show("/");
    expect(labels()).toEqual(["Neuroscience", "Business", "Memory", "Mnemonics"]);
    expect(marked()).toEqual(["Memory", "Mnemonics"]);
    for (const b of chips()) expect(b.querySelector(".voice-ai")?.textContent).toBe(b.getAttribute("aria-label")?.split(" ")[0]);
    /* The marker is decoration: the accessible name is still the label first. */
    expect(chip("Memory").querySelector("[data-topic-finer]")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("leaves a phrase topic unmarked and in the app's own face", async () => {
    answer = async () => ACTIVE_TERMS;
    await show("/");
    expect(marked()).toEqual([]);
    expect(host.querySelector("button[aria-pressed] .voice-ai")).toBeNull();
  });

  it("moves the finer topics inside a chosen subject up beside it", async () => {
    await show("/");
    click(chip("Neuroscience"));
    await settle();
    expect(params().get("topics")).toBe("neuroscience");
    expect(labels()).toEqual(["Neuroscience", "Memory", "Business", "Mnemonics"]);
    click(chip("Memory"));
    await settle();
    expect(labels()).toEqual(["Neuroscience", "Memory", "Mnemonics", "Business"]);
  });

  it("says which broader topic a finer one is inside, and never 'used N times'", async () => {
    await show("/");
    await hover(chip("Memory"));
    await waitFor(() => document.body.textContent?.includes("match this view") ?? false, "the tooltip");
    const text = document.body.textContent ?? "";
    expect(document.body.querySelector("[data-topic-inside]")?.textContent).toBe("Inside Neuroscience");
    expect(text).toContain("2 match this view · 2 of 4 on the shelf");
    /* Members in the order sent (newest first), with nothing after the title. */
    expect(text).toContain("Memory palacesMemory and the brain");
    expect(text).not.toMatch(/used \d* ?times?|used undefined/);
    expect(text).toContain("Named by a model");
    expect(text).not.toContain("nobody wrote this list");
  });

  it("says nothing about a broader topic on a broad subject's card", async () => {
    await show("/");
    await hover(chip("Neuroscience"));
    await waitFor(() => document.body.textContent?.includes("match this view") ?? false, "the tooltip");
    expect(document.body.querySelector("[data-topic-inside]")).toBeNull();
  });

  it("explains itself on the word Topics: a model named them, broad first, new articles sorted in", async () => {
    await show("/");
    const word = [...host.querySelectorAll<HTMLElement>("span[tabindex]")].find((s) => s.textContent === "Topics");
    expect(word).toBeTruthy();
    await hover(word as HTMLElement);
    await waitFor(() => document.body.textContent?.includes("a model named") ?? false, "the Topics card");
    const text = document.body.textContent ?? "";
    expect(text).toContain("titles and summaries of your articles");
    expect(text).toContain("Broad subjects come first");
    expect(text).toContain("New articles are sorted into the topics automatically");
    expect(text).not.toContain("Phrases your articles use");
  });

  it("keeps the phrase card for phrase topics", async () => {
    answer = async () => ACTIVE_TERMS;
    await show("/");
    const word = [...host.querySelectorAll<HTMLElement>("span[tabindex]")].find((s) => s.textContent === "Topics");
    await hover(word as HTMLElement);
    await waitFor(() => document.body.textContent?.includes("Phrases your articles use") ?? false, "the Topics card");
    expect(document.body.textContent).not.toContain("a model named");
  });

  it("indents the finer rows of More detail by depth, with the same marker on their chips", async () => {
    await show("/?topicsView=detail");
    const rows = [...host.querySelectorAll('[aria-label="Topics in detail"] > li')];
    expect(rows.map((r) => r.querySelector("[data-topic-depth]")?.getAttribute("data-topic-depth"))).toEqual(["0", "0", "1", "2"]);
    expect(rows.map((r) => !!r.querySelector("[data-topic-finer]"))).toEqual([false, false, true, true]);
    /* Newest first, as sent — not re-sorted by a count that is not there. */
    expect([...(rows[0]?.querySelectorAll("a") ?? [])].map((a) => a.getAttribute("href"))).toEqual([
      "/read/mem-brain",
      "/read/neurons",
      "/read/palaces",
    ]);
  });
});

/* `?topics=` while a model refresh is under way. A refresh can bring a topic
   back, so a key missing from a `refreshing` answer is neither applied nor
   dropped; it goes on the settled answer, or when the asking gives up. */
describe("a chosen key during a model refresh", () => {
  const withGone: LibraryTermsResponse = {
    ...ACTIVE_TERMS,
    terms: [...ACTIVE_TERMS.terms, term("gone", ["startups", 2])],
  };
  async function tick() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESHING_RETRY_MS + 10);
    });
    await settle();
  }

  it("keeps the key through a refreshing answer, and applies it when the refresh brings the topic back", async () => {
    let calls = 0;
    answer = async () => (++calls === 1 ? { ...ACTIVE_TERMS, refreshing: true } : withGone);
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["setTimeout", "clearTimeout"] });
    try {
      await show("/?topics=gone,memory");
      await settle(200);
      expect(calls).toBe(1);
      expect(params().get("topics"), "dropped during the refresh").toBe("gone,memory");
      /* Not applied either: *memory* alone narrows to three. */
      expect(cards()).toHaveLength(3);
      await tick();
      expect(calls).toBe(2);
      expect(params().get("topics")).toBe("gone,memory");
      expect(cards()).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops the key when the settled answer still lacks it", async () => {
    let calls = 0;
    answer = async () => (++calls === 1 ? { ...ACTIVE_TERMS, refreshing: true } : ACTIVE_TERMS);
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["setTimeout", "clearTimeout"] });
    try {
      await show("/?topics=gone,memory");
      await settle(200);
      expect(params().get("topics")).toBe("gone,memory");
      await tick();
      await waitFor(() => params().get("topics") === "memory", "the stale key to be dropped");
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops the key once the asking has given up on a refresh that never lands", async () => {
    let calls = 0;
    answer = async () => {
      calls++;
      return { ...ACTIVE_TERMS, refreshing: true };
    };
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["setTimeout", "clearTimeout"] });
    try {
      await show("/?topics=gone,memory");
      for (let i = 0; i < REFRESHING_RETRIES - 1; i++) await tick();
      expect(calls).toBe(REFRESHING_RETRIES);
      expect(params().get("topics"), "dropped while still asking").toBe("gone,memory");
      await tick();
      expect(calls).toBe(1 + REFRESHING_RETRIES);
      await waitFor(() => params().get("topics") === "memory", "the stale key to be dropped");
    } finally {
      vi.useRealTimers();
    }
  });
});

/* Pure, so outside the block above: its afterEach unmounts a root this test
   never mounts. */
describe("shelfKeyOf", () => {
  it("asks a new question for a new revision even when its counts and words are unchanged", () => {
    const before = [entry("same", "Same title", { revisionId: "6849672c-0fe4-4b17-8fec-3e1be53fa862" })];
    const after = [entry("same", "Same title", { revisionId: "66f7a3c7-9bcc-4b79-aeee-8157433948a1" })];
    expect(shelfKeyOf(after, null, false)).not.toBe(shelfKeyOf(before, null, false));
  });
});
