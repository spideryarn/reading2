// @vitest-environment jsdom
/**
 * **The button that archives an article has to say "Archive".**
 *
 * It said "Delete", with a bin in it, from 2026-08-26 to 2026-09-04, over a
 * handler that has never done anything but set `archived_at`. The cost of that
 * was not theoretical: Greg filed report SPIDERYARN-READING2-19 asking for an
 * archive feature — reversible, hidden from the shelf by default, restorable —
 * that the app had already had for nine days. He could not tell, because the
 * only word on screen said the opposite.
 *
 * So this test is not about a string. It pins **the label to the act**: the
 * control the reader presses to archive is found by the name a screen reader
 * would read out, and then pressed, and `shelf.archive` has to be what runs.
 * A test that only asserted the word would go green over a button wired to
 * something else; a test that only asserted the call would go green over a
 * button called "Delete" again.
 *
 * **Both renderers.** The shelf draws cards and a dense table, and they share
 * `Actions` — but "they share it" is exactly the sort of thing that stops being
 * true, and a marker checked in one of them looks finished from wherever the
 * reviewer happened to be standing (the same argument
 * tests/shelf-shared-badge.test.tsx is built on).
 *
 * docs/project/library.md § Archive, and Undo is the confirmation.
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

const { ShelfCard } = await import("../src/web/ShelfEntry.js");
const { libraryColumns, ADDED_NOTE } = await import("../src/web/library-columns.js");
const { DataTable, useSortedTable } = await import("../src/web/lib/DataTable.js");

const NOW = Date.parse("2026-09-04T12:00:00.000Z");

const ENTRY: LibraryEntry = {
  slug: "a-piece",
  title: "Something worth reading",
  addedAt: "2026-08-20T10:00:00.000Z",
  words: 2400,
  minutes: 11,
  blocks: 60,
  parts: 3,
  sections: 9,
  comments: 0,
  opens: 2,
  has: { arc: false, tweets: false, glossary: false },
};

/** What the button under test is supposed to call, recorded rather than run. */
let archived: string[];

function stubShelf() {
  return {
    renaming: null,
    report: () => {},
    archive: (slug: string) => {
      archived.push(slug);
      return Promise.resolve();
    },
    beginRename: () => {},
    cancelRename: () => {},
    rename: () => Promise.resolve(),
  } as unknown as Parameters<typeof libraryColumns>[0];
}

let shelf: ReturnType<typeof stubShelf>;

/** The table, mounted the way Library.tsx mounts it. */
function Table(): ReactElement {
  const table = useSortedTable<LibraryEntry>({
    data: [ENTRY],
    columns: libraryColumns(shelf, NOW),
    sorting: SORTING,
    onSortingChange: () => {},
    rowId: (e) => e.slug,
  });
  return createElement(DataTable<LibraryEntry>, {
    table,
    rows: table.getRowModel().rows,
    caption: "The shelf",
  });
}

/** Stable across renders — an array rebuilt per render is a render loop here. */
const SORTING: SortingState = [{ id: "added", desc: true }];

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  archived = [];
  shelf = stubShelf();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function paint(node: ReactElement): void {
  act(() => {
    root.render(node);
  });
}

/**
 * Every button on screen, by the name it is announced under.
 *
 * `aria-label` first and the text second, because these are icon-only buttons
 * whose whole name is the attribute — a query on text alone would find nothing
 * at all and every "no Delete here" assertion below would pass vacuously.
 */
function names(): string[] {
  return [...host.querySelectorAll<HTMLButtonElement>("button")].map((b) =>
    (b.getAttribute("aria-label") ?? b.textContent ?? "").trim(),
  );
}

function press(name: string): void {
  const button = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => (b.getAttribute("aria-label") ?? b.textContent ?? "").trim() === name,
  );
  expect(button, `a button called "${name}"`).toBeTruthy();
  act(() => {
    button?.click();
  });
}

const card = () =>
  createElement(ShelfCard, { entry: ENTRY, shelf, note: ADDED_NOTE(ENTRY, NOW) });

describe.each([
  ["the card", card],
  ["the table row", () => createElement(Table)],
] as const)("%s", (_label, render) => {
  it("offers Archive, and never Delete", () => {
    paint(render());

    expect(names()).toContain("Archive");
    /* The word that was wrong, asserted absent rather than merely not asked
       for: a second button appearing beside this one, or a revert of the
       rename, is exactly the drift worth catching. */
    expect(names()).not.toContain("Delete");
  });

  it("archives the article when it is pressed", () => {
    paint(render());
    press("Archive");

    /* The act, not the word. Together with the assertion above this is the
       whole point of the file: the label and the handler are pinned to each
       other, so neither can move without the other. */
    expect(archived).toEqual([ENTRY.slug]);
  });

  /**
   * **A bin says "delete" as loudly as the word does.**
   *
   * Checked by `class`, because lucide renders its name onto the `<svg>` —
   * `lucide-archive` for the box, `lucide-trash-2` for the bin. Asserting the
   * icon is the half of the rename that no label query can see.
   */
  it("draws a box rather than a bin", () => {
    paint(render());

    expect(host.querySelector(".lucide-archive"), "the archive box").toBeTruthy();
    expect(host.querySelector(".lucide-trash-2"), "no bin").toBeNull();
  });
});
