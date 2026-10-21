// @vitest-environment jsdom
/**
 * **`DataTable`'s `pinFirst`: the first column stays on screen while the table
 * scrolls sideways.** Greg, 2026-10-19, on `/admin/users`:
 *
 * > When I scroll the table, can you keep the first column, which shows the
 * > name, frozen/visible the whole time?
 *
 * docs/plans/261019o-admin-tables-freeze-the-first-column.md. What has to hold:
 *
 *  - With `pinFirst`, the first **visible** column is pinned — its header and
 *    every cell under it — and no other. Hide that column and the next one
 *    along takes the pin, because `left: 0` is only right for the first.
 *  - Without it, nothing is pinned: the shelf draws as it did.
 *
 * jsdom does no layout, so this pins the class on the cell. Whether a sticky
 * cell actually stays put is the browser check in the plan.
 */
import { act, createElement, type ReactElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { SortingState, VisibilityState } from "@tanstack/react-table";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const { DataTable, useSortedTable } = await import("../src/web/lib/DataTable.js");
type SortableColumn<T> = import("../src/web/lib/DataTable.js").SortableColumn<T>;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Row = { id: string; name: string; count: number };
const ROWS: Row[] = [
  { id: "a", name: "Alice", count: 3 },
  { id: "b", name: "Bob", count: 5 },
];

const column = (id: "name" | "count"): SortableColumn<Row> => ({
  id,
  header: id,
  accessorFn: (r) => r[id],
  sortDescFirst: false,
  meta: { label: id, hint: id, ends: ["low", "high"], fluid: id === "name", numeric: id === "count" },
});
const COLUMNS = [column("name"), column("count")];

function Harness({ pinFirst, markedRowId }: { pinFirst?: boolean; markedRowId?: string }): ReactElement {
  const [sorting, setSorting] = useState<SortingState>([{ id: "name", desc: false }]);
  const [columnVisibility, setVisibility] = useState<VisibilityState>({});
  const table = useSortedTable<Row>({
    data: ROWS,
    columns: COLUMNS,
    sorting,
    onSortingChange: setSorting,
    rowId: (r) => r.id,
    columnVisibility,
    onColumnVisibilityChange: setVisibility,
  });
  return createElement(
    "div",
    null,
    createElement(
      "button",
      { type: "button", "data-hide-name": "", onClick: () => table.getColumn("name")?.toggleVisibility(false) },
      "Hide name",
    ),
    createElement(DataTable<Row>, {
      table,
      rows: table.getRowModel().rows,
      caption: "People",
      pinFirst: pinFirst ?? false,
      markedRowId: markedRowId ?? null,
    }),
  );
}

/** Which cells of each row are pinned: `[0]` on every row is the first column held. */
const pinnedIn = (root: ParentNode) =>
  [...root.querySelectorAll("tr")].map((tr) =>
    [...tr.children].flatMap((cell, i) => (cell.classList.contains("tw:sticky") ? [i] : [])),
  );

/** Sticky alone does not hold a column horizontally; it needs the inset too. */
const PIN_CLASSES = [
  "tw:sticky",
  "tw:left-0",
  "tw:z-10",
  "tw:bg-background",
  "tw:shadow-[1px_0_0_var(--border)]",
];

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("DataTable pinFirst", () => {
  it("pins the first column's header and every cell under it, and nothing else", () => {
    act(() => root.render(createElement(Harness, { pinFirst: true })));
    expect(pinnedIn(host)).toEqual([[0], [0], [0]]);
    for (const cell of host.querySelectorAll("th:first-child, td:first-child")) {
      expect([...cell.classList]).toEqual(expect.arrayContaining(PIN_CLASSES));
    }
  });

  it("moves the pin when the first visible column is hidden", () => {
    act(() => root.render(createElement(Harness, { pinFirst: true })));
    expect(host.querySelector("th")?.textContent).toContain("name");
    expect(pinnedIn(host)).toEqual([[0], [0], [0]]);

    act(() => host.querySelector<HTMLButtonElement>("[data-hide-name]")?.click());
    expect(host.querySelector("th")?.textContent).toContain("count");
    expect(pinnedIn(host)).toEqual([[0], [0], [0]]);
  });

  it("pins nothing without it", () => {
    act(() => root.render(createElement(Harness, {})));
    expect(pinnedIn(host)).toEqual([[], [], []]);
  });

  it("keeps the default row's attributes and fixed, fluid, numeric, pinned and marked classes", () => {
    act(() => root.render(createElement(Harness, { pinFirst: true, markedRowId: "a" })));
    const [marked, ordinary] = host.querySelectorAll("tbody tr");
    expect(marked?.getAttribute("data-row-id")).toBe("a");
    expect(marked?.getAttribute("aria-current")).toBe("true");
    expect([...marked!.classList]).toEqual(
      expect.arrayContaining([
        "tw:group",
        "tw:border-b",
        "tw:border-border/60",
        "tw:last:border-0",
        "tw:bg-[color-mix(in_oklab,var(--spideryarn-orange)_10%,var(--background))]",
      ]),
    );
    expect(ordinary?.getAttribute("data-row-id")).toBe("b");
    expect(ordinary?.hasAttribute("aria-current")).toBe(false);
    expect(ordinary?.classList.contains("tw:hover:bg-card")).toBe(true);

    const [fluid, numeric] = marked!.querySelectorAll("td");
    expect([...fluid!.classList]).toEqual(
      expect.arrayContaining([
        "tw:px-3",
        "tw:first:pl-4",
        "tw:py-2",
        "tw:w-full",
        "tw:max-w-0",
        "tw:min-w-56",
        "tw:sticky",
        "tw:left-0",
        "tw:max-sm:min-w-40",
      ]),
    );
    expect([...numeric!.classList]).toEqual(
      expect.arrayContaining([
        "tw:last:pr-4",
        "tw:whitespace-nowrap",
        "tw:text-xs",
        "tw:text-muted-foreground",
        "tw:text-right",
        "tw:tabular-nums",
      ]),
    );
  });
});
