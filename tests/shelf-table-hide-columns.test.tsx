// @vitest-environment jsdom
/**
 * **The shelf's Table view: columns you can hide, and get back.**
 *
 * Greg, 2026-09-28:
 *
 * > Maybe I can right-click a column to hide it? but then I'd need a way to
 * > reveal it again.
 *
 * docs/plans/260928a-shelf-table-view-row-card-full-titles-hide-columns.md,
 * Decision 3 and stage 2. What has to hold, and why each is its own assertion:
 *
 *  - **A Columns menu is the way back**, and the route that works on a finger
 *    and a keyboard. It offers the data columns and never Article or Actions
 *    (Sol P-5): a row with no title is not a row, and the actions are five
 *    controls rather than a value the row card could carry back.
 *  - **Right-click is a shortcut, and focus survives it** (Sol P-4). The
 *    header that opened the menu is gone once its column is, and Radix would
 *    hand focus back to that removed node — which is focus on nothing.
 *  - **Remembered in this browser**, and a store that throws or holds junk
 *    lands on "everything shown" rather than on a crash or a missing title.
 *  - **Nothing becomes unreachable**: a hidden column's value is in the row
 *    card.
 *  - **Hiding is not sorting** (Sol P-6): hide the column the shelf is sorted
 *    by and the order, the missing-last rule, and the chip all stay put.
 *  - **`/admin` is untouched** — hiding is opt-in in `DataTable`, and its table
 *    gets no menus it did not ask for.
 *
 * ## The harness is Library.tsx's table, not Library.tsx
 *
 * No test mounts the whole shelf page (it wants a session, the router, nuqs and
 * the job queue). `ShelfTable` below is the part of it this plan touches: the
 * same hook, the same `useSortedTable` call, the same two `sinkLast` passes
 * that `Library.tsx`'s `sorted` memo makes, and the chips, the Columns menu
 * and the table, in one `TooltipGroup`. If `Library.tsx`'s `sorted` memo
 * changes shape, this copy is the one to update.
 *
 * Radix menus in jsdom: the trigger opens on a mouse's `pointerdown` (button 0,
 * no ctrl) — jsdom has no `PointerEvent`, so it is a `MouseEvent` of that type
 * with `pointerType` defined on it, as tests/shelf-actions-menu.test.tsx does —
 * and an item fires `onSelect` on `click`. The menus are portalled to `<body>`.
 */
import { act, createElement, type ReactElement, useMemo, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { SortingState } from "@tanstack/react-table";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminUser } from "../src/admin.js";
import type { LibraryEntry } from "../src/types.js";

/* Nothing here reaches the network, but importing the real module drags the
   Supabase client and `import.meta.env` in behind it. Same mock, same reason,
   as tests/shelf-table-row-card.test.tsx. */
vi.mock("../src/web/lib/api.js", () => ({
  fetchOk: () => Promise.resolve(new Response(null, { status: 200 })),
  apiFetch: () => Promise.resolve(new Response(null, { status: 200 })),
  readJson: () => Promise.resolve({}),
}));

const { CHIP_ORDER, libraryColumns } = await import("../src/web/library-columns.js");
const { ColumnsMenu, DataTable, SortChips, useSortedTable } = await import(
  "../src/web/lib/DataTable.js"
);
const { sinkLast } = await import("../src/web/lib/table-sort.js");
const { TooltipGroup } = await import("../src/web/Tooltip.js");
const { ShelfControls } = await import("../src/web/ShelfControls.js");
const { HIDDEN_COLUMNS_KEY, useShelfHiddenColumns } = await import(
  "../src/web/shelf-hidden-columns.js"
);
const { adminColumns } = await import("../src/web/admin-columns.js");

const NOW = Date.parse("2026-09-28T12:00:00.000Z");

function entry(over: Partial<LibraryEntry> & { slug: string }): LibraryEntry {
  return {
    title: `Title of ${over.slug}`,
    addedAt: "2026-08-10T10:00:00.000Z",
    words: 1500,
    minutes: 7,
    blocks: 30,
    parts: 2,
    sections: 5,
    comments: 0,
    opens: 0,
    sourceReusable: true,
    has: { arc: false, tweets: false, glossary: false },
    ...over,
  };
}

/**
 * **Chosen so every order is different**, and so the Words value (`3,456`)
 * cannot turn up by accident anywhere else in a card.
 */
const ENTRIES: LibraryEntry[] = [
  entry({ slug: "hide-b", lastOpenedAt: "2026-09-20T10:00:00.000Z", words: 3456, opens: 5 }),
  entry({ slug: "hide-a", lastOpenedAt: "2026-09-25T10:00:00.000Z", words: 800, opens: 2 }),
  /* Never opened: sorts last whichever way "Last opened" points. */
  entry({ slug: "hide-never", words: 2200 }),
  entry({ slug: "hide-c", lastOpenedAt: "2026-09-01T10:00:00.000Z", words: 1200, opens: 9 }),
  /* The fixture: below even the never-opened rows. */
  entry({ slug: "hide-fixture", lastOpenedAt: "2026-09-27T10:00:00.000Z", fixture: true }),
];

const shelf = {
  renaming: null,
  report: () => {},
  archive: () => Promise.resolve(),
  beginRename: () => {},
  cancelRename: () => {},
  rename: () => Promise.resolve(),
} as unknown as Parameters<typeof libraryColumns>[0];

const slugOf = (e: LibraryEntry) => e.slug;

/* Column visibility is controlled state: accepting only one half would compile
   a caller whose hiding controls silently do nothing. */
// @ts-expect-error visibility state requires its change handler
const HALF_CONTROLLED_TABLE: Parameters<typeof useSortedTable<LibraryEntry>>[0] = {
  data: [],
  columns: [],
  sorting: [],
  onSortingChange: () => {},
  rowId: slugOf,
  columnVisibility: {},
};
void HALF_CONTROLLED_TABLE;

/** Library.tsx's table, without the page — see the file comment. */
function ShelfTable({ entries }: { entries: LibraryEntry[] }): ReactElement {
  const columns = useMemo(() => libraryColumns(shelf, NOW), []);
  const [sorting, setSorting] = useState<SortingState>([{ id: "opened", desc: true }]);
  const [columnVisibility, onColumnVisibilityChange] = useShelfHiddenColumns(columns);
  const table = useSortedTable<LibraryEntry>({
    data: entries,
    columns,
    sorting,
    onSortingChange: setSorting,
    rowId: slugOf,
    columnVisibility,
    onColumnVisibilityChange,
  });
  /* The two sinks from Library.tsx's `sorted` memo, in its order. */
  const modelRows = table.getRowModel().rows;
  const primary = sorting[0]?.id;
  const missingLast = primary
    ? sinkLast(modelRows, (r) => r.getValue(primary) === undefined)
    : modelRows;
  const rows = sinkLast(missingLast, (r) => !!r.original.fixture);

  return createElement(
    "div",
    null,
    createElement(SortChips<LibraryEntry>, { table, order: CHIP_ORDER }),
    createElement(ColumnsMenu<LibraryEntry>, { table }),
    createElement(
      TooltipGroup,
      { delay: { open: 240, close: 90 }, timeoutMs: 400 },
      createElement(DataTable<LibraryEntry>, { table, rows, caption: "Your articles" }),
    ),
  );
}

/* ------------------------------------------------------------ storage ---- */

/**
 * **A real store, not a stub that always says no** — Node's own
 * `localStorage` shadows the browser one under vitest and reads `undefined`,
 * so without this the round trip is unobservable (tests/small-screen-banner.test.tsx).
 */
let store: Map<string, string>;

function workingStorage(): void {
  store = new Map();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    },
  });
}

/** Safari's private mode: every touch throws. */
function throwingStorage(): void {
  const no = () => {
    throw new DOMException("The operation is insecure.", "SecurityError");
  };
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: { getItem: no, setItem: no, removeItem: no, clear: no, key: no, length: 0 },
  });
}

/* ------------------------------------------------------------ harness ---- */

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  workingStorage();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function paint(entries: LibraryEntry[] = ENTRIES): void {
  act(() => {
    root.render(createElement(ShelfTable, { entries }));
  });
}

function remount(): void {
  act(() => root.unmount());
  root = createRoot(host);
  paint();
}

async function wait(ms: number): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

const flat = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/** The visible words of every header, in order — `sr-only` text included. */
const headers = () => [...host.querySelectorAll("thead th")].map((th) => flat(th.textContent));

/** How many cells each body row has. */
const cellCounts = () => [...host.querySelectorAll("tbody tr")].map((tr) => tr.children.length);

/** The rows' slugs, top to bottom. */
const order = () =>
  [...host.querySelectorAll<HTMLAnchorElement>("tbody tr a[href]")].map(
    (a) => a.getAttribute("href")?.split("/").pop() ?? "",
  );

function th(text: string): HTMLElement {
  const hit = [...host.querySelectorAll<HTMLElement>("thead th")].filter(
    (el) => flat(el.textContent) === text,
  );
  expect(hit, `no single header reading ${text}`).toHaveLength(1);
  return hit[0] as HTMLElement;
}

function pointerDown(el: Element): void {
  const ev = new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 });
  Object.defineProperty(ev, "pointerType", { value: "mouse" });
  act(() => {
    el.dispatchEvent(ev);
  });
}

function touchPointer(el: Element, type: "pointerdown" | "pointerup" | "pointercancel"): void {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 });
  Object.defineProperty(ev, "pointerType", { value: "touch" });
  act(() => {
    el.dispatchEvent(ev);
  });
}

function click(el: Element): void {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
  });
}

function rightClick(el: Element): void {
  act(() => {
    el.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: 40,
        clientY: 20,
      }),
    );
  });
}

/** The open menu, which Radix portals to the end of `<body>`, or null. */
const menu = (): HTMLElement | null => document.querySelector<HTMLElement>('[role="menu"]');

function columnsTrigger(): HTMLElement {
  const hit = [...host.querySelectorAll<HTMLElement>("button")].filter((el) =>
    (el.getAttribute("aria-label") ?? "").startsWith("Columns"),
  );
  expect(hit, "no single Columns trigger").toHaveLength(1);
  return hit[0] as HTMLElement;
}

const checkboxes = () => [
  ...(menu()?.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]') ?? []),
];

function checkbox(label: string): HTMLElement {
  const hit = checkboxes().filter((el) => flat(el.textContent) === label);
  expect(hit, `no single checkbox reading ${label}`).toHaveLength(1);
  return hit[0] as HTMLElement;
}

function openColumns(): void {
  pointerDown(columnsTrigger());
  expect(menu(), "the Columns menu did not open").not.toBeNull();
}

/** Hide one column from the Columns menu, and close it again. */
async function hideFromMenu(label: string): Promise<void> {
  openColumns();
  click(checkbox(label));
  act(() => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
  });
  await wait(10);
  expect(menu(), "Escape did not close the Columns menu").toBeNull();
}

const ALL_HEADERS = ["Article", "Added", "Last opened", "Opens", "Comments", "Words", "Actions"];

/* ------------------------------------------------------- the Columns menu -- */

describe("the Columns menu", () => {
  /**
   * **Five data columns.** Added belongs in the menu even though its exact date
   * is already in the card; hiding it removes the relative date from the row.
   */
  it("offers every data column and never Article or Actions", () => {
    paint();
    openColumns();
    expect(checkboxes().map((el) => flat(el.textContent))).toEqual([
      "Added",
      "Last opened",
      "Times opened",
      "Comments",
      "Length",
    ]);
    for (const el of checkboxes()) expect(el.getAttribute("aria-checked")).toBe("true");
  });

  it("hides a column's header and every cell under it, stays open, and brings it back", () => {
    paint();
    expect(headers()).toEqual(ALL_HEADERS);
    openColumns();

    click(checkbox("Length"));
    expect(headers()).toEqual(ALL_HEADERS.filter((h) => h !== "Words"));
    expect(cellCounts().every((n) => n === ALL_HEADERS.length - 1)).toBe(true);
    expect(menu(), "toggling a column closed the menu").not.toBeNull();
    expect(checkbox("Length").getAttribute("aria-checked")).toBe("false");

    click(checkbox("Length"));
    expect(headers()).toEqual(ALL_HEADERS);
    expect(cellCounts().every((n) => n === ALL_HEADERS.length)).toBe(true);
  });

  it("says how many are hidden, in its badge and its accessible name", async () => {
    paint();
    const before = columnsTrigger();
    expect(before.getAttribute("aria-label")).not.toMatch(/hidden/);
    expect(flat(before.textContent)).toBe("Columns");
    expect(before.hasAttribute("title"), "the trigger used an inaccessible native tooltip").toBe(
      false,
    );

    await hideFromMenu("Length");
    await hideFromMenu("Comments");
    const after = columnsTrigger();
    expect(after.getAttribute("aria-label")).toMatch(/^Columns\b.*\b2 hidden\b/);
    expect(flat(after.textContent)).toMatch(/^Columns\s*2$/);
  });

  it("carries a rich card explaining what hiding does not change", async () => {
    paint();
    columnsTrigger().dispatchEvent(new MouseEvent("mouseenter"));
    await wait(400);

    const card = document.body.querySelector<HTMLElement>(".tooltip");
    expect(card, "hovering Columns opened no explanatory card").not.toBeNull();
    expect(flat(card?.textContent)).toContain("Hiding changes only what the table draws");
    expect(flat(card?.textContent)).toContain("does not change the current sort");

    pointerDown(columnsTrigger());
    expect(menu(), "pressing Columns did not open its menu").not.toBeNull();
    await wait(100); // the tooltip's close transition keeps an opacity-zero node for 80ms
    expect(
      document.body.querySelector(".tooltip"),
      "the Columns card stayed open over its menu",
    ).toBeNull();
  });

  it("waits for a finger tap instead of opening when a scroll starts on the trigger", () => {
    paint();
    const trigger = columnsTrigger();

    touchPointer(trigger, "pointerdown");
    expect(menu(), "pointerdown opened the menu before the browser knew this was a tap").toBeNull();

    touchPointer(trigger, "pointerup");
    click(trigger);
    expect(menu(), "a completed finger tap did not open the menu").not.toBeNull();
  });

  it("is drawn beside the view switch in table view only", () => {
    function Controls({ view }: { view: "cards" | "table" }) {
      const columns = useMemo(() => libraryColumns(shelf, NOW), []);
      const [columnVisibility, onColumnVisibilityChange] = useShelfHiddenColumns(columns);
      const table = useSortedTable<LibraryEntry>({
        data: ENTRIES,
        columns,
        sorting: STABLE_SORT,
        onSortingChange: () => {},
        rowId: slugOf,
        columnVisibility,
        onColumnVisibilityChange,
      });
      return createElement(ShelfControls, {
        table,
        chipOrder: CHIP_ORDER,
        view,
        onView: () => {},
        filter: "all" as const,
        onFilter: () => {},
        archived: false,
        onArchived: () => {},
      });
    }
    act(() => root.render(createElement(Controls, { view: "table" })));
    expect(columnsTrigger()).toBeTruthy();
    act(() => root.render(createElement(Controls, { view: "cards" })));
    expect(
      [...host.querySelectorAll("button")].some((b) =>
        (b.getAttribute("aria-label") ?? "").startsWith("Columns"),
      ),
      "the cards view has no columns to hide",
    ).toBe(false);
  });
});

const STABLE_SORT: SortingState = [{ id: "opened", desc: true }];

/* ------------------------------------------------------ right-clicking ---- */

describe("right-clicking a header", () => {
  it("offers one item, Hide \"Words\", which hides it", () => {
    paint();
    rightClick(th("Words"));
    const open = menu();
    expect(open, "right-clicking a header opened no menu").not.toBeNull();
    const items = [...(open as HTMLElement).querySelectorAll('[role="menuitem"]')].map((el) =>
      flat(el.textContent),
    );
    expect(items).toEqual(['Hide "Words"']);
    click((open as HTMLElement).querySelector('[role="menuitem"]') as HTMLElement);
    expect(headers()).not.toContain("Words");
  });

  /**
   * **The one Sol P-4 is about.** The header that opened the menu no longer
   * exists, so focus goes to the next header along that has a sort button —
   * and, when there is none (Words is followed only by Actions, which has no
   * button), to the previous one.
   */
  it("moves focus to the next header's sort button", async () => {
    paint();
    /* **Something else holds focus first**, because that is what Radix would
       hand focus back to on close — and with nothing focused it hands it to
       `<body>`, which a jsdom `focus()` ignores, so without this the test
       passed with Radix's own return still switched on. */
    act(() => (th("Article").querySelector("button") as HTMLElement).focus());
    rightClick(th("Added"));
    click(menu()?.querySelector('[role="menuitem"]') as HTMLElement);
    await wait(20);
    const focused = document.activeElement as HTMLElement | null;
    expect(focused?.tagName).toBe("BUTTON");
    expect(flat(focused?.closest("th")?.textContent)).toBe("Last opened");
  });

  it("falls back to the previous header's sort button when nothing after it sorts", async () => {
    paint();
    rightClick(th("Words"));
    click(menu()?.querySelector('[role="menuitem"]') as HTMLElement);
    await wait(20);
    const focused = document.activeElement as HTMLElement | null;
    expect(focused?.tagName).toBe("BUTTON");
    expect(flat(focused?.closest("th")?.textContent)).toBe("Comments");
  });

  it("leaves Escape's focus return to Radix and keeps the column", async () => {
    paint();
    const before = th("Article").querySelector("button") as HTMLElement;
    act(() => before.focus());
    rightClick(th("Added"));
    act(() => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
    await wait(20);

    expect(menu()).toBeNull();
    expect(headers()).toContain("Added");
    expect(document.activeElement).toBe(before);
  });

  it("opens nothing on Article or Actions", () => {
    paint();
    rightClick(th("Article"));
    expect(menu(), "Article offered to hide itself").toBeNull();
    rightClick(th("Actions"));
    expect(menu(), "Actions offered to hide itself").toBeNull();
  });

  it("still sorts on a plain click of the header", () => {
    paint();
    const header = th("Words");
    const row = header.parentElement as HTMLTableRowElement;
    expect(row.tagName).toBe("TR");
    expect([...row.children].every((child) => child.tagName === "TH")).toBe(true);

    const button = header.querySelector("button") as HTMLElement;
    click(button);
    expect(th("Words").getAttribute("aria-sort")).toBe("descending");
  });

  it("does not sort when a finger lifts after opening the context menu by long-press", async () => {
    paint();
    const button = th("Words").querySelector("button") as HTMLElement;

    touchPointer(button, "pointerdown");
    await wait(720);
    expect(menu(), "the long-press did not open the context menu").not.toBeNull();

    touchPointer(button, "pointerup");
    click(button);
    expect(th("Words").getAttribute("aria-sort")).toBeNull();
  });
});

/* --------------------------------------------------------- remembered ---- */

describe("remembered in this browser", () => {
  it("stays hidden across an unmount and a remount", async () => {
    paint();
    await hideFromMenu("Length");
    expect(headers()).not.toContain("Words");
    expect(JSON.parse(store.get(HIDDEN_COLUMNS_KEY) ?? "null")).toEqual(["length"]);
    remount();
    expect(headers()).not.toContain("Words");
    expect(headers()).toContain("Comments");
  });

  it("shows everything, and does not crash, when storage throws", async () => {
    throwingStorage();
    paint();
    expect(headers()).toEqual(ALL_HEADERS);
    await hideFromMenu("Length");
    expect(headers(), "hiding still works for this visit").not.toContain("Words");
  });

  it.each([
    ["not JSON", "{not json"],
    ["not an array", '{"length":false}'],
    ["a bare string", '"length"'],
    ["the two columns that cannot be hidden", '["title","actions"]'],
    ["ids we do not have", '["nonsense",42,null]'],
  ])("shows everything when it holds %s", (_, raw) => {
    store.set(HIDDEN_COLUMNS_KEY, raw);
    paint();
    expect(headers()).toEqual(ALL_HEADERS);
  });

  it("keeps the ids it knows from a list that also holds ones it does not", () => {
    store.set(HIDDEN_COLUMNS_KEY, '["length","nonsense","title"]');
    paint();
    expect(headers()).toEqual(ALL_HEADERS.filter((h) => h !== "Words"));
  });
});

/* ------------------------------------------------------- the row card ---- */

describe("the row card", () => {
  it("carries a hidden column's value", async () => {
    paint([ENTRIES[0] as LibraryEntry]);
    await hideFromMenu("Length");
    const link = host.querySelector<HTMLAnchorElement>("tbody a[href]") as HTMLAnchorElement;
    link.dispatchEvent(new MouseEvent("mouseenter"));
    await wait(400);
    const cards = [...document.body.querySelectorAll<HTMLElement>(".tooltip")];
    expect(cards).toHaveLength(1);
    expect(flat(cards[0]?.textContent)).toContain("3,456 words");
  });

  it("takes the table's real hidden ids and restores every hidden value", async () => {
    store.set(HIDDEN_COLUMNS_KEY, '["opened","opens","questions","length"]');
    paint([entry({ slug: "hidden-facts", words: 3456, opens: 5, comments: 7 })]);
    expect(headers()).toEqual(["Article", "Added", "Actions"]);

    const link = host.querySelector<HTMLAnchorElement>("tbody a[href]") as HTMLAnchorElement;
    link.dispatchEvent(new MouseEvent("mouseenter"));
    await wait(400);
    const card = document.body.querySelector<HTMLElement>(".tooltip");
    const words = flat(card?.textContent);
    expect(words).toMatch(/Last opened\s*never/);
    expect(words).toMatch(/Opened\s*5 times/);
    expect(words).toMatch(/Comments\s*7/);
    expect(words).toContain("3,456 words");
  });
});

describe("visibility state identity", () => {
  it("keeps both controlled-state identities across an unrelated render", () => {
    const seen: Array<{ visibility: object; onChange: object }> = [];

    function IdentityHarness(): ReactElement {
      const columns = useMemo(() => libraryColumns(shelf, NOW), []);
      const [tick, setTick] = useState(0);
      const [columnVisibility, onColumnVisibilityChange] = useShelfHiddenColumns(columns);
      seen.push({ visibility: columnVisibility, onChange: onColumnVisibilityChange });
      useSortedTable<LibraryEntry>({
        data: ENTRIES,
        columns,
        sorting: STABLE_SORT,
        onSortingChange: () => {},
        rowId: slugOf,
        columnVisibility,
        onColumnVisibilityChange,
      });
      return createElement("button", { type: "button", onClick: () => setTick((n) => n + 1) }, tick);
    }

    act(() => root.render(createElement(IdentityHarness)));
    click(host.querySelector("button") as HTMLButtonElement);
    expect(seen).toHaveLength(2);
    expect(seen[1]?.visibility).toBe(seen[0]?.visibility);
    expect(seen[1]?.onChange).toBe(seen[0]?.onChange);
  });
});

/* ----------------------------------------------- sorting by a hidden column */

describe("hiding the column the shelf is sorted by (Sol P-6)", () => {
  function chip(): { pressed: string | null; label: string } {
    const hit = [...host.querySelectorAll<HTMLElement>("fieldset button")].filter(
      (b) => flat(b.textContent) === "Last opened",
    );
    expect(hit, "no single Last opened chip").toHaveLength(1);
    const b = hit[0] as HTMLElement;
    return { pressed: b.getAttribute("aria-pressed"), label: b.getAttribute("aria-label") ?? "" };
  }

  const snapshot = () => ({ order: order(), chip: chip() });

  it("keeps the order, missing-last, and the chip, in both directions", async () => {
    paint();
    const shown = snapshot();
    expect(shown.order).toEqual(["hide-a", "hide-b", "hide-c", "hide-never", "hide-fixture"]);
    expect(shown.chip.pressed).toBe("true");
    expect(shown.chip.label).toMatch(/most recent first/);

    await hideFromMenu("Last opened");
    expect(headers()).not.toContain("Last opened");
    expect(snapshot()).toEqual(shown);

    /* Reverse it from the chip while hidden, then show it again: the same. */
    const chipButton = [...host.querySelectorAll<HTMLElement>("fieldset button")].find(
      (b) => flat(b.textContent) === "Last opened",
    ) as HTMLElement;
    click(chipButton);
    const reversedHidden = snapshot();
    expect(reversedHidden.order).toEqual(["hide-c", "hide-b", "hide-a", "hide-never", "hide-fixture"]);
    expect(reversedHidden.chip.label).toMatch(/longest ago first/);

    openColumns();
    click(checkbox("Last opened"));
    expect(snapshot()).toEqual(reversedHidden);
  });
});

/* ------------------------------------------------------------- /admin ---- */

describe("/admin's table, which did not ask for any of this", () => {
  function user(n: number, over: Partial<AdminUser> = {}): AdminUser {
    return {
      id: `admin-hide-${n}`,
      email: `person${n}@example.test`,
      createdAt: `2026-08-0${n}T10:00:00.000Z`,
      providers: [],
      articles: n,
      archived: 0,
      uploads: 0,
      questions: 0,
      chats: 0,
      searches: 0,
      opens: n * 3,
      spendNanos: 0,
      spendCalls: 0,
      spendUnpricedCalls: 0,
      spendMonth: "2026-09",
      plan: "free",
      ingests: 0,
      ingestsShared: 0,
      ingestLimit: 3,
      ingestWindow: "lifetime",
      ...over,
    } as AdminUser;
  }
  const USERS = [user(1), user(2), user(3)];
  const idOf = (u: AdminUser) => u.id;

  function Admin(): ReactElement {
    const columns = useMemo(() => adminColumns(NOW), []);
    const [sorting, setSorting] = useState<SortingState>([{ id: "signedUp", desc: true }]);
    const table = useSortedTable<AdminUser>({
      data: USERS,
      columns,
      sorting,
      onSortingChange: setSorting,
      rowId: idOf,
    });
    return createElement(
      "div",
      null,
      createElement(ColumnsMenu<AdminUser>, { table }),
      createElement(DataTable<AdminUser>, {
        table,
        rows: table.getRowModel().rows,
        caption: "Everyone with an account",
      }),
    );
  }

  it("keeps every header and cell, still sorts, and offers no menu", () => {
    const columnCount = adminColumns(NOW).length;
    act(() => root.render(createElement(Admin)));

    expect(host.querySelectorAll("thead th")).toHaveLength(columnCount);
    expect(cellCounts()).toEqual([columnCount, columnCount, columnCount]);
    expect(
      [...host.querySelectorAll("button")].some((b) =>
        (b.getAttribute("aria-label") ?? "").startsWith("Columns"),
      ),
      "/admin grew a Columns menu",
    ).toBe(false);

    for (const cell of host.querySelectorAll("thead th")) {
      rightClick(cell);
      expect(menu(), `right-clicking ${flat(cell.textContent)} opened a menu`).toBeNull();
    }

    const ingests = [...host.querySelectorAll<HTMLElement>("thead th")].find(
      (el) => flat(el.textContent) === "Ingests",
    ) as HTMLElement;
    click(ingests.querySelector("button") as HTMLElement);
    expect(ingests.getAttribute("aria-sort")).toBe("descending");
  });
});
