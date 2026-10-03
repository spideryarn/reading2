// @vitest-environment jsdom
/**
 * **The shelf's Table view: a card on each title, and whole titles.**
 *
 * Greg, 2026-09-28:
 *
 * > Include a rich tooltip for each row that shows a bunch of extra stuff about
 * > the article. … Perhaps always show the full article title on each row?
 *
 * docs/plans/260928a-shelf-table-view-row-card-full-titles-hide-columns.md,
 * stage 1. What has to hold, and why each is its own assertion:
 *
 *  - **The card is defined by subtraction** (Decision 2, the rule Structure's
 *    card set — docs/project/tooltips.md § Structure's card). It carries the
 *    gist and the exact dates, and none of the values the row is already
 *    printing. A card that repeats the row is the restatement failure, and it
 *    is the one a screenshot of a single hover would never show.
 *  - **Exactly one card is ever open.** The row also holds five action buttons
 *    with cards of their own; two nested `TooltipGroup`s each keep their own
 *    current member, so a focused title and a hovered action could both be up
 *    (GPT Sol, plan review P-3). Counted under `document.body`, because the
 *    panels are portalled there rather than into the table.
 *  - **No `title` attribute in the table body.** The one that was there — "Never
 *    opened" on the em dash — is unreachable by touch and by keyboard.
 *  - **Titles wrap.** `truncate` was the "too truncated".
 *
 * The hover mechanics are docs/project/tooltips.md § Three things about testing
 * a card in jsdom, copied from tests/dock-mode-tooltips.test.tsx's `cardFor`.
 */
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { SortingState } from "@tanstack/react-table";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryEntry } from "../src/types.js";

/* Nothing here reaches the network, but importing the real module drags the
   Supabase client and `import.meta.env` in behind it. Same mock, same reason,
   as tests/shelf-shared-badge.test.tsx. */
vi.mock("../src/web/lib/api.js", () => ({
  fetchOk: () => Promise.resolve(new Response(null, { status: 200 })),
  apiFetch: () => Promise.resolve(new Response(null, { status: 200 })),
  readJson: () => Promise.resolve({}),
}));

const { libraryColumns, rowCardFacts } = await import("../src/web/library-columns.js");
const { DataTable, useSortedTable } = await import("../src/web/lib/DataTable.js");
const { TooltipGroup } = await import("../src/web/Tooltip.js");
const { VIEW_TIPS } = await import("../src/web/ShelfControls.js");
const { exactly } = await import("../src/web/relative-time.js");
const { SHARING_ON } = await import("../src/messages.js");

const NOW = Date.parse("2026-09-28T12:00:00.000Z");

/**
 * **Numbers chosen so none of them can turn up by accident** in a date, a
 * block count or a section count — the "does not repeat the row" assertions
 * search the card's text for them, and `7` would be found in half the dates of
 * the year.
 */
const ENTRY: LibraryEntry = {
  slug: "row-card-piece",
  title: "On the unreasonable effectiveness of reading slowly, and other essays",
  byline: "Ada Quillfeather",
  siteName: "The Longform Review",
  addedAt: "2026-08-12T09:15:00.000Z",
  lastOpenedAt: "2026-09-20T16:05:00.000Z",
  words: 3456,
  minutes: 16,
  blocks: 97,
  parts: 4,
  sections: 11,
  comments: 38,
  opens: 41,
  sourceReusable: true,
  gist: "Slow reading is argued to be a skill that compounds rather than a luxury.",
  titleOverridden: true,
  has: { arc: true, tweets: true, glossary: false },
};

/** The same shape, with nothing optional — never opened, no gist, nothing built. */
const BARE: LibraryEntry = {
  slug: "row-card-bare",
  title: "A bare piece",
  addedAt: "2026-09-01T08:30:00.000Z",
  words: 900,
  minutes: 4,
  blocks: 20,
  parts: 1,
  sections: 1,
  comments: 0,
  opens: 0,
  sourceReusable: true,
  has: { arc: false, tweets: false, glossary: false },
};

const shelf = {
  renaming: null,
  report: () => {},
  archive: () => Promise.resolve(),
  beginRename: () => {},
  cancelRename: () => {},
  rename: () => Promise.resolve(),
} as unknown as Parameters<typeof libraryColumns>[0];

/** Stable across renders — an array rebuilt per render is a render loop here. */
const SORTING: SortingState = [{ id: "opened", desc: true }];

/**
 * The table, mounted the way Library.tsx mounts it — **inside one
 * `TooltipGroup`**, because that group is part of what is under test: the row's
 * action buttons have to join it rather than start their own.
 */
function Table({ entries }: { entries: LibraryEntry[] }): ReactElement {
  const table = useSortedTable<LibraryEntry>({
    data: entries,
    columns: libraryColumns(shelf, NOW),
    sorting: SORTING,
    onSortingChange: () => {},
    rowId: (e) => e.slug,
  });
  return createElement(
    TooltipGroup,
    { delay: { open: 240, close: 90 }, timeoutMs: 400 },
    createElement(DataTable<LibraryEntry>, {
      table,
      rows: table.getRowModel().rows,
      caption: "Your articles",
    }),
  );
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function paint(entries: LibraryEntry[] = [ENTRY]): void {
  act(() => {
    root.render(createElement(Table, { entries }));
  });
}

const flat = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/** Every card open anywhere — they are portalled to `<body>`, not into `host`. */
const openCards = () => [...document.body.querySelectorAll<HTMLElement>(".tooltip")];

/** The title link of the row for this slug. */
function titleLink(slug = ENTRY.slug): HTMLAnchorElement {
  const a = host.querySelector<HTMLAnchorElement>(`tbody a[href$="${slug}"]`);
  expect(a, `no title link for ${slug}`).not.toBeNull();
  return a as HTMLAnchorElement;
}

/** An action button in the row, by the start of its accessible name. */
function action(name: string): HTMLElement {
  const hit = [...host.querySelectorAll<HTMLElement>("tbody [data-action]")].filter((el) =>
    (el.getAttribute("aria-label") ?? "").startsWith(name),
  );
  expect(hit, `no single action named ${name}`).toHaveLength(1);
  return hit[0] as HTMLElement;
}

async function wait(ms: number): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

function enter(el: Element): void {
  el.dispatchEvent(new MouseEvent("mouseenter"));
}

/** Both leave events: a native `mouseleave` alone leaves the card up. */
function leave(el: Element): void {
  el.dispatchEvent(new MouseEvent("mouseleave"));
  el.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }));
}

/** Two `act` blocks to close and a third to wait out the group — tooltips.md. */
async function settle(): Promise<void> {
  for (const _ of [0, 1, 2]) await wait(300);
}

/** Hover the title and read the one card it opens. */
async function hoverTitle(slug = ENTRY.slug): Promise<string> {
  enter(titleLink(slug));
  await wait(400);
  const cards = openCards();
  expect(cards, "hovering the title opened no card, or more than one").toHaveLength(1);
  return flat(cards[0]?.textContent);
}

/* ----------------------------------------------------------- the card ---- */

describe("the row card", () => {
  it("opens on hovering the title, with the gist and the exact dates", async () => {
    paint();
    const text = await hoverTitle();
    expect(text).toContain(ENTRY.gist ?? "no gist");
    expect(text).toContain(exactly(ENTRY.addedAt) ?? "no date");
    expect(text).toContain(exactly(ENTRY.lastOpenedAt) ?? "no date");
    leave(titleLink());
    await settle();
    expect(openCards()).toHaveLength(0);
  });

  it("opens on focus too, so the keyboard gets what the mouse does", async () => {
    paint();
    const link = titleLink();
    await act(async () => {
      link.focus();
      await new Promise((r) => setTimeout(r, 400));
    });
    const cards = openCards();
    expect(cards, "focusing the title opened no card, or more than one").toHaveLength(1);
    expect(flat(cards[0]?.textContent)).toContain(ENTRY.gist ?? "no gist");
    await act(async () => {
      link.blur();
      await new Promise((r) => setTimeout(r, 300));
    });
  });

  /**
   * **Subtraction.** Everything named here is on the row already — the byline
   * and site under the title, the three counts in their columns — so a card
   * carrying any of them makes the reader re-read what they are looking at.
   */
  it("repeats nothing the row is already showing", async () => {
    paint();
    const text = await hoverTitle();
    for (const shown of [
      ENTRY.title,
      "Ada Quillfeather",
      "The Longform Review",
      "3,456",
      "3456",
      "41",
      "38",
      "16 min",
    ]) {
      expect(text, `the card repeats "${shown}", which the row shows`).not.toContain(shown);
    }
    leave(titleLink());
    await settle();
  });
});

/* ------------------------------------------------ exactly one card open ---- */

/**
 * **Only the third of these tells one group from two.** Moving the pointer
 * leaves the first trigger, and leaving closes its card whatever the groups
 * are — so the first two pin the ordinary scrub, and they were red for the
 * nested version only when read inside the same `act` as the close, which is a
 * timing artefact rather than a finding. Focus does not leave when the pointer
 * moves, which is why the third is the real test of Sol P-3: checked against a
 * table whose actions keep their own group, it reads two cards every run.
 */
describe("one card at a time", () => {
  it("title, then an action: only the action's card is up", async () => {
    paint();
    await hoverTitle();
    leave(titleLink());
    const edit = action("Edit title");
    enter(edit);
    await wait(400);
    await wait(300); // the title card closes in the block above and unmounts in this one
    const cards = openCards();
    expect(cards).toHaveLength(1);
    expect(flat(cards[0]?.textContent)).toContain("Edit title");
    leave(edit);
    await settle();
    expect(openCards()).toHaveLength(0);
  });

  it("an action, then the title: only the title's card is up", async () => {
    paint();
    const copy = action("Copy link");
    enter(copy);
    await wait(400);
    expect(openCards()).toHaveLength(1);
    leave(copy);
    enter(titleLink());
    await wait(400);
    await wait(300); // the copy card closes in the block above and unmounts in this one
    const cards = openCards();
    expect(cards).toHaveLength(1);
    expect(flat(cards[0]?.textContent)).toContain(ENTRY.gist ?? "no gist");
    leave(titleLink());
    await settle();
  });

  /**
   * **The case two nested groups get wrong** (Sol P-3). Focus does not leave
   * when the pointer moves, so the title's card stays up by focus while the
   * pointer opens an action's — and if the action row kept a private group,
   * nothing would close the title's.
   */
  it("a focused title and a hovered action: still exactly one", async () => {
    paint();
    const link = titleLink();
    await act(async () => {
      link.focus();
      await new Promise((r) => setTimeout(r, 400));
    });
    expect(openCards()).toHaveLength(1);
    const archive = action("Archive");
    enter(archive);
    await wait(400);
    /* A second block, because the title's card is closed by the group inside
       the first and only *unmounted* by the render after it — the same two-act
       shape as closing (tooltips.md § Three things). Without it this reads two
       cards whether or not the groups are one. */
    await wait(300);
    const cards = openCards();
    expect(cards, "the title's card and the action's are both open").toHaveLength(1);
    expect(flat(cards[0]?.textContent)).toContain("Archive");
    leave(archive);
    await act(async () => {
      link.blur();
      await new Promise((r) => setTimeout(r, 300));
    });
    await settle();
  });
});

/* ------------------------------------------------------- the row itself ---- */

describe("the row", () => {
  it("has no title attribute anywhere in the table body", () => {
    paint([ENTRY, BARE, { ...BARE, slug: "row-card-shared", visibility: "public" }]);
    const titled = [...host.querySelectorAll("tbody [title]")].map((el) => el.outerHTML.slice(0, 80));
    expect(titled).toEqual([]);
  });

  it("says never opened to a screen reader without a title attribute", () => {
    paint([BARE]);
    const row = host.querySelector("tbody tr");
    expect(row?.textContent).toContain("never opened");
    /* Any hidden element saying "—", not the first hidden one: the tag
       control's icon (ShelfTags.tsx) is hidden too, and comes earlier. */
    const hidden = [...(row?.querySelectorAll("[aria-hidden='true']") ?? [])];
    expect(hidden.map((el) => el.textContent)).toContain("—");
  });

  it("wraps the title and byline line even when either contains an unbroken word", () => {
    paint();
    const link = titleLink();
    expect(link.className).not.toMatch(/\btw:truncate\b/);
    expect(link.className).toMatch(/\btw:wrap-anywhere\b/);
    const byline = [...host.querySelectorAll<HTMLElement>("tbody span")].find((el) =>
      (el.textContent ?? "").includes("Ada Quillfeather"),
    );
    expect(byline, "no byline line").toBeDefined();
    expect(byline?.className ?? "").not.toMatch(/\btw:truncate\b/);
    expect(byline?.className ?? "").toMatch(/\btw:wrap-anywhere\b/);
  });

  it("draws the Added cell as plain text, with no card of its own", () => {
    paint();
    const cells = [...host.querySelectorAll("tbody tr td")];
    // Article, Added, … — the second cell is Added.
    expect(cells[1]?.querySelector("button")).toBeNull();
  });

  /**
   * **The scroll box is the containing block for the `sr-only` labels inside
   * it.** Found in the browser at 390px and 320px, 2026-09-28: the Actions
   * header's `sr-only` span is `position: absolute`, and with no positioned
   * ancestor its box was placed against the table's full intrinsic width
   * rather than clipped by the scrolling wrapper — so the *page* scrolled
   * sideways by ~300px. jsdom has no layout, so this pins the class that fixes
   * it; the browser check in plan 260928a is the measurement.
   */
  it("keeps the positioned scroll-box class from the browser regression", () => {
    paint();
    const box = host.querySelector("table")?.parentElement;
    expect(box?.className).toMatch(/\btw:overflow-x-auto\b/);
    expect(box?.className).toMatch(/\btw:relative\b/);
  });
});

/* ------------------------------------------------------ the Table control -- */

describe("the Table control's own card", () => {
  it("describes the columns the reader chose, rather than promising every one", () => {
    const all = `${VIEW_TIPS.table.what} ${VIEW_TIPS.table.how}`;
    expect(all).not.toContain("every column at once");
    expect(all).not.toContain("No blurb");
    expect(VIEW_TIPS.table.what).toContain("chosen to show");
  });

  it("does not promise a missing blurb or claim an already-present fact moves", () => {
    expect(VIEW_TIPS.table.how).toContain("when there is one");
    expect(VIEW_TIPS.table.how).toContain("stays available in that card");
    expect(VIEW_TIPS.table.how).not.toContain("moves into that card");
  });
});

/* ---------------------------------------------------- the facts, as data --- */

describe("rowCardFacts", () => {
  const labels = (e: LibraryEntry, hidden: string[] = []) =>
    rowCardFacts(e, hidden).facts.map((f) => f.label);
  const value = (e: LibraryEntry, label: string, hidden: string[] = []) =>
    rowCardFacts(e, hidden).facts.find((f) => f.label === label)?.value;

  it("carries the gist when there is one, and nothing in its place when not", () => {
    expect(rowCardFacts(ENTRY, []).gist).toBe(ENTRY.gist);
    expect(rowCardFacts(BARE, []).gist).toBeUndefined();
  });

  it("gives both dates exactly", () => {
    expect(value(ENTRY, "Added")).toBe(exactly(ENTRY.addedAt));
    expect(value(ENTRY, "Last opened")).toBe(exactly(ENTRY.lastOpenedAt));
  });

  /** The row's em dash already says never; the card saying it again is the row twice. */
  it("says nothing about opening one never opened, while its column is showing", () => {
    expect(labels(BARE)).not.toContain("Last opened");
  });

  it("gives size beyond words, singular where it is one", () => {
    expect(value(ENTRY, "Size")).toBe("4 parts · 11 sections · 97 blocks");
    expect(value(BARE, "Size")).toBe("1 part · 1 section · 20 blocks");
  });

  it("lists only what has been built, calling the tweets a thread", () => {
    expect(value(ENTRY, "Built")).toBe("arc · thread");
    expect(labels(BARE)).not.toContain("Built");
  });

  it("says renamed only when it was", () => {
    expect(value(ENTRY, "Title")).toBe("renamed by you");
    expect(labels(BARE)).not.toContain("Title");
  });

  it("explains the Shared badge, whose own hover sentence the table drops", () => {
    expect(value({ ...BARE, visibility: "public" }, "Shared")).toBe(SHARING_ON);
    expect(labels(BARE)).not.toContain("Shared");
  });

  it("carries none of the visible columns' values", () => {
    const all = rowCardFacts(ENTRY, []).facts.map((f) => `${f.label} ${f.value}`).join(" | ");
    expect(all).not.toContain("3,456");
    expect(all).not.toContain("41");
    expect(all).not.toContain("38");
  });

  /**
   * **A hidden column's value comes back into the card** — Decision 2's last
   * bullet, which is what stage 2's hiding relies on to be safe.
   */
  it("carries a hidden column's value", () => {
    expect(value(ENTRY, "Opened", ["opens"])).toBe("41 times");
    expect(value(BARE, "Opened", ["opens"])).toBe("never");
    expect(value(ENTRY, "Comments", ["questions"])).toBe("38");
    expect(value(ENTRY, "Size", ["length"])).toBe("3,456 words · 4 parts · 11 sections · 97 blocks");
    expect(value(BARE, "Last opened", ["opened"])).toBe("never");
  });
});
