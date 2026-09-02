// @vitest-environment jsdom
/**
 * **An owner looking at their own shelf should be able to see, at a glance,
 * which of these anybody can read.**
 *
 * Greg's decision on
 * docs/plans/260902j-public-read-only-access-audit-and-improvements.md § Cluster E,
 * and the whole of it: *a badge, not a filter*, until there is enough shared
 * material for filtering to be worth anything.
 *
 * Two properties, and the second is the one that decays quietly:
 *
 * 1. **A shared article is marked, in both views.** The shelf has two
 *    renderers — cards and the dense table — and everything they are supposed
 *    to share has to be asserted twice, because a marker added to one of them
 *    looks finished from wherever the reviewer happened to be looking.
 * 2. **A private article gets nothing at all.** No "Private" chip: the shelf is
 *    almost entirely private, so a badge on every card is decoration rather
 *    than information, and the one on the shared card would stop standing out —
 *    which is the entire job it has.
 *
 * The visitor's side of the same fact is `ViewOnlyChip` in
 * src/web/PublicChrome.tsx, and it deliberately says something else: *you may
 * not change this*, where this one says *anyone with the link can read this*.
 * Two sentences, two components.
 */
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { SortingState } from "@tanstack/react-table";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryEntry } from "../src/types.js";

/* The card's Re-fetch button posts a job when it is pressed, and nothing here
   presses one — but importing the real module drags the Supabase client and
   `import.meta.env` in behind it. Same mock, same reason, as
   tests/profile-shelf-failure.test.tsx. */
vi.mock("../src/web/lib/api.js", () => ({
  fetchOk: () => Promise.resolve(new Response(null, { status: 200 })),
  apiFetch: () => Promise.resolve(new Response(null, { status: 200 })),
  readJson: () => Promise.resolve({}),
}));

const { ShelfCard } = await import("../src/web/ShelfEntry.js");
const { libraryColumns, ADDED_NOTE } = await import("../src/web/library-columns.js");
const { DataTable, useSortedTable } = await import("../src/web/lib/DataTable.js");
const { SHARING_BADGE } = await import("../src/messages.js");

const NOW = Date.parse("2026-09-02T12:00:00.000Z");

/** One card's worth of article. `visibility` is what each test varies. */
function entry(over: Partial<LibraryEntry> = {}): LibraryEntry {
  return {
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
    ...over,
  };
}

/**
 * The shelf hook, stubbed down to what a card *renders* with.
 *
 * Everything else on it is a callback that only a click reaches, and no test
 * here clicks anything: what is under test is what an owner sees before they
 * touch it.
 */
const shelf = {
  renaming: null,
  report: () => {},
  archive: () => Promise.resolve(),
  beginRename: () => {},
  cancelRename: () => {},
  rename: () => Promise.resolve(),
} as unknown as Parameters<typeof libraryColumns>[0];

/** The table, mounted the way Library.tsx mounts it. */
function Table({ entries }: { entries: LibraryEntry[] }): ReactElement {
  const table = useSortedTable<LibraryEntry>({
    data: entries,
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
 * The badge, found by the word an owner reads rather than by a class name.
 *
 * A CSS hook would pass for a marker rendered with `display: none` or with no
 * text in it at all, which is the failure this is here to catch: the badge is
 * only worth anything if it is legible.
 */
function badges(): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>("span")].filter(
    (el) => el.textContent?.trim() === SHARING_BADGE,
  );
}

/**
 * **The word itself, once, written out.**
 *
 * Everything below finds the badge through `SHARING_BADGE`, which is right —
 * pinning the prose in six assertions would make the constant unrewordable. But
 * it means the test and the component read the same variable, so changing
 * `SHARING_BADGE` to `"Private"` leaves every one of them green while the shelf
 * says the opposite of the truth. GPT Sol found that mutation surviving.
 *
 * One literal, here, is the whole fix: the constant stays rewordable in the
 * sense that matters — *Shared with anyone*, *Public* — and cannot silently
 * become a word that means the other thing.
 */
it("calls it Shared, and not the opposite", () => {
  expect(SHARING_BADGE).toBe("Shared");
});

describe("the card", () => {
  it("marks an article anyone with the link can read", () => {
    paint(
      createElement(ShelfCard, {
        entry: entry({ visibility: "public" }),
        shelf,
        note: ADDED_NOTE(entry(), NOW),
      }),
    );

    expect(badges()).toHaveLength(1);
    /* The sentence, not merely the word: a chip saying "Shared" and nothing
       else leaves the owner to guess whether it means *shared with me* or
       *shared by me*. It is the owner's own card's sentence, reused. */
    expect(badges()[0]?.title).toContain("Anyone with the link can read this");
  });

  it("says nothing whatever about a private one", () => {
    paint(
      createElement(ShelfCard, {
        entry: entry(),
        shelf,
        note: ADDED_NOTE(entry(), NOW),
      }),
    );

    expect(badges()).toHaveLength(0);
    // And no "Private" by another name, either.
    expect(host.textContent ?? "").not.toMatch(/private/i);
  });
});

describe("the table", () => {
  it("marks the shared row and only the shared row", () => {
    paint(
      createElement(Table, {
        entries: [
          entry({ slug: "shared-piece", title: "Out in the world", visibility: "public" }),
          entry({ slug: "quiet-piece", title: "Nobody else's business" }),
        ],
      }),
    );

    expect(badges()).toHaveLength(1);

    /* **In the shared row**, which `toHaveLength(1)` on its own does not say:
       a marker rendered against the wrong row is the mistake a table makes
       that a card cannot. */
    const marked = badges()[0]?.closest("tr");
    expect(marked?.textContent).toContain("Out in the world");
    expect(marked?.textContent).not.toContain("Nobody else's business");
  });

  it("says nothing on a shelf with nothing shared on it", () => {
    paint(createElement(Table, { entries: [entry()] }));

    expect(badges()).toHaveLength(0);
    expect(host.textContent ?? "").not.toMatch(/private/i);
  });
});
