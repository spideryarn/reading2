// @vitest-environment jsdom
/**
 * **Every shelf card shows the masthead's how-much-read pie** — Greg's answer
 * to q-y78eth, 2026-10-25: *"1A"*. Plan
 * docs/plans/261025l-shelf-cards-show-the-how-much-read-pie.md.
 *
 * Asserted in both of the shelf's renderers, for `SharedBadge`'s reason
 * (tests/shelf-shared-badge.test.tsx): a mark added to one looks finished from
 * wherever the reviewer was standing. And the kept copy of a shelf, painted
 * before the server answers and all there is offline, never carries a band
 * (cached-shelf.ts § `withoutReadBands`).
 */
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { SortingState } from "@tanstack/react-table";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryEntry } from "../src/types.js";

vi.mock("../src/web/lib/api.js", () => ({
  fetchOk: () => Promise.resolve(new Response(null, { status: 200 })),
  apiFetch: () => Promise.resolve(new Response(null, { status: 200 })),
  readJson: () => Promise.resolve({}),
}));

const { ShelfCard } = await import("../src/web/ShelfEntry.js");
const { libraryColumns } = await import("../src/web/library-columns.js");
const { DataTable, useSortedTable } = await import("../src/web/lib/DataTable.js");
const { withoutReadBands, shelfFromCachedBody } = await import("../src/web/lib/cached-shelf.js");

const NOW = Date.parse("2026-10-25T12:00:00.000Z");

function entry(over: Partial<LibraryEntry> = {}): LibraryEntry {
  return {
    slug: "a-piece",
    title: "Something worth reading",
    addedAt: "2026-10-20T10:00:00.000Z",
    words: 2400,
    minutes: 11,
    blocks: 60,
    parts: 3,
    sections: 9,
    comments: 0,
    opens: 2,
    sourceReusable: true,
    has: { arc: false, tweets: false, glossary: false },
    tags: [],
    ...over,
  };
}

const shelf = {
  renaming: null,
  report: () => {},
  archive: () => Promise.resolve(),
  beginRename: () => {},
  cancelRename: () => {},
  rename: () => Promise.resolve(),
} as unknown as Parameters<typeof libraryColumns>[0];

const SORTING: SortingState = [{ id: "added", desc: true }];

function Table({ entries }: { entries: LibraryEntry[] }): ReactElement {
  const table = useSortedTable<LibraryEntry>({
    data: entries,
    columns: libraryColumns(shelf, NOW),
    sorting: SORTING,
    onSortingChange: () => {},
    rowId: (e) => e.slug,
  });
  return createElement(DataTable<LibraryEntry>, { table, rows: table.getRowModel().rows, caption: "The shelf" });
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

function paint(node: ReactElement): void {
  act(() => root.render(node));
}

/** The pie, by the name a screen reader is given: the masthead's words. */
const pies = () => [...host.querySelectorAll<HTMLButtonElement>("button.read-so-far")].map((b) => b.getAttribute("aria-label"));

const BANDS = [
  ["started", "Read so far: started"],
  ["half", "Read so far: about half"],
  ["most", "Read so far: most of it"],
  ["finished", "Read so far: finished"],
] as const;

describe("the card", () => {
  it.each(BANDS)("draws the %s pie, right after the minutes", (band, label) => {
    paint(createElement(ShelfCard, { entry: entry({ readBand: band }), shelf, note: "" }));
    expect(pies()).toEqual([label]);
    const fact = host.querySelector("button.read-so-far")?.closest("[data-shelf-fact]");
    expect(fact?.textContent).toContain("~11 min");
  });

  it("draws nothing without a band", () => {
    paint(createElement(ShelfCard, { entry: entry(), shelf, note: "" }));
    expect(pies()).toEqual([]);
  });

  it("draws the pie once when another fact happens to have the minutes' words", () => {
    paint(createElement(ShelfCard, { entry: entry({ byline: "~11 min", readBand: "finished" }), shelf, note: "" }));
    expect(pies()).toEqual(["Read so far: finished"]);
    expect(host.querySelector("button.read-so-far")?.closest("[data-shelf-fact]")?.textContent).toContain("~11 min");
  });
});

describe("the table", () => {
  it.each(BANDS)("draws the %s pie in the title cell", (band, label) => {
    paint(createElement(Table, { entries: [entry({ readBand: band })] }));
    expect(pies()).toEqual([label]);
    expect(host.querySelector("button.read-so-far")?.closest("[data-shelf-title-sub]")).not.toBeNull();
  });

  it("draws nothing without a band", () => {
    paint(createElement(Table, { entries: [entry()] }));
    expect(pies()).toEqual([]);
  });
});

describe("a kept shelf", () => {
  it("is kept without its bands, and draws no pie", () => {
    const live = { articles: [entry({ readBand: "finished" }), entry({ slug: "b", readBand: "half" }), entry({ slug: "c" })] };
    const kept = withoutReadBands(live);
    expect(JSON.stringify(kept)).not.toContain("readBand");
    const drawn = shelfFromCachedBody(kept);
    expect(drawn?.map((e) => e.slug)).toEqual(["a-piece", "b", "c"]);
    paint(createElement(ShelfCard, { entry: drawn![0]!, shelf, note: "" }));
    expect(pies()).toEqual([]);
  });

  it("leaves a body that is not a shelf alone", () => {
    expect(withoutReadBands(null)).toBeNull();
    expect(withoutReadBands({ other: 1 })).toEqual({ other: 1 });
  });

  it("strips bands from a legacy body when it is read back", () => {
    const legacy = { articles: [entry({ readBand: "finished" }), entry({ slug: "b", readBand: "half" })] };
    const drawn = shelfFromCachedBody(legacy);
    expect(drawn?.map((e) => e.slug)).toEqual(["a-piece", "b"]);
    expect(JSON.stringify(drawn)).not.toContain("readBand");
  });
});
